import { afterEach, beforeEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/engine/store.js';
import { createRenderer } from '../src/site/pages.js';
import { homePinLimit, homeSchema, siteSchema, type Repository } from '../src/shared/contracts.js';
import { pinnedHomeEntries, recentHomeEntries } from '../src/shared/home.js';

let root: string, model: Repository;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-homepage-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  model = await new Store(root).read();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('defaults legacy notebooks to a profile while retaining their curated chapters', () => {
  const slides = model.site.home.slides;
  model.site = siteSchema.parse({ ...model.site, home: { slides } });
  expect(model.site.home).toMatchObject({
    layout: 'profile',
    motion: 'subtle',
    pinned: [],
    slides,
    profile: { showPortrait: true, showAffiliations: false },
    recent: {
      sources: ['posts', 'lab'],
      limit: 6,
      showSummary: true,
      showDate: true,
      showCover: false,
    },
  });
  expect(siteSchema.parse({ ...model.site, home: undefined }).home.layout).toBe('profile');
  const switched = homeSchema.parse({ ...model.site.home, layout: 'chapters' });
  expect(switched.slides).toEqual(slides);
  expect(switched.recent).toEqual(model.site.home.recent);
  expect(homeSchema.safeParse({ recent: { sources: [] } }).success).toBe(false);
  expect(homeSchema.safeParse({ recent: { sources: ['posts', 'posts'] } }).success).toBe(false);
  expect(homeSchema.safeParse({ recent: { limit: 13 } }).success).toBe(false);
  for (const pinned of [
    ['same', 'same'],
    ['../entry'],
    [''],
    Array.from({ length: homePinLimit + 1 }, (_, index) => `entry-${index}`),
  ])
    expect(homeSchema.safeParse({ pinned }).success).toBe(false);
  const pins = ['post-curiosity', 'lab-light'];
  expect(homeSchema.parse({ ...switched, pinned: pins }).pinned).toEqual(pins);
});

it('keeps ordered published pins above a distinct recent feed, independent of recent source filters', async () => {
  const draft = model.entries.find((entry) => entry.status === 'draft')!;
  model.entries.push({ ...draft, id: 'scheduled-pin', status: 'scheduled', slug: 'scheduled-pin' });
  const ids = ['post-curiosity', 'lab-light', draft.id, 'scheduled-pin', 'missing-pin'];
  model.site.home = homeSchema.parse({
    pinned: ids,
    recent: { sources: ['posts'], limit: 2 },
  });
  model.site.collections.posts.path = 'post';
  model.site.collections.lab.path = 'article';
  const article = model.entries.find((entry) => entry.id === 'lab-light')!;
  article.title = 'A renamed article';
  article.slug = 'renamed-article';
  expect(pinnedHomeEntries(model).map((entry) => entry.id)).toEqual(ids.slice(0, 2));
  const recent = recentHomeEntries(model);
  expect(recent).toHaveLength(2);
  expect(recent.every((entry) => entry.kind === 'posts' && !ids.includes(entry.id))).toBe(true);
  const html = (await createRenderer(model)).render('/');
  const rows = [...html.matchAll(/class="home-entry" href="([^"]+)"/g)].map((match) => match[1]);
  expect(rows).toEqual([
    '/post/a-small-case-for-curiosity/',
    '/article/renamed-article/',
    '/post/component-showcase/',
    '/post/good-tools-get-out-of-the-way/',
  ]);
  expect(html.match(/data-home-pinned="true"/g)).toHaveLength(2);
  expect(html.match(/class="home-entry-pin"/g)).toHaveLength(2);
  expect(html).toContain('From the notebook');
  expect(html).not.toContain(draft.title);
  expect(model.site.home.pinned).toEqual(ids);
  model.site.home.layout = 'chapters';
  expect((await createRenderer(model)).render('/')).not.toContain('data-home-pinned');
  expect(model.site.home.pinned).toEqual(ids);
});

it('saves homepage pins with settings revisions without rewriting Markdown or legacy reads', async () => {
  const store = new Store(root);
  const source = await fs.readFile(path.join(root, 'content/site.json'), 'utf8');
  await store.read();
  expect(await fs.readFile(path.join(root, 'content/site.json'), 'utf8')).toBe(source);
  const originals = await Promise.all(
    model.entries.map((entry) =>
      fs.readFile(path.join(root, 'content', entry.kind, entry.file), 'utf8'),
    ),
  );
  model.site.home.pinned = ['lab-light', 'post-curiosity', 'missing-pin'];
  await store.saveJson('site', model.site, model.siteRevision);
  const saved = await new Store(root).read();
  expect(saved.site.home.pinned).toEqual(model.site.home.pinned);
  expect(saved.entries.map((entry) => entry.revision)).toEqual(
    model.entries.map((entry) => entry.revision),
  );
  expect(
    await Promise.all(
      saved.entries.map((entry) =>
        fs.readFile(path.join(root, 'content', entry.kind, entry.file), 'utf8'),
      ),
    ),
  ).toEqual(originals);
  await expect(store.saveJson('site', model.site, model.siteRevision)).rejects.toThrow(
    'Settings changed',
  );
});

it('selects a bounded, deterministic feed from publication dates and configured collections', () => {
  model.site.home = homeSchema.parse({ recent: { limit: 3 } });
  const base = model.entries[0];
  model.entries = [
    { ...base, id: 'draft', title: 'Private draft', status: 'draft', publishedAt: '2099-01-01' },
    { ...base, id: 'scheduled', status: 'scheduled', publishedAt: '2099-01-01' },
    {
      ...base,
      id: 'old',
      title: 'Older post',
      kind: 'posts',
      status: 'published',
      publishedAt: '2024-01-01',
      updatedAt: '2099-01-01',
    },
    {
      ...base,
      id: 'b',
      title: 'Same title',
      kind: 'lab',
      status: 'published',
      publishedAt: '2025-01-01',
    },
    {
      ...base,
      id: 'a',
      title: 'Same title',
      kind: 'posts',
      status: 'published',
      publishedAt: '2025-01-01',
    },
    {
      ...base,
      id: 'latest',
      title: 'Latest article',
      kind: 'lab',
      status: 'published',
      publishedAt: '2025-02-01',
    },
  ];
  expect(recentHomeEntries(model).map((entry) => entry.id)).toEqual(['latest', 'a', 'b']);
  model.site.home.recent.sources = ['posts'];
  expect(recentHomeEntries(model).map((entry) => entry.id)).toEqual(['a', 'old']);
});

it('renders a static profile, protected links and configurable reading rows with collection routes', async () => {
  model.site.home = homeSchema.parse({ recent: { showCover: true } });
  model.site.profile.email = 'reader@example.org';
  model.site.profile.links = [{ label: 'Elsewhere', href: 'https://example.org/' }];
  model.site.collections.posts.path = 'post';
  const entry = model.entries.find((item) => item.status === 'published')!;
  entry.reading = { publishedDate: false };
  entry.summary = 'The latest published writing.';
  model.entries = [entry];
  const html = (await createRenderer(model)).render('/');
  expect(html).toContain('data-home-layout="profile"');
  expect(html).toContain('class="about-profile home-profile"');
  expect(html).toContain('class="home-entry-list"');
  expect(html).toContain(`href="/post/${entry.slug}/"`);
  expect(html).toContain('class="home-entry-cover"');
  expect(html).toContain('data-email-token');
  expect(html).not.toContain('mailto:reader@example.org');
  expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  expect(html).not.toContain('visual-chapters');
  const row = html.match(/class="home-entry"[\s\S]*?<\/a>/)![0];
  expect(row).not.toContain('<time');
  expect(row).toContain(entry.summary);
  model.site.home.profile = {
    showPortrait: false,
    showRole: false,
    showLocation: false,
    showAffiliations: false,
    showLinks: false,
  };
  model.site.home.recent.showSummary = false;
  model.site.home.recent.showCover = false;
  const quiet = (await createRenderer(model)).render('/');
  const profile = quiet.match(/class="about-profile home-profile"[\s\S]*?<\/header>/)![0];
  expect(profile).toContain(model.site.profile.headline);
  expect(profile).not.toMatch(/about-portrait|about-links|about-affiliations|data-email-token/);
  expect(quiet).not.toContain('class="home-entry-cover"');
  expect(quiet.match(/class="home-entry"[\s\S]*?<\/a>/)![0]).not.toContain('<p>');
  model.entries = [];
  expect((await createRenderer(model)).render('/')).toContain('New writing will appear here.');
});

it('ships compiled specimen typography only on reader settings and accepts older asset manifests', async () => {
  model.site.theme.textScale = 1.35;
  model.site.theme.focusMode = true;
  const assets = {
    version: 1 as const,
    script: '/site.js',
    style: '/site.css',
    appearance: '/appearance.js',
    contentStyle: '/content.css',
    settingsStyle: '/settings.css',
  };
  const renderer = await createRenderer(model, { readerAssets: assets });
  const html = renderer.render('/settings/');
  expect(html).toContain('href="/settings.css"');
  expect(html).toContain('href="/content.css"');
  expect(html).toContain('data-preview-tab="materials"');
  expect(html).toContain('<mjx-container');
  expect(html).toContain('--reader-text-scale:1.35');
  expect(html).toContain('"focusMode":true');
  expect(html).toMatch(/data-reader-control="textScale"[^>]*value="1.35"/);
  expect(html).toMatch(/data-reader-control="focusMode"[^>]*checked=""/);
  expect(html).toContain('prose-table-scroll');
  expect(html).not.toMatch(/src="[^"]*(?:mathjax|mermaid)/i);
  expect(renderer.render('/')).not.toContain('href="/settings.css"');
  const legacy = await createRenderer(model, {
    readerAssets: { ...assets, settingsStyle: undefined },
  });
  expect(legacy.render('/settings/')).not.toContain('href="/settings.css"');
});
