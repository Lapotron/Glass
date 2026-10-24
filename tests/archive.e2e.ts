import { test, expect } from '@playwright/test';
import {
  archivePage,
  createArchiveIndex,
  emptyArchiveState,
  filterArchive,
  type ArchiveCatalog,
} from '../src/shared/archive.js';
import { archivePaginationHtml, archiveTimelineHtml } from '../src/shared/archive-html.js';
const catalog: ArchiveCatalog = {
  version: 1,
  labels: { posts: 'Post', lab: 'Article' },
  records: Array.from({ length: 10000 }, (_, i) => ({
    id: `archive-${i}`,
    title: `${i === 9999 ? 'Distant needle' : 'Entry'} ${String(i).padStart(5, '0')}`,
    summary:
      'A long collection remains easy to browse, with a quiet month panel and a stable thumbnail.',
    publishedAt: `${2026 - Math.floor(i / 1000)}-10-20`,
    kind: i % 2 ? 'posts' : 'lab',
    lang: 'en',
    tags: [`topic-${i % 60}`],
    facts: { published: true, updatedAt: '2026-10-22', words: 1234, minutes: 6 },
    url: `/blog/archive-${i}/`,
    cover: i % 3 ? '/media/coast-dawn.svg' : undefined,
  })),
};

test('large archive loads its full catalog only on intent and keeps filtering and pagination bounded', async ({
  page,
  context,
}) => {
  let fetches = 0;
  await context.route('**/assets/archive/catalog-*.json', (route) => {
    fetches++;
    return route.fulfill({ json: catalog });
  });
  await page.goto('/archive/');
  await expect(page.locator('[data-timeline-search]')).toBeVisible();
  await page.waitForTimeout(250);
  expect(fetches).toBe(0);
  await page.locator('[data-timeline-search]').fill('Distant needle');
  await expect(page.locator('[data-timeline-entry]')).toHaveCount(1);
  await expect(page.locator('[data-timeline-entry]')).toContainText('09999');
  await expect(page.locator('[data-timeline-fact="words"]')).toHaveText('1,234 words');
  await expect(page.locator('[data-timeline-fact="reading"]')).toContainText('6 min read');
  await expect(page.locator('[data-timeline-fact="updated"] time')).toHaveAttribute(
    'datetime',
    '2026-10-22',
  );

  await expect(page).toHaveURL(/q=Distant\+needle/);
  await page.locator('[data-timeline-search]').fill('');
  await expect(page.locator('[data-timeline-entry]')).toHaveCount(24);
  await expect(page.locator('[data-timeline-count]')).toHaveText('10000 published entries');
  await page.locator('[data-year-link="2025"]').click();
  await expect(page).toHaveURL(/\/archive\/page\/42\/#archive-year-2025$/);
  await expect(page.locator('[data-year-link="2025"]')).toHaveAttribute('aria-current', 'location');
  await page.locator('[data-year-link="2026"]').click();
  await expect(page).toHaveURL(/\/archive\/#archive-year-2026$/);

  await page
    .getByRole('navigation', { name: 'Archive pages' })
    .getByRole('link', { name: 'Next', exact: true })
    .click();
  await expect(page).toHaveURL(/\/archive\/page\/2\/$/);
  await expect(page.locator('.archive-page-range')).toHaveText('25–48 of 10000');
  await expect(page.locator('.timeline-continuation')).toHaveText('Continued');
  await page.locator('.archive-topic-picker > summary').click();
  await expect(page.locator('[data-topic-options] [data-timeline-tag]')).toHaveCount(21);
  await page.getByRole('searchbox', { name: 'Search topics', exact: true }).fill('topic-59');
  await expect(page.locator('[data-topic-options] [data-timeline-tag]')).toHaveCount(2);
  await page.locator('[data-timeline-tag="topic-59"]').click();
  await expect(page).toHaveURL(/\/archive\/\?tag=topic-59$/);
  await expect(page.locator('[data-timeline-count]')).toHaveText('166 published entries');
  await page.reload();
  await expect(page.locator('[data-timeline-entry]')).toHaveCount(24);
  await expect(page.locator('[data-topic-label]')).toHaveText('topic-59');
  await page.locator('[data-timeline-search]').fill('no matches');
  await page.locator('[data-timeline-search]').fill('Entry 00059');
  await expect(page.locator('[data-timeline-entry]')).toHaveCount(1);
  await expect(page.locator('[data-timeline-entry]')).toContainText('Entry 00059');
  await page.goBack();
  await expect(page.locator('[data-timeline-search]')).toHaveValue('');
  await expect(page.locator('[data-timeline-entry]')).toHaveCount(24);
  expect(fetches).toBe(2); // One index per document, reused across filters and page changes.
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    history.pushState(null, '', '/archive/page/100/?q=Entry');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('.archive-page-link[aria-current]')).toHaveText('100');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
});

test('archive fallback retains the static page on catalog failure and supports explicit retry', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, 'Worker', { value: undefined });
  });
  let failing = true;
  await context.route('**/assets/archive/catalog-*.json', (route) =>
    failing
      ? route.fulfill({ status: 503, body: 'Unavailable' })
      : route.fulfill({ json: catalog }),
  );
  await page.goto('/archive/');
  await expect(page.locator('[data-timeline-browser]')).toHaveAttribute(
    'data-archive-ready',
    'true',
  );
  const original = await page.locator('[data-timeline-entry]').count();
  await page.locator('[data-timeline-search]').fill('Distant needle');
  await expect(page.locator('[data-archive-status]')).toContainText('Could not filter');
  await expect(page.locator('[data-timeline-entry]')).toHaveCount(original);
  await expect(page.locator('.timeline-entry').first()).toHaveAttribute('href', /^\//);
  failing = false;
  await page.locator('[data-archive-retry]').click();
  await expect(page.locator('[data-timeline-entry]')).toHaveCount(1);
  await expect(page.locator('[data-archive-status]')).toBeEmpty();
  await expect(page.locator('[data-archive-retry]')).toBeHidden();
});

