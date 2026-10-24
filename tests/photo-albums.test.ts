import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { librarySchema, photoAlbumSchema } from '../src/shared/contracts.js';
import { resolveAlbums, saveAlbum, removeAlbum, albumRoute } from '../src/shared/albums.js';
import { createRenderer } from '../src/site/pages.js';
import { Store } from '../src/engine/store.js';
import { siteRedirects } from '../src/engine/shortlinks.js';
const photo = {
  id: 'photo',
  src: '/media/coast-dawn.svg',
  alt: 'The coast at dawn',
  caption: 'Dawn',
  album: 'Coast',
  takenAt: '2026-01-01',
  demo: false,
};
it('derives existing albums without requiring a source migration', () => {
  const library = librarySchema.parse({ photos: [photo], news: [] });
  expect(library.albums).toEqual([]);
  const [album] = resolveAlbums(library);
  expect(album.legacy).toBe(true);
  expect(albumRoute(album)).toBe('/life/coast/');
  expect(album.effectiveCover).toBe(photo.src);
});
it('renames metadata and membership atomically while retaining public aliases', () => {
  const library = librarySchema.parse({ photos: [photo], news: [] }),
    old = resolveAlbums(library)[0];
  const next = saveAlbum(
    library,
    photoAlbumSchema.parse({
      id: 'album',
      name: 'Coastlines',
      slug: 'coastlines',
      description: 'Changing light',
    }),
    old,
  );
  expect(next.photos[0].album).toBe('Coastlines');
  expect(next.albums[0].aliases).toEqual(['coast']);
  expect(library.photos[0].album).toBe('Coast');
  expect(siteRedirects([], undefined, next)).toContain('/life/coast/ /life/coastlines/ 301');
  expect(() =>
    saveAlbum(next, photoAlbumSchema.parse({ id: 'other', name: 'Other', slug: 'coast' })),
  ).toThrow(/path/);
});
it('falls back from moved covers and keeps photographs when deleting an album', () => {
  const library = librarySchema.parse({
    photos: [photo, { ...photo, id: 'later', src: '/media/coast-dusk.svg', takenAt: '2026-02-01' }],
    news: [],
    albums: [{ id: 'album', name: 'Coast', slug: 'coast', cover: '/media/missing.webp' }],
  });
  const album = resolveAlbums(library)[0];
  expect(album.effectiveCover).toBe('/media/coast-dusk.svg');
  const next = removeAlbum(library, album, 'My journal');
  expect(next.albums).toEqual([]);
  expect(next.photos).toHaveLength(2);
  expect(next.photos.every((p) => p.album === 'My journal')).toBe(true);
  expect(() => removeAlbum(library, album, 'Coast')).toThrow(/another/);
  expect(() => removeAlbum(library, album, ' Coast ')).toThrow(/another/);
});
it('renders album covers/descriptions and excludes empty albums from public routes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'album-render-'));
  try {
    await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
    const model = await new Store(root).read();
    const existing = resolveAlbums(model.library)[0];
    model.library = saveAlbum(
      model.library,
      photoAlbumSchema.parse({
        id: 'album',
        name: existing.name,
        slug: 'curated',
        description: 'A story told in changing light',
      }),
      existing,
    );
    model.library.albums.push(
      photoAlbumSchema.parse({ id: 'empty', name: 'Empty', slug: 'empty' }),
    );
    const renderer = await createRenderer(model);
    expect(renderer.render('/life/')).toContain('life-album-card');
    expect(renderer.routes).toContain('/life/curated/');
    expect(renderer.routes).not.toContain('/life/empty/');
    expect(renderer.render('/life/curated/')).toContain('A story told in changing light');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
