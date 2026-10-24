import { defaultCollections, collectionAliases, collectionIndexRoute } from './collections.js';
import type { Library, PhotoAlbum } from './contracts.js';
import { headingSlug } from './utils.js';
export type ResolvedAlbum = PhotoAlbum & {
  photos: Library['photos'];
  effectiveCover: string;
  from: string;
  to: string;
  legacy: boolean;
};
export const albumRoute = (album: Pick<PhotoAlbum, 'slug'>, collections = defaultCollections) =>
  `${collectionIndexRoute('life', collections)}${encodeURIComponent(album.slug)}/`;
/** Exact aliases protect link validation; old prefixes and renamed albums resolve in one hop. */
export function albumAliasRoutes(library: Library, collections = defaultCollections) {
  const aliases = new Map<string, string>();
  for (const album of resolveAlbums(library).filter((a) => a.photos.length))
    for (const prefix of [collections.life.path, ...collectionAliases('life', collections)])
      for (const slug of [album.slug, ...album.aliases]) {
        const route = `/${prefix}/${encodeURIComponent(slug)}/`;
        if (route !== albumRoute(album, collections))
          for (const path of [route, route.slice(0, -1)])
            aliases.set(path, albumRoute(album, collections));
      }
  return aliases;
}
export function resolveAlbums(library: Library): ResolvedAlbum[] {
  const names = [
    ...new Set([
      ...(library.albums || []).map((a) => a.name),
      ...library.photos.map((p) => p.album),
    ]),
  ];
  return names
    .map((name) => {
      const metadata = (library.albums || []).find((a) => a.name === name);
      const photos = library.photos
        .filter((p) => p.album === name)
        .sort((a, b) => b.takenAt.localeCompare(a.takenAt) || a.id.localeCompare(b.id));
      const oldSlug = headingSlug(name);
      const album: PhotoAlbum = metadata || {
        id: `legacy-${oldSlug}`.slice(0, 100),
        name,
        slug: oldSlug,
        description: '',
        cover: '',
        aliases: [],
      };
      return {
        ...album,
        photos,
        effectiveCover: photos.some((p) => p.src === album.cover)
          ? album.cover
          : photos[0]?.src || '',
        from: photos.at(-1)?.takenAt || '',
        to: photos[0]?.takenAt || '',
        legacy: !metadata,
      };
    })
    .sort((a, b) => b.to.localeCompare(a.to) || a.name.localeCompare(b.name));
}
export function saveAlbum(library: Library, next: PhotoAlbum, previous?: ResolvedAlbum): Library {
  const names = resolveAlbums(library).filter((a) => a.id !== previous?.id);
  if (
    names.some(
      (a) => a.name.normalize('NFC').toLowerCase() === next.name.normalize('NFC').toLowerCase(),
    )
  )
    throw new Error('An album already uses this name.');
  const aliases = [
    ...new Set([
      ...next.aliases,
      ...(previous && previous.slug !== next.slug ? [previous.slug] : []),
    ]),
  ].filter((slug) => slug !== next.slug);
  const allPaths = [next.slug, ...aliases].map((s) => s.normalize('NFC').toLowerCase());
  if (
    names.some((a) =>
      [a.slug, ...a.aliases].some((s) => allPaths.includes(s.normalize('NFC').toLowerCase())),
    )
  )
    throw new Error('Another album uses this public path or one of its retained aliases.');
  return {
    ...library,
    albums: [...(library.albums || []).filter((a) => a.id !== previous?.id), { ...next, aliases }],
    photos: library.photos.map((p) =>
      p.album === previous?.name ? { ...p, album: next.name } : p,
    ),
  };
}
export function removeAlbum(library: Library, album: ResolvedAlbum, destination: string): Library {
  if (album.photos.length && (!destination.trim() || destination.trim() === album.name))
    throw new Error('Choose another album for these moments.');
  return {
    ...library,
    albums: (library.albums || []).filter((a) => a.id !== album.id),
    photos: library.photos.map((p) =>
      p.album === album.name ? { ...p, album: destination.trim() } : p,
    ),
  };
}
