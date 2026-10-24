import { afterEach, beforeEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {
  entrySchema,
  siteSchema,
  type ContentEntry,
  type Repository,
} from '../src/shared/contracts.js';
import { Store } from '../src/engine/store.js';
import { createRenderer } from '../src/site/pages.js';
import { writeBranding } from '../src/engine/branding.js';
import { buildSite } from '../src/engine/build.js';
import { prepareMediaDelivery } from '../src/engine/media-delivery.js';
import { footerCopyright, socialLocale } from '../src/shared/site-presentation.js';
import { createApp } from '../src/server/app.js';

let root: string, store: Store, model: Repository, assets: string;
const entry = (id: string, date = '2026-10-19', kind: 'posts' | 'lab' = 'posts'): ContentEntry => ({
  ...entrySchema.parse({
    id,
    slug: id,
    title: `Note ${id}`,
    publishedAt: date,
    summary: `Summary for ${id}`,
    status: 'published',
    tags: ['Notes'],
  }),
  body: '## A useful heading\n\nA quiet paragraph.',
  kind,
  revision: id,
  file: id + '.md',
});
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-site-settings-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  model = await store.read();
  model.entries = [
    entry('older', '2026-10-10'),
    entry('newest'),
    entry('experiment', '2026-10-18', 'lab'),
    { ...entry('hidden'), status: 'draft' },
  ];
  model.about.body = '## Story\n\nA simple story.';
  model.site.profile.bio = 'A short bio.';
  model.library.photos = [];
  assets = path.join(root, 'asset-fixture');
  await fs.mkdir(assets);
  for (const file of ['site.js', 'site.css', 'appearance.js', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, file), '/* fixture */');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('defaults every new settings group without rewriting a legacy notebook', async () => {
  const before = await fs.readFile(path.join(root, 'content/site.json'), 'utf8');
  expect(model.site.branding).toMatchObject({
    favicon: '',
    logo: '',
    iconStyle: 'book',
    showName: true,
  });
  expect(model.site.metadata.titleTemplate).toBe('{title} — {site}');
  expect(model.site.feeds).toMatchObject({ rss: true, atom: false, json: false });
  expect(model.site.navigationTools).toEqual({
    tools: true,
    search: true,
    themeToggle: true,
    readerSettings: true,
  });
  expect(await fs.readFile(path.join(root, 'content/site.json'), 'utf8')).toBe(before);
  expect(footerCopyright(model.site, 2026)).toBe('© 2026 Writer');
  model.site.footer.since = 2020;
  model.site.footer.copyrightName = 'Notebook owner';
  expect(footerCopyright(model.site, 2026)).toBe('© 2020–2026 Notebook owner');
  expect(socialLocale(model.site, 'zh-Hans')).toBe('zh_CN');
});

it('validates image selection, template placeholders, languages, colors, tokens and limits', () => {
  for (const patch of [
    { branding: { favicon: 'https://other.test/icon.svg' } },
    { branding: { logo: '/media/executable.svg' } },
    { branding: { favicon: '/media/..%2Ficon.png' } },
    { branding: { iconBackground: 'red' } },
    { metadata: { titleTemplate: '{unknown}' } },
    { metadata: { googleVerification: '<meta name="bad">' } },
    { metadata: { twitterSite: 'https://x.com/example' } },
    { language: 'not_a_language' },
    { feeds: { limit: 201 } },
    { footer: { links: [{ label: 'Bad', href: 'javascript:alert(1)' }] } },
    { footer: { links: [{ label: 'Bad', href: '//external.example.org' }] } },
    { footer: { links: [{ label: 'Bad', href: 'relative' }] } },
    { footer: { links: [{ label: 'Bad', href: 'https://user:password@example.org' }] } },
  ])
    expect(siteSchema.safeParse({ ...model.site, ...patch }).success).toBe(false);
  const valid = siteSchema.parse({
    ...model.site,
    language: 'zh-CN',
    branding: { favicon: '/media/icon.webp' },
    metadata: { titleTemplate: '{title} | {site}', googleVerification: 'a_B-2' },
    feeds: { json: true },
    footer: { links: [{ label: 'Contact', href: 'mailto:writer@example.org' }] },
  });
  expect(valid.branding.iconBackground).toBe('#3868e8');
  expect(valid.feeds.rss).toBe(true);
});

it('renders titles, locale, fallback sharing images, author metadata and safe structured data', async () => {
  model.site.language = 'zh-CN';
  Object.assign(model.site.metadata, {
    homeTitle: 'A quiet notebook',
    titleTemplate: '{title} | {site}',
    socialImage: '/media/social.jpg',
    socialImageAlt: 'Blue mountains',
    twitterSite: 'notebook',
    googleVerification: 'google_test',
    bingVerification: 'B1A2',
  });
  model.entries[1].title = '</script><script>alert(1)</script>';
  const renderer = await createRenderer(model, { brandingVersion: 'icon-version' });
  const home = renderer.render('/');
  expect(home).toContain('<html lang="en" data-content-language="zh-CN"');
  expect(home).toContain('<title>A quiet notebook</title>');
  expect(home).toContain('property="og:locale" content="zh_CN"');
  expect(home).toContain('property="og:image" content="https://example.com/media/social.jpg"');
  expect(home).toContain('name="twitter:site" content="@notebook"');
  expect(home).toContain('name="google-site-verification" content="google_test"');
  expect(home).toContain('href="/site.webmanifest?v=icon-version"');
  const article = renderer.render('/blog/newest/');
  expect(article).toContain(' | Fieldnotes</title>');
  expect(article).not.toContain('<script>alert(1)</script>');
  const json = JSON.parse(
    article.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1],
  );
  expect(json).toMatchObject({
    '@type': 'BlogPosting',
    headline: model.entries[1].title,
    inLanguage: 'en',
    image: 'https://example.com/media/social.jpg',
  });
  expect(json.author.name).toBe('Writer');
  model.site.metadata.author = false;
  model.site.metadata.structuredData = false;
  const plain = (await createRenderer(model)).render('/blog/newest/');
  expect(plain).not.toContain('application/ld+json');
  expect(plain).not.toContain('name="author"');
});

