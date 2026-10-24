import { mediaLinkMap } from './media-links.js';
import { promises as fs } from 'node:fs';
import { entryMedia } from '../shared/entry-settings.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import rehypeRaw from 'rehype-raw';
import type { Element } from 'hast';
import { visit } from 'unist-util-visit';
import { z } from 'zod';
import { Store, digest, parseEntry, ConflictError } from './store.js';
import { MediaService } from './media.js';
import { BackupService } from './backup.js';
import { canonicalMediaUrl } from '../shared/media-details.js';
import { commitFiles, fileDigest, type FileChange } from './file-transaction.js';
import {
  photoTrashRecordSchema,
  type MediaUsage,
  type MediaReference,
} from '../shared/operations.js';
import { routeFor, type ContentEntry, type Library } from '../shared/contracts.js';

const parser = unified().use(remarkParse).use(remarkDirective);
const htmlParser = unified().use(rehypeRaw);
export function markdownMediaLocations(body: string, resolveAlias?: (value: string) => string[]) {
  const tree = parser.parse(body),
    references = new Map<string, { url: string; line: number; field: string }>(),
    definitions = new Map<string, string>();
  const add = (value: string, line: number, field: string) => {
    for (const target of value.startsWith('/m/') ? resolveAlias?.(value) || [] : [value])
      if (target.startsWith('/media/')) {
        const url = canonicalMediaUrl(target.replaceAll('&amp;', '&'));
        references.set(`${url}|${line}|${field}`, { url, line, field });
      }
  };
  visit(tree, 'definition', (node: any) => {
    definitions.set(node.identifier.toLowerCase(), node.url);
  });
  visit(tree, (node: any) => {
    const line = node.position?.start.line || 1;
    if (['image', 'link'].includes(node.type))
      add(node.url, line, node.type === 'image' ? 'Markdown image' : 'File link');
    if (['imageReference', 'linkReference'].includes(node.type))
      add(
        definitions.get(node.identifier.toLowerCase()) || '',
        line,
        node.type === 'imageReference' ? 'Referenced image' : 'Referenced file link',
      );
    if (node.type === 'html') {
      const html = htmlParser.runSync({
        type: 'root',
        children: [{ type: 'raw', value: node.value }],
      } as import('hast').Root);
      visit(html, 'element', (element: Element) => {
        const htmlLine = line + (element.position?.start.line || 1) - 1;
        for (const [name, property] of Object.entries(element.properties)) {
          if (name.toLowerCase() === 'srcset') {
            for (const match of String(property)
              .replace(/,(?=\/media\/)/g, ' ')
              .matchAll(/\/media\/[^\s"'<>]+/g))
              add(match[0].replace(/,+$/, ''), htmlLine, `HTML ${element.tagName}.${name}`);
          } else if (
            typeof property === 'string' &&
            (property.startsWith('/media/') || property.startsWith('/m/')) &&
            !['srcset', 'style'].includes(name.toLowerCase())
          )
            add(property, htmlLine, `HTML ${element.tagName}.${name}`);
          else
            for (const match of String(property).matchAll(/\/media\/[^\s"'<>),;]+/g))
              add(match[0], htmlLine, `HTML ${element.tagName}.${name}`);
        }
      });
    }
    if (node.type.endsWith('Directive'))
      for (const [attribute, value] of Object.entries(node.attributes || {}))
        if (typeof value === 'string') add(value, line, `${node.name}.${attribute}`);
  });
  return [...references.values()];
}
export function markdownMedia(body: string) {
  return [...new Set(markdownMediaLocations(body).map((reference) => reference.url))];
}
async function filesUnder(base: string): Promise<string[]> {
  const entries = await fs.readdir(base, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error('Media references cannot follow symbolic links.');
    const file = path.join(base, entry.name);
    files.push(...(entry.isDirectory() ? await filesUnder(file) : [file]));
    if (files.length > 10000)
      throw new Error('Media history exceeds the 10,000-file maintenance limit.');
  }
  return files;
}
export type MediaAudit = { revision: string; items: MediaUsage[]; issues: string[] };
export type CleanupReview = {
  id: string;
  revision: string;
  expiresAt: string;
  items: { url: string; name: string; bytes: number }[];
};
export class MediaMaintenance {
  private reviews = new Map<string, CleanupReview>();
  constructor(
    readonly store: Store,
    readonly media: MediaService,
    readonly backups: BackupService,
    readonly idle: () => boolean,
  ) {}
  discardReviews() {
    this.reviews.clear();
  }
  async inspectUnlocked(): Promise<MediaAudit> {
    const model = await this.store.read(),
      files = await this.media.list();
    const items = new Map<string, MediaUsage>(
      files.map((file) => [
        canonicalMediaUrl(file.url),
        {
          url: file.url,
          name: file.name,
          bytes: file.bytes,
          active: [],
          history: [],
          missing: false,
        },
      ]),
    );
    const issues: string[] = [],
      history: string[] = [];
    type Reference = Omit<MediaReference, 'id' | 'scope'>;
    const add = (url: string, label: string, retained = false, reference?: Reference) => {
      if (!url.startsWith('/media/')) return;
      const key = canonicalMediaUrl(url);
      let item = items.get(key);
      if (!item) {
        item = {
          url: key,
          name: decodeURIComponent(key.slice(7)),
          bytes: 0,
          active: [],
          history: [],
          missing: true,
        };
        items.set(key, item);
      }
      const list = retained ? item.history : item.active;
      if (!list.includes(label)) list.push(label);
      if (reference) {
        const id = digest(
          JSON.stringify([
            retained,
            reference.kind,
            reference.source,
            reference.line,
            reference.field,
            reference.title,
          ]),
        ).slice(0, 20);
        const references = (item.references ||= []);
        if (references.some((item) => item.id === id)) return;
        if (references.length >= 300) {
          item.referencesTruncated = true;
          return;
        }
        references.push({ ...reference, id, scope: retained ? 'history' : 'current' });
        item.referenceCount = references.length;
      }
    };
    const aliases = new Map<string, Set<string>>();
    const registerAliases = (library: Partial<Library>) => {
      for (const [code, url] of mediaLinkMap(
        files.map((file) => file.url),
        { ...model.library, ...library, mediaDetails: library.mediaDetails || {} },
      )) {
        const targets = aliases.get(code) || new Set<string>();
        targets.add(url);
        aliases.set(code, targets);
      }
    };
    registerAliases(model.library);
    const pendingMarkdown: {
      text: string;
      label: string;
      retained: boolean;
      reference: Reference;
    }[] = [];
    const markdown = (text: string, label: string, retained: boolean, reference: Reference) => {
      pendingMarkdown.push({ text, label, retained, reference });
    };
    const values = (
      value: unknown,
      label: string,
      retained: boolean,
      reference: Reference,
      field = '',
    ) => {
      if (typeof value === 'string' && value.startsWith('/m/'))
        markdown('[](' + value + ')', label, retained, { ...reference, field });
      else if (typeof value === 'string' && value.startsWith('/media/'))
        add(value, label, retained, { ...reference, field });
      else if (Array.isArray(value))
        value.forEach((item, index) =>
          values(item, label, retained, reference, `${field}[${index}]`),
        );
      else if (value && typeof value === 'object')
        Object.entries(value).forEach(([key, item]) =>
          values(item, label, retained, reference, field ? field + '.' + key : key),
        );
    };
    const settings = (value: unknown, field = '') => {
      if (typeof value === 'string' && value.startsWith('/media/')) {
        const labels: Record<string, string> = {
          'profile.portrait': 'Profile portrait',
          'theme.backgroundImage': 'Background picture',
          'metadata.socialImage': 'Default sharing image',
          'branding.logo': 'Site logo',
          'branding.favicon': 'Favicon',
          'branding.appleTouchIcon': 'Home-screen icon',
        };
        add(value, 'Site settings', false, {
          title: labels[field] || 'Site artwork',
          context: 'Site settings',
          source: 'content/site.json',
          field,
          kind: 'setting',
          view: field.startsWith('profile.')
            ? 'about'
            : field.startsWith('theme.')
              ? 'appearance'
              : 'settings',
          tab: field.startsWith('home.') ? 'home' : field.split('.')[0],
        });
      } else if (Array.isArray(value))
        value.forEach((item, index) => settings(item, `${field}[${index}]`));
      else if (value && typeof value === 'object')
        Object.entries(value).forEach(([key, item]) =>
          settings(item, field ? field + '.' + key : key),
        );
    };
    for (const project of model.projects?.projects || []) {
      add(project.image, `Project: ${project.title}`, false, {
        kind: 'project',
        title: project.title,
        context: 'Projects',
        source: 'content/projects.json',
        field: `${project.id}.image`,
        view: 'projects',
      });
    }
    for (const file of await filesUnder(path.join(this.store.root, '.studio/project-history'))) {
      try {
        values(JSON.parse(await fs.readFile(file, 'utf8')).previous, 'Project history', true, {
          kind: 'collection-history',
          title: 'Project recovery',
          context: 'Projects undo',
          source: path.relative(this.store.root, file),
          view: 'projects',
        });
      } catch {
        issues.push(`Could not inspect project recovery: ${path.basename(file)}`);
      }
    }
    const libraryReferences = (library: Partial<Library>, source: string, retained: boolean) => {
      registerAliases(library);
      for (const [url, metadata] of Object.entries(library.mediaDetails || {}))
        if (metadata.publishForSharing)
          add(url, retained ? 'Shared media history' : 'Published for sharing', retained, {
            kind: retained ? 'collection-history' : 'setting',
            title: metadata.displayName || decodeURIComponent(url.slice(7)),
            context: 'Published for sharing' + (retained ? ' · Collection Undo' : ''),
            source,
            field: 'mediaDetails.' + url + '.publishForSharing',
            view: 'media',
          });
      library.photos?.forEach((photo, index) =>
        add(photo.src, retained ? 'Photo history' : 'Photo Journal', retained, {
          kind: retained ? 'collection-history' : 'photo',
          title: photo.caption || photo.alt,
          context: `Album: ${photo.album}${retained ? ' · Collection Undo' : ''}`,
          source,
          field: `photos[${index}].src`,
          view: 'photos',
        }),
      );
      library.albums?.forEach((album, index) => {
        if (album.cover)
          add(album.cover, retained ? 'Album history' : 'Photo albums', retained, {
            kind: retained ? 'collection-history' : 'album',
            title: album.name,
            context: 'Album cover' + (retained ? ' · Collection Undo' : ''),
            source,
            field: `albums[${index}].cover`,
            view: 'photos',
          });
      });
      values(
        library.news,
        retained ? 'Collection history' : 'Retained collection',
        retained,
        {
          title: 'Legacy collection',
          kind: 'collection-history',
          context: 'Retained collection data',
          source,
          view: 'photos',
        },
        'news',
      );
    };
    const entryReferences = (
      entry: ContentEntry,
      kind: 'entry' | 'revision' | 'trash',
      source: string,
      context: string,
    ) => {
      const retained = kind !== 'entry';
      const label =
        kind === 'trash'
          ? 'Trash: ' + entry.title
          : kind === 'revision'
            ? 'Revision: ' + entry.title
            : entry.title;
      const reference: Reference = {
        title: entry.title,
        kind,
        context,
        source,
        status: entry.status,
        view: kind === 'trash' ? 'trash' : entry.kind === 'lab' ? 'lab' : 'writing',
        ...(kind === 'entry'
          ? {
              entryId: entry.id,
              ...(entry.status === 'published'
                ? { href: routeFor(entry, model.site.collections) }
                : {}),
            }
          : {}),
      };
      entryMedia(entry).forEach((url, index) =>
        add(url, label, retained, {
          ...reference,
          field: index === 0 && entry.cover ? 'Cover image' : 'Sharing image',
        }),
      );
      markdown(entry.body, label, retained, reference);
    };
    settings(model.site);
    libraryReferences(model.library, 'content/library.json', false);
    markdown(model.about.body, 'About', false, {
      title: 'About introduction',
      kind: 'about',
      context: 'About page',
      source: 'content/about.md',
      view: 'about',
    });
    for (const entry of model.entries)
      entryReferences(
        entry,
        'entry',
        `content/${entry.kind}/${entry.file}`,
        model.site.collections[entry.kind].singular,
      );
    for (const location of ['revisions', 'trash', 'history', 'pages']) {
      for (const file of await filesUnder(path.join(this.store.root, '.studio', location))) {
        if (!/\.(json|md)$/.test(file)) continue;
        try {
          const raw = await fs.readFile(file, 'utf8');
          history.push(digest(raw));
          const record = file.endsWith('.json') ? JSON.parse(raw) : null;
          const source = path.relative(this.store.root, file).split(path.sep).join('/');
          if (location === 'trash' && file.endsWith('.md')) {
            const receipt = JSON.parse(await fs.readFile(file.replace(/\.md$/, '.json'), 'utf8'));
            const entry = parseEntry(raw, receipt.kind, receipt.file);
            entryReferences(entry, 'trash', source, 'Trash · Deleted ' + receipt.deletedAt);
          } else if (
            location === 'trash' &&
            path.dirname(file) === path.join(this.store.root, '.studio/trash/photos')
          ) {
            const receipt = photoTrashRecordSchema.parse(record);
            if (path.basename(file) !== receipt.id + '.json')
              throw new Error('Invalid photo Trash identity.');
            values(
              receipt.photo.src,
              'Photo Trash: ' + (receipt.photo.caption || receipt.photo.alt),
              true,
              {
                title: receipt.photo.caption || receipt.photo.alt,
                kind: 'photo-trash',
                context: `Album: ${receipt.photo.album} · Photo Trash`,
                source,
                field: 'photo.src',
                view: 'trash',
                tab: 'photos',
              },
              'photo.src',
            );
          } else if (location === 'revisions') {
            const entry = parseEntry(record.raw, record.kind, record.file);
            entryReferences(entry, 'revision', source, 'Revision · ' + record.savedAt);
          } else if (location === 'history') {
            libraryReferences(record.previous, source, true);
          } else if (location === 'pages')
            markdown(record.body, 'About history', true, {
              title: 'About introduction',
              kind: 'about-history',
              context: 'About revision · ' + record.savedAt,
              source,
              view: 'about',
            });
        } catch {
          issues.push(
            'Could not verify references in ' +
              path.relative(this.store.root, file) +
              '. Cleanup is blocked.',
          );
        }
      }
    }
    for (const { text, label, retained, reference } of pendingMarkdown)
      markdownMediaLocations(text, (code) => {
        const targets = aliases.get(code.split(/[?#]/)[0].replace(/\/$/, ''));
        if (!targets)
          issues.push('Could not resolve media short link ' + code + '. Cleanup is blocked.');
        return [...(targets || [])];
      }).forEach(({ url, line, field }) =>
        add(url, label, retained, { ...reference, line, field }),
      );
    return {
      revision: digest(
        JSON.stringify({
          model,
          history,
          files: files.map(({ url, bytes, modifiedAt, sourceId }) => ({
            url,
            bytes,
            modifiedAt,
            sourceId,
          })),
        }),
      ),
      items: [...items.values()],
      issues,
    };
  }
  audit() {
    return this.store.exclusive(() => this.inspectUnlocked());
  }
  async review(request: unknown): Promise<CleanupReview> {
    const urls = z
      .array(z.string().max(1000))
      .min(1)
      .max(500)
      .parse(request)
      .map(canonicalMediaUrl);
    if (new Set(urls).size !== urls.length) throw new Error('Choose each image once.');
    const audit = await this.audit();
    if (audit.issues.length) throw new Error(audit.issues.join('\n'));
    const items = urls.map((url) => {
      const item = audit.items.find((item) => canonicalMediaUrl(item.url) === url);
      if (!item || item.missing || item.active.length || item.history.length)
        throw new Error('Only unused media without retained references can be deleted.');
      return { url: item.url, name: item.name, bytes: item.bytes };
    });
    for (const [id, review] of this.reviews)
      if (Date.parse(review.expiresAt) < Date.now()) this.reviews.delete(id);
    if (this.reviews.size >= 3) this.reviews.delete(this.reviews.keys().next().value!);
    const review = {
      id: randomUUID(),
      revision: audit.revision,
      expiresAt: new Date(Date.now() + 20 * 60000).toISOString(),
      items,
    };
    this.reviews.set(review.id, review);
    return review;
  }
  async cleanup(id: string, revision: string) {
    const review = this.reviews.get(id);
    if (!review || Date.parse(review.expiresAt) < Date.now())
      throw new Error('This cleanup review expired. Review the selection again.');
    if (!this.idle())
      throw new Error('Wait for build, publication, scheduling or restoration to finish.');
    const before = await this.audit();
    if (before.revision !== revision || review.revision !== revision)
      throw new ConflictError('The notebook changed. Review unused media again.');
    const safety = await this.backups.create('before-cleanup');
    return this.store.exclusive(async () => {
      if (!this.idle()) throw new Error('Wait for the current job before cleaning up media.');
      const audit = await this.inspectUnlocked();
      if (audit.revision !== revision || audit.issues.length)
        throw new ConflictError('Media references changed. Review cleanup again.');
      const files = await this.media.list(),
        removed = new Set(review.items.map((item) => canonicalMediaUrl(item.url)));
      const changes: FileChange[] = [];
      for (const item of review.items) {
        const file = path.join(
          this.store.content,
          'media',
          decodeURIComponent(canonicalMediaUrl(item.url).slice(7)),
        );
        changes.push({ file, value: null, expected: await fileDigest(file) });
      }
      for (const sourceId of new Set(
        files
          .filter((file) => removed.has(canonicalMediaUrl(file.url)))
          .map((file) => file.sourceId)
          .filter((id): id is string => !!id),
      )) {
        const { record } = await this.media.source(sourceId);
        const variants = record.variants.filter(
          (variant) =>
            !removed.has(canonicalMediaUrl('/media/' + encodeURIComponent(variant.name))),
        );
        const recordFile = path.join(
          this.store.root,
          '.studio/media-originals',
          sourceId,
          'record.json',
        );
        changes.push({
          file: recordFile,
          value: variants.length ? JSON.stringify({ ...record, variants }) : null,
          expected: await fileDigest(recordFile),
        });
        if (!variants.length) {
          const original = path.join(path.dirname(recordFile), 'original');
          changes.push({ file: original, value: null, expected: await fileDigest(original) });
        }
      }
      const model = await this.store.read();
      const library = {
        ...model.library,
        mediaDetails: Object.fromEntries(
          Object.entries(model.library.mediaDetails).filter(
            ([url]) => !removed.has(canonicalMediaUrl(url)),
          ),
        ),
      };
      if (JSON.stringify(library) !== JSON.stringify(model.library))
        changes.push({
          file: path.join(this.store.content, 'library.json'),
          value: JSON.stringify(library, null, 2) + '\n',
          expected: model.libraryRevision,
        });
      await commitFiles(this.store.root, changes);
      this.reviews.delete(id);
      return { deleted: review.items.length, safetyBackup: safety.id };
    });
  }
}
