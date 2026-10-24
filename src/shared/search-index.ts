import { topK } from './algorithms.js';

export type SearchEntry = {
  title: string;
  summary: string;
  text: string;
  tags: string[];
  url: string;
  kind: string;
  kindLabel?: string;
};
export function prepareSearch(entries: SearchEntry[]) {
  return entries.map((entry) => ({
    entry,
    title: entry.title.toLocaleLowerCase(),
    tags: entry.tags.join(' ').toLocaleLowerCase(),
    text: entry.text.toLocaleLowerCase(),
    all: `${entry.title} ${entry.summary} ${entry.tags.join(' ')} ${entry.text}`.toLocaleLowerCase(),
  }));
}
export function searchEntries(index: ReturnType<typeof prepareSearch>, query: string, limit = 12) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  function* matches() {
    for (const record of index) {
      if (!words.every((word) => record.all.includes(word))) continue;
      const score = words.reduce(
        (total, word) =>
          total +
          (record.title.includes(word) ? 5 : 0) +
          (record.tags.includes(word) ? 3 : 0) +
          (record.text.includes(word) ? 1 : 0),
        0,
      );
      yield { entry: record.entry, score };
    }
  }
  return topK(matches(), limit, (a, b) => b.score - a.score).map((record) => record.entry);
}
