import { mediaMetadataSchema } from '../src/shared/media-metadata.js';
import { cameraPicture } from './fixtures/camera.js';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { parseReaderPreferences } from '../src/shared/reader-preferences.js';
import { Store, digest } from '../src/engine/store.js';
import { MediaService } from '../src/engine/media.js';
import { buildSite } from '../src/engine/build.js';
import { cameraInformation } from '../src/engine/image-details.js';
import { cameraFromImageHeader } from '../src/cloud/image-details.js';
import {
  prepareMediaDelivery,
  resolveMediaHtml,
  mediaResolver,
} from '../src/engine/media-delivery.js';
import {
  createR2Transport,
  r2Readiness,
  synchronizeMedia,
  type MediaTransport,
} from '../src/server/r2.js';
import { verifyPublishedDeployment } from '../src/server/deployment-check.js';
import { JobService, type Runner } from '../src/server/publishing.js';
import { createApp } from '../src/server/app.js';
import { BackupService } from '../src/engine/backup.js';
import { routeFor } from '../src/shared/contracts.js';
let root: string, store: Store, assets: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-reader-media-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  assets = path.join(root, 'test-assets');
  await fs.mkdir(assets);
  for (const file of ['site.js', 'site.css', 'appearance.js', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, file), '/* isolated fixture */');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function publishedPicture(exif = true) {
  const media = new MediaService(store),
    file = await media.upload(
      new File([new Uint8Array(await cameraPicture())], 'camera-study.jpg', { type: 'image/jpeg' }),
    );
  const entry = await store.create('posts', 'Camera study', 'camera-study');
  const saved = await store.saveEntry(entry.id, {
    metadata: { ...entry, status: 'published', cover: file.url },
    body: '![A camera study](' + file.url + ')',
    revision: entry.revision,
  });
  const model = await store.read();
  model.site = {
    ...model.site,
    url: 'https://journal.example',
    theme: { ...model.site.theme, backgroundImage: file.url },
    cloudflare: {
      accountId: 'a'.repeat(32),
      projectName: 'journal-test',
      productionBranch: 'main',
    },
    mediaDelivery: {
      mode: 'r2',
      bucket: 'journal-media',
      publicOrigin: 'https://media.journal.example',
      prefix: 'media',
    },
  };
  model.library.mediaDetails[file.url] = mediaMetadataSchema.parse({ publishCameraExif: exif });
  await store.saveJson('site', model.site, model.siteRevision);
  await store.saveJson('library', model.library, model.libraryRevision);
  return { file, entry: saved, model: await store.read(), media };
}
it('ignores Finder metadata while keeping private original validation intact', async () => {
  const { media } = await publishedPicture();
  const before = await media.list(),
    directory = path.join(root, '.studio/media-originals');
  await fs.writeFile(path.join(directory, '.DS_Store'), 'Finder metadata');
  await fs.writeFile(path.join(directory, '._metadata'), 'AppleDouble metadata');
  expect(await media.list()).toEqual(before);
  await media.validate();
  expect(await fs.readFile(path.join(directory, '.DS_Store'), 'utf8')).toBe('Finder metadata');
  await fs.mkdir(path.join(directory, 'damaged-source-record'));
  await expect(media.list()).rejects.toThrow('Invalid UUID');
});
it('accepts only bounded reader presentation overrides and rejects CSS, URLs and unknown versions', () => {
  expect(
    parseReaderPreferences({
      version: 1,
      theme: {
        accent: '#ab23fe',
        fontScale: 1.1,
        background: 'sand',
        wallpaperWash: 'dark',
        reduceMotion: true,
        glassBlur: 999,
        backgroundImage: 'url(javascript:bad)',
        private: 'no',
      },
      textScale: 1.5,
      wallpaper: 'local',
      wallpaperPreview: 'data:image/webp;base64,YWJj',
    }),
  ).toEqual({
    version: 1,
    theme: {
      accent: '#ab23fe',
      fontScale: 1.1,
      background: 'sand',
      wallpaperWash: 'dark',
      reduceMotion: true,
    },
    textScale: 1.5,
    wallpaper: 'local',
    wallpaperPreview: 'data:image/webp;base64,YWJj',
  });
  expect(parseReaderPreferences({ version: 2, theme: { accent: '#abcdef' } }).theme).toEqual({});
  expect(
    parseReaderPreferences({
      version: 1,
      theme: { accent: 'red; color:black', lineHeight: NaN, wallpaperWash: 'url(bad)' },
      textScale: Infinity,
      wallpaperPreview: 'data:image/svg+xml,<svg/>',
    }),
  ).toEqual({ version: 1, theme: {} });
});
it('extracts a bounded camera vocabulary while leaving serials, locations and personal data private', async () => {
  const camera = await cameraInformation(await cameraPicture());
  expect(camera).toMatchObject({
    make: 'Test Camera',
    model: 'Lens Study',
    lens: 'A small lens',
    exposure: '1/125 s',
    aperture: 'f/2.8',
    iso: '400',
    focalLength: '35 mm',
  });
  expect(JSON.stringify(camera)).not.toMatch(
    /Private|PRIVATE|GPS|Latitude|Serial|Artist|UserComment/,
  );
  expect(await cameraInformation(Buffer.from('broken EXIF'))).toEqual({});
  expect(cameraFromImageHeader(await cameraPicture())).toEqual(camera);
  expect(cameraFromImageHeader(Buffer.from('broken EXIF'))).toEqual({});
});
it('builds referenced public metadata only, strips embedded EXIF and keeps opt-out and backup choices consistent', async () => {
  const { file, model, media } = await publishedPicture();
  expect((await media.details(file.url)).camera.model).toBe('Lens Study');
  expect(
    (await sharp(await fs.readFile(path.join(root, 'content/media', file.name))).metadata()).exif,
  ).toBeUndefined();
  const result = await buildSite(store, { model, assets });
  const metadata = JSON.parse(
    await fs.readFile(path.join(result.outputDir, 'assets/media-details.json'), 'utf8'),
  );
  expect(metadata.images[file.url].camera.model).toBe('Lens Study');
  expect(JSON.stringify(metadata)).not.toMatch(
    /PRIVATE|Private|sourceId|libraryRevision|media-originals/,
  );
  expect(result.manifest.some((file) => file.includes('original'))).toBe(false);
  const backup = await new BackupService(store).create();
  const recovery = new BackupService(store),
    archive = await recovery.download(backup.id);
  const beforeRestore = await store.read();
  await store.saveJson(
    'library',
    { ...beforeRestore.library, mediaDetails: {} },
    beforeRestore.libraryRevision,
  );
  const review = await recovery.inspect(archive);
  await recovery.restore(review.id, review.sourceRevision);
  expect((await store.read()).library.mediaDetails[file.url].publishCameraExif).toBe(true);
  model.library.mediaDetails[file.url].publishCameraExif = false;
  const next = await buildSite(store, { model, assets });
  expect(
    JSON.parse(await fs.readFile(path.join(next.outputDir, 'assets/media-details.json'), 'utf8'))
      .images[file.url].camera,
  ).toEqual({});
}, 30000);
it('rewrites image destinations, responsive sources, widget data, OG and wallpaper without changing prose', async () => {
  const { model, entry, file } = await publishedPicture();
  model.entries.find((record) => record.id === entry.id)!.summary = file.url;
  const built = await buildSite(store, { model, assets });
  const delivered = await prepareMediaDelivery(built, model.site);
  expect(
    JSON.parse(await fs.readFile(path.join(delivered.outputDir, 'assets/deployment.json'), 'utf8')),
  ).toEqual({ version: 1, id: built.id });
  expect(delivered.manifest).toContain('assets/deployment.json');
  expect(await fs.readFile(path.join(delivered.outputDir, '_headers'), 'utf8')).toContain(
    '/assets/deployment.json\n  Cache-Control: no-store',
  );
  expect(delivered.outputDir).not.toBe(built.outputDir);
  const originalCatalog = built.manifest.find((file) => /^assets\/archive\/catalog-/.test(file))!;
  const deliveredCatalog = delivered.manifest.find((file) =>
    /^assets\/archive\/catalog-/.test(file),
  )!;
  const catalogBytes = await fs.readFile(path.join(delivered.outputDir, deliveredCatalog));
  expect(deliveredCatalog).toBe(`assets/archive/catalog-${digest(catalogBytes).slice(0, 20)}.json`);
  expect(deliveredCatalog).not.toBe(originalCatalog);
  expect(
    JSON.parse(catalogBytes.toString()).records.find((e: { id: string }) => e.id === entry.id)
      .cover,
  ).toMatch(/^https:\/\/media\.journal\.example\//);
  expect(
    JSON.parse(catalogBytes.toString()).records.find((e: { id: string }) => e.id === entry.id)
      .summary,
  ).toBe(file.url);
  const archiveHtml = await fs.readFile(
    path.join(delivered.outputDir, 'archive/index.html'),
    'utf8',
  );
  expect(archiveHtml).toContain(`data-archive-catalog="/${deliveredCatalog}"`);
  expect(archiveHtml).not.toContain('/' + originalCatalog);
  expect(await fs.readFile(path.join(built.outputDir, originalCatalog), 'utf8')).toContain(
    '/media/',
  );

  const image = delivered.media!.assets.find((asset) => asset.file === 'media/' + file.name)!;
  expect(image.url).toContain('/media/v2/' + image.sha256 + '.');
  // A CDN failure must retain an identical same-origin image for the viewer.
  expect(digest(await fs.readFile(path.join(delivered.outputDir, image.file)))).toBe(image.sha256);
  const html = await fs.readFile(
    path.join(delivered.outputDir, routeFor(entry).slice(1), 'index.html'),
    'utf8',
  );
  expect(html).toContain('src="' + image.url + '"');
  expect(html).not.toMatch(/imageSrcSet="\/media\//);
  expect(html).toContain('content="' + image.url + '"');
  expect(html).toContain('url("' + image.url + '")');
  expect(
    JSON.parse(
      await fs.readFile(path.join(delivered.outputDir, 'assets/media-details.json'), 'utf8'),
    ).images[file.url].url,
  ).toBe(image.url);
  expect(
    await fs.readFile(path.join(built.outputDir, routeFor(entry).slice(1), 'index.html'), 'utf8'),
  ).toContain('src="' + file.url + '"');
  const sample =
    '<p>Write ' +
    file.url +
    ' here.</p><img src="' +
    file.url +
    '"><figure data-config="{&quot;before&quot;:&quot;' +
    file.url +
    '&quot;}"></figure>';
  const changed = resolveMediaHtml(sample, mediaResolver(delivered.media!.assets, model.site.url));
  expect(changed).toContain('<p>Write ' + file.url + ' here.</p>');
  expect(changed).toContain('&quot;before&quot;:&quot;' + image.url + '&quot;');
  expect((await store.read()).entries.find((item) => item.id === entry.id)!.body).toContain(
    file.url,
  );
}, 30000);
it('keeps metadata writes token-checked, revision-checked and bounded to local image files', async () => {
  const { file } = await publishedPicture(false);
  const context = await createApp(root, { watchFiles: false });
  try {
    const session = await (await context.app.request('http://localhost/api/bootstrap')).json();
    const update = { url: file.url, publishCameraExif: true, revision: session.libraryRevision };
    const read = await context.app.request(
      'http://localhost/api/media/details?url=' + encodeURIComponent(file.url),
    );
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect((await read.json()).publishCameraExif).toBe(false);
    expect(
      (
        await context.app.request('http://localhost/api/media/details', {
          method: 'PUT',
          body: JSON.stringify(update),
          headers: { 'Content-Type': 'application/json' },
        })
      ).status,
    ).toBe(403);
    const headers = { 'Content-Type': 'application/json', 'X-Studio-Token': session.token };
    expect(
      (
        await context.app.request('http://localhost/api/media/details', {
          method: 'PUT',
          body: JSON.stringify(update),
          headers,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await context.app.request('http://localhost/api/media/details', {
          method: 'PUT',
          body: JSON.stringify(update),
          headers,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await context.app.request(
          'http://localhost/api/media/details?url=' + encodeURIComponent('/media/../site.json'),
        )
      ).status,
    ).toBe(400);
    expect(
      (await context.app.request('http://localhost/api/cloudflare/media')).headers.get(
        'cache-control',
      ),
    ).toBe('no-store');
  } finally {
    context.close();
  }
}, 20000);
it('synchronizes frozen objects before verification and retries without duplicate uploads', async () => {
  const bytes = Buffer.from('public image');
  const asset = {
    file: 'media/image.webp',
    key: 'media/' + digest(bytes) + '/image.webp',
    url: 'https://media.journal.example/image.webp',
    sha256: digest(bytes),
    bytes: bytes.length,
    contentType: 'image/webp',
  };
  await fs.mkdir(path.join(root, 'media'));
  await fs.writeFile(path.join(root, asset.file), bytes);
  const seen = new Set<string>(),
    events: string[] = [];
  const transport: MediaTransport = {
    matches: async (item) => seen.has(item.key),
    upload: async (item) => {
      events.push('upload');
      seen.add(item.key);
    },
    verify: async () => {
      events.push('verify');
    },
    close: vi.fn(),
  };
  await synchronizeMedia(transport, root, [asset], () => {});
  await synchronizeMedia(transport, root, [asset], () => {});
  expect(events).toEqual(['upload', 'verify', 'verify']);
});
it('verifies CDN bytes, MIME, immutable caching and public read CORS without treating ETag as a checksum', async () => {
  const model = await store.read();
  model.site.cloudflare.accountId = 'a'.repeat(32);
  model.site.mediaDelivery = {
    mode: 'r2',
    bucket: 'journal-media',
    prefix: 'media',
    publicOrigin: 'https://media.journal.example',
  };
  const bytes = Buffer.from('public image');
  const asset = {
    file: 'media/image.webp',
    key: 'image.webp',
    url: 'https://media.journal.example/image.webp',
    sha256: digest(bytes),
    bytes: bytes.length,
    contentType: 'image/webp',
  };
  const env = { R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret' };
  expect(r2Readiness(model.site, {}).configured).toBe(false);
  expect(() => createR2Transport(model.site, {})).toThrow(/R2_ACCESS_KEY_ID/);
  const response = (value = bytes, cors = '*') =>
    new Response(new Uint8Array(value), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': cors,
        ETag: 'not-a-sha256',
      },
    });
  const valid = createR2Transport(model.site, env, async () => response());
  await valid.verify(asset);
  valid.close?.();
  const corrupt = createR2Transport(model.site, env, async () =>
    response(Buffer.from('wrong bytes')),
  );
  await expect(corrupt.verify(asset)).rejects.toThrow(/verification failed/);
  corrupt.close?.();
  const noCors = createR2Transport(model.site, env, async () => response(bytes, ''));
  await expect(noCors.verify(asset)).rejects.toThrow(/CORS Policy.*purge the media hostname/);
  noCors.close?.();
});
it('publishes only after all images verify and preserves an uploaded URL when deployment verification fails', async () => {
  await publishedPicture();
  const sequence: string[] = [];
  const runner: Runner = async (args) => {
    if (args.includes('list')) return { code: 0, stdout: '[{"name":"journal-test"}]', stderr: '' };
    sequence.push('pages');
    return { code: 0, stdout: 'https://frozen.journal-test.pages.dev', stderr: '' };
  };
  const services = {
    media: () => ({
      matches: async () => false,
      upload: async () => {
        sequence.push('media');
      },
      verify: async () => {
        sequence.push('verify-media');
      },
    }),
    verify: vi.fn(async () => {
      sequence.push('verify-pages');
    }),
  };
  const jobs = new JobService(
    store,
    runner,
    (s, options) => buildSite(s, { ...options, assets }),
    services,
  );
  await jobs.initialize();
  const job = await jobs.waitFor(jobs.start('publish').id);
  expect(job.state).toBe('succeeded');
  expect(job.mediaDelivery).toBe('r2');
  expect(sequence.indexOf('pages')).toBeGreaterThan(sequence.lastIndexOf('verify-media'));
  expect(sequence.at(-1)).toBe('verify-pages');
  expect(services.verify).toHaveBeenCalledWith(
    job.deployment,
    job.build,
    undefined,
    expect.objectContaining({ canonicalUrl: 'https://journal.example/' }),
  );
  const failed = new JobService(
    store,
    runner,
    (s, options) => buildSite(s, { ...options, assets }),
    {
      media: () => ({
        matches: async () => true,
        upload: async () => {
          throw new Error('unexpected');
        },
        verify: async () => {
          throw new Error('bad image');
        },
      }),
      verify: services.verify,
    },
  );
  await failed.initialize();
  sequence.length = 0;
  const rejected = await failed.waitFor(failed.start('publish').id);
  expect(rejected.state).toBe('failed');
  expect(rejected.failedAt).toBe('verifying-media');
  expect(
    JSON.parse(await fs.readFile(path.join(root, '.studio/jobs', `${rejected.id}.json`), 'utf8'))
      .failedAt,
  ).toBe('verifying-media');
  expect(sequence).not.toContain('pages');
  const uploaded = new JobService(
    store,
    runner,
    (s, options) => buildSite(s, { ...options, assets }),
    {
      ...services,
      verify: async () => {
        throw new Error('Live verification failed');
      },
    },
  );
  await uploaded.initialize();
  const uncertain = await uploaded.waitFor(uploaded.start('publish').id);
  expect(uncertain.state).toBe('failed');
  expect(uncertain.failedAt).toBe('verifying-deployment');
  expect(uncertain.deployment?.url).toContain('pages.dev');
}, 30000);
it('preserves the interrupted phase when reconciling an unfinished job journal', async () => {
  const folder = path.join(root, '.studio/jobs');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, 'interrupted.json'),
    JSON.stringify({
      id: 'interrupted',
      action: 'publish',
      state: 'verifying-media',
      mediaDelivery: 'r2',
      logs: [],
      startedAt: '2026-10-19T00:00:00Z',
      mediaProgress: { total: 8, done: 3, uploaded: 8, bytes: 4096 },
    }),
  );
  const jobs = new JobService(store, async () => {
    throw new Error('Restart must not run a command.');
  });
  await jobs.initialize();
  const saved = JSON.parse(await fs.readFile(path.join(folder, 'interrupted.json'), 'utf8'));
  expect(saved).toMatchObject({
    state: 'failed',
    failedAt: 'verifying-media',
    mediaDelivery: 'r2',
    mediaProgress: { total: 8, done: 3 },
  });
  await jobs.initialize();
  expect(jobs.jobs[0].failedAt).toBe('verifying-media');
});
it('checks the actual public deployment contract and preserves actionable uncertain-upload errors', async () => {
  const build = {
    id: 'check',
    outputDir: root,
    pages: 1,
    manifest: ['index.html', '_worker.js'],
    diagnostics: [],
    sourceRevision: 'hash',
    completedAt: '',
  };
  const deployment = {
    url: 'https://test.pages.dev',
    project: 'test',
    buildId: 'check',
    completedAt: '',
  };
  const request: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/')
      return new Response('<header class="site-header"></header>', {
        headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'" },
      });
    return new Response(path.includes('annotations') ? '{}' : '<h1>Missing</h1>', {
      status: 404,
      headers: { 'Content-Type': path.includes('annotations') ? 'application/json' : 'text/html' },
    });
  };
  await verifyPublishedDeployment(deployment, build, request);
  await expect(
    verifyPublishedDeployment(deployment, build, async () => new Response('bad', { status: 500 })),
  ).rejects.toThrow(/Uploaded to .*before retrying/);
});

it('strips identifying metadata from directly added legacy raster files without rewriting canonical bytes', async () => {
  const bytes = await cameraPicture();
  await fs.writeFile(path.join(root, 'content/media/legacy-camera.jpg'), bytes);
  const entry = await store.create('posts', 'Legacy camera image', 'legacy-camera');
  await store.saveEntry(entry.id, {
    metadata: { ...entry, status: 'published' },
    body: '![A legacy image](/media/legacy-camera.jpg)',
    revision: entry.revision,
  });
  const result = await buildSite(store, { assets });
  expect(
    (
      await sharp(
        await fs.readFile(path.join(result.outputDir, 'media/legacy-camera.jpg')),
      ).metadata()
    ).exif,
  ).toBeUndefined();
  expect(await fs.readFile(path.join(root, 'content/media/legacy-camera.jpg'))).toEqual(bytes);
  const metadata = JSON.parse(
    await fs.readFile(path.join(result.outputDir, 'assets/media-details.json'), 'utf8'),
  );
  expect(metadata.images['/media/legacy-camera.jpg'].camera).toEqual({});
}, 20000);
