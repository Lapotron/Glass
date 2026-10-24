import { z } from 'zod';

export type CollectionKind = 'posts' | 'lab';
export const collectionKinds = ['posts', 'lab'] as const;
export const publicCollectionKinds = ['posts', 'lab', 'life'] as const;
export type PublicCollectionKind = (typeof publicCollectionKinds)[number];
const originalPaths = { posts: 'blog', lab: 'lab', life: 'life' } as const;
const reservedPaths = new Set([
  'about',
  'archive',
  'projects',
  'tools',
  'settings',
  'tags',
  's',
  'm',
  'news',
  'api',
  'studio',
  'assets',
  'media',
  'preview',
  'previews',
  'feed',
  'feeds',
  'search',
  'cdn-cgi',
]);
const pathSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^\/+|\/+$/g, '').toLowerCase())
  .pipe(
    z
      .string()
      .regex(
        /^[a-z][a-z0-9-]{0,47}$/,
        'Use one path segment: letters, numbers and hyphens, starting with a letter.',
      ),
  )
  .refine(
    (value) => !reservedPaths.has(value),
    'This path is reserved by the site. Choose another path.',
  );
const collectionSchema = (name: string, singular: string, path: string) =>
  z.object({
    name: z.string().trim().min(1).max(40).default(name),
    singular: z.string().trim().min(1).max(40).default(singular),
    path: pathSchema.default(path),
    aliases: z.array(pathSchema).max(40).default([]),
  });
const postsSchema = collectionSchema('Writing', 'Entry', originalPaths.posts);
const labSchema = collectionSchema('Lab', 'Experiment', originalPaths.lab);
const lifeSchema = collectionSchema('Life', 'Moment', originalPaths.life);
export const collectionsSchema = z
  .object({
    posts: postsSchema.default(() => postsSchema.parse({})),
    lab: labSchema.default(() => labSchema.parse({})),
    life: lifeSchema.default(() => lifeSchema.parse({})),
  })
  .superRefine((value, context) => {
    for (const kind of publicCollectionKinds)
      for (const other of publicCollectionKinds.filter((candidate) => candidate !== kind)) {
        const owned = new Set([originalPaths[other], value[other].path, ...value[other].aliases]);
        for (const field of ['path', 'aliases'] as const) {
          const paths = field === 'path' ? [value[kind].path] : value[kind].aliases;
          if (paths.some((path) => owned.has(path)))
            context.addIssue({
              code: 'custom',
              path: [kind, field],
              message: `This path belongs to ${value[other].name} or one of its earlier URLs. Choose a different path.`,
            });
        }
      }
  });
export type CollectionsConfig = z.infer<typeof collectionsSchema>;
export const defaultCollections = collectionsSchema.parse({});
export function collectionIndexRoute(kind: PublicCollectionKind, collections = defaultCollections) {
  return `/${collections[kind].path}/`;
}
export function routeFor(
  entry: { kind: CollectionKind; slug: string },
  collections = defaultCollections,
) {
  return `${collectionIndexRoute(entry.kind, collections)}${encodeURIComponent(entry.slug)}/`;
}
export function collectionAliases(kind: PublicCollectionKind, collections = defaultCollections) {
  return [...new Set([originalPaths[kind], ...collections[kind].aliases])].filter(
    (path) => path !== collections[kind].path,
  );
}
export function routesForEntry(
  entry: { kind: CollectionKind; slug: string },
  collections = defaultCollections,
) {
  return [
    routeFor(entry, collections),
    ...collectionAliases(entry.kind, collections).map(
      (path) => `/${path}/${encodeURIComponent(entry.slug)}/`,
    ),
  ];
}
export function collectionRedirect(pathname: string, collections = defaultCollections) {
  for (const kind of publicCollectionKinds)
    for (const alias of collectionAliases(kind, collections)) {
      if (pathname === `/${alias}` || pathname === `/${alias}/`)
        return collectionIndexRoute(kind, collections);
      if (pathname.startsWith(`/${alias}/`))
        return collectionIndexRoute(kind, collections) + pathname.slice(alias.length + 2);
    }
  return undefined;
}
/** Save-time history is retained even when an older client omits it. No source folders change. */
export function retainCollectionPaths(next: CollectionsConfig, previous: CollectionsConfig) {
  return collectionsSchema.parse(
    Object.fromEntries(
      publicCollectionKinds.map((kind) => [
        kind,
        {
          ...next[kind],
          aliases: [
            ...new Set([...previous[kind].aliases, previous[kind].path, ...next[kind].aliases]),
          ].filter((path) => path !== next[kind].path && path !== originalPaths[kind]),
        },
      ]),
    ),
  );
}
/** Known aliases only: a redirect namespace must never hide a missing article during validation. */
export function collectionAliasRoutes(
  entries: { kind: CollectionKind; slug: string; status: string }[],
  collections = defaultCollections,
) {
  const redirects = new Map<string, string>();
  for (const kind of publicCollectionKinds)
    for (const alias of collectionAliases(kind, collections)) {
      redirects.set(`/${alias}`, collectionIndexRoute(kind, collections));
      redirects.set(`/${alias}/`, collectionIndexRoute(kind, collections));
      for (const entry of entries.filter(
        (entry) => entry.kind === kind && entry.status === 'published',
      ))
        for (const suffix of ['', '/'])
          redirects.set(
            `/${alias}/${encodeURIComponent(entry.slug)}${suffix}`,
            routeFor(entry, collections),
          );
    }
  return redirects;
}
