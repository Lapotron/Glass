import { digest, parseEntry } from '../engine/store.js';
import { siteSchema, librarySchema } from '../shared/contracts.js';
import { projectsSchema } from '../shared/projects.js';
import { photoTrashRecordSchema, entryTrashRecordSchema } from '../shared/operations.js';
import { mediaSourceSchema as sourceSchema } from '../shared/media-upload.js';
/** Validate each small author-data file in its own bounded import request. */
export function validateNotebookFile(path: string, bytes: Uint8Array) {
  if (path.startsWith('content/media/') || /\.studio\/media-originals\/[^/]+\/original$/.test(path))
    return;
  if (!/\.(?:md|json)$/.test(path)) return;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const entry = path.match(/^content\/(posts|lab)\/([^/]+)\.md$/);
  if (entry) {
    if (text.length > 1000000 || text.includes('\0'))
      throw new Error('Markdown must be under 1 MB and contain no null characters.');
    parseEntry(text, entry[1] as 'posts' | 'lab', entry[2] + '.md');
    return;
  }
  if (path === 'content/about.md') {
    if (text.length > 1000000 || text.includes('\0'))
      throw new Error('About must be Markdown under 1 MB.');
    return;
  }
  if (/^\.studio\/trash\/[^/]+\.md$/.test(path)) {
    const entry = parseEntry(text, 'posts', 'restored.md');
    if (entry.id !== path.split('/').at(-1)!.replace(/\.md$/, ''))
      throw new Error('Trash Markdown identity does not match.');
    return;
  }
  const record = JSON.parse(text);
  if (path === 'content/site.json') siteSchema.parse(record);
  else if (path === 'content/library.json') librarySchema.parse(record);
  else if (path === 'content/projects.json') projectsSchema.parse(record);
  else if (path.startsWith('.studio/revisions/')) {
    const parts = path.split('/');
    if (
      record.version !== 1 ||
      typeof record.raw !== 'string' ||
      digest(record.raw) !== parts[3].replace('.json', '') ||
      !['edit', 'restore', 'schedule', 'batch'].includes(record.reason) ||
      !Number.isFinite(Date.parse(record.savedAt))
    )
      throw new Error('The article revision is damaged.');
    const entry = parseEntry(record.raw, record.kind, record.file);
    if (entry.id !== parts[2]) throw new Error('Revision identity does not match.');
  } else if (path.startsWith('.studio/pages/about/')) {
    if (
      typeof record.body !== 'string' ||
      digest(record.body) !== path.split('/').at(-1)!.replace('.json', '') ||
      !Number.isFinite(Date.parse(record.savedAt))
    )
      throw new Error('The About revision is damaged.');
  } else if (path.startsWith('.studio/history/')) librarySchema.parse(record.previous);
  else if (path.startsWith('.studio/project-history/')) projectsSchema.parse(record.previous);
  else if (path.startsWith('.studio/trash/photos/')) {
    const receipt = photoTrashRecordSchema.parse(record);
    if (path.split('/').at(-1) !== receipt.id + '.json')
      throw new Error('Photo Trash identity does not match.');
  } else if (path.startsWith('.studio/media-originals/')) {
    const source = sourceSchema.parse(record);
    if (source.sourceId !== path.split('/')[2])
      throw new Error('Original media identity does not match.');
  } else if (/^\.studio\/trash\/[^/]+\.json$/.test(path)) {
    const receipt = entryTrashRecordSchema.parse(record);
    if (path !== '.studio/trash/' + receipt.id + '.json')
      throw new Error('Trash identity does not match.');
  }
}
