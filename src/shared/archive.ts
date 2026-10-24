/** Published metadata only. Shared by static output, Studio and the lazy archive worker. */
export const archivePageSize = 24;
export const archiveTopicLimit = 20;
export type ArchiveFacts = {
  published?: boolean;
  updatedAt?: string;
  words?: number;
  minutes?: number;
};
export type ArchiveRecord = {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  kind: 'posts' | 'lab';
  lang: string;
  tags: string[];
  url: string;
  cover?: string;
  coverWidth?: number;
  coverHeight?: number;
  facts?: ArchiveFacts;
};
export type ArchiveCatalog = {
  version: 1;
  records: ArchiveRecord[];
  labels: { posts: string; lab: string };
};
export type ArchiveState = { q: string; kind: 'all' | 'posts' | 'lab'; tag: string };
export type ArchiveYear = { year: string; count: number; page: number };
export type ArchiveIndex = {
  records: ArchiveRecord[];
  text: string[];
  topics: { tag: string; count: number }[];
};
export type ArchiveSelection = {
  records: ArchiveRecord[];
  years: ArchiveYear[];
  months: Map<string, number>;
};
export type ArchivePage = {
  page: number;
  pages: number;
  total: number;
  start: number;
  end: number;
  years: ArchiveYear[];
  groups: {
    year: string;
    months: { month: string; entries: ArchiveRecord[]; count: number; continued: boolean }[];
  }[];
};
export const emptyArchiveState = (): ArchiveState => ({ q: '', kind: 'all', tag: '' });
export function archiveRoute(page = 1) {
  return page <= 1 ? '/archive/' : `/archive/page/${page}/`;
}
export function archivePageNumber(path: string) {
  return Number(path.match(/^\/archive\/page\/([1-9]\d*)\/$/)?.[1] || 1);
}
export function archiveState(params: URLSearchParams): ArchiveState {
  const kind = params.get('kind');
  return {
    q: (params.get('q') || '').slice(0, 500),
    kind: kind === 'posts' || kind === 'lab' ? kind : 'all',
    tag: (params.get('tag') || '').slice(0, 200),
  };
}
export function archiveHref(
  page: number,
  state: ArchiveState = emptyArchiveState(),
  year?: string,
) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.kind !== 'all') params.set('kind', state.kind);
  if (state.tag) params.set('tag', state.tag);
  return (
    archiveRoute(page) + (params.size ? `?${params}` : '') + (year ? `#archive-year-${year}` : '')
  );
}
export function createArchiveIndex(
  source: readonly ArchiveRecord[],
  buildOrdered = false,
): ArchiveIndex {
  // Catalog order is already canonical. Do not sort it again in the reader's locale.
  const records = buildOrdered
    ? [...source]
    : [...source].sort(
        (a, b) =>
          b.publishedAt.localeCompare(a.publishedAt) ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      );
  const topics = new Map<string, number>();
  for (const entry of records)
    for (const tag of new Set(entry.tags)) topics.set(tag, (topics.get(tag) || 0) + 1);
  return {
    records,
    text: records.map((e) => `${e.title} ${e.summary} ${e.tags.join(' ')}`.toLowerCase()),
    topics: [...topics]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, count]) => ({ tag, count })),
  };
}
export function archiveTopics(index: ArchiveIndex, query: string) {
  const value = query.trim().toLowerCase();
  const suggestions = [];
  for (const topic of index.topics) {
    if (topic.tag.toLowerCase().includes(value)) suggestions.push(topic);
    if (suggestions.length === archiveTopicLimit) break;
  }
  return suggestions;
}
export function filterArchive(index: ArchiveIndex, state: ArchiveState): ArchiveSelection {
  const q = state.q.trim().toLowerCase();
  const records: ArchiveRecord[] = [],
    years: ArchiveYear[] = [],
    months = new Map<string, number>();
  for (let i = 0; i < index.records.length; i++) {
    const entry = index.records[i];
    if (
      (state.kind !== 'all' && entry.kind !== state.kind) ||
      (q && !index.text[i].includes(q)) ||
      (state.tag && !entry.tags.includes(state.tag))
    )
      continue;
    const year = entry.publishedAt.slice(0, 4),
      month = entry.publishedAt.slice(0, 7);
    const current = years[years.length - 1];
    if (current?.year === year) current.count++;
    else years.push({ year, count: 1, page: Math.floor(records.length / archivePageSize) + 1 });
    months.set(month, (months.get(month) || 0) + 1);
    records.push(entry);
  }
  return { records, years, months };
}
export function archivePage(selection: ArchiveSelection, requested = 1): ArchivePage {
  const total = selection.records.length,
    pages = Math.max(1, Math.ceil(total / archivePageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(requested) || 1));
  const offset = (page - 1) * archivePageSize;
  const groups: ArchivePage['groups'] = [];
  for (const entry of selection.records.slice(offset, offset + archivePageSize)) {
    const year = entry.publishedAt.slice(0, 4),
      month = entry.publishedAt.slice(0, 7);
    let group = groups[groups.length - 1];
    if (group?.year !== year) {
      group = { year, months: [] };
      groups.push(group);
    }
    let bucket = group.months[group.months.length - 1];
    if (bucket?.month !== month) {
      bucket = {
        month,
        entries: [],
        count: selection.months.get(month) || 0,
        continued: offset > 0 && selection.records[offset - 1]?.publishedAt.startsWith(month),
      };
      group.months.push(bucket);
    }
    bucket.entries.push(entry);
  }
  return {
    page,
    pages,
    total,
    start: total ? offset + 1 : 0,
    end: Math.min(total, offset + archivePageSize),
    groups,
    years: selection.years,
  };
}
export function archivePageLinks(page: number, pages: number): (number | null)[] {
  const numbers = [
    ...new Set([1, pages, page - 1, page, page + 1].filter((n) => n > 0 && n <= pages)),
  ].sort((a, b) => a - b);
  return numbers.flatMap((n, i) => (i && n - numbers[i - 1] > 1 ? [null, n] : [n]));
}
export function readArchiveCatalog(value: unknown): ArchiveCatalog {
  const data = value as ArchiveCatalog;
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.records) ||
    data.records.length > 100_000 ||
    !data.labels ||
    typeof data.labels.posts !== 'string' ||
    typeof data.labels.lab !== 'string' ||
    !data.records.every(
      (e) =>
        e &&
        typeof e.id === 'string' &&
        typeof e.title === 'string' &&
        typeof e.summary === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.publishedAt) &&
        (e.kind === 'posts' || e.kind === 'lab') &&
        typeof e.lang === 'string' &&
        typeof e.url === 'string' &&
        /^\/(?!\/)/.test(e.url) &&
        !/[\s\\]/.test(e.url) &&
        Array.isArray(e.tags) &&
        e.tags.every((tag) => typeof tag === 'string') &&
        (e.facts === undefined ||
          (!!e.facts &&
            typeof e.facts === 'object' &&
            !Array.isArray(e.facts) &&
            (e.facts.published === undefined || typeof e.facts.published === 'boolean') &&
            (e.facts.updatedAt === undefined ||
              (typeof e.facts.updatedAt === 'string' &&
                /^\d{4}-\d{2}-\d{2}$/.test(e.facts.updatedAt))) &&
            (e.facts.words === undefined ||
              (Number.isSafeInteger(e.facts.words) && e.facts.words >= 0)) &&
            (e.facts.minutes === undefined ||
              (Number.isSafeInteger(e.facts.minutes) && e.facts.minutes >= 1)))) &&
        (e.coverWidth === undefined ||
          (Number.isInteger(e.coverWidth) && e.coverWidth > 0 && e.coverWidth <= 40000000)) &&
        (e.coverHeight === undefined ||
          (Number.isInteger(e.coverHeight) && e.coverHeight > 0 && e.coverHeight <= 40000000)) &&
        (e.cover === undefined ||
          (typeof e.cover === 'string' && /^(?:\/(?!\/)|https:\/\/)/.test(e.cover))),
    )
  )
    throw new Error('The archive catalog is unavailable or outdated.');
  return data;
}
