import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { Store, ConflictError, contained, digest, parseEntry, serializeEntry } from './store.js';
import { commitFiles, fileDigest, type FileChange } from './file-transaction.js';
import {
  entrySchema,
  librarySchema,
  publicEntry,
  type ContentEntry,
  type ContentKind,
  type EntryMeta,
  type Photo,
} from '../shared/contracts.js';
import {
  contentBatchSchema,
  selectedItemsSchema,
  type OperationIssue,
  type EntryTrashItem,
  type PhotoTrashItem,
} from '../shared/operations.js';
import { validateShortLinks } from '../shared/shortlinks.js';
import { retainedEntryRoutes, validateEntryRoutes } from '../shared/entry-routes.js';
import { routeFor } from '../shared/collections.js';

export class OperationConflict extends ConflictError {
  constructor(readonly issues: OperationIssue[]) {
    super('No items were changed. ' + issues.map((issue) => issue.message).join(' '));
  }
}
export const snapshotRevision = (model: unknown) => digest(JSON.stringify(model));
async function treeFiles(folder: string): Promise<string[]> {
  let items;
  try {
    items = await fs.readdir(folder, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const item of items) {
    if (item.isSymbolicLink()) throw new Error('History cannot contain symbolic links.');
    const target = path.join(folder, item.name);
    files.push(...(item.isDirectory() ? await treeFiles(target) : [target]));
  }
  return files;
}
function freeSlug(base: string, kind: ContentKind, occupied: Set<string>, files: Set<string>) {
  const stem = base.slice(0, 86).replace(/-+$/, '') || 'entry';
  let slug = stem,
    suffix = 2;
  while (occupied.has(kind + '/' + slug.toLowerCase()) || files.has(kind + '/' + slug + '.md'))
    slug = stem + '-' + suffix++;
  occupied.add(kind + '/' + slug.toLowerCase());
  files.add(kind + '/' + slug + '.md');
  return slug;
}
export type MarkdownImportReview = {
  id: string;
  sourceRevision: string;
  entries: { name: string; title: string; slug: string; kind: ContentKind; warnings: string[] }[];
  expiresAt: string;
};
export class Operations {
  private imports = new Map<
    string,
    {
      review: MarkdownImportReview;
      entries: { metadata: EntryMeta; body: string; kind: ContentKind; file: string }[];
    }
  >();
  constructor(readonly store: Store) {}
  discardReviews() {
    this.imports.clear();
  }
  async content(request: unknown) {
    const input = contentBatchSchema.parse(request);
    return this.store.exclusive(async () => {
      const model = await this.store.read();
      const issues: OperationIssue[] = [];
      const selected: ContentEntry[] = [];
      for (const item of input.items) {
        const entry = model.entries.find((entry) => entry.id === item.id);
        if (!entry || entry.revision !== item.revision)
          issues.push({
            id: item.id,
            message: `${entry?.title || item.id} changed or is unavailable. Refresh the selection.`,
          });
        else selected.push(entry);
      }
      if (issues.length) throw new OperationConflict(issues);
      const changes: FileChange[] = [],
        updated: ContentEntry[] = [],
        trashed: EntryTrashItem[] = [];
      const occupied = new Set(
        model.entries.map((entry) => entry.kind + '/' + entry.slug.toLowerCase()),
      );
      const files = new Set(model.entries.map((entry) => entry.kind + '/' + entry.file));
      for (const entry of selected) {
        const target = await contained(path.join(this.store.content, entry.kind), entry.file);
        const original = await fs.readFile(target, 'utf8');
        if (digest(original) !== entry.revision)
          throw new OperationConflict([
            { id: entry.id, message: entry.title + ' changed during review.' },
          ]);
        if (input.action === 'trash') {
          const receipt = {
            id: entry.id,
            kind: entry.kind,
            file: entry.file,
            deletedAt: new Date().toISOString(),
          };
          const receiptRaw = JSON.stringify(receipt);
          changes.push(
            {
              file: path.join(this.store.root, '.studio/trash', entry.id + '.json'),
              value: receiptRaw,
              expected: null,
            },
            {
              file: path.join(this.store.root, '.studio/trash', entry.id + '.md'),
              value: original,
              expected: null,
            },
            { file: target, value: null, expected: entry.revision },
          );
          trashed.push({ ...receipt, title: entry.title, revision: digest(receiptRaw + original) });
          continue;
        }
        if (input.action === 'duplicate') {
          const id = randomUUID(),
            slug = freeSlug(entry.slug + '-copy', entry.kind, occupied, files);
          const metadata = entrySchema.parse({
            ...entry,
            id,
            slug,
            title: entry.title.slice(0, 148) + ' (copy)',
            status: 'draft',
            publishAt: '',
            publishedAt: new Date().toISOString().slice(0, 10),
            updatedAt: undefined,
            featured: false,
            demo: false,
            shortCode: digest(id).slice(0, 12),
            shortAliases: [],
            routeAliases: [],
            discussion: entry.discussion ? {...entry.discussion,articleTerm:undefined} : undefined,
          });
          const raw = serializeEntry(metadata, entry.body);
          changes.push({
            file: path.join(this.store.content, entry.kind, slug + '.md'),
            value: raw,
            expected: null,
          });
          updated.push(parseEntry(raw, entry.kind, slug + '.md'));
          continue;
        }
        let metadata: EntryMeta = { ...entry };
        let nextKind=entry.kind, nextFile=entry.file;
        if(input.action==='convert') {
          if(!input.targetKind)throw new Error('Choose a destination collection.');
          if(input.targetKind===entry.kind){updated.push(entry);continue;}
          nextKind=input.targetKind;
          const slug=input.slugs?.[entry.id]||entry.slug;
          nextFile=slug+'.md';
          const destination=routeFor({kind:nextKind,slug},model.site.collections);
          metadata={...metadata,slug,routeAliases:[...new Set([...entry.routeAliases,...retainedEntryRoutes(entry,model.site.collections)])].filter(route=>route!==destination),discussion:{...entry.discussion,articleTerm:entry.discussion?.articleTerm||routeFor(entry)}};
          if(occupied.has(nextKind+'/'+slug.toLowerCase())||files.has(nextKind+'/'+nextFile)) {
            issues.push({id:entry.id,message:`${entry.title}: destination URL or filename is already in use. Choose a different slug.`});continue;
          }
          occupied.add(nextKind+'/'+slug.toLowerCase());files.add(nextKind+'/'+nextFile);
        } else if (input.action === 'status') {
          if (!input.status) throw new Error('Choose the status for the selected entries.');
          metadata = {
            ...metadata,
            status: input.status,
            publishAt: input.status === 'scheduled' ? input.publishAt || '' : '',
          };
        } else if (input.action === 'tags') {
          if (!input.tags?.length || !input.tagMode)
            throw new Error('Choose tags to add or remove.');
          metadata.tags =
            input.tagMode === 'remove'
              ? entry.tags.filter((tag) => !input.tags!.includes(tag))
              : [...new Set([...entry.tags, ...input.tags])];
        } else if (input.action === 'clearAliases') {
          metadata.shortAliases = [];
        } else {
          if (input.enabled === undefined)
            throw new Error('Choose whether to enable the selected setting.');
          metadata = { ...metadata, [input.action]: input.enabled };
        }
        const parsed = entrySchema.safeParse(metadata);
        if (!parsed.success) {
          issues.push({
            id: entry.id,
            message:
              entry.title + ': ' + parsed.error.issues.map((issue) => issue.message).join(' '),
          });
          continue;
        }
        const raw = serializeEntry(parsed.data, entry.body);
        if (raw === original) {
          updated.push(entry);
          continue;
        }
        changes.push(
          {
            file: path.join(
              this.store.root,
              '.studio/revisions',
              entry.id,
              entry.revision + '.json',
            ),
            value: JSON.stringify({
              version: 1,
              kind: entry.kind,
              file: entry.file,
              raw: original,
              savedAt: (await fs.stat(target)).mtime.toISOString(),
              reason: 'batch',
            }),
          },
          ...(nextKind===entry.kind ? [{file:target,value:raw,expected:entry.revision}] : [
            {file:path.join(this.store.content,nextKind,nextFile),value:raw,expected:null},
            {file:target,value:null,expected:entry.revision},
          ]),
        );
        updated.push(parseEntry(raw, nextKind, nextFile));
      }
      if (issues.length) throw new OperationConflict(issues);
      const ids = new Set(selected.map((entry) => entry.id));
      validateShortLinks([
        ...model.entries.filter((entry) => input.action === 'duplicate' || !ids.has(entry.id)),
        ...updated,
      ]);
      validateEntryRoutes([...model.entries.filter(entry=>input.action==='duplicate'||!ids.has(entry.id)),...updated],model.site.collections);
      await commitFiles(this.store.root, changes);
      return { entries: updated.map(publicEntry), trashed };
    });
  }
  async photos(request: unknown) {
    const input = z
      .object({
        ids: z.array(z.string().min(1)).min(1).max(500),
        revision: z.string().regex(/^[a-f0-9]{64}$/),
        action: z.enum(['remove', 'album']),
        album: z.string().trim().min(1).max(100).optional(),
      })
      .strict()
      .parse(request);
    return this.store.exclusive(async () => {
      const model = await this.store.read(),
        ids = new Set(input.ids);
      if (
        model.libraryRevision !== input.revision ||
        ids.size !== input.ids.length ||
        model.library.photos.filter((photo) => ids.has(photo.id)).length !== ids.size
      )
        throw new ConflictError('The photo journal changed. Refresh the selection.');
      if (input.action === 'album' && !input.album)
        throw new Error('Choose an album for the selected photos.');
      const value = librarySchema.parse({
        ...model.library,
        photos:
          input.action === 'remove'
            ? model.library.photos.filter((photo) => !ids.has(photo.id))
            : model.library.photos.map((photo) =>
                ids.has(photo.id) ? { ...photo, album: input.album! } : photo,
              ),
      });
      const raw = await fs.readFile(path.join(this.store.content, 'library.json'), 'utf8');
      if (digest(raw) !== input.revision)
        throw new ConflictError('The photo journal changed. Refresh the selection.');
      await commitFiles(this.store.root, await this.store.prepareLibraryChange(raw, value));
      return { value, revision: digest(`${JSON.stringify(value, null, 2)}\n`) };
    });
  }
  async trash(request: unknown) {
    const { action, items, libraryRevision } = z
      .object({
        action: z.enum(['restore', 'purge']),
        items: selectedItemsSchema,
        libraryRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .parse(request);
    return this.store.exclusive(async () => {
      const available = await this.store.listTrash(),
        model = await this.store.read();
      const changes: FileChange[] = [],
        restored: ContentEntry[] = [],
        restoredPhotos: PhotoTrashItem[] = [],
        issues: OperationIssue[] = [];
      const routes = new Set(
        model.entries.map((entry) => entry.kind + '/' + entry.slug.toLowerCase()),
      );
      const identities = new Set(model.entries.map((entry) => entry.id));
      const photoIdentities = new Set(model.library.photos.map((photo) => photo.id));
      for (const item of items) {
        const receipt = available.find((entry) => entry?.id === item.id);
        if (
          !receipt ||
          receipt.revision !== item.revision ||
          !/^[\w-]+$/.test(receipt.id) ||
          !['posts', 'lab', 'photos'].includes(receipt.kind)
        ) {
          issues.push({ id: item.id, message: (receipt?.title || item.id) + ' changed in Trash.' });
          continue;
        }
        if (receipt.kind === 'photos') {
          if (action === 'restore') {
            if (libraryRevision !== model.libraryRevision)
              throw new ConflictError(
                'The photo journal changed. Close this review and try again.',
              );
            if (photoIdentities.has(receipt.photo.id)) {
              issues.push({
                id: item.id,
                message: receipt.title + ' is already in the photo journal.',
              });
              continue;
            }
            photoIdentities.add(receipt.photo.id);
            restoredPhotos.push(receipt);
          }
          changes.push({
            file: path.join(this.store.root, '.studio/trash/photos', receipt.id + '.json'),
            value: null,
            expected: receipt.revision,
          });
          continue;
        }
        const markdown = path.join(this.store.root, '.studio/trash', receipt.id + '.md');
        const receiptFile = path.join(this.store.root, '.studio/trash', receipt.id + '.json');
        const raw = await fs.readFile(markdown, 'utf8');
        const receiptRaw = await fs.readFile(receiptFile, 'utf8');
        if (digest(receiptRaw + raw) !== item.revision) {
          issues.push({ id: item.id, message: receipt.title + ' changed in Trash.' });
          continue;
        }
        const entry = parseEntry(raw, receipt.kind, receipt.file);
        if (action === 'restore') {
          const target = await contained(path.join(this.store.content, entry.kind), entry.file);
          if (
            routes.has(entry.kind + '/' + entry.slug.toLowerCase()) ||
            identities.has(entry.id) ||
            (await fileDigest(target)) !== null
          ) {
            issues.push({
              id: item.id,
              message: entry.title + ' conflicts with an existing entry or filename.',
            });
            continue;
          }
          identities.add(entry.id);
          routes.add(entry.kind + '/' + entry.slug.toLowerCase());
          changes.push({ file: target, value: raw, expected: null });
          restored.push(entry);
        } else {
          for (const file of await treeFiles(
            path.join(this.store.root, '.studio/revisions', item.id),
          ))
            changes.push({ file, value: null });
        }
        changes.push(
          { file: markdown, value: null, expected: digest(raw) },
          { file: receiptFile, value: null, expected: digest(receiptRaw) },
        );
      }
      if (issues.length) throw new OperationConflict(issues);
      validateShortLinks([...model.entries, ...restored]);
      validateEntryRoutes([...model.entries,...restored],model.site.collections);
      let library;
      if (restoredPhotos.length) {
        const photos: Photo[] = [...model.library.photos];
        for (const receipt of restoredPhotos.sort((a, b) => a.position - b.position))
          photos.splice(Math.min(receipt.position, photos.length), 0, receipt.photo);
        const value = librarySchema.parse({ ...model.library, photos }),
          raw = await fs.readFile(path.join(this.store.content, 'library.json'), 'utf8');
        if (digest(raw) !== libraryRevision)
          throw new ConflictError('The photo journal changed. Close this review and try again.');
        changes.push(
          ...(await this.store.prepareLibraryChange(raw, value, { reconcileTrash: false })),
        );
        library = { value, revision: digest(`${JSON.stringify(value, null, 2)}\n`) };
      }
      await commitFiles(this.store.root, changes);
      return { entries: restored.map(publicEntry), ...(library ? { library } : {}) };
    });
  }
  async reviewImport(
    files: { name: string; text: string }[],
    kind: ContentKind,
  ): Promise<MarkdownImportReview> {
    if (
      !files.length ||
      files.length > 100 ||
      files.reduce((sum, file) => sum + Buffer.byteLength(file.text), 0) > 20 * 1024 * 1024
    )
      throw new Error('Import 1–100 Markdown files totaling at most 20 MiB.');
    const model = await this.store.snapshot();
    const occupied = new Set(
        model.entries.map((entry) => entry.kind + '/' + entry.slug.toLowerCase()),
      ),
      names = new Set(model.entries.map((entry) => entry.kind + '/' + entry.file));
    const prepared = files.map((file) => {
      if (!/\.md$/i.test(file.name) || file.text.length > 1000000 || file.text.includes('\0'))
        throw new Error('Choose UTF-8 Markdown files under 1 MB each.');
      const match = file.text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      const supplied = match ? parseYaml(match[1]) : {};
      if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))
        throw new Error(file.name + ': frontmatter must contain fields.');
      const body = match ? file.text.slice(match[0].length).replace(/^\r?\n/, '') : file.text;
      const title = String(
        supplied.title || body.match(/^#\s+(.+)$/m)?.[1] || path.basename(file.name, '.md'),
      ).slice(0, 160);
      const base =
        String(supplied.slug || title)
          .normalize('NFC')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, '-')
          .replace(/^-|-$/g, '') || 'entry';
      const slug = freeSlug(base, kind, occupied, names),
        id = randomUUID();
      const metadata = entrySchema.parse({
        ...supplied,
        id,
        title,
        slug,
        status: 'draft',
        publishAt: '',
        publishedAt: supplied.publishedAt || new Date().toISOString().slice(0, 10),
        shortCode: digest(id).slice(0, 12),
        shortAliases: [],
        featured: false,
        demo: false,
      });
      const warnings = ['Imported as a new draft.'];
      if (supplied.slug && supplied.slug !== slug)
        warnings.push('URL adjusted to avoid a collision.');
      const unknown = Object.keys(supplied).filter((key) => !(key in entrySchema.shape));
      if (unknown.length) warnings.push('Unsupported frontmatter omitted: ' + unknown.join(', '));
      return { metadata, body, kind, file: slug + '.md', name: file.name, warnings };
    });
    const review: MarkdownImportReview = {
      id: randomUUID(),
      sourceRevision: snapshotRevision(model),
      expiresAt: new Date(Date.now() + 20 * 60000).toISOString(),
      entries: prepared.map((entry) => ({
        name: entry.name,
        title: entry.metadata.title,
        slug: entry.metadata.slug,
        kind,
        warnings: entry.warnings,
      })),
    };
    for (const [id, plan] of this.imports)
      if (Date.parse(plan.review.expiresAt) <= Date.now()) this.imports.delete(id);
    if (this.imports.size >= 3) this.imports.delete(this.imports.keys().next().value!);
    this.imports.set(review.id, { review, entries: prepared });
    return review;
  }
  async import(id: string, revision: string) {
    const plan = this.imports.get(id);
    if (!plan || Date.parse(plan.review.expiresAt) <= Date.now())
      throw new Error('This import review expired. Choose the files again.');
    return this.store.exclusive(async () => {
      const model = await this.store.read();
      if (snapshotRevision(model) !== revision || plan.review.sourceRevision !== revision)
        throw new ConflictError('The notebook changed. Review the import again.');
      const entries = plan.entries.map((entry) =>
        parseEntry(serializeEntry(entry.metadata, entry.body), entry.kind, entry.file),
      );
      validateShortLinks([...model.entries, ...entries]);
      validateEntryRoutes([...model.entries,...entries],model.site.collections);
      await commitFiles(
        this.store.root,
        plan.entries.map((entry) => ({
          file: path.join(this.store.content, entry.kind, entry.file),
          value: serializeEntry(entry.metadata, entry.body),
          expected: null,
        })),
      );
      this.imports.delete(id);
      return { entries: entries.map(publicEntry) };
    });
  }
}
