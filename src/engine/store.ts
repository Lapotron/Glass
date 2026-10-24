import { readProjects } from './projects.js';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { countWork, mapConcurrent } from './work-cache.js';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { commitFiles, recoverTransactions, type FileChange } from './file-transaction.js';
import {
  photoTrashRecordSchema,
  type EntryTrashItem,
  type PhotoTrashItem,
  type TrashItem,
} from '../shared/operations.js';
import { validateShortLinks } from '../shared/shortlinks.js';
import { retainCollectionPaths, routeFor } from '../shared/collections.js';
import { retainedEntryRoutes, validateEntryRoutes } from '../shared/entry-routes.js';
import {
  entrySchema,
  siteSchema,
  librarySchema,
  type ContentEntry,
  type ContentKind,
  type Repository,
  type SiteConfig,
  type Library,
  type EntryRevision,
  publicEntry,
  publicNavigationFor,
} from '../shared/contracts.js';

export const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
export class ConflictError extends Error {}
export async function atomicWrite(file: string, text: string | Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, text);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
export async function contained(base: string, name: string) {
  const target = path.resolve(base, name);
  if (target === base || !target.startsWith(`${path.resolve(base)}${path.sep}`))
    throw new Error('Invalid project path');
  const realBase = await fs.realpath(base);
  let existing = target;
  while (true) {
    try {
      const real = await fs.realpath(existing);
      if (real !== realBase && !real.startsWith(`${realBase}${path.sep}`))
        throw new Error('Symbolic link leaves project directory');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      existing = path.dirname(existing);
    }
  }
  return target;
}
export function parseEntry(raw: string, kind: ContentKind, file: string): ContentEntry {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${file}: Markdown needs YAML frontmatter`);
  const metadata = entrySchema.parse(parseYaml(match[1]));
  return {
    ...metadata,
    shortCode: metadata.shortCode || digest(metadata.id).slice(0, 12),
    kind,
    body: raw.slice(match[0].length).replace(/^\r?\n/, ''),
    revision: digest(raw),
    file,
  };
}
export function serializeEntry(metadata: unknown, body: string) {
  return `---\n${stringifyYaml(entrySchema.parse(metadata))}---\n\n${body.endsWith('\n') ? body : `${body}\n`}`;
}
export class Store {
  readonly content: string;
  private parsedEntries = new Map<string, ContentEntry>();
  private parsedSite?: { raw: string; value: Repository['site'] };
  private parsedLibrary?: { raw: string; value: Repository['library'] };
  private pending: Promise<unknown> = Promise.resolve();
  private maintenanceActive = false;
  constructor(readonly root: string) {
    this.content = path.join(root, 'content');
  }
  async exclusive<T>(task: () => Promise<T>): Promise<T> {
    if (this.maintenanceActive)
      throw new ConflictError('The notebook is being reset. Wait for the reset to finish.');
    const run = async () => {
      await recoverTransactions(this.root);
      return task();
    };
    const next = this.pending.then(run, run);
    this.pending = next.catch(() => undefined);
    return next;
  }
  async maintenance<T>(task: () => Promise<T>): Promise<T> {
    if (this.maintenanceActive) throw new ConflictError('A notebook reset is already running.');
    const pending = this.exclusive(task);
    this.maintenanceActive = true;
    try {
      return await pending;
    } finally {
      this.maintenanceActive = false;
    }
  }
  snapshot() {
    return this.exclusive(() => this.read());
  }
  async read(): Promise<Repository> {
    const [siteRaw, libraryRaw, posts, lab, projects] = await Promise.all([
      fs.readFile(path.join(this.content, 'site.json'), 'utf8'),
      fs.readFile(path.join(this.content, 'library.json'), 'utf8'),
      this.readKind('posts'),
      this.readKind('lab'),
      readProjects(this.root),
    ]);
    const entries = [...posts, ...lab].sort(
      (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.title.localeCompare(b.title),
    );
    const ids = new Set<string>(),
      routes = new Set<string>();
    for (const entry of entries) {
      if (ids.has(entry.id)) throw new Error(`Duplicate content id: ${entry.id}`);
      const key = `${entry.kind}/${entry.slug.normalize('NFC').toLowerCase()}`;
      if (routes.has(key)) throw new Error(`Duplicate route: ${key}`);
      ids.add(entry.id);
      routes.add(key);
    }
    if (this.parsedSite?.raw !== siteRaw)
      this.parsedSite = { raw: siteRaw, value: siteSchema.parse(JSON.parse(siteRaw)) };
    if (this.parsedLibrary?.raw !== libraryRaw)
      this.parsedLibrary = { raw: libraryRaw, value: librarySchema.parse(JSON.parse(libraryRaw)) };
    const site = structuredClone(this.parsedSite!.value);
    const aboutRaw = await fs
      .readFile(path.join(this.content, 'about.md'), 'utf8')
      .catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    return {
      projects: projects.value,
      projectsRevision: projects.revision,
      site,
      about: {
        body:
          aboutRaw ??
          `# ${site.profile.name}\n\n${site.profile.bio}\n\n${site.profile.links.map((l) => `- [${l.label}](${l.href})`).join('\n')}\n`,
        revision: digest(aboutRaw ?? ''),
      },
      library: structuredClone(this.parsedLibrary!.value),
      entries,
      siteRevision: digest(siteRaw),
      libraryRevision: digest(libraryRaw),
    };
  }
  async saveAbout(body: string, revision: string, reason = 'edit') {
    if (typeof body !== 'string' || body.length > 1000000)
      throw new Error('About must be Markdown under 1 MB.');
    return this.exclusive(async () => {
      const old = (await this.read()).about;
      if (old.revision !== revision)
        throw new ConflictError(
          'About changed outside Studio. Your text is preserved; reload before saving.',
        );
      if (old.body === body) return old;
      const target = path.join(this.content, 'about.md');
      const raw = await fs.readFile(target, 'utf8').catch((e) => {
        if (e.code === 'ENOENT') return '';
        throw e;
      });
      if (digest(raw) !== revision)
        throw new ConflictError('About changed while saving. Reload the latest version.');
      const previous = digest(old.body);
      await atomicWrite(
        path.join(this.root, '.studio/pages/about', `${previous}.json`),
        JSON.stringify({ body: old.body, savedAt: new Date().toISOString(), reason }),
      );
      await atomicWrite(target, body);
      return { body, revision: digest(body) };
    });
  }
  async aboutRevision(revision: string) {
    if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid page revision');
    const record = JSON.parse(
      await fs.readFile(path.join(this.root, '.studio/pages/about', `${revision}.json`), 'utf8'),
    );
    if (
      typeof record.body !== 'string' ||
      digest(record.body) !== revision ||
      !Number.isFinite(Date.parse(record.savedAt))
    )
      throw new Error('Damaged About revision');
    return { ...record, revision } as {
      body: string;
      revision: string;
      savedAt: string;
      reason: string;
    };
  }
  async aboutRevisions() {
    const names = await fs.readdir(path.join(this.root, '.studio/pages/about')).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    return (
      await Promise.all(
        names
          .filter((n) => /^[a-f0-9]{64}\.json$/.test(n))
          .map((n) => this.aboutRevision(n.slice(0, -5))),
      )
    ).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  private async readKind(kind: ContentKind) {
    const base = path.join(this.content, kind);
    const names = (await fs.readdir(base)).filter((name) => name.endsWith('.md'));
    const active = new Set(names.map((name) => `${kind}/${name}`));
    for (const key of this.parsedEntries.keys())
      if (key.startsWith(kind + '/') && !active.has(key)) this.parsedEntries.delete(key);
    return mapConcurrent(names, 16, async (name) => {
      const file = await contained(base, name);
      const raw = await fs.readFile(file, 'utf8'),
        key = `${kind}/${name}`;
      let parsed = this.parsedEntries.get(key);
      if (parsed?.revision !== digest(raw)) {
        parsed = parseEntry(raw, kind, name);
        this.parsedEntries.set(key, parsed);
        countWork('notebook.parse');
      }
      return structuredClone(parsed!);
    });
  }
  async saveEntry(
    id: string,
    data: { metadata: unknown; body: string; revision: string; draftOnly?: boolean },
    reason: EntryRevision['reason'] = 'edit',
  ) {
    return this.exclusive(async () => {
      const model = await this.read();
      const old = model.entries.find((entry) => entry.id === id);
      if (!old) throw new Error('Content not found');
      if(data.draftOnly && old.status !== 'draft') throw new ConflictError('MCP can only revise drafts. Duplicate this entry as a draft in Studio first.');
      if (old.revision !== data.revision)
        throw new ConflictError(
          'This file changed outside Studio. Reload the latest version before saving.',
        );
      let metadata = entrySchema.parse(data.metadata);
      if(data.draftOnly && metadata.status !== 'draft') throw new Error('MCP drafts cannot be published or scheduled.');
      if (metadata.id !== id) throw new Error('Content identity cannot change');
      if(metadata.slug!==old.slug && (old.routeAliases.length || old.discussion?.articleTerm)) {
        const canonical=routeFor({...old,...metadata},model.site.collections);
        metadata=entrySchema.parse({...metadata,routeAliases:[...new Set([...old.routeAliases,...metadata.routeAliases,...retainedEntryRoutes(old,model.site.collections)])].filter(route=>route!==canonical),discussion:{...metadata.discussion,articleTerm:old.discussion?.articleTerm||routeFor(old)}});
      }
      validateEntryRoutes(model.entries.map(entry=>entry.id===id?{...entry,...metadata}:entry),model.site.collections);
      validateShortLinks(
        model.entries.map((entry) =>
          entry.id === id
            ? { ...entry, ...metadata, shortCode: metadata.shortCode || digest(id).slice(0, 12) }
            : entry,
        ),
      );
      if (
        model.entries.some(
          (e) =>
            e.id !== id &&
            e.kind === old.kind &&
            e.slug.toLowerCase() === metadata.slug.toLowerCase(),
        )
      )
        throw new Error('This URL is already in use');
      const raw = serializeEntry(metadata, data.body);
      const target = await contained(path.join(this.content, old.kind), old.file);
      const original = await fs.readFile(target, 'utf8');
      if (digest(original) !== old.revision)
        throw new ConflictError('This file changed while saving. Reload the latest version.');
      if (raw === original) return old;
      const savedAt = (await fs.stat(target)).mtime.toISOString();
      await atomicWrite(
        path.join(this.root, '.studio/revisions', id, `${old.revision}.json`),
        JSON.stringify({
          version: 1,
          kind: old.kind,
          file: old.file,
          raw: original,
          savedAt,
          reason,
        }),
      );
      await atomicWrite(target, raw);
      return parseEntry(raw, old.kind, old.file);
    });
  }
  async getRevision(id: string, revision: string) {
    entrySchema.shape.id.parse(id);
    if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid revision identity');
    const file = await contained(
      path.join(this.root, '.studio'),
      `revisions/${id}/${revision}.json`,
    );
    const record = JSON.parse(await fs.readFile(file, 'utf8')) as {
      version: number;
      kind: ContentKind;
      file: string;
      raw: string;
      savedAt: string;
      reason: EntryRevision['reason'];
    };
    if (
      record.version !== 1 ||
      !['posts', 'lab'].includes(record.kind) ||
      typeof record.raw !== 'string' ||
      digest(record.raw) !== revision ||
      !['edit', 'restore', 'schedule', 'batch'].includes(record.reason) ||
      !Number.isFinite(Date.parse(record.savedAt))
    )
      throw new Error('This revision is damaged.');
    const entry = parseEntry(record.raw, record.kind, record.file);
    if (entry.id !== id) throw new Error('This revision belongs to another entry.');
    return { entry: publicEntry(entry), savedAt: record.savedAt, reason: record.reason };
  }
  async listRevisions(id: string): Promise<EntryRevision[]> {
    entrySchema.shape.id.parse(id);
    const folder = path.join(this.root, '.studio/revisions', id);
    let names: string[];
    try {
      names = await fs.readdir(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const revisions = await Promise.all(
      names
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map(async (name) => {
          const record = await this.getRevision(id, name.slice(0, -5));
          return {
            revision: record.entry.revision,
            savedAt: record.savedAt,
            title: record.entry.title,
            reason: record.reason,
            words: record.entry.body.trim().split(/\s+/).filter(Boolean).length,
            status: record.entry.status,
          };
        }),
    );
    return revisions.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async restoreRevision(id: string, selected: string, revision: string) {
    const { entry } = await this.getRevision(id, selected);
    const current = (await this.read()).entries.find((candidate) => candidate.id === id);
    if (!current) throw new Error('The current entry is unavailable.');
    return this.saveEntry(id, { metadata: {...entry,routeAliases:[...new Set([...current.routeAliases,...entry.routeAliases])],discussion:{...entry.discussion,articleTerm:current.discussion?.articleTerm||entry.discussion?.articleTerm}}, body: entry.body, revision }, 'restore');
  }
  async publishDue(now = new Date()) {
    const due = (await this.read()).entries.filter(
      (entry) => entry.status === 'scheduled' && Date.parse(entry.publishAt) <= now.getTime(),
    );
    const promoted: string[] = [];
    for (const entry of due) {
      await this.saveEntry(
        entry.id,
        { metadata: { ...entry, status: 'published' }, body: entry.body, revision: entry.revision },
        'schedule',
      );
      promoted.push(entry.id);
    }
    return promoted;
  }
  async create(kind: ContentKind, title: string, slug: string, draft?: {body:string;metadata?:Record<string,unknown>}) {
    return this.exclusive(async () => {
      const model = await this.read();
      const id = randomUUID();
      const meta = entrySchema.parse({
        publishedAt: new Date().toISOString().slice(0, 10),
        ...draft?.metadata,
        status: 'draft',
        id,
        shortCode: digest(id).slice(0, 12),
        title,
        slug,
      });
      if (model.entries.some((e) => e.kind === kind && e.slug.toLowerCase() === slug.toLowerCase()))
        throw new Error('This URL is already in use');
      validateShortLinks([...model.entries, meta]);
      const file = `${slug}.md`;
      const target = await contained(path.join(this.content, kind), file);
      try {
        await fs.access(target);
        throw new Error('A file with that name already exists');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const raw = serializeEntry(
        meta,
        draft?.body ?? `Start with a thought.\n\n## A place to begin\n\nWrite something worth sharing.\n`,
      );
      validateEntryRoutes([...model.entries,parseEntry(raw,kind,file)],model.site.collections);
      await atomicWrite(target, raw);
      return parseEntry(raw, kind, file);
    });
  }
  async saveJson(
    type: 'site' | 'library',
    value: unknown,
    revision: string,
  ): Promise<{ value: SiteConfig | Library; revision: string }> {
    return this.exclusive(async () => {
      const target = path.join(this.content, `${type}.json`);
      const old = await fs.readFile(target, 'utf8');
      if (digest(old) !== revision)
        throw new ConflictError('Settings changed outside Studio. Reload before saving.');
      const parsed = type === 'site' ? siteSchema.parse(value) : librarySchema.parse(value);
      if (type === 'site') {
        const site = parsed as SiteConfig;
        site.navigation = publicNavigationFor(site.collections).map((item) => ({ ...item }));
        site.collections = retainCollectionPaths(
          site.collections,
          siteSchema.parse(JSON.parse(old)).collections,
        );
        validateEntryRoutes((await this.read()).entries,site.collections);
      }
      const text = `${JSON.stringify(parsed, null, 2)}\n`;
      if (type === 'library')
        await commitFiles(this.root, await this.prepareLibraryChange(old, parsed as Library));
      else await atomicWrite(target, text);
      return { value: parsed, revision: digest(text) };
    });
  }
  /** Prepare only while holding the Store queue; install with commitFiles. */
  async prepareLibraryChange(
    old: string,
    value: Library,
    { history = true, reconcileTrash = true } = {},
  ): Promise<FileChange[]> {
    const previous = librarySchema.parse(JSON.parse(old)),
      next = librarySchema.parse(value),
      text = `${JSON.stringify(next, null, 2)}\n`;
    if (old === text) return [];
    const changes: FileChange[] = [],
      activeIds = new Set(next.photos.map((photo) => photo.id));
    previous.photos.forEach((photo, position) => {
      if (activeIds.has(photo.id)) return;
      const record = photoTrashRecordSchema.parse({
        version: 1,
        id: 'photo-' + randomUUID(),
        kind: 'photos',
        photo,
        position,
        deletedAt: new Date().toISOString(),
      });
      changes.push({
        file: path.join(this.root, '.studio/trash/photos', record.id + '.json'),
        value: JSON.stringify(record),
        expected: null,
      });
    });
    if (reconcileTrash) {
      for (const receipt of await this.listPhotoTrash()) {
        if (next.photos.some((photo) => JSON.stringify(photo) === JSON.stringify(receipt.photo)))
          changes.push({
            file: path.join(this.root, '.studio/trash/photos', receipt.id + '.json'),
            value: null,
            expected: receipt.revision,
          });
      }
    }
    if (history)
      changes.push({
        file: path.join(this.root, '.studio/history', `${Date.now()}-${randomUUID()}.json`),
        value: JSON.stringify({ previous: JSON.parse(old), afterRevision: digest(text) }),
        expected: null,
      });
    changes.push({
      file: path.join(this.content, 'library.json'),
      value: text,
      expected: digest(old),
    });
    return changes;
  }
  async listPhotoTrash(): Promise<PhotoTrashItem[]> {
    const base = path.join(this.root, '.studio/trash/photos');
    await fs.mkdir(base, { recursive: true });
    if ((await fs.lstat(base)).isSymbolicLink()) throw new Error('Invalid photo Trash directory.');
    const items: PhotoTrashItem[] = [];
    for (const name of await fs.readdir(base)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(base, name),
        stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Invalid photo Trash file.');
      const raw = await fs.readFile(file, 'utf8'),
        parsed = photoTrashRecordSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || name !== parsed.data.id + '.json')
        throw new Error('A photo Trash record is damaged. Restore it from a notebook backup.');
      items.push({
        ...parsed.data,
        title: parsed.data.photo.caption || parsed.data.photo.alt,
        revision: digest(raw),
      });
    }
    return items;
  }
  async undoLibrary(revision: string) {
    return this.exclusive(async () => {
      const file = path.join(this.content, 'library.json'),
        raw = await fs.readFile(file, 'utf8');
      if (digest(raw) !== revision)
        throw new ConflictError('The collection changed. Reload it before undoing.');
      const folder = path.join(this.root, '.studio/history');
      await fs.mkdir(folder, { recursive: true });
      const names = (await fs.readdir(folder))
        .filter((n) => n.endsWith('.json'))
        .sort()
        .reverse();
      for (const name of names) {
        const historyRaw = await fs.readFile(path.join(folder, name), 'utf8'),
          history = JSON.parse(historyRaw);
        if (history.afterRevision === revision) {
          const value = librarySchema.parse(history.previous),
            text = `${JSON.stringify(value, null, 2)}\n`;
          await commitFiles(this.root, [
            ...(await this.prepareLibraryChange(raw, value, { history: false })),
            { file: path.join(folder, name), value: null, expected: digest(historyRaw) },
          ]);
          return { value, revision: digest(text) };
        }
      }
      throw new Error('There are no earlier collection changes to undo.');
    });
  }
  async trash(id: string, revision: string) {
    return this.exclusive(async () => {
      const model = await this.read();
      const item = model.entries.find((e) => e.id === id);
      if (!item) throw new Error('Content not found');
      if (item.revision !== revision)
        throw new ConflictError('The file changed. Reload it before moving it to Trash.');
      const base = path.join(this.root, '.studio/trash');
      await fs.mkdir(base, { recursive: true });
      const receipt = { id, kind: item.kind, file: item.file, deletedAt: new Date().toISOString() };
      await atomicWrite(path.join(base, `${id}.json`), JSON.stringify(receipt));
      await fs.rename(
        await contained(path.join(this.content, item.kind), item.file),
        path.join(base, `${id}.md`),
      );
    });
  }
  async listTrash(): Promise<TrashItem[]> {
    const base = path.join(this.root, '.studio/trash');
    await fs.mkdir(base, { recursive: true });
    const names = (await fs.readdir(base)).filter((n) => n.endsWith('.json'));
    const items = await Promise.all(
      names.map(async (n) => {
        const receipt = JSON.parse(await fs.readFile(path.join(base, n), 'utf8'));
        try {
          const entry = parseEntry(
            await fs.readFile(path.join(base, `${receipt.id}.md`), 'utf8'),
            receipt.kind,
            receipt.file,
          );
          return {
            ...receipt,
            title: entry.title,
            revision: digest(
              (await fs.readFile(path.join(base, n), 'utf8')) +
                (await fs.readFile(path.join(base, `${receipt.id}.md`), 'utf8')),
            ),
          };
        } catch {
          return null;
        }
      }),
    );
    return [
      ...items.filter((item): item is EntryTrashItem => item !== null),
      ...(await this.listPhotoTrash()),
    ];
  }
  async restore(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error('Invalid trash identity');
    return this.exclusive(async () => {
      const base = path.join(this.root, '.studio/trash');
      const receipt = JSON.parse(await fs.readFile(path.join(base, `${id}.json`), 'utf8'));
      const kind = receipt.kind as ContentKind;
      if (!['posts', 'lab'].includes(kind)) throw new Error('Invalid collection');
      const raw = await fs.readFile(path.join(base, `${id}.md`), 'utf8');
      const entry = parseEntry(raw, kind, receipt.file);
      const model = await this.read();
      if (
        model.entries.some((e) => e.id === entry.id || (e.kind === kind && e.slug === entry.slug))
      )
        throw new Error('A restored entry would conflict with existing content');
      validateShortLinks([...model.entries, entry]);
      validateEntryRoutes([...model.entries,entry],model.site.collections);
      const target = await contained(path.join(this.content, kind), receipt.file);
      try {
        await fs.access(target);
        throw new Error('The original filename is occupied');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      await atomicWrite(target, raw);
      await fs.rm(path.join(base, `${id}.md`));
      await fs.rm(path.join(base, `${id}.json`));
    });
  }
}
