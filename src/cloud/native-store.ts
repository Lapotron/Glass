import { Store, digest, parseEntry, serializeEntry, ConflictError } from '../engine/store.js';
import {
  entrySchema,
  librarySchema,
  siteSchema,
  publicEntry,
  publicNavigationFor,
  type Repository,
  type ContentKind,
  type EntryRevision,
  type Library,
  type SiteConfig,
} from '../shared/contracts.js';
import { projectsSchema, emptyProjects } from '../shared/projects.js';
import {
  photoTrashRecordSchema,
  entryTrashRecordSchema,
  type PhotoTrashItem,
  type TrashItem,
} from '../shared/operations.js';
import { validateEntryRoutes, retainedEntryRoutes } from '../shared/entry-routes.js';
import { validateShortLinks } from '../shared/shortlinks.js';
import { retainCollectionPaths, routeFor } from '../shared/collections.js';
import type { CloudWorkspace } from './workspace.js';
import { mediaSourceSchema } from '../shared/media-upload.js';

/** Native D1/R2 unit of work. Core authoring never calls an emulated OS filesystem. */
export class NativeStore extends Store {
  private recordLibraryHistory = true;
  private historyIndex?: Promise<Set<string>>;
  private repository?: { serial: number; value: Promise<Repository> };
  constructor(readonly workspace: CloudWorkspace) {
    super('/workspace');
  }
  override exclusive<T>(task: () => Promise<T>): Promise<T> {
    return task();
  }
  override maintenance<T>(task: () => Promise<T>): Promise<T> {
    return task();
  }
  text(path: string) {
    return this.workspace.read(path).then((value) => new TextDecoder().decode(value));
  }
  put(path: string, value: string | null) {
    this.workspace.write(path, value === null ? null : new TextEncoder().encode(value));
  }
  private async hasHistory(path: string) {
    if (this.workspace.changed.has(path)) return this.workspace.has(path);
    if (this.workspace.has(path)) return true;
    this.historyIndex ||= this.workspace.env.DB.prepare(
      "SELECT path FROM cloud_files WHERE path GLOB '.studio/revisions/*' OR path GLOB '.studio/pages/about/*'",
    )
      .all<{ path: string }>()
      .then((result) => new Set(result.results.map((file) => file.path)));
    return (await this.historyIndex).has(path);
  }
  paths(prefix: string) {
    return this.workspace.paths().filter((path) => path.startsWith(prefix));
  }
  override snapshot() {
    return this.read();
  }
  async validateRecoveryReferences() {
    for (const path of this.paths('.studio/trash/').filter((path) =>
      /^\.studio\/trash\/[\w-]+\.(?:md|json)$/.test(path),
    )) {
      const companion = path.replace(/\.(md|json)$/, path.endsWith('.md') ? '.json' : '.md');
      if (!this.workspace.has(companion))
        throw new Error('Trash recovery is incomplete: ' + companion);
    }
    for (const path of this.paths('.studio/media-originals/').filter((path) =>
      path.endsWith('/record.json'),
    )) {
      const source = mediaSourceSchema.parse(JSON.parse(await this.text(path))),
        folder = '.studio/media-originals/' + source.sourceId + '/',
        original = this.workspace.files.get(folder + 'original');
      if (path !== folder + 'record.json' || !original || original.sha !== source.sha256)
        throw new Error('Private original is missing or differs from its recipe: ' + path);
      for (const variant of source.variants)
        if (!this.workspace.has('content/media/' + variant.name))
          throw new Error('Prepared image is missing: ' + variant.name);
    }
    for (const path of this.paths('.studio/media-originals/').filter((path) =>
      path.endsWith('/original'),
    ))
      if (!this.workspace.has(path.replace(/original$/, 'record.json')))
        throw new Error('Private original recipe is missing: ' + path);
  }
  override async read(): Promise<Repository> {
    if (this.repository?.serial !== this.workspace.serial)
      this.repository = { serial: this.workspace.serial, value: this.readRepository() };
    return structuredClone(await this.repository!.value);
  }
  private async readRepository(): Promise<Repository> {
    const siteRaw = await this.text('content/site.json'),
      libraryRaw = await this.text('content/library.json');
    const site = siteSchema.parse(JSON.parse(siteRaw)),
      library = librarySchema.parse(JSON.parse(libraryRaw));
    const entries = await Promise.all(
      this.workspace
        .paths()
        .filter((path) => /^content\/(posts|lab)\/[^/]+\.md$/.test(path))
        .map(async (path) => {
          const parts = path.split('/');
          return parseEntry(await this.text(path), parts[1] as ContentKind, parts[2]);
        }),
    );
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
      throw new Error('Duplicate content identity.');
    validateEntryRoutes(entries, site.collections);
    validateShortLinks(entries);
    entries.sort(
      (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.title.localeCompare(b.title),
    );
    const about = this.workspace.has('content/about.md') ? await this.text('content/about.md') : '';
    const projects = this.workspace.has('content/projects.json')
      ? await this.text('content/projects.json')
      : '';
    return {
      site,
      library,
      entries,
      siteRevision: digest(siteRaw),
      libraryRevision: digest(libraryRaw),
      about: { body: about, revision: digest(about) },
      projects: projectsSchema.parse(projects ? JSON.parse(projects) : emptyProjects()),
      projectsRevision: digest(projects),
    };
  }
  override async create(
    kind: ContentKind,
    title: string,
    slug: string,
    draft?: { body: string; metadata?: Record<string, unknown> },
  ) {
    const model = await this.read(),
      id = crypto.randomUUID();
    const meta = entrySchema.parse({
      publishedAt: new Date().toISOString().slice(0, 10),
      ...draft?.metadata,
      status: 'draft',
      id,
      shortCode: digest(id).slice(0, 12),
      title,
      slug,
    });
    const file = slug + '.md',
      path = 'content/' + kind + '/' + file;
    if (this.workspace.has(path)) throw new Error('A file with that name already exists');
    const raw = serializeEntry(meta, draft?.body ?? 'Start with a thought.\n');
    const entry = parseEntry(raw, kind, file);
    validateEntryRoutes([...model.entries, entry], model.site.collections);
    validateShortLinks([...model.entries, entry]);
    this.put(path, raw);
    return entry;
  }
  override async saveEntry(
    id: string,
    data: { metadata: unknown; body: string; revision: string; draftOnly?: boolean },
    reason: EntryRevision['reason'] = 'edit',
  ) {
    const model = await this.read(),
      old = model.entries.find((entry) => entry.id === id);
    if (!old) throw new Error('Content not found');
    if (old.revision !== data.revision)
      throw new ConflictError(
        'This file changed outside Studio. Reload the latest version before saving.',
      );
    let metadata = entrySchema.parse(data.metadata);
    if (metadata.id !== id) throw new Error('Content identity cannot change');
    if (data.draftOnly && (old.status !== 'draft' || metadata.status !== 'draft'))
      throw new Error('MCP can only revise drafts.');
    if (metadata.slug !== old.slug && (old.routeAliases.length || old.discussion?.articleTerm)) {
      const canonical = routeFor({ ...old, ...metadata }, model.site.collections);
      metadata = entrySchema.parse({
        ...metadata,
        routeAliases: [
          ...new Set([
            ...old.routeAliases,
            ...metadata.routeAliases,
            ...retainedEntryRoutes(old, model.site.collections),
          ]),
        ].filter((route) => route !== canonical),
        discussion: {
          ...metadata.discussion,
          articleTerm: old.discussion?.articleTerm || routeFor(old),
        },
      });
    }
    const path = 'content/' + old.kind + '/' + old.file,
      original = await this.text(path),
      raw = serializeEntry(metadata, data.body);
    const saved = parseEntry(raw, old.kind, old.file);
    validateEntryRoutes(
      model.entries.map((entry) => (entry.id === id ? saved : entry)),
      model.site.collections,
    );
    validateShortLinks(model.entries.map((entry) => (entry.id === id ? saved : entry)));
    if (raw !== original) {
      const history = '.studio/revisions/' + id + '/' + old.revision + '.json';
      if (!(await this.hasHistory(history)))
        this.put(
          history,
          JSON.stringify({
            version: 1,
            kind: old.kind,
            file: old.file,
            raw: original,
            savedAt: this.workspace.files.get(path)?.modified || new Date().toISOString(),
            reason,
          }),
        );
      this.put(path, raw);
    }
    return saved;
  }
  override async saveAbout(body: string, revision: string, reason = 'edit') {
    if (body.length > 1000000) throw new Error('About must be Markdown under 1 MB.');
    const old = (await this.read()).about;
    if (old.revision !== revision)
      throw new ConflictError(
        'About changed outside Studio. Your text is preserved; reload before saving.',
      );
    if (old.body !== body) {
      const history = '.studio/pages/about/' + digest(old.body) + '.json';
      if (!(await this.hasHistory(history)))
        this.put(
          history,
          JSON.stringify({ body: old.body, savedAt: new Date().toISOString(), reason }),
        );
      this.put('content/about.md', body);
    }
    return { body, revision: digest(body) };
  }
  override async getRevision(id: string, revision: string) {
    entrySchema.shape.id.parse(id);
    if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid revision identity');
    const record = JSON.parse(
      await this.text('.studio/revisions/' + id + '/' + revision + '.json'),
    );
    if (
      record.version !== 1 ||
      digest(record.raw) !== revision ||
      !['posts', 'lab'].includes(record.kind) ||
      !['edit', 'restore', 'schedule', 'batch'].includes(record.reason) ||
      !Number.isFinite(Date.parse(record.savedAt))
    )
      throw new Error('This revision is damaged.');
    const entry = parseEntry(record.raw, record.kind, record.file);
    if (entry.id !== id) throw new Error('This revision belongs to another entry.');
    return {
      entry: publicEntry(entry),
      savedAt: record.savedAt as string,
      reason: record.reason as EntryRevision['reason'],
    };
  }
  override async listRevisions(id: string): Promise<EntryRevision[]> {
    const records = await Promise.all(
      this.paths('.studio/revisions/' + id + '/').map(async (path) => {
        const revision = path.split('/').at(-1)!.replace('.json', ''),
          record = await this.getRevision(id, revision);
        return {
          revision,
          savedAt: record.savedAt,
          title: record.entry.title,
          reason: record.reason,
          words: record.entry.body.trim().split(/\s+/).filter(Boolean).length,
          status: record.entry.status,
        };
      }),
    );
    return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  override async aboutRevisions() {
    return (
      await Promise.all(
        this.paths('.studio/pages/about/').map(async (path) => {
          return this.aboutRevision(path.split('/').at(-1)!.replace('.json', ''));
        }),
      )
    ).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  override async aboutRevision(revision: string) {
    if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid page revision');
    const record = JSON.parse(await this.text('.studio/pages/about/' + revision + '.json'));
    if (
      typeof record.body !== 'string' ||
      digest(record.body) !== revision ||
      !Number.isFinite(Date.parse(record.savedAt))
    )
      throw new Error('This page revision is damaged.');
    return { ...record, revision };
  }
  override async saveJson(
    type: 'site' | 'library',
    value: unknown,
    revision: string,
  ): Promise<{ value: SiteConfig | Library; revision: string }> {
    const path = 'content/' + type + '.json',
      old = await this.text(path);
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
      validateEntryRoutes((await this.read()).entries, site.collections);
    }
    const raw = JSON.stringify(parsed, null, 2) + '\n';
    if (raw !== old && type === 'library') {
      if (this.recordLibraryHistory)
        this.put(
          '.studio/history/' + Date.now() + '-' + crypto.randomUUID() + '.json',
          JSON.stringify({ previous: JSON.parse(old), afterRevision: digest(raw) }),
        );
      const next = parsed as Library;
      librarySchema.parse(JSON.parse(old)).photos.forEach((photo, position) => {
        if (!next.photos.some((item) => item.id === photo.id)) {
          const id = 'photo-' + crypto.randomUUID();
          this.put(
            '.studio/trash/photos/' + id + '.json',
            JSON.stringify({
              version: 1,
              id,
              kind: 'photos',
              photo,
              position,
              deletedAt: new Date().toISOString(),
            }),
          );
        }
      });
      for (const receipt of await this.listPhotoTrash())
        if (next.photos.some((photo) => JSON.stringify(photo) === JSON.stringify(receipt.photo)))
          this.put('.studio/trash/photos/' + receipt.id + '.json', null);
    }
    this.put(path, raw);
    return { value: parsed, revision: digest(raw) };
  }
  override async undoLibrary(revision: string) {
    if ((await this.read()).libraryRevision !== revision)
      throw new ConflictError('The collection changed. Reload it before undoing.');
    for (const path of this.paths('.studio/history/').sort().reverse()) {
      const record = JSON.parse(await this.text(path));
      if (record.afterRevision === revision) {
        this.recordLibraryHistory = false;
        try {
          const result = await this.saveJson('library', record.previous, revision);
          this.put(path, null);
          return { ...result, value: result.value as Library };
        } finally {
          this.recordLibraryHistory = true;
        }
      }
    }
    throw new Error('There are no earlier collection changes to undo.');
  }
  override async trash(id: string, revision: string) {
    const entry = (await this.read()).entries.find((item) => item.id === id);
    if (!entry || entry.revision !== revision)
      throw new ConflictError('The file changed. Reload it before moving it to Trash.');
    const path = 'content/' + entry.kind + '/' + entry.file;
    this.put(
      '.studio/trash/' + id + '.json',
      JSON.stringify({
        id,
        kind: entry.kind,
        file: entry.file,
        deletedAt: new Date().toISOString(),
      }),
    );
    this.put('.studio/trash/' + id + '.md', await this.text(path));
    this.put(path, null);
  }
  override async listPhotoTrash(): Promise<PhotoTrashItem[]> {
    return Promise.all(
      this.paths('.studio/trash/photos/')
        .filter((path) => path.endsWith('.json'))
        .map(async (path) => {
          const raw = await this.text(path),
            record = photoTrashRecordSchema.parse(JSON.parse(raw));
          if (path.split('/').at(-1) !== record.id + '.json')
            throw new Error('Photo Trash identity does not match.');
          return {
            ...record,
            title: record.photo.caption || record.photo.alt,
            revision: digest(raw),
          };
        }),
    );
  }
  override async listTrash(): Promise<TrashItem[]> {
    const photos = await this.listPhotoTrash(),
      entries = [];
    for (const path of this.paths('.studio/trash/').filter((path) =>
      /^\.studio\/trash\/[^/]+\.json$/.test(path),
    )) {
      const raw = await this.text(path),
        receipt = entryTrashRecordSchema.parse(JSON.parse(raw)),
        source = '.studio/trash/' + receipt.id + '.md';
      if (!this.workspace.has(source)) continue;
      const markdown = await this.text(source),
        entry = parseEntry(markdown, receipt.kind, receipt.file);
      if (path !== '.studio/trash/' + receipt.id + '.json' || entry.id !== receipt.id)
        throw new Error('Trash identity does not match.');
      entries.push({ ...receipt, title: entry.title, revision: digest(raw + markdown) });
    }
    return [...entries, ...photos];
  }
  override async restore(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error('Invalid trash identity');
    const raw = await this.text('.studio/trash/' + id + '.md'),
      record = entryTrashRecordSchema.parse(
        JSON.parse(await this.text('.studio/trash/' + id + '.json')),
      );
    const entry = parseEntry(raw, record.kind, record.file),
      model = await this.read();
    if (record.id !== id || entry.id !== id) throw new Error('Trash identity does not match.');
    validateEntryRoutes([...model.entries, entry], model.site.collections);
    validateShortLinks([...model.entries, entry]);
    const target = 'content/' + record.kind + '/' + record.file;
    if (this.workspace.has(target)) throw new Error('The original filename is occupied');
    this.put(target, raw);
    this.put('.studio/trash/' + id + '.md', null);
    this.put('.studio/trash/' + id + '.json', null);
  }
}
