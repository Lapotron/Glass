import type { PublicEntry, SiteConfig } from './contracts.js';
import { routeFor } from './contracts.js';
import { resolveEntrySettings } from './entry-settings.js';
import { articleReadingStats } from './article-reading.js';
import type { ArchiveFacts, ArchiveRecord } from './archive.js';

export function archiveEntryMetadata(
  entry: PublicEntry,
  collections: SiteConfig['collections'],
): ArchiveRecord {
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    publishedAt: entry.publishedAt,
    kind: entry.kind,
    lang: entry.lang,
    tags: entry.tags,
    url: routeFor(entry, collections),
    ...(entry.cover ? { cover: entry.cover } : {}),
  };
}
/** Explicit published presentation metadata; source, revisions and hidden facts stay private. */
export function archiveEntry(
  entry: PublicEntry,
  site: SiteConfig,
  stats?: { words: number; minutes: number },
): ArchiveRecord {
  const { reading } = resolveEntrySettings(site, entry);
  const metrics = reading.readingTime ? stats || articleReadingStats(entry.body) : undefined;
  const facts: ArchiveFacts = {
    ...(reading.publishedDate ? { published: true } : {}),
    ...(reading.modifiedDate && entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
    ...(metrics ? { words: metrics.words, minutes: metrics.minutes } : {}),
  };
  return {
    ...archiveEntryMetadata(entry, site.collections),
    ...(Object.keys(facts).length ? { facts } : {}),
  };
}
