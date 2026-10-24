import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { entrySchema, siteSchema, type PublicEntry } from '../src/shared/contracts.js';
import { archiveEntry } from '../src/shared/archive-entry.js';
import { articleReadingStats } from '../src/shared/article-reading.js';
import {
  archivePage,
  createArchiveIndex,
  emptyArchiveState,
  filterArchive,
  readArchiveCatalog,
} from '../src/shared/archive.js';
import { archiveTimelineHtml } from '../src/shared/archive-html.js';
const site = siteSchema.parse(
  JSON.parse(readFileSync(new URL('./fixtures/notebook/site.json', import.meta.url), 'utf8')),
);
function entry(): PublicEntry {
  return {
    ...entrySchema.parse({
      id: 'facts',
      title: 'Reading facts',
      slug: 'facts',
      publishedAt: '2026-10-20',
      lang: 'en',
      tags: [],
    }),
    kind: 'posts',
    status: 'published',
    body: 'One two three.',
    revision: 'private-source-revision',
  };
}
it('uses the existing production word and multilingual reading estimate without parsing source in readers', () => {
  expect(articleReadingStats('')).toEqual({ words: 0, minutes: 1 });
  expect(articleReadingStats('One two three.')).toEqual({ words: 3, minutes: 1 });
  expect(articleReadingStats('word '.repeat(441))).toEqual({ words: 441, minutes: 3 });
  expect(articleReadingStats('汉'.repeat(440))).toEqual({ words: 1, minutes: 2 });
  expect(archiveEntry(entry(), site).facts).toEqual({ published: true, words: 3, minutes: 1 });
});
it('honors inherited and explicit visibility and omits absent modification dates', () => {
  const source = { ...entry(), updatedAt: '2026-10-22' };
  const hidden = {
    ...site,
    reading: { ...site.reading, publishedDate: false, readingTime: false },
  };
  expect(archiveEntry(source, hidden).facts).toBeUndefined();
  expect(archiveEntry({ ...source, reading: { publishedDate: true } }, hidden).facts).toEqual({
    published: true,
    updatedAt: '2026-10-22',
  });
  expect(archiveEntry({ ...source, reading: { modifiedDate: false } }, site).facts).toEqual({
    published: true,
    words: 3,
    minutes: 1,
  });
  expect(archiveEntry(entry(), site).facts).not.toHaveProperty('updatedAt');
  expect(source).not.toHaveProperty('reading');
});
it('publishes only the explicit facts projection, including when metrics contain private extra fields', () => {
  const metrics = {
    words: 1234,
    minutes: 6,
    revision: 'private-metric-revision',
    body: 'secret source',
  };
  const record = archiveEntry({ ...entry(), updatedAt: '2026-10-22' }, site, metrics);
  expect(record.facts).toEqual({
    published: true,
    updatedAt: '2026-10-22',
    words: 1234,
    minutes: 6,
  });
  expect(JSON.stringify(record)).not.toMatch(/private|secret|body|revision/);
  const catalog = { version: 1, records: [record], labels: { posts: 'Post', lab: 'Article' } };
  expect(readArchiveCatalog(catalog).records[0].facts).toEqual(record.facts);
  expect(() =>
    readArchiveCatalog({ ...catalog, records: [{ ...record, facts: { words: -1 } }] }),
  ).toThrow();
  expect(() =>
    readArchiveCatalog({ ...catalog, records: [{ ...record, facts: { minutes: 0 } }] }),
  ).toThrow();
  expect(() => readArchiveCatalog({ ...catalog, records: [{ ...record, facts: null }] })).toThrow();
  const legacy = { ...record };
  delete legacy.facts;
  expect(readArchiveCatalog({ ...catalog, records: [legacy] }).records[0].facts).toBeUndefined();
});
it('renders factual metadata with semantic dates and labels and keeps fully hidden rows absent', () => {
  const record = archiveEntry({ ...entry(), updatedAt: '2026-10-22' }, site, {
    words: 1234,
    minutes: 6,
  });
  const page = archivePage(filterArchive(createArchiveIndex([record]), emptyArchiveState()));
  const html = archiveTimelineHtml(page, { posts: 'Post', lab: 'Article' }, emptyArchiveState());
  expect(html).toContain('<dl class="timeline-entry-facts">');
  expect(html).toContain('data-timeline-fact="published"');
  expect(html).toContain('data-archive-date="2026-10-22"');
  expect(html).toContain('1,234 words');
  expect(html).toContain('6 min read');
  const hidden = archiveEntry(
    { ...entry(), reading: { publishedDate: false, modifiedDate: false, readingTime: false } },
    site,
  );
  const hiddenPage = archivePage(filterArchive(createArchiveIndex([hidden]), emptyArchiveState()));
  expect(
    archiveTimelineHtml(hiddenPage, { posts: 'Post', lab: 'Article' }, emptyArchiveState()),
  ).not.toContain('timeline-entry-facts');
});
