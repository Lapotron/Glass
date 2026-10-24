import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store, ConflictError, contained, digest } from './store.js';
import { BackupService } from './backup.js';
import { MediaService } from './media.js';
import { buildAssets, buildSite } from './build.js';
import { commitNotebookResetFiles, fileDigest, type FileChange } from './file-transaction.js';
import { librarySchema, type Repository } from '../shared/contracts.js';
import { canonicalMediaUrl } from '../shared/media-details.js';
import type {
  NotebookResetReview,
  NotebookResetResult,
  ResetRecovery,
} from '../shared/notebook-reset.js';

const resetFolders = [
  'content/posts',
  'content/lab',
  'content/media',
  '.studio/revisions',
  '.studio/trash',
  '.studio/history',
  '.studio/project-history',
  '.studio/pages',
  '.studio/media-originals',
  '.studio/backups',
  '.studio/jobs',
  '.studio/job-history',
  '.studio/builds',
  '.studio/render-cache',
  '.studio/exports',
  '.studio/imports',
  '.studio/reports',
  '.studio/search-console',
  '.studio/health',
  '.studio/analytics',
  '.studio/reset-recovery',
  'dist',
];
const protectedFiles = [
  'content/site.json',
  '.studio/connections.json',
  '.studio/launcher.json',
  '.studio/backup-settings.json',
];
const recoverySchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type Plan = {
  review: NotebookResetReview;
  backup: Buffer;
  keptFiles: Set<string>;
  originals: Map<string, string>;
  output: Map<string, Buffer>;
  library: string;
};
async function filesUnder(root: string, relative: string): Promise<string[]> {
  const base = path.join(root, relative);
  let entries;
  try {
    if ((await fs.lstat(base)).isSymbolicLink())
      throw new Error('Reset cannot follow symbolic links.');
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error('Reset cannot follow symbolic links.');
    const name = relative + '/' + entry.name;
    if (entry.isDirectory()) files.push(...(await filesUnder(root, name)));
    else if (entry.isFile()) files.push(name);
    else throw new Error('Reset requires regular notebook files.');
    if (files.length > 50000)
      throw new Error('Reset supports up to 50,000 notebook and artifact files.');
  }
  return files;
}
async function snapshot(root: string) {
  const names = new Set([
    ...(await Promise.all(resetFolders.map((folder) => filesUnder(root, folder)))).flat(),
    ...protectedFiles,
    'content/about.md',
    'content/library.json',
    'content/projects.json',
    '.studio/scheduler.json',
  ]);
  if (names.size > 50000)
    throw new Error('Reset supports up to 50,000 notebook and artifact files.');
  const files = new Map<string, string | null>();
  for (const name of [...names].sort()) files.set(name, await fileDigest(path.join(root, name)));
  return { files, revision: digest(JSON.stringify([...files])) };
}
const backupUrl = (id: string) => `/api/notebook/reset/${id}/backup`;
export class NotebookReset {
  private plans = new Map<string, Plan>();
  busy = false;
  constructor(
    readonly store: Store,
    readonly backups: BackupService,
    readonly idle: () => boolean,
    readonly completed: () => void = () => {},
  ) {}
  private requireIdle() {
    if (!this.idle())
      throw new ConflictError(
        'Wait for the active build, publication, backup or restore before resetting.',
      );
  }
  async review(): Promise<NotebookResetReview> {
    this.requireIdle();
    return this.store.exclusive(async () => {
      this.requireIdle();
      const model = await this.store.read(),
        before = await snapshot(this.store.root);
      const media = new Set<string>();
      const references = (value: unknown) => {
        if (typeof value === 'string' && value.startsWith('/media/'))
          media.add(canonicalMediaUrl(value));
        else if (Array.isArray(value)) value.forEach(references);
        else if (value && typeof value === 'object') Object.values(value).forEach(references);
      };
      references(model.site);
      const keptFiles = new Set(protectedFiles);
      for (const url of media) {
        const name = 'content/media/' + decodeURIComponent(url.slice(7));
        if (!before.files.get(name))
          throw new Error(
            `Site settings reference missing media: ${url}. Choose an available image or file before resetting.`,
          );
        keptFiles.add(name);
      }
      const originals = new Map<string, string>(),
        mediaService = new MediaService(this.store);
      const sourceIds = new Set(
        [...before.files.keys()]
          .filter((name) => name.startsWith('.studio/media-originals/'))
          .map((name) => name.split('/')[2]),
      );
      for (const id of sourceIds) {
        const { record } = await mediaService.source(id);
        const variants = record.variants.filter((variant) =>
          keptFiles.has('content/media/' + variant.name),
        );
        if (!variants.length) continue;
        const base = '.studio/media-originals/' + id + '/';
        keptFiles.add(base + 'original');
        keptFiles.add(base + 'record.json');
        originals.set(base + 'record.json', JSON.stringify({ ...record, variants }));
      }
      const backup = await this.backups.portableSnapshot();
      await this.backups.verifyPortableSnapshot(backup);
      const library = librarySchema.parse({ photos: [], albums: [], news: [], mediaDetails: {} });
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-reset-'));
      const output = new Map<string, Buffer>();
      try {
        for (const folder of ['posts', 'lab', 'media'])
          await fs.mkdir(path.join(temporary, 'content', folder), { recursive: true });
        await fs.copyFile(
          path.join(this.store.content, 'site.json'),
          path.join(temporary, 'content/site.json'),
        );
        await fs.writeFile(path.join(temporary, 'content/about.md'), '');
        await fs.writeFile(path.join(temporary, 'content/library.json'), JSON.stringify(library));
        for (const name of keptFiles)
          if (name.startsWith('content/media/'))
            await fs.copyFile(path.join(this.store.root, name), path.join(temporary, name));
        const blank: Repository = {
          ...model,
          entries: [],
          projects: { version: 1, projects: [] },
          projectsRevision: digest(''),
          library,
          about: { body: '', revision: digest('') },
        };
        const built = await buildSite(new Store(temporary), {
          model: blank,
          updateDist: false,
          assets: await buildAssets(this.store.root),
        });
        for (const name of built.manifest)
          output.set('dist/' + name, await fs.readFile(path.join(built.outputDir, name)));
      } catch (error) {
        throw new Error(
          'Could not prepare the empty notebook. Check site links and artwork before resetting. ' +
            (error as Error).message,
          { cause: error },
        );
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
      if ((await snapshot(this.store.root)).revision !== before.revision)
        throw new ConflictError('The notebook changed while preparing the reset. Review it again.');
      const id = randomUUID(),
        files = [...before.files.keys()];
      const review: NotebookResetReview = {
        id,
        sourceRevision: before.revision,
        expiresAt: new Date(Date.now() + 20 * 60000).toISOString(),
        siteName: model.site.name,
        counts: {
          posts: model.entries.filter((entry) => entry.kind === 'posts').length,
          lab: model.entries.filter((entry) => entry.kind === 'lab').length,
          photos: model.library.photos.length,
          albums: model.library.albums.length,
          projects: model.projects?.projects.length || 0,
          media: files.filter((name) => name.startsWith('content/media/') && !keptFiles.has(name))
            .length,
          trash: files.filter((name) => name.startsWith('.studio/trash/') && name.endsWith('.json'))
            .length,
          revisions: files.filter((name) =>
            /^\.studio\/(revisions|pages|history|project-history)\//.test(name),
          ).length,
          backups: files.filter((name) =>
            /^\.studio\/(backups|reset-recovery)\/.*\.json\.gz$/.test(name),
          ).length,
          builds: files.filter((name) => name.startsWith('.studio/jobs/') && name.endsWith('.json'))
            .length,
        },
        keptMedia: [...media].sort(),
        backupBytes: backup.length,
        backupUrl: backupUrl(id),
      };
      for (const [key, plan] of this.plans)
        if (Date.parse(plan.review.expiresAt) <= Date.now()) this.plans.delete(key);
      while (this.plans.size >= 2) this.plans.delete(this.plans.keys().next().value!);
      this.plans.set(id, {
        review,
        backup,
        keptFiles,
        originals,
        output,
        library: JSON.stringify(library, null, 2) + '\n',
      });
      return review;
    });
  }
  async commit(id: string, request: unknown): Promise<NotebookResetResult> {
    const input = z
      .object({
        sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
        confirmation: z.literal('RESET'),
      })
      .strict()
      .parse(request);
    z.uuid().parse(id);
    const plan = this.plans.get(id);
    if (!plan || Date.parse(plan.review.expiresAt) <= Date.now())
      throw new ConflictError('This reset review expired. Review the reset again.');
    if (this.busy) throw new ConflictError('A notebook reset is already running.');
    this.requireIdle();
    this.busy = true;
    try {
      return await this.store.maintenance(async () => {
        this.requireIdle();
        const current = await snapshot(this.store.root);
        if (
          current.revision !== input.sourceRevision ||
          plan.review.sourceRevision !== input.sourceRevision
        )
          throw new ConflictError(
            'The notebook changed after this review. Nothing was reset. Review the reset again.',
          );
        const changes = new Map<string, FileChange>();
        const change = (name: string, value: string | Buffer | null) =>
          changes.set(name, {
            file: path.join(this.store.root, name),
            value,
            expected: current.files.get(name) ?? null,
          });
        for (const [name, hash] of current.files)
          if (hash && !plan.keptFiles.has(name)) change(name, null);
        change('content/about.md', '');
        change('content/library.json', plan.library);
        change('content/projects.json', JSON.stringify({ version: 1, projects: [] }) + '\n');
        change('.studio/scheduler.json', JSON.stringify({ running: false, pendingIds: [] }));
        for (const [name, raw] of plan.originals)
          if (digest(raw) !== current.files.get(name)) change(name, raw);
        for (const [name, bytes] of plan.output) change(name, bytes);
        const createdAt = new Date().toISOString();
        change(`.studio/reset-recovery/${id}.json.gz`, plan.backup);
        change(
          `.studio/reset-recovery/${id}.json`,
          JSON.stringify({
            version: 1,
            id,
            createdAt,
            bytes: plan.backup.length,
            sha256: digest(plan.backup),
          }),
        );
        await commitNotebookResetFiles(this.store.root, [...changes.values()]);
        this.plans.clear();
        this.completed();
        return {
          recovery: { id, createdAt, bytes: plan.backup.length, url: backupUrl(id) },
          counts: plan.review.counts,
        };
      });
    } finally {
      this.busy = false;
    }
  }
  async recoveries(): Promise<ResetRecovery[]> {
    const root = path.join(this.store.root, '.studio/reset-recovery');
    if (
      await fs
        .lstat(root)
        .then((stat) => stat.isSymbolicLink())
        .catch((error) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        })
    )
      throw new Error('Reset recovery storage cannot use symbolic links.');
    const files = await fs.readdir(root).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const records: ResetRecovery[] = [];
    for (const file of files.filter((name) => name.endsWith('.json'))) {
      const record = recoverySchema.parse(
        JSON.parse(await fs.readFile(await contained(root, file), 'utf8')),
      );
      if (file !== record.id + '.json') throw new Error('Invalid reset recovery identity.');
      records.push({
        id: record.id,
        createdAt: record.createdAt,
        bytes: record.bytes,
        url: backupUrl(record.id),
      });
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async download(id: string) {
    z.uuid().parse(id);
    const plan = this.plans.get(id);
    if (plan && Date.parse(plan.review.expiresAt) > Date.now()) return plan.backup;
    const root = path.join(this.store.root, '.studio/reset-recovery');
    if ((await fs.lstat(root)).isSymbolicLink())
      throw new Error('Reset recovery storage cannot use symbolic links.');
    const record = recoverySchema.parse(
      JSON.parse(await fs.readFile(await contained(root, id + '.json'), 'utf8')),
    );
    const archive = await contained(root, id + '.json.gz');
    await fileDigest(archive);
    const bytes = await fs.readFile(archive);
    if (record.id !== id || digest(bytes) !== record.sha256 || bytes.length !== record.bytes)
      throw new Error('The reset recovery checksum changed.');
    return bytes;
  }
}
