import { beforeEach, afterEach, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { Store, digest } from '../src/engine/store.js';
import { MediaService } from '../src/engine/media.js';
import { BackupService } from '../src/engine/backup.js';
import { MediaMaintenance } from '../src/engine/media-maintenance.js';
import { buildSite } from '../src/engine/build.js';
import { prepareMediaDelivery } from '../src/engine/media-delivery.js';
import { mediaLinkMap } from '../src/engine/media-links.js';
import { siteRedirects } from '../src/engine/shortlinks.js';
import { languageOptionLabel } from '../src/shared/content-languages.js';
let root: string, store: Store, media: MediaService, assets: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-media-sharing-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  media = new MediaService(store);
  assets = path.join(root, 'assets');
  await fs.mkdir(assets);
  for (const name of ['site.js', 'site.css', 'appearance.js', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, name), '/* fixture */');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const upload = async () =>
  media.upload(
    new File(
      [
        new Uint8Array(
          await sharp({ create: { width: 80, height: 50, channels: 3, background: '#456789' } })
            .png()
            .toBuffer(),
        ),
      ],
      'source-photo.png',
      { type: 'image/png' },
    ),
  );
it('renames labels without changing files, retains previous codes and rejects stale or colliding edits', async () => {
  const file = await upload(),
    before = await media.metadata(file.url),
    bytes = await fs.readFile(path.join(root, 'content/media', file.name));
  const changed = await media.saveMetadata(
    file.url,
    { ...before.metadata, displayName: '海岸, study', shortCode: 'coast-study' },
    before.libraryRevision,
  );
  expect(changed.downloadName).toBe('海岸, study.webp');
  expect(changed.metadata.shortAliases).toContain(before.metadata.shortCode);
  expect(digest(await fs.readFile(path.join(root, 'content/media', file.name)))).toBe(
    digest(bytes),
  );
  expect((await media.list()).find((f) => f.url === file.url)?.displayName).toBe('海岸, study');
  await expect(
    media.saveMetadata(file.url, before.metadata, before.libraryRevision),
  ).rejects.toThrow('changed');
  const another = await upload(),
    second = await media.metadata(another.url);
  await expect(
    media.saveMetadata(
      another.url,
      { ...second.metadata, shortCode: 'coast-study' },
      second.libraryRevision,
    ),
  ).rejects.toThrow('already in use');
  await expect(
    media.saveMetadata(
      another.url,
      { ...second.metadata, displayName: 'bad\r\nheader' },
      second.libraryRevision,
    ),
  ).rejects.toThrow();
  expect((await media.metadata(file.url)).metadata.displayName).toBe('海岸, study');
});
it('publishes only referenced or explicitly shared files and keeps R2 keys independent of labels', async () => {
  const file = await upload(),
    original = await media.metadata(file.url);
  let built = await buildSite(store, { assets });
  expect(built.manifest).not.toContain('media/' + file.name);
  expect(await fs.readFile(path.join(built.outputDir, '_redirects'), 'utf8')).not.toContain(
    original.shortPath,
  );
  await media.saveMetadata(
    file.url,
    { ...original.metadata, displayName: 'Shared photo', publishForSharing: true },
    original.libraryRevision,
  );
  const model = await store.snapshot();
  await store.saveJson(
    'site',
    {
      ...model.site,
      url: 'https://reader.example.org',
      mediaDelivery: {
        mode: 'r2',
        bucket: 'media',
        publicOrigin: 'https://assets.example.org',
        prefix: 'media',
      },
    },
    model.siteRevision,
  );
  built = await buildSite(store, { assets });
  expect(built.manifest).toContain('media/' + file.name);
  expect(await fs.readFile(path.join(built.outputDir, '_redirects'), 'utf8')).toContain(
    original.shortPath + ' ' + file.url + ' 302',
  );
  const delivery = await prepareMediaDelivery(built, (await store.snapshot()).site),
    asset = delivery.media!.assets.find((a) => a.file === 'media/' + file.name)!;
  expect(await fs.readFile(path.join(delivery.outputDir, '_redirects'), 'utf8')).toContain(
    original.shortPath + ' ' + asset.url + ' 302',
  );
  const headers = await fs.readFile(path.join(delivery.outputDir, '_headers'), 'utf8');
  expect(headers).toContain('/assets/*\n  Access-Control-Allow-Origin: *\n  X-Robots-Tag: noindex');
  expect(headers).toContain('/media/*\n  X-Robots-Tag: noindex');
  const metadata = await media.metadata(file.url);
  await media.saveMetadata(
    file.url,
    { ...metadata.metadata, displayName: 'A second name' },
    metadata.libraryRevision,
  );
  const second = await prepareMediaDelivery(
    await buildSite(store, { assets }),
    (await store.snapshot()).site,
  );
  expect(second.media!.assets.find((a) => a.file === 'media/' + file.name)?.key).toBe(asset.key);
  const manifest = JSON.parse(
    await fs.readFile(path.join(second.outputDir, 'assets/media-details.json'), 'utf8'),
  );
  expect(manifest.images[file.url]).toMatchObject({
    displayName: 'A second name',
    downloadName: 'A second name.webp',
    shortUrl: original.shortPath,
  });
  expect(second.manifest.some((f) => f.includes('original') || f.includes('.studio'))).toBe(false);
});
it('resolves short references for builds and protects current and retained sharing through backup restore', async () => {
  const file = await upload(),
    metadata = await media.metadata(file.url),
    entry = await store.create('posts', 'Media alias', 'media-alias');
  await store.saveEntry(entry.id, {
    metadata: { ...entry, status: 'published' },
    body: '![A shared photo](' + metadata.shortPath + ')',
    revision: entry.revision,
  });
  const built = await buildSite(store, { assets });
  expect(built.manifest).toContain('media/' + file.name);
  const audit = await new MediaMaintenance(
    store,
    media,
    new BackupService(store),
    () => true,
  ).audit();
  expect(
    audit.items
      .find((item) => item.url === file.url)
      ?.references?.some((ref) => ref.entryId === entry.id),
  ).toBe(true);
  const latest = await media.metadata(file.url),
    saved = await media.saveMetadata(
      file.url,
      { ...latest.metadata, displayName: 'Restored label', publishForSharing: true },
      latest.libraryRevision,
    );
  const backups = new BackupService(store),
    backup = await backups.create();
  await media.saveMetadata(
    file.url,
    { ...saved.metadata, displayName: 'Changed label', publishForSharing: false },
    saved.libraryRevision,
  );
  const review = await backups.inspect(await backups.download(backup.id));
  await backups.restore(review.id, review.sourceRevision);
  expect((await media.metadata(file.url)).metadata).toMatchObject({
    displayName: 'Restored label',
    publishForSharing: true,
  });
});
it('counts media aliases against native redirect limits and presents native language names', async () => {
  const model = await store.snapshot(),
    links = new Map(Array.from({ length: 2001 }, (_, i) => ['/m/file-' + i, '/media/wave.svg']));
  expect(() => siteRedirects(model.entries, model.site.collections, model.library, links)).toThrow(
    '2,000',
  );
  const known = mediaLinkMap(['/media/wave.svg'], model.library);
  expect(known.size).toBe(1);
  expect([...known.keys()][0]).toMatch(/^\/m\/[a-f0-9]{16}$/);
  expect(languageOptionLabel('es')).toBe('Español');
  expect(languageOptionLabel('zh-Hans')).toBe('简体中文');
  expect(languageOptionLabel('zh-Hant')).toBe('繁體中文');
  expect(languageOptionLabel('en')).toBe('English');
  expect(languageOptionLabel('ja')).toBe('日本語');
  expect(languageOptionLabel('ar')).toBe('العربية');
});
