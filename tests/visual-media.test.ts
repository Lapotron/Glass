import { beforeEach, afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { Store, digest } from '../src/engine/store.js';
import { MediaService, inspectImage } from '../src/engine/media.js';
import { BackupService } from '../src/engine/backup.js';
import { renderMarkdown } from '../src/engine/markdown.js';
import { markdownSnippets } from '../src/shared/markdown-snippets.js';
import { resolveSlides } from '../src/shared/home.js';
import { homeSlideSchema, publicNavigation } from '../src/shared/contracts.js';
import { createRenderer } from '../src/site/pages.js';
import { buildSite } from '../src/engine/build.js';
let root: string, store: Store;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'blog-visual-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  await fs.rm(path.join(root, 'content/about.md'), { force: true });
  store = new Store(root);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const picture = async () =>
  sharp({
    create: {
      width: 800,
      height: 400,
      channels: 4,
      background: { r: 20, g: 90, b: 140, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
it('renders visual chapters, fixed navigation, and an About route without old home grids', async () => {
  const model = await store.read(),
    renderer = await createRenderer(model);
  const html = renderer.render('/');
  expect(html).toContain('visual-chapters');
  expect(html).not.toContain('home-hero');
  expect(renderer.routes).toContain('/about/');
  const nav = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)![0];
  expect([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(
    publicNavigation.map((n) => n.href),
  );
  expect(renderer.render('/about/')).toContain(model.site.profile.name);
  const entry = model.entries.find((e) => e.status === 'published')!;
  expect(
    renderer.render(
      `/${entry.kind === 'posts' ? 'blog' : 'lab'}/${encodeURIComponent(entry.slug)}/`,
    ),
  ).toMatch(/href="\/archive\/" aria-current="page"/);
});
it('curates stable references, omits drafts, and saves the canonical four links', async () => {
  const model = await store.read();
  const published = model.entries.find((e) => e.status === 'published')!;
  const draft = model.entries.find((e) => e.status === 'draft')!;
  model.site.home.slides = [
    homeSlideSchema.parse({ id: 'visible', source: 'entry', reference: published.id }),
    homeSlideSchema.parse({ id: 'private', source: 'entry', reference: draft.id }),
  ];
  expect(resolveSlides(model).map((s) => s.id)).toEqual(['visible']);
  const saved = await store.saveJson('site', model.site, model.siteRevision);
  expect((saved.value as typeof model.site).navigation).toEqual(publicNavigation);
});
it('keeps About conflict-safe, supports empty documents, and records restorable Markdown', async () => {
  const first = (await store.read()).about;
  const next = await store.saveAbout('# About\n\nA real paragraph.', first.revision);
  await expect(store.saveAbout('stale', first.revision)).rejects.toThrow(/changed/);
  const records = await store.aboutRevisions();
  expect(records[0].body).toBe(first.body);
  const empty = await store.saveAbout('', next.revision);
  expect((await store.read()).about.body).toBe('');
  await store.saveAbout(records[0].body, empty.revision, 'restore');
  expect((await store.read()).about.body).toBe(first.body);
});
it('compiles the full Markdown pack, preserves nested media and math, and validates discussion IDs', async () => {
  for (const snippet of markdownSnippets) {
    const result = await renderMarkdown(snippet.value.replace('SECTION_KEY', 'stable-section'), {
      entryId: 'post-1',
      comments: true,
    });
    expect(result.html).not.toContain('containerDirective');
  }
  const rich = await renderMarkdown(
    '::::discussion[Conversation]{#stable-key comments="true"}\n## Nested heading\n\n:::figure[Caption]\n![Alt](/media/coast-dawn.svg)\n:::\n::::',
    { entryId: 'post-1', comments: true },
  );
  expect(rich.html).toContain('data-section-thread="stable-key"');
  expect(rich.media).toContain('/media/coast-dawn.svg');
  expect(rich.headings.map((h) => h.text)).toContain('Nested heading');
  await expect(
    renderMarkdown(':::discussion[A]{#same}\nText\n:::\n\n:::discussion[B]{#same}\nText\n:::'),
  ).rejects.toThrow(/duplicate/);
  await expect(renderMarkdown(':::discussion[No key]{comments="true"}\nText\n:::')).rejects.toThrow(
    /stable/,
  );
  await expect(renderMarkdown(':::unknown\nText\n:::')).rejects.toThrow(/Unknown/);
  const safe = await renderMarkdown(':mark[Hello]{onclick="evil()"}\n\n<script>alert(1)</script>');
  expect(safe.html).not.toMatch(/onclick|<script/);
  const link = await renderMarkdown(
    '::link-card[Archive]{href="/archive/" description="Read more"}',
  );
  expect(link.html).toContain('class="md-link-card"');
});
it('stores the original privately and creates bounded, transparent crop/resize variants', async () => {
  const media = new MediaService(store),
    bytes = await picture();
  const file = new File([new Uint8Array(bytes)], 'transparent.png', { type: 'image/png' });
  const upload = await media.upload(file, {
    crop: { x: 100, y: 50, width: 400, height: 200 },
    resize: { width: 200, height: 100 },
  });
  expect(upload.width).toBe(200);
  expect(upload.height).toBe(100);
  expect((await media.source(upload.sourceId!)).bytes).toEqual(bytes);
  const meta = await sharp(
    await fs.readFile(path.join(root, 'content/media', upload.name)),
  ).metadata();
  expect(meta.hasAlpha).toBe(true);
  const variant = await media.variant(upload.sourceId!, {
    crop: { x: 0, y: 0, width: 300, height: 300 },
    resize: { width: 150, height: 150 },
  });
  expect(variant.name).not.toBe(upload.name);
  expect(variant.width).toBe(150);
  expect(variant.height).toBe(150);
  await expect(
    media.variant(upload.sourceId!, { crop: { x: 700, y: 0, width: 500, height: 400 } }),
  ).rejects.toThrow(/within/);
  expect((await media.list()).find((f) => f.name === upload.name)?.canEdit).toBe(true);
  await media.validate();
});
it('uses EXIF-oriented crop coordinates and preserves animation when resizing', async () => {
  const raw = await picture(),
    oriented = await sharp(raw).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const metadata = await inspectImage(oriented);
  expect([metadata.width, metadata.height]).toEqual([400, 800]);
  const media = new MediaService(store);
  const saved = await media.upload(
    new File([new Uint8Array(oriented)], 'rotated.jpg', { type: 'image/jpeg' }),
    { crop: { x: 0, y: 400, width: 400, height: 400 }, resize: { width: 100, height: 100 } },
  );
  expect([saved.width, saved.height]).toEqual([100, 100]);
  const frame1 = await sharp({ create: { width: 20, height: 20, channels: 4, background: 'red' } })
      .png()
      .toBuffer(),
    frame2 = await sharp({ create: { width: 20, height: 20, channels: 4, background: 'blue' } })
      .png()
      .toBuffer();
  const animated = await sharp([frame1, frame2], { join: { animated: true } })
    .gif({ delay: [100, 100] })
    .toBuffer();
  const anim = await media.upload(
    new File([new Uint8Array(animated)], 'motion.gif', { type: 'image/gif' }),
    { resize: { width: 10, height: 10 } },
  );
  const out = await sharp(await fs.readFile(path.join(root, 'content/media', anim.name)), {
    animated: true,
  }).metadata();
  expect(out.pages).toBe(2);
  expect(out.pageHeight).toBe(10);
  expect(anim.height).toBe(10);
  await expect(
    media.variant(anim.sourceId!, { crop: { x: 0, y: 0, width: 10, height: 10 } }),
  ).rejects.toThrow(/Animated/);
});
it('round-trips About, page history, private originals and recipes in v2 backups, and accepts v1', async () => {
  const initial = (await store.read()).about;
  await store.saveAbout('# My About', initial.revision);
  const media = new MediaService(store);
  const bytes = await picture();
  const image = await media.upload(
    new File([new Uint8Array(bytes)], 'sample.png', { type: 'image/png' }),
  );
  const backups = new BackupService(store);
  const saved = await backups.create();
  const archive = await backups.download(saved.id);
  const envelope = JSON.parse(gunzipSync(archive).toString());
  expect(envelope.version).toBe(2);
  expect(envelope.files.some((f: { path: string }) => f.path === 'content/about.md')).toBe(true);
  expect(
    envelope.files.some((f: { path: string }) => f.path.startsWith('private/media-originals/')),
  ).toBe(true);
  await store.saveAbout('# Changed', (await store.read()).about.revision);
  const review = await backups.inspect(archive);
  await backups.restore(review.id, review.sourceRevision);
  expect((await store.read()).about.body).toBe('# My About');
  expect((await new MediaService(store).source(image.sourceId!)).bytes).toEqual(bytes);
  envelope.version = 1;
  envelope.files = envelope.files.filter(
    (f: { path: string }) =>
      !f.path.startsWith('private/') &&
      !f.path.startsWith('history/pages/') &&
      f.path !== 'content/about.md',
  );
  const old = await backups.inspect(gzipSync(JSON.stringify(envelope)));
  await backups.restore(old.id, old.sourceRevision);
  expect((await store.read()).about.body).toContain((await store.read()).site.profile.name);
  expect(await fs.readdir(path.join(root, '.studio/media-originals'))).toEqual([]);
});
it('publishes image dimensions and referenced derivatives while excluding original sources', async () => {
  const media = new MediaService(store),
    bytes = await picture();
  const image = await media.upload(
    new File([new Uint8Array(bytes)], 'private.png', { type: 'image/png' }),
  );
  let model = await store.read();
  model.site.home.slides = [
    homeSlideSchema.parse({ id: 'image', source: 'custom', image: image.url, title: 'A visual' }),
  ];
  await store.saveJson('site', model.site, model.siteRevision);
  const assets = path.join(root, 'fixture');
  await fs.mkdir(assets);
  for (const name of ['site.js', 'site.css', 'appearance.js', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, name), '');
  const build = await buildSite(store, { assets });
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  expect(html).toContain('width="800" height="400"');
  expect(build.manifest).toContain(`media/${image.name}`);
  expect(build.manifest.some((n) => /original|record\.json|\.studio|about\.md/.test(n))).toBe(
    false,
  );
  model = await store.read();
  expect(model.about.revision).toBe(digest(''));
});