it('honors toolbar and footer controls while retaining five public destinations and direct reader settings', async () => {
  model.site.navigationTools = { tools: false, search: false, themeToggle: false, readerSettings: false };
  Object.assign(model.site.branding, { showName: false, namePeriod: false });
  Object.assign(model.site.footer, {
    showBrand: false,
    tagline: 'Read slowly.',
    showSocialLinks: false,
    showFeeds: false,
    since: 2021,
    copyrightName: 'A writer',
    links: [
      { label: 'A project', href: 'https://project.example.org' },
      { label: 'Contact', href: '/about/' },
    ],
  });
  const renderer = await createRenderer(model);
  const html = renderer.render('/archive/');
  expect(html).not.toContain('id="search-dialog"');
  expect(html).not.toContain('data-theme-toggle');
  expect(html).not.toContain('reader-settings-link');
  expect(html).not.toContain('brand-period');
  expect(html).toContain('aria-label="Fieldnotes home"');
  expect(html).toContain('aria-label="Main navigation"');
  const nav = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)![0];
  expect((nav.match(/<a /g) || []).length).toBe(5);
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)![0];
  expect(footer).toContain('Read slowly.');
  expect(footer).toContain('© 2021–');
  expect(footer).toContain(
    'href="https://project.example.org" target="_blank" rel="noopener noreferrer"',
  );
  expect(footer).not.toContain('GitHub');
  expect(footer).not.toContain('RSS feed');
  expect(renderer.render('/settings/')).toContain('Reader settings');
});

it('opens Archive, Writing, Lab and tag pages directly with entries and accessible headings', async () => {
  const renderer = await createRenderer(model);
  for (const route of ['/archive/', '/blog/', '/lab/', '/tags/notes/']) {
    const html = renderer.render(route);
    expect(html).not.toContain('archive-heading');
    expect(html).not.toContain('<header class="page-heading">');
    expect(html).toMatch(/<h1 class="sr-only"[^>]*>/);
    expect(html).toContain('Note ');
  }
});

it('keeps the listing shell scoped to configured Posts and topic routes with accurate topic context', async () => {
  model.site.collections.posts = { name: 'Posts', singular: 'Post', path: 'post', aliases: [] };
  const renderer = await createRenderer(model);
  const posts = renderer.render('/post/');
  expect(posts).toContain('data-page="listing"');
  expect(posts).toContain('class="site-main listing-main"');
  expect(posts).toContain('2 Posts in the notebook');
  expect(posts).not.toContain('Note hidden');
  const topic = renderer.render('/tags/notes/');
  expect(topic).toContain('class="listing-topic"');
  expect(topic).toContain('href="/post/"');
  expect(topic.replace(/<[^>]*>/g, '')).toContain('All Posts');
  expect(topic).toContain('3 entries in this topic');
  expect(topic).not.toContain('data-tag-filter="Notes"');
  for (const route of ['/', '/archive/', '/lab/', '/post/older/', '/settings/'])
    expect(renderer.render(route)).not.toContain('class="site-main listing-main"');
  expect(renderer.routes).not.toContain('/tags/');
});

