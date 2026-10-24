export type ReadingRecord = {
  id: string;
  title: string;
  url: string;
  revision: string;
  bookmarked: boolean;
  progress: number;
  anchor: string;
  quote: string;
  updatedAt: string;
};
export const readingStorageKey = 'glass-reading-v1';
export function parseReadingRecords(value: unknown): ReadingRecord[] {
  if (!Array.isArray(value) || value.length > 500)
    throw new Error('Reading lists support up to 500 entries.');
  const result = new Map<string, ReadingRecord>();
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error('Invalid reading list.');
    const r = item as ReadingRecord;
    if (
      typeof r.id !== 'string' ||
      !r.id ||
      r.id.length > 100 ||
      typeof r.title !== 'string' ||
      r.title.length > 300 ||
      typeof r.url !== 'string' ||
      !/^\/(?!\/)[^?#\s]*$/.test(r.url) ||
      r.url.length > 500 ||
      typeof r.revision !== 'string' ||
      !/^[a-f\d]{0,64}$/.test(r.revision) ||
      typeof r.bookmarked !== 'boolean' ||
      !Number.isFinite(r.progress) ||
      r.progress < 0 ||
      r.progress > 100 ||
      typeof r.anchor !== 'string' ||
      r.anchor.length > 100 ||
      !/^$|^line-[a-f\d]{20}-[1-9]\d{0,4}-\d{1,7}-\d{1,7}$/.test(r.anchor) ||
      typeof r.quote !== 'string' ||
      r.quote.length > 200 ||
      typeof r.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(r.updatedAt))
    )
      throw new Error('Invalid reading list entry.');
    result.set(r.id, {
      id: r.id,
      title: r.title,
      url: r.url,
      revision: r.revision,
      bookmarked: r.bookmarked,
      progress: r.progress,
      anchor: r.anchor,
      quote: r.quote,
      updatedAt: r.updatedAt,
    });
  }
  return [...result.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
