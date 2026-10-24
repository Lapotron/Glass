import { routeFor, type ContentEntry } from '../shared/contracts.js';
import { validateShortLinks } from '../shared/shortlinks.js';
import type { Library } from '../shared/contracts.js';
import { albumAliasRoutes } from '../shared/albums.js';
import { entryAliasRoutes } from '../shared/entry-routes.js';
import {
  collectionAliases,
  collectionIndexRoute,
  publicCollectionKinds,
  defaultCollections,
} from '../shared/collections.js';
export function shortLinkRedirects(
  entries: ContentEntry[],
  collections = defaultCollections,
  reservedStatic = 2,
) {
  validateShortLinks(entries);
  const rules = entries
    .filter((entry) => entry.status === 'published')
    .flatMap((entry) =>
      [entry.shortCode, ...entry.shortAliases].map(
        (code) => '/s/' + code + ' ' + routeFor(entry, collections) + ' 302',
      ),
    );
  // The caller reserves Archive/collection indexes; one dynamic rule normalizes short-link slashes.
  if (rules.length + reservedStatic > 2000)
    throw new Error(
      'Short links exceed the Cloudflare Pages limit of 2,000 static redirects. Remove unused aliases before building.',
    );
  return rules.length ? rules.join('\n') + '\n/s/:code/ /s/:code 301\n' : '';
}
export function siteRedirects(
  entries: ContentEntry[],
  collections = defaultCollections,
  library?: Library,
  mediaLinks = new Map<string, string>(),
) {
  const staticRules = ['/news /archive/ 301', '/news/ /archive/ 301'];
  for(const [source,target] of entryAliasRoutes(entries,collections))
    staticRules.push(`${source} ${target} 301`);
  for (const [source, target] of mediaLinks) staticRules.push(`${source} ${target} 302`);
  if (library)
    for (const [source, destination] of albumAliasRoutes(library, collections))
      staticRules.push(`${source} ${destination} 301`);
  const dynamicRules: string[] = [];
  if (mediaLinks.size) dynamicRules.push('/m/:code/ /m/:code 301');
  for (const kind of publicCollectionKinds)
    for (const alias of collectionAliases(kind, collections)) {
      const destination = collectionIndexRoute(kind, collections);
      staticRules.push(`/${alias} ${destination} 301`, `/${alias}/ ${destination} 301`);
      dynamicRules.push(`/${alias}/* ${destination}:splat 301`);
    }
  const shortRules = shortLinkRedirects(entries, collections, staticRules.length)
    .trim()
    .split('\n')
    .filter(Boolean);
  if (dynamicRules.length + Number(shortRules.some((rule) => rule.includes(':code'))) > 100)
    throw new Error(
      'Collection history exceeds the Cloudflare Pages limit of 100 dynamic redirects. Reduce retained path aliases before building.',
    );
  return (
    [
      ...staticRules,
      ...shortRules.filter((rule) => !rule.includes(':code')),
      ...dynamicRules,
      ...shortRules.filter((rule) => rule.includes(':code')),
    ].join('\n') + '\n'
  );
}