it('renders one clear empty state for an empty listing without a competing search-empty message', async () => {
  model.entries = [];
  const html = (await createRenderer(model)).render('/blog/');
  expect(html).toContain('The next page is yours');
  expect(html).not.toContain('data-archive-empty');
  expect(html).not.toContain('data-entry');
  expect(html).toContain('data-count-singular="Entry"');
  expect(html).toContain('data-count-plural="Writing"');
});

it('builds metadata-free icons and compact alternate logos, with reproducible manifest references', async () => {
  const file = path.join(root, 'content/media/icon.jpg');
  await sharp({ create: { width: 800, height: 400, channels: 3, background: '#c83050' } })
    .withExif({ IFD0: { Copyright: 'Private icon metadata' } })
    .jpeg()
    .toFile(file);
  Object.assign(model.site.branding, {
    favicon: '/media/icon.jpg',
    logo: '/media/icon.jpg',
    darkLogo: '/media/icon.jpg',
    shortName: 'Notes',
    iconBackground: '#123456',
    appDisplay: 'standalone',
  });
  model.site.language = 'zh-CN';
  const result = await buildSite(store, { model, assets });
  const output = result.outputDir;
  for (const [name, size] of [
    ['favicon-16x16.png', 16],
    ['favicon-32x32.png', 32],
    ['apple-touch-icon.png', 180],
    ['app-icon-192.png', 192],
    ['app-icon-512.png', 512],
    ['app-icon-maskable.png', 512],
  ] as const) {
    const image = await sharp(path.join(output, name)).metadata();
    expect([image.width, image.height]).toEqual([size, size]);
    expect(image.exif).toBeUndefined();
  }
  const logo = await sharp(path.join(output, 'assets/brand-logo.png')).metadata();
  expect([logo.width, logo.height]).toEqual([128, 64]);
  expect(logo.exif).toBeUndefined();
  expect(result.manifest).not.toContain('media/icon.jpg');
  const icon = await fs.readFile(path.join(output, 'favicon.ico'));
  expect([icon.readUInt16LE(2), icon.readUInt16LE(4)]).toEqual([1, 3]);
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'site.webmanifest'), 'utf8'));
  expect(manifest).toMatchObject({
    name: 'Fieldnotes',
    short_name: 'Notes',
    lang: 'zh-CN',
    display: 'standalone',
    start_url: '/',
    scope: '/',
  });
  expect(manifest.icons.at(-1)).toMatchObject({ purpose: 'maskable', sizes: '512x512' });
  const before = manifest.icons[0].src;
  await sharp({ create: { width: 800, height: 400, channels: 3, background: '#2358b0' } })
    .jpeg()
    .toFile(file);
  const version = await writeBranding(root, output, model.site);
  expect(`/app-icon-192.png?v=${version}`).not.toBe(before);
});

