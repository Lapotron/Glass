import { z } from 'zod';
import { routeFor, routesForEntry, type CollectionsConfig } from './collections.js';
import type { ContentEntry } from './contracts.js';

export const entryRouteAliasSchema = z
  .string()
  .max(500)
  .refine((value) => {
    if (!/^\/[a-z][a-z0-9-]{0,47}\/[^/?#\\<>"\s]+\/$/.test(value)) return false;
    try {
      const [prefix, slug] = value.slice(1, -1).split('/').map(decodeURIComponent);
      return (
        ![
          'assets',
          'media',
          'api',
          'studio',
          'settings',
          'about',
          'archive',
          'projects',
          'tags',
          's',
          'm',
          'life',
          'news',
          'search',
          'preview',
          'previews',
          'cdn-cgi',
        ].includes(prefix) &&
        !!slug &&
        !/[\\/#?]/.test(slug) &&
        slug !== '.' &&
        slug !== '..'
      );
    } catch {
      return false;
    }
  }, 'Use a former local article URL with a collection prefix and trailing slash.');
const key = (path: string) => decodeURIComponent(path).toLocaleLowerCase();
export function retainedEntryRoutes(
  entry: Pick<ContentEntry, 'kind' | 'slug' | 'routeAliases'>,
  collections: CollectionsConfig,
) {
  return [...new Set([...routesForEntry(entry, collections), ...(entry.routeAliases || [])])];
}
export function validateEntryRoutes(entries: ContentEntry[], collections: CollectionsConfig) {
  const owners = new Map<string, string>();
  for (const entry of entries)
    for (const route of retainedEntryRoutes(entry, collections)) {
      const normalized = key(route),
        owner = owners.get(normalized);
      if (owner && owner !== entry.id)
        throw new Error(`This URL is already in use or retained by another entry: ${route}`);
      owners.set(normalized, entry.id);
    }
}
export function entryAliasRoutes(entries: ContentEntry[], collections: CollectionsConfig) {
  if (!entries.some((entry) => entry.routeAliases?.length)) return new Map<string, string>();
  validateEntryRoutes(entries, collections);
  const aliases = new Map<string, string>();
  for (const entry of entries.filter((entry) => entry.status === 'published')) {
    const canonical = routeFor(entry, collections);
    for (const route of entry.routeAliases || [])
      if (key(route) !== key(canonical)) aliases.set(route, canonical);
  }
  return aliases;
}
