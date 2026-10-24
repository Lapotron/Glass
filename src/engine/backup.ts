import { projectsSchema } from '../shared/projects.js';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { z } from 'zod';
import { Store, digest, atomicWrite, ConflictError, parseEntry } from './store.js';
import { MediaService } from './media.js';
import { librarySchema } from '../shared/contracts.js';
import { selectedItemsSchema } from '../shared/operations.js';
import { commitFiles, fileDigest } from './file-transaction.js';
import { OperationConflict } from './operations.js';
import {
  backupLocations as locations,
  backupPath as allowedPath,
  backupTarget as targetFor,
} from './backup-paths.js';
import {
  backupRevision,
  indexBackupFiles,
  hashBackupFile,
  createLargeBackup,
  extractLargeBackup,
  legacyBackupFile,
  type BackupFileIndex,
} from './backup-archive.js';
import { LARGE_BACKUP_BYTES } from '../shared/backup-transfer.js';

const compress = promisify(gzip),
  decompress = promisify(gunzip);
const MAX_ARCHIVE = 128 * 1024 * 1024,
  MAX_EXPANDED = 384 * 1024 * 1024;
const envelopeSchema = z.object({
  format: z.literal('fieldnotes-notebook'),
  version: z.union([z.literal(1), z.literal(2)]),
  createdAt: z.iso.datetime(),
  files: z
    .array(
      z.object({
        path: z.string().refine(allowedPath, 'Invalid backup path'),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        data: z.string(),
      }),
    )
    .max(10000),
});
type Envelope = z.infer<typeof envelopeSchema>;
type File = Envelope['files'][number];
export type BackupRecord = {
  id: string;
  createdAt: string;
  bytes: number;
  files: number;
  entries: number;
  media: number;
  revisions: number;
  name: string;
  reason: 'manual' | 'before-restore' | 'automatic' | 'before-cleanup';
  label?: string;
  sha256?: string;
  revision: string;
  available?: boolean;
  archiveFormat?: 'tar';
  unpackedBytes?: number;
};
export type RestoreReview = {
  id: string;
  createdAt: string;
  files: number;
  entries: number;
  media: number;
  revisions: number;
  name: string;
  added: number;
  changed: number;
  removed: number;
  sourceRevision: string;
  archiveFormat?: 'tar' | 'json';
  archiveBytes?: number;
  unpackedBytes?: number;
  archiveSha256?: string;
  expiresAt?: string;
};
type Capture = { envelope: Envelope; revision: string };
async function walk(base: string, prefix: string): Promise<File[]> {
  let nodes;
  try {
    if ((await fs.lstat(base)).isSymbolicLink())
      throw new Error(`Backups cannot include symbolic links: ${prefix}`);
    nodes = await fs.readdir(base, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: File[] = [];
  for (const node of nodes.sort((a, b) => a.name.localeCompare(b.name))) {
    if (node.name.startsWith('.')) continue;
    const file = path.join(base, node.name),
      name = `${prefix}/${node.name}`;
    if (node.isSymbolicLink()) throw new Error(`Backups cannot include symbolic links: ${name}`);
    if (node.isDirectory()) files.push(...(await walk(file, name)));
    else if (node.isFile()) {
      if (!allowedPath(name))
        throw new Error(`This file is outside portable notebook data: ${name}`);
      const data = await fs.readFile(file);
      files.push({ path: name, sha256: digest(data), data: data.toString('base64') });
    }
  }
  return files;
}
const revisionFor = (files: File[]) =>
  digest(
    files
      .map((file) => `${file.path}:${file.sha256}`)
      .sort()
      .join('\n'),
  );
const counts = (files: { path: string }[]) => ({
  files: files.length,
  entries: files.filter((file) => /^content\/(posts|lab)\//.test(file.path)).length,
  media: files.filter((file) => file.path.startsWith('content/media/')).length,
  revisions: files.filter((file) => file.path.startsWith('history/revisions/')).length,
});
async function capture(root: string): Promise<Capture> {
  const files = (
    await Promise.all(
      locations.map((location) => walk(path.join(root, location.disk), location.archive)),
    )
  ).flat();
  if (files.length > 10000)
    throw new Error('A notebook backup supports up to 10,000 source and history files.');
  const envelope: Envelope = {
    format: 'fieldnotes-notebook',
    version: 2,
    createdAt: new Date().toISOString(),
    files,
  };
  if (Buffer.byteLength(JSON.stringify(envelope)) > MAX_EXPANDED)
    throw new Error('Notebook is too large for this portable backup.');
  return { envelope, revision: revisionFor(files) };
}
async function validateAndStage(archive: Uint8Array, root: string) {
  if (archive.byteLength > MAX_ARCHIVE) throw new Error('Backup must be smaller than 128 MB.');
  let raw: Buffer;
  try {
    raw = await decompress(archive, { maxOutputLength: MAX_EXPANDED });
  } catch {
    throw new Error(
      'This is not a readable notebook backup, or it exceeds the expanded size limit.',
    );
  }
  const envelope = envelopeSchema.parse(JSON.parse(raw.toString('utf8')));
  const paths = new Set<string>();
  for (const file of envelope.files) {
    if (paths.has(file.path)) throw new Error(`Duplicate backup path: ${file.path}`);
    paths.add(file.path);
    const data = Buffer.from(file.data, 'base64');
    if (data.toString('base64') !== file.data || digest(data) !== file.sha256)
      throw new Error(`Backup checksum does not match: ${file.path}`);
    await atomicWrite(targetFor(root, file.path), data);
  }
  return { envelope, model: await validateStaged(root, envelope.files) };
}
async function validateStaged(root: string, files: { path: string }[]) {
  const paths = new Set(files.map((file) => file.path));
  for (const location of locations)
    await fs.mkdir(path.join(root, location.disk), { recursive: true });
  await fs.mkdir(path.join(root, 'content/posts'), { recursive: true });
  await fs.mkdir(path.join(root, 'content/lab'), { recursive: true });
  await fs.mkdir(path.join(root, 'content/media'), { recursive: true });
  const staged = new Store(root),
    model = await staged.read();
  // Loading every historical record verifies its hash and stable entry namespace as well.
  const ids = new Set(
    files
      .filter((file) => file.path.startsWith('history/revisions/'))
      .map((file) => file.path.split('/')[2]),
  );
  for (const id of ids) await staged.listRevisions(id);
  await staged.aboutRevisions();
  await staged.listPhotoTrash();
  await new MediaService(staged).validate();
  const receipts = files.filter((file) => /^history\/trash\/[^/]+\.json$/.test(file.path));
  for (const file of receipts) {
    const receipt = JSON.parse(await fs.readFile(targetFor(root, file.path), 'utf8'));
    if (
      !/^[\w-]{1,100}$/.test(receipt.id) ||
      !['posts', 'lab'].includes(receipt.kind) ||
      !/^[^/\\]+\.md$/.test(receipt.file) ||
      !paths.has(`history/trash/${receipt.id}.md`) ||
      file.path !== `history/trash/${receipt.id}.json`
    )
      throw new Error('Backup contains an invalid Trash record.');
    const deleted = parseEntry(
      await fs.readFile(path.join(root, '.studio/trash', `${receipt.id}.md`), 'utf8'),
      receipt.kind,
      receipt.file,
    );
    if (deleted.id !== receipt.id) throw new Error('A Trash entry does not match its receipt.');
  }
  for (const file of files.filter((file) => file.path.startsWith('history/collections/'))) {
    const record = JSON.parse(await fs.readFile(targetFor(root, file.path), 'utf8'));
    librarySchema.parse(record.previous);
    if (!/^[a-f0-9]{64}$/.test(record.afterRevision))
      throw new Error('Invalid collection history.');
  }
  for (const file of files.filter((file) => file.path.startsWith('history/projects/'))) {
    const record = JSON.parse(await fs.readFile(targetFor(root, file.path), 'utf8'));
    projectsSchema.parse(record.previous);
    if (!/^[a-f0-9]{64}$/.test(record.afterRevision)) throw new Error('Invalid project history.');
  }
  return model;
}
async function validateArchiveFile(archive: string, root: string) {
  let legacy: boolean;
  try {
    legacy = await legacyBackupFile(archive);
  } catch {
    throw new Error(
      'This is not a readable notebook backup. Choose a Glass .json.gz or .tar.gz archive.',
    );
  }
  if (legacy) {
    if ((await fs.stat(archive)).size > MAX_ARCHIVE)
      throw new Error(
        'Legacy JSON backups support up to 128 MiB. Create a large .tar.gz backup for bigger notebooks.',
      );
    return {
      ...(await validateAndStage(await fs.readFile(archive), root)),
      archiveFormat: 'json' as const,
    };
  }
  const envelope = await extractLargeBackup(archive, root);
  return {
    envelope,
    model: await validateStaged(root, envelope.files),
    archiveFormat: 'tar' as const,
  };
}
export const backupArchiveName = (record: Pick<BackupRecord, 'id' | 'archiveFormat'>) =>
  record.id + (record.archiveFormat === 'tar' ? '.tar.gz' : '.json.gz');
export class BackupService {
  private plans = new Map<string, { root: string; review: RestoreReview; createdAt: number }>();
  restoring = false;
  constructor(readonly store: Store) {}
  /** Caller owns the Store queue. Credentials and generated output stay excluded. */
  async portableSnapshot() {
    const captured = await capture(this.store.root);
    const bytes = await compress(JSON.stringify(captured.envelope));
    if (bytes.length > MAX_ARCHIVE)
      throw new Error('Notebook exceeds the 128 MB compressed backup limit.');
    return bytes;
  }
  async verifyPortableSnapshot(bytes: Uint8Array) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-reset-recovery-'));
    try {
      await validateAndStage(bytes, root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
  discardReviews() {
    this.plans.clear();
  }
  hasReview(id: string) {
    const plan = this.plans.get(id);
    return !!plan && Date.now() - plan.createdAt <= 20 * 60 * 1000;
  }
  private async save(captured: Capture, reason: BackupRecord['reason']) {
    const data = await compress(JSON.stringify(captured.envelope));
    if (data.length > MAX_ARCHIVE)
      throw new Error('Notebook exceeds the 128 MB compressed backup limit.');
    const site = JSON.parse(
      Buffer.from(
        captured.envelope.files.find((file) => file.path === 'content/site.json')!.data,
        'base64',
      ).toString('utf8'),
    );
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const record: Omit<BackupRecord, 'revision'> = {
      id,
      createdAt: captured.envelope.createdAt,
      bytes: data.length,
      ...counts(captured.envelope.files),
      name: site.name,
      reason,
      sha256: digest(data),
    };
    const folder = path.join(this.store.root, '.studio/backups');
    await commitFiles(this.store.root, [
      { file: path.join(folder, `${id}.json.gz`), value: data, expected: null },
      { file: path.join(folder, `${id}.json`), value: JSON.stringify(record), expected: null },
    ]);
    return (await this.list()).find((item) => item.id === id)!;
  }
  private async saveLarge(files: BackupFileIndex, reason: BackupRecord['reason']) {
    const temporary = path.join(this.store.root, '.studio/backup-work');
    await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const file = path.join(temporary, id + '.tar.gz');
    try {
      const manifest = await createLargeBackup(this.store.root, file, files);
      const site = JSON.parse(
        await fs.readFile(path.join(this.store.root, 'content/site.json'), 'utf8'),
      );
      const record: Omit<BackupRecord, 'revision'> = {
        id,
        createdAt: manifest.createdAt,
        bytes: (await fs.stat(file)).size,
        ...counts(files),
        name: site.name,
        reason,
        sha256: await hashBackupFile(file),
        archiveFormat: 'tar',
        unpackedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      };
      const folder = path.join(this.store.root, '.studio/backups');
      await commitFiles(this.store.root, [
        { file: path.join(folder, backupArchiveName(record)), source: file, expected: null },
        { file: path.join(folder, id + '.json'), value: JSON.stringify(record), expected: null },
      ]);
      return (await this.list()).find((item) => item.id === id)!;
    } finally {
      await fs.rm(file, { force: true });
    }
  }
  async create(
    reason: BackupRecord['reason'] = 'manual',
    format: 'large' | 'legacy' = reason === 'manual' ? 'legacy' : 'large',
  ) {
    return this.store.exclusive(async () =>
      format === 'large'
        ? this.saveLarge(await indexBackupFiles(this.store.root), reason)
        : this.save(await capture(this.store.root), reason),
    );
  }
  async list(): Promise<BackupRecord[]> {
    const folder = path.join(this.store.root, '.studio/backups');
    await fs.mkdir(folder, { recursive: true });
    const files = (await fs.readdir(folder)).filter((name) => /^\d+-[a-f0-9-]+\.json$/.test(name));
    const records = await Promise.all(
      files.map(async (name) => {
        const raw = await fs.readFile(path.join(folder, name), 'utf8');
        const record = JSON.parse(raw) as BackupRecord;
        if (record.id + '.json' !== name)
          throw new Error('Backup identity does not match its catalog.');
        const stat = await fs.stat(path.join(folder, backupArchiveName(record))).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        return {
          ...record,
          revision: digest(raw + '|' + stat?.size + '|' + stat?.mtimeMs),
          available: !!stat,
        };
      }),
    );
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async download(id: string) {
    return fs.readFile((await this.downloadFile(id)).file);
  }
  async downloadFile(id: string) {
    if (!/^\d+-[a-f0-9-]+$/.test(id)) throw new Error('Invalid backup identity');
    const record = JSON.parse(
      await fs.readFile(path.join(this.store.root, '.studio/backups', `${id}.json`), 'utf8'),
    ) as BackupRecord;
    if (record.id !== id) throw new Error('Backup identity does not match its catalog.');
    const file = path.join(this.store.root, '.studio/backups', backupArchiveName(record));
    if (record.sha256 && (await hashBackupFile(file)) !== record.sha256)
      throw new Error('The saved backup checksum changed.');
    return { file, record };
  }
  async batch(request: unknown) {
    const input = z
      .object({
        action: z.enum(['delete', 'label']),
        items: selectedItemsSchema,
        label: z.string().trim().max(100).optional(),
      })
      .strict()
      .parse(request);
    return this.store.exclusive(async () => {
      if (this.restoring) throw new Error('Wait for notebook restoration to finish.');
      const available = await this.list();
      const issues = input.items
        .filter(
          (item) =>
            !available.some((record) => record.id === item.id && record.revision === item.revision),
        )
        .map((item) => ({ id: item.id, message: item.id + ' changed or is unavailable.' }));
      if (issues.length) throw new OperationConflict(issues);
      const changes = [];
      for (const item of input.items) {
        const file = path.join(this.store.root, '.studio/backups', item.id + '.json');
        if (input.action === 'delete') {
          const record = available.find((record) => record.id === item.id)!;
          const archive = path.join(this.store.root, '.studio/backups', backupArchiveName(record));
          changes.push(
            { file: archive, value: null, expected: await fileDigest(archive) },
            { file, value: null, expected: await fileDigest(file) },
          );
        } else {
          if (input.label === undefined) throw new Error('Enter a backup label.');
          const original = await fs.readFile(file, 'utf8');
          changes.push({
            file,
            value: JSON.stringify({ ...JSON.parse(original), label: input.label }),
            expected: digest(original),
          });
        }
      }
      await commitFiles(this.store.root, changes);
      return { items: await this.list() };
    });
  }
  async inspect(data: Uint8Array): Promise<RestoreReview> {
    return this.inspectSource((file) => fs.writeFile(file, data));
  }
  async inspectFile(file: string): Promise<RestoreReview> {
    if ((await fs.stat(file)).size > LARGE_BACKUP_BYTES)
      throw new Error('Backup exceeds the 4 GiB compressed limit.');
    return this.inspectSource((target) => fs.copyFile(file, target, constants.COPYFILE_FICLONE));
  }
  async inspectSaved(id: string) {
    return this.inspectFile((await this.downloadFile(id)).file);
  }
  private async inspectSource(write: (file: string) => Promise<unknown>): Promise<RestoreReview> {
    const id = randomUUID(),
      root = path.join(this.store.root, '.studio/imports', id);
    try {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const source = path.join(root, 'source.json.gz');
      await write(source);
      const { envelope, model, archiveFormat } = await validateArchiveFile(source, root);
      const current = await this.store.exclusive(() => indexBackupFiles(this.store.root));
      const incoming = new Map(envelope.files.map((file) => [file.path, file.sha256])),
        previous = new Map(current.map((file) => [file.path, file.sha256]));
      const review: RestoreReview = {
        id,
        createdAt: envelope.createdAt,
        ...counts(envelope.files),
        name: model.site.name,
        sourceRevision: backupRevision(current),
        archiveFormat,
        archiveBytes: (await fs.stat(source)).size,
        unpackedBytes: (envelope.files as { data?: string; bytes?: number }[]).reduce(
          (sum, file) =>
            sum +
            (file.data !== undefined ? Buffer.byteLength(file.data, 'base64') : file.bytes || 0),
          0,
        ),
        archiveSha256: await hashBackupFile(source),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        added: [...incoming].filter(([file]) => !previous.has(file)).length,
        changed: [...incoming].filter(
          ([file, hash]) => previous.has(file) && previous.get(file) !== hash,
        ).length,
        removed: [...previous].filter(([file]) => !incoming.has(file)).length,
      };
      this.plans.set(id, { root, review, createdAt: Date.now() });
      for (const [key, plan] of this.plans)
        if (this.plans.size > 3 || Date.now() - plan.createdAt > 20 * 60 * 1000) {
          this.plans.delete(key);
          await fs.rm(plan.root, { recursive: true, force: true });
        }
      return review;
    } catch (error) {
      await fs.rm(root, { recursive: true, force: true });
      throw error;
    }
  }
  async restore(id: string, sourceRevision: string) {
    const plan = this.plans.get(id);
    if (!plan || Date.now() - plan.createdAt > 20 * 60 * 1000)
      throw new Error('This restore review expired. Review the backup again.');
    if (this.restoring) throw new Error('A notebook restore is already running.');
    this.restoring = true;
    try {
      return await this.store.exclusive(async () => {
        const current = await indexBackupFiles(this.store.root);
        if (
          sourceRevision !== plan.review.sourceRevision ||
          backupRevision(current) !== sourceRevision
        )
          throw new ConflictError(
            'The notebook changed after this review. Review the backup again before restoring.',
          );
        const archive = path.join(plan.root, 'source.json.gz');
        if (
          plan.review.archiveSha256 &&
          (await hashBackupFile(archive)) !== plan.review.archiveSha256
        )
          throw new Error('The reviewed archive changed. Review it again before restoring.');
        // Restage from the checksum-verified archive so edits to a preview directory cannot enter the notebook.
        const staged = path.join(plan.root, 'accepted');
        await fs.rm(staged, { recursive: true, force: true });
        // The accepted copy is re-extracted from the original archive. Release the old preview first.
        for (const location of locations)
          await fs.rm(path.join(plan.root, location.disk), { recursive: true, force: true });
        await validateArchiveFile(archive, staged);
        const safety = await this.saveLarge(current, 'before-restore');
        const rollback = path.join(plan.root, 'rollback');
        await fs.mkdir(rollback, { recursive: true });
        const moved: { target: string; old: string; hadOld: boolean; installed: boolean }[] = [];
        try {
          for (let index = 0; index < locations.length; index++) {
            const location = locations[index],
              target = path.join(this.store.root, location.disk),
              old = path.join(rollback, String(index));
            const state = { target, old, hadOld: false, installed: false };
            moved.push(state);
            try {
              await fs.rename(target, old);
              state.hadOld = true;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.rename(path.join(staged, location.disk), target);
            state.installed = true;
          }
        } catch (error) {
          for (const state of moved.reverse()) {
            if (state.installed) await fs.rm(state.target, { recursive: true, force: true });
            if (state.hadOld) await fs.rename(state.old, state.target);
          }
          throw error;
        }
        this.plans.delete(id);
        await fs.rm(plan.root, { recursive: true, force: true });
        return { safetyBackup: safety.id };
      });
    } finally {
      this.restoring = false;
    }
  }
}