it('copies sharing-only media, filters all feed formats, and rewrites R2 image metadata without changing source', async () => {
  await sharp({ create: { width: 600, height: 300, channels: 3, background: '#456789' } })
    .jpeg()
    .toFile(path.join(root, 'content/media/social.jpg'));
  model.site.metadata.socialImage = '/media/social.jpg';
  model.entries[1].cover = '/media/social.jpg';
  model.entries[1].summary = 'https://example.com/media/social.jpg';
  Object.assign(model.site.feeds, {
    atom: true,
    json: true,
    lab: false,
    limit: 1,
    title: 'Notes & observations',
    author: false,
  });
  const source = await fs.readFile(path.join(root, 'content/site.json'), 'utf8');
  const result = await buildSite(store, { model, assets });
  expect(result.manifest).toContain('media/social.jpg');
  const feed = JSON.parse(await fs.readFile(path.join(result.outputDir, 'feed.json'), 'utf8'));
  expect(feed.items.map((item: { id: string }) => item.id)).toEqual([
    'https://example.com/blog/newest/',
  ]);
  expect(feed.authors).toBeUndefined();
  for (const file of ['feed.xml', 'atom.xml']) {
    const text = await fs.readFile(path.join(result.outputDir, file), 'utf8');
    expect(text).toContain('Notes &amp; observations');
    expect(text).toContain('Note newest');
    expect(text).not.toContain('Note hidden');
    expect(text).not.toContain('Note experiment');
    expect(text).not.toContain('Note older');
  }
  expect(await fs.readFile(path.join(result.outputDir, 'atom.xml'), 'utf8')).toContain(
    '<author><name>Fieldnotes</name>',
  );
  Object.assign(model.site.mediaDelivery, {
    mode: 'r2',
    bucket: 'test-bucket',
    publicOrigin: 'https://cdn.example.org',
    prefix: 'media',
  });
  const delivery = await prepareMediaDelivery(result, model.site);
  const rewritten = JSON.parse(
    await fs.readFile(path.join(delivery.outputDir, 'feed.json'), 'utf8'),
  );
  expect(rewritten.items[0].image).toMatch(
    /^https:\/\/cdn.example.org\/media\/v2\/[a-f0-9]{64}\.jpg$/,
  );
  expect(rewritten.items[0].summary).toBe('https://example.com/media/social.jpg');
  const page = await fs.readFile(path.join(delivery.outputDir, 'blog/newest/index.html'), 'utf8');
  expect(page).toContain(`property="og:image" content="${rewritten.items[0].image}"`);
  const schema = JSON.parse(
    page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1],
  );
  expect(schema.image).toBe(rewritten.items[0].image);
  expect(schema.description).toBe('https://example.com/media/social.jpg');
  expect(page).toContain(
    'property="og:description" content="https://example.com/media/social.jpg"',
  );
  expect(await fs.readFile(path.join(root, 'content/site.json'), 'utf8')).toBe(source);
});

it('removes disabled feeds and sitemap from a replacement build while leaving noindex pages crawlable', async () => {
  const first = await buildSite(store, { model, assets });
  expect(first.manifest).toContain('feed.xml');
  Object.assign(model.site.feeds, { rss: false, atom: false, json: false });
  model.site.metadata.indexing = false;
  model.site.metadata.followLinks = false;
  const second = await buildSite(store, { model, assets });
  expect(second.manifest).not.toContain('sitemap.xml');
  expect(second.manifest).not.toContain('feed.xml');
  expect(await fs.readFile(path.join(root, 'dist/robots.txt'), 'utf8')).toBe(
    'User-agent: *\nAllow: /\n',
  );
  const page = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  expect(page).toContain('content="noindex,nofollow,max-image-preview:large"');
  expect(page).not.toContain('rel="alternate"');
  expect(page).not.toContain('RSS feed');
  await expect(fs.access(path.join(root, 'dist/feed.xml'))).rejects.toThrow();
});

it('explains a disabled feed link and preserves the last accepted build', async () => {
  await buildSite(store, { model, assets });
  const before = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  model.entries[0].body += '\n\n[Subscribe](/feed.xml)';
  model.site.feeds.rss = false;
  await expect(buildSite(store, { model, assets })).rejects.toThrow(
    'Site settings → Feeds or update the source link',
  );
  expect(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8')).toBe(before);
});

it('previews unsaved settings privately and persists all groups with conflict detection', async () => {
  const app = await createApp(root);
  try {
    const state = await (await app.app.request('http://127.0.0.1/api/bootstrap')).json();
    const headers = {
      'Content-Type': 'application/json',
      'X-Studio-Token': state.token,
      Origin: 'http://127.0.0.1',
    };
    const value = siteSchema.parse({
      ...state.site,
      language: 'ja',
      branding: { iconStyle: 'monogram', monogram: 'FN' },
      metadata: { homeTitle: 'Unsaved notebook' },
      footer: { tagline: 'Keep a little room.' },
      feeds: { atom: true },
    });
    const response = await app.app.request('http://127.0.0.1/api/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({ site: value, route: '/' }),
    });
    expect(response.status).toBe(200);
    const preview = await (
      await app.app.request('http://127.0.0.1' + (await response.json()).url)
    ).text();
    expect(preview).toContain('<title>Unsaved notebook</title>');
    expect(preview).toContain('content="noindex,nofollow"');
    expect(preview).toContain('data:image/svg+xml,');
    expect((await store.read()).site.metadata.homeTitle).toBe('');
    const saved = await app.app.request('http://127.0.0.1/api/site', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ value, revision: state.siteRevision }),
    });
    expect(saved.status).toBe(200);
    expect((await store.read()).site).toEqual({
      ...value,
      navigation: (await store.read()).site.navigation,
    });
    const stale = await app.app.request('http://127.0.0.1/api/site', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ value: state.site, revision: state.siteRevision }),
    });
    expect(stale.status).toBe(409);
  } finally {
    app.close();
  }
});