test('native archive pagination and year destinations work without JavaScript', async ({
  browser,
  request,
}) => {
  const response = await request.get('/archive/'),
    template = await response.text();
  const start = template.indexOf('<div class="archive-page"'),
    end = template.indexOf('</main>', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const selection = filterArchive(
    createArchiveIndex(
      catalog.records
        .slice(0, 49)
        .map((e, i) => ({ ...e, publishedAt: i < 25 ? '2026-10-20' : '2025-09-01' })),
    ),
    emptyArchiveState(),
  );
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route(/\/archive\/(?:page\/\d+\/)?(?:\?.*)?$/, (route) => {
    const number = Number(new URL(route.request().url()).pathname.match(/page\/(\d+)/)?.[1] || 1),
      model = archivePage(selection, number);
    return route.fulfill({
      contentType: 'text/html',
      body:
        template.slice(0, start) +
        `<div class="archive-page">${archiveTimelineHtml(model, catalog.labels, emptyArchiveState())}${archivePaginationHtml(model, emptyArchiveState())}</div>` +
        template.slice(end),
    });
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4387/archive/');
  await expect(page.locator('[data-timeline-entry]')).toHaveCount(24);
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/\/archive\/page\/2\/$/);
  await expect(page.locator('[data-timeline-entry]')).toHaveCount(24);
  await expect(page.locator('.timeline-continuation')).toBeVisible();
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(page.locator('[data-timeline-entry]')).toHaveCount(1);
  await page.locator('[data-year-link="2026"]').click();
  await expect(page).toHaveURL(/\/archive\/#archive-year-2026$/);
  await context.close();
});

test('archive glass retains optical controls, solid fallback and a compact phone layout', async ({
  page,
  browserName,
}) => {
  await page.goto('/archive/');
  const toolbar = page.locator('.timeline-controls');
  await expect(toolbar).toHaveAttribute('data-liquid', 'optic');
  await expect(page.locator('.timeline-month-marker').first()).toHaveCSS('width', '36px');
  await expect(page.locator('.timeline-month-marker').first()).toHaveAttribute(
    'data-liquid',
    'optic',
  );
  await expect(page.locator('.timeline-month-panel').first()).toHaveAttribute(
    'data-liquid',
    'surface',
  );
  const optics = await toolbar.evaluate(
    (node) => getComputedStyle(node, '::before').backdropFilter,
  );
  if (browserName === 'chromium') {
    await expect
      .poll(() => toolbar.evaluate((node) => getComputedStyle(node, '::before').backdropFilter))
      .toContain('url(');
    const background = await page.addStyleTag({
      content:
        '.archive-page { background-image: repeating-linear-gradient(90deg, rgb(180 60 90 / .6) 0 2px, transparent 2px 12px); }',
    });
    await page.mouse.move(0, 0);
    const before = await toolbar.screenshot({ animations: 'disabled' });
    const previous = await toolbar.evaluate((node) => {
      const previous = node.style.getPropertyValue('--liquid-refraction');
      const filter = getComputedStyle(node, '::before').backdropFilter;
      node.style.setProperty('--liquid-refraction', filter.replace(/url\([^)]*\)\s*/g, ''));
      return previous;
    });
    const after = await toolbar.screenshot({ animations: 'disabled' });
    expect(before.equals(after)).toBe(false);
    await test.info().attach('archive-refraction', { body: before, contentType: 'image/png' });
    await test.info().attach('archive-blur-only', { body: after, contentType: 'image/png' });
    await toolbar.evaluate(
      (node, value) => node.style.setProperty('--liquid-refraction', value),
      previous,
    );
    await background.evaluate((node) => (node as HTMLStyleElement).remove());
  } else expect(optics).toContain('blur(');
  await page.evaluate(() => (document.documentElement.dataset.reduceTransparency = 'true'));
  await expect(toolbar).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('.timeline-month-panel').first()).toHaveCSS('backdrop-filter', 'none');
  await page.evaluate(() => delete document.documentElement.dataset.reduceTransparency);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await expect(toolbar).toBeVisible();
  await expect.poll(async () => (await toolbar.boundingBox())!.height).toBeLessThan(120);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 740 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
  await page.locator('.archive-topic-picker > summary').click();
  await expect(page.locator('.archive-topic-popover')).toHaveAttribute('data-liquid', 'surface');
  await expect
    .poll(() =>
      page
        .locator('.archive-topic-popover')
        .evaluate((node) => getComputedStyle(node).backdropFilter),
    )
    .not.toBe('none');
  await expect(page.getByRole('searchbox', { name: 'Search topics', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.archive-topic-picker > summary')).toBeFocused();
});

test('archive controls, counts and month names follow both Chinese interfaces', async ({
  page,
}) => {
  for (const [locale, count, topic] of [
    ['zh-Hans', '篇已发布文章', '搜索主题'],
    ['zh-Hant', '篇已發佈文章', '搜尋主題'],
  ]) {
    await page.goto('/settings/');
    await page.locator('select[data-ui-language]').selectOption(locale);
    await page.goto('/archive/');
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('[data-timeline-count]')).toContainText(count);
    await expect(page.locator('.timeline-month-heading').first()).toContainText('月');
    await page.locator('[data-timeline-search]').fill('shape');
    await expect(page.locator('[data-timeline-entry]')).toHaveCount(1);
    await expect(page.locator('[data-timeline-count]')).toContainText('1 ' + count);
    await page.locator('.archive-topic-picker > summary').click();
    await expect(page.getByRole('searchbox', { name: topic, exact: true })).toBeVisible();
  }
});
