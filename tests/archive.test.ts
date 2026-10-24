import { describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import {
  archiveHref,
  archivePage,
  archivePageLinks,
  archivePageNumber,
  archiveState,
  archiveTopics,
  createArchiveIndex,
  emptyArchiveState,
  filterArchive,
  readArchiveCatalog,
  type ArchiveRecord,
} from '../src/shared/archive.js';
import { archivePaginationHtml, archiveTimelineHtml } from '../src/shared/archive-html.js';
import { archiveDataSource } from '../src/site/archive-data.js';
const entry = (i: number, overrides: Partial<ArchiveRecord> = {}): ArchiveRecord => ({
  id: String(i).padStart(5, '0'),
  title: `Entry ${String(i).padStart(5, '0')}`,
  summary: 'A quiet note',
  publishedAt: '2026-10-20',
  kind: i % 2 ? 'posts' : 'lab',
  lang: 'en',
  tags: [`topic-${i % 60}`],
  url: `/post/entry-${i}/`,
  ...overrides,
});
const select = (entries: ArchiveRecord[]) =>
  filterArchive(createArchiveIndex(entries), emptyArchiveState());
it('paginates dense months with exact global counts and deterministic ties', () => {
  const selection = select(Array.from({ length: 49 }, (_, i) => entry(i)));
  const first = archivePage(selection),
    second = archivePage(selection, 2),
    last = archivePage(selection, 99);
  expect(first).toMatchObject({ page: 1, pages: 3, total: 49, start: 1, end: 24 });
  expect(first.groups[0].months[0]).toMatchObject({ count: 49, continued: false });
  expect(second.groups[0].months[0]).toMatchObject({ count: 49, continued: true });
  expect(last).toMatchObject({ page: 3, start: 49, end: 49 });
  expect(
    new Set(
      [first, second, last].flatMap((p) =>
        p.groups.flatMap((g) => g.months.flatMap((m) => m.entries.map((e) => e.id))),
      ),
    ).size,
  ).toBe(49);
  expect(archivePage(selection, -5).page).toBe(1);
  expect(archivePage(select([]))).toMatchObject({
    page: 1,
    pages: 1,
    total: 0,
    start: 0,
    end: 0,
    groups: [],
  });
});
it('maps each year to its first page and each month to its full count', () => {
  const selection = select([
    ...Array.from({ length: 25 }, (_, i) => entry(i)),
    entry(26, { publishedAt: '2025-09-01' }),
    entry(27, { publishedAt: '2024-01-01' }),
  ]);
  expect(selection.years).toEqual([
    { year: '2026', count: 25, page: 1 },
    { year: '2025', count: 1, page: 2 },
    { year: '2024', count: 1, page: 2 },
  ]);
  const second = archivePage(selection, 2);
  expect(second.groups.map((g) => g.year)).toEqual(['2026', '2025', '2024']);
  expect(second.groups[1].months[0].continued).toBe(false);
});
it('filters the full catalog and bounds searchable topic suggestions', () => {
  const index = createArchiveIndex(Array.from({ length: 100 }, (_, i) => entry(i)));
  const result = filterArchive(index, { q: ' ENTRY 00099 ', kind: 'posts', tag: 'topic-39' });
  expect(result.records.map((e) => e.id)).toEqual(['00099']);
  expect(archiveTopics(index, '')).toHaveLength(20);
  expect(archiveTopics(index, 'topic-59')).toEqual([{ tag: 'topic-59', count: 1 }]);
  expect(filterArchive(index, { q: '', kind: 'lab', tag: 'topic-39' }).records).toHaveLength(0);
});
it('preserves URL filters and emits bounded native pagination links', () => {
  const state = { q: '中文 & math', kind: 'lab', tag: 'a/b' } as const;
  const href = archiveHref(4, state, '2025');
  const url = new URL(href, 'https://example.com');
  expect(archiveState(url.searchParams)).toEqual(state);
  expect(archivePageNumber(url.pathname)).toBe(4);
  expect(archivePageLinks(100, 417)).toEqual([1, null, 99, 100, 101, null, 417]);
  expect(archiveState(new URLSearchParams('kind=private'))).toEqual(emptyArchiveState());
  const page = archivePage(select(Array.from({ length: 49 }, (_, i) => entry(i))), 2);
  const html = archivePaginationHtml(page, state);
  expect(html).toContain('rel="prev"');
  expect(html).toContain('rel="next"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('25–48 of 49');
});
it('escapes all authored text and validates catalogs before client rendering', () => {
  const record = entry(1, {
    title: '<img src=x onerror=alert(1)>',
    summary: '<script>secret</script>',
    tags: ['<b>'],
    cover: '/media/a.svg',
  });
  const catalog = { version: 1, records: [record], labels: { posts: 'Post', lab: 'Article' } };
  expect(readArchiveCatalog(catalog)).toEqual(catalog);
  expect(() =>
    readArchiveCatalog({ ...catalog, records: [{ ...record, url: 'javascript:alert(1)' }] }),
  ).toThrow();
  expect(() => readArchiveCatalog({ ...catalog, version: 2 })).toThrow();
  const html = archiveTimelineHtml(
    archivePage(select([record])),
    catalog.labels,
    emptyArchiveState(),
  );
  expect(html).toContain('&lt;img');
  expect(html).not.toContain('<script>secret');
  expect(html).toContain('timeline-month-marker liquid-lens');
  expect(html).toContain('timeline-month-panel glass-panel');
  expect(html).toContain('data-aca-item="00001"');
});
it('reuses one catalog request and retries a failed catalog fetch', async () => {
  const catalog = {
    version: 1,
    records: Array.from({ length: 49 }, (_, i) => entry(i)),
    labels: { posts: 'Post', lab: 'Article' },
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockImplementation(async () => Response.json(catalog));
  vi.stubGlobal('fetch', fetcher);
  try {
    const query = archiveDataSource(),
      request = {
        id: 1,
        url: '/assets/archive/catalog-' + 'a'.repeat(20) + '.json',
        state: emptyArchiveState(),
        page: 1,
        topicQuery: '',
      };
    await expect(query(request)).rejects.toThrow();
    expect((await query(request)).page.total).toBe(49);
    expect((await query({ ...request, page: 2 })).page.start).toBe(25);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
describe('large archive model', () => {
  for (const size of [1000, 10000])
    it(`keeps ${size} entries reachable with bounded page work`, () => {
      const start = performance.now();
      const index = createArchiveIndex(
          Array.from({ length: size }, (_, i) =>
            entry(i, { publishedAt: `${2026 - (i % 40)}-10-20` }),
          ),
        ),
        selection = filterArchive(index, emptyArchiveState());
      const ids = new Set<string>();
      for (let p = 1; p <= Math.ceil(size / 24); p++) {
        const page = archivePage(selection, p),
          records = page.groups.flatMap((g) => g.months.flatMap((m) => m.entries));
        expect(records.length).toBeLessThanOrEqual(24);
        records.forEach((e) => ids.add(e.id));
      }
      expect(ids.size).toBe(size);
      expect(archiveTopics(index, '')).toHaveLength(20);
      // A generous regression guard, not a hardware-specific microbenchmark.
      expect(performance.now() - start).toBeLessThan(5000);
    });
});

it('keeps build-ordered catalogs in canonical order regardless of reader collation', () => {
  const source = [entry(2, { title: '中文' }), entry(1, { title: 'Alpha' })];
  expect(createArchiveIndex(source, true).records).toEqual(source);
  expect(createArchiveIndex(source).records[0].title).toBe('Alpha');
});
