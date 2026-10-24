import { test, expect, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Store, parseEntry } from '../src/engine/store.js';
import {
  entrySchema,
  siteSchema,
  type ContentEntry,
  type Repository,
} from '../src/shared/contracts.js';
import { createRenderer, type SiteRenderer } from '../src/site/pages.js';
import type { ReaderAssets } from '../src/shared/reader-assets.js';

let model: Repository,
  assets: ReaderAssets,
  renderer: SiteRenderer,
  empty: SiteRenderer,
  single: SiteRenderer,
  guide: SiteRenderer;
const longTopic = 'Topic'.padEnd(40, 'x');
const item = (
  id: string,
  changes: Record<string, unknown> = {},
  kind: 'posts' | 'lab' = 'posts',
): ContentEntry => ({
  ...entrySchema.parse({
    id,
    slug: id,
    title: `A note about ${id}`,
    publishedAt: '2026-10-21',
    status: 'published',
    summary: 'A short observation, with room for an example.',
    tags: ['Layout', 'Writing'],
    ...changes,
  }),
  kind,
  body: '## An observation\n\nA simple paragraph.',
  revision: id,
  file: id + '.md',
});
test.beforeAll(async ({ request }) => {
  // Read the isolated server's fixture and serve real renderer output; never modify the author notebook.
  const runtime = await (await request.get('/api/runtime-settings')).json();
  const root = runtime.active.notebookRoot;
  expect(path.basename(root)).toMatch(/^fieldnotes-browser-/);
  model = await new Store(root).read();
  assets = JSON.parse(await fs.readFile(path.join(root, 'dist/assets/reader-assets.json'), 'utf8'));
  model.site = siteSchema.parse({
    ...model.site,
    collections: {
      ...model.site.collections,
      posts: { name: 'Posts', singular: 'Post', path: 'post' },
      lab: { name: 'Articles', singular: 'Article', path: 'article' },
    },
    theme: {
      ...model.site.theme,
      appearance: 'light',
      contentWidth: 1200,
      fontScale: 1,
      backgroundImage: '',
    },
    integrations: {
      ...model.site.integrations,
      newsletter: { ...model.site.integrations.newsletter, enabled: false },
      comments: { ...model.site.integrations.comments, enabled: false },
    },
  });
  model.entries = [
    item('observing', { cover: '/media/coast-dawn.svg' }),
    item('thinking', {
      title:
        'A longer title about leaving enough room for words to wrap naturally across a smaller reading surface',
      tags: ['Layout', longTopic],
    }),
    item('making', { cover: '/media/coast-dusk.svg', tags: ['Layout', 'Making'] }),
    item('experiment', { tags: ['Layout'] }, 'lab'),
    item('hidden-draft', { status: 'draft' }),
  ];
  model.about.body = '';
  renderer = await createRenderer(model, { readerAssets: assets });
  empty = await createRenderer({ ...model, entries: [] }, { readerAssets: assets });
  single = await createRenderer(
    { ...model, entries: [model.entries[0]] },
    { readerAssets: assets },
  );
  const article = parseEntry(
    await fs.readFile('tests/fixtures/markdown-basics.md', 'utf8'),
    'posts',
    'markdown-basics.md',
  );
  expect(article.status).toBe('draft');
  guide = await createRenderer(
    { ...model, entries: [article] },
    { readerAssets: assets, includeDrafts: true },
  );
});
async function wire(page: Page, source: SiteRenderer = renderer) {
  for (const route of ['/post/', '/tags/layout/'])
    await page.route('http://127.0.0.1:4387' + route, (routeRequest) =>
      routeRequest.fulfill({ contentType: 'text/html', body: source.render(route) }),
    );
}
async function settle(page: Page) {
  await expect
    .poll(() => page.locator('html').evaluate((node) => getComputedStyle(node, '::before').opacity))
    .toBe('0');
}
async function geometry(page: Page, minimumGap: number) {
  const result = await page.evaluate(() => {
    const header = document.querySelector('.site-header')!.getBoundingClientRect();
    const main = document.querySelector('.site-main')!.getBoundingClientRect();
    const first = document
      .querySelector('.listing-context,.archive-tools')!
      .getBoundingClientRect();
    const footer = document.querySelector('.site-footer')!.getBoundingClientRect();
    return {
      gap: first.top - header.bottom,
      mainLeft: main.left,
      footerLeft: footer.left,
      mainWidth: main.width,
      footerWidth: footer.width,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  expect(result.gap).toBeGreaterThanOrEqual(minimumGap - 1);
  expect(Math.abs(result.mainLeft - result.footerLeft)).toBeLessThan(1);
  expect(Math.abs(result.mainWidth - result.footerWidth)).toBeLessThan(1);
  expect(result.overflow).toBeLessThanOrEqual(1);
}
test('post and topic indexes keep a balanced responsive main layout and readable cards', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await wire(page);
  for (const route of ['/post/', '/tags/layout/']) {
    for (const width of [1440, 834, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await settle(page);
      await geometry(page, width <= 680 ? 32 : 48);
      await expect(page.getByRole('heading', { level: 1 })).toHaveClass('sr-only');
      await expect(page.locator('.site-nav a[aria-current="page"]')).toHaveText('Archive');
      const tracks = await page
        .locator('.archive-grid')
        .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
      expect(tracks).toBe(width > 1000 ? 3 : width > 680 ? 2 : 1);
      const cover = await page.locator('.post-cover').first().boundingBox();
      expect(Math.abs(cover!.width / cover!.height - 16 / 9)).toBeLessThan(0.01);
      if (width === 1440) {
        const bottoms = await page
          .locator('.post-card-bottom')
          .evaluateAll((nodes) =>
            nodes.slice(0, 3).map((node) => node.getBoundingClientRect().bottom),
          );
        expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1);
      }
      const search = await page.locator('.archive-search').boundingBox();
      const topics = await page.locator('.archive-tags').boundingBox();
      if (width <= 680) expect(search!.y + search!.height).toBeLessThan(topics!.y);
      await page.screenshot({
        path: test.info().outputPath(`${route.includes('tags') ? 'topic' : 'posts'}-${width}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.evaluate(() =>
    localStorage.setItem(
      'fieldnotes-reader-v1',
      JSON.stringify({
        version: 1,
        theme: { contentWidth: 1600, fontScale: 1.15, appearance: 'dark', background: 'mist' },
      }),
    ),
  );
  await page.goto('/post/');
  await settle(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await page.locator('.site-main').boundingBox())!.width).toBe(1600);
  await geometry(page, 48);
  const card = page.locator('.post-feature').first(),
    image = card.locator('.post-cover');
  const relative = async () => {
    const a = await card.boundingBox(),
      b = await image.boundingBox();
    return { top: b!.y - a!.y, height: b!.height };
  };
  const before = await relative();
  await card.hover();
  expect(Math.abs((await relative()).top - before.top)).toBeLessThan(1);
  expect(Math.abs((await relative()).height - before.height)).toBeLessThan(1);
  await page.screenshot({ path: test.info().outputPath('posts-dark-wide.png') });
  expect(errors).toEqual([]);
});
test('listing filters preserve naming and topic scope, and short or empty pages keep one clear state', async ({
  page,
}) => {
  await wire(page);
  await page.goto('/post/');
  const search = page.getByRole('searchbox', { name: 'Filter Posts', exact: true });
  await search.fill('longer title');
  await expect(page.locator('[data-entry]:visible')).toHaveCount(1);
  await expect(page.locator('[data-archive-count]')).toHaveText('1 Post in the notebook');
  await search.fill('not-a-matching-note');
  await expect(page.locator('[data-archive-empty]')).toBeVisible();
  await expect(page.locator('.empty-state')).toHaveCount(0);
  await search.fill('');
  const making = page
    .getByRole('group', { name: 'Filter by topic' })
    .getByRole('button', { name: 'Making', exact: true });
  await making.focus();
  await page.keyboard.press('Enter');
  await expect(making).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-entry]:visible')).toHaveCount(1);
  await page.goto('/tags/layout/');
  await expect(page.locator('.listing-topic')).toHaveText('Layout');
  await expect(page.locator('[data-entry]')).toHaveCount(4);
  await expect(page.locator('[data-archive-count]')).toHaveText('4 entries in this topic');
  await page.getByRole('link', { name: 'All Posts', exact: true }).click();
  await expect(page).toHaveURL(/\/post\/$/);
  await expect(page.locator('[data-entry]')).toHaveCount(3);
  for (const source of [single, empty]) {
    await page.unroute('http://127.0.0.1:4387/post/');
    await wire(page, source);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/post/');
    await settle(page);
    await geometry(page, 32);
    const footer = await page.locator('.site-footer').boundingBox();
    expect(footer!.y + footer!.height).toBeGreaterThanOrEqual(875);
    if (source === empty) {
      await expect(page.locator('.empty-state')).toHaveCount(1);
      await page.getByRole('searchbox').fill('anything');
      await expect(page.locator('[data-archive-empty]')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath('posts-empty-phone.png') });
    }
  }
});
test('listing contents remain readable without JavaScript and respect reduced materials and motion', async ({
  browser,
  page,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 900 },
  });
  const fallback = await context.newPage();
  await wire(fallback);
  await fallback.goto('/post/');
  await expect(fallback.locator('[data-entry]:visible')).toHaveCount(3);
  await geometry(fallback, 32);
  await context.close();
  await wire(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() =>
    localStorage.setItem(
      'fieldnotes-reader-v1',
      JSON.stringify({ version: 1, theme: { reduceTransparency: true, reduceMotion: true } }),
    ),
  );
  await page.goto('/post/');
  const card = page.locator('.post-feature').first();
  await card.hover();
  await expect(card).toHaveCSS('transform', 'none');
  await expect(page.locator('html')).toHaveAttribute('data-reduce-transparency', 'true');
  await expect(card).toHaveCSS('backdrop-filter', 'none');
});
test('basic Markdown examples have usable tabs, disclosures, quiz and compact illustration', async ({
  page,
  browser,
}) => {
  const articleRoute = 'http://127.0.0.1:4387/post/markdown-reading-sample/';
  const articleHtml = guide.render('/post/markdown-reading-sample/');
  await page.route(articleRoute, (route) =>
    route.fulfill({ contentType: 'text/html', body: articleHtml }),
  );
  await page.goto(articleRoute);
  await expect(
    page.getByRole('heading', { name: 'Markdown reading sample', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.article-body > .reading-surface')).toHaveCount(0);
  expect(await page.locator('[role="math"] svg').count()).toBeGreaterThanOrEqual(3);
  const illustration = page.getByAltText('An illustrated blue wave', { exact: true });
  await illustration.scrollIntoViewIfNeeded();
  await expect
    .poll(() => illustration.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect((await illustration.boundingBox())!.width).toBeLessThanOrEqual(480);
  expect((await illustration.boundingBox())!.height).toBeLessThanOrEqual(320);
  const detail = page
    .locator('.article-body details')
    .filter({ has: page.getByText('Why use a disclosure?', { exact: true }) });
  await detail.locator('summary').click();
  await expect(detail).toHaveAttribute('open', '');
  await page.getByRole('tab', { name: 'The checklist', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'The checklist' })).toContainText(
    'Read it aloud.',
  );
  const quiz = page.locator('[data-interactive="quiz"]');
  await quiz.hover();
  await quiz.locator('input[type="radio"]').first().check();
  await quiz.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(quiz.locator('.quiz-feedback')).toHaveAttribute('data-state', 'correct');
  for (const dark of [false, true]) {
    await page.evaluate(
      (dark) =>
        localStorage.setItem(
          'fieldnotes-reader-v1',
          JSON.stringify({ version: 1, theme: { appearance: dark ? 'dark' : 'light' } }),
        ),
      dark,
    );
    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload();
    await settle(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.locator('.md-tabs').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath(`markdown-guide-phone-${dark ? 'dark' : 'light'}.png`),
    });
  }
  const context = await browser.newContext({ javaScriptEnabled: false });
  const fallback = await context.newPage();
  await fallback.route(articleRoute, (route) =>
    route.fulfill({ contentType: 'text/html', body: articleHtml }),
  );
  await fallback.goto(articleRoute);
  await expect(fallback.locator('.md-tab:visible')).toHaveCount(2);
  await fallback.locator('.quiz-solution summary').click();
  await expect(fallback.locator('.quiz-solution')).toContainText('Two hash marks');
  await context.close();
});
