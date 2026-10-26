import { test, expect } from '@playwright/test';

for (const site of [
  { address: 'http://127.0.0.1:4396/Glass/', canonical: 'https://owner.github.io/Glass/' },
  { address: 'http://127.0.0.1:4397/', canonical: 'https://owner.github.io/' },
  { address: 'http://127.0.0.1:4399/', canonical: 'https://blog.example.test/' },
])
  test(`static reader, search and media work at ${site.canonical}`, async ({ page, request }) => {
    const failed: string[] = [],
      api: string[] = [];
    page.on('response', (response) => {
      if (response.url().startsWith(site.address) && response.status() >= 400)
        failed.push(response.url());
    });
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.includes('/api/')) api.push(request.url());
    });
    await page.goto(site.address);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', site.canonical);
    await page.goto(site.address + 'post/github-components/');
    await expect(
      page.getByRole('heading', { name: 'GitHub Pages components', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.article-body mjx-container').first()).toBeVisible();
    await expect(page.locator('.article-body code')).toContainText(
      'href="/post/github-components/"',
    );
    await expect(page.locator('[data-annotation-endpoint],[data-annotate-line]')).toHaveCount(0);
    await expect(page.locator('.article-bottom')).toHaveAttribute(
      'data-canonical',
      site.canonical + 'post/github-components/',
    );
    await expect(page.locator('.article-discussion [data-load-comments]').first()).toBeVisible();
    const photo = page.locator('.article-body img[src*="test-photo"]').first();
    await photo.scrollIntoViewIfNeeded();
    await photo.click();
    await expect(page.locator('dialog.media-viewer')).toBeVisible();
    await expect(page.locator('dialog.media-viewer .pswp__img').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto(site.address + 'search/?q=telescope');
    await expect(page.locator('[data-search-page] .search-results')).toContainText(
      'GitHub Pages components',
      { timeout: 20000 },
    );
    const hit = page
      .locator('[data-search-page] .search-results a[href*="github-components"]')
      .first();
    await expect(hit).toHaveAttribute(
      'href',
      new URL(site.address).pathname + 'post/github-components/?highlight=telescope',
    );
    await page.goto(site.address + 'archive/');
    await page
      .getByRole('searchbox', { name: 'Filter archive', exact: true })
      .fill('Archive example');
    await expect(page).toHaveURL(/q=Archive(?:\+|%20)example/);
    await expect(page.locator('[data-timeline-count]')).toContainText('26');
    await expect(page.locator('[data-archive-status]')).toHaveText('');
    await expect(page.locator('[data-archive-results]')).toContainText('Archive example');
    const next = page.getByRole('link', { name: 'Next', exact: true });
    await next.click();
    await expect(page).toHaveURL(new RegExp('/archive/page/2/'));
    await expect(page.locator('[data-archive-results]')).toContainText('Archive example');
    await page.goto(site.address + 'settings/');
    await expect(page.locator('[data-reader-control]').first()).toBeVisible();
    await page.goto(site.address + 'tools/#equation');
    await expect(page.locator('.cm-editor').first()).toBeVisible();
    expect(api).toEqual([]);
    expect(failed).toEqual([]);
    const privateApi = await request.get(site.address + 'api/bootstrap');
    expect(privateApi.status()).toBe(404);
  });

test('interactive diagrams, charts and comparisons use static repository assets', async ({
  page,
}) => {
  const failed: string[] = [];
  page.on('response', (response) => {
    if (response.url().startsWith('http://127.0.0.1:4396/') && response.status() >= 400)
      failed.push(response.url());
  });
  await page.goto('http://127.0.0.1:4396/Glass/post/component-showcase/');
  await expect(page.locator('[data-mermaid] .mermaid-canvas svg:visible')).toHaveCount(2);
  const chart = page.locator('[data-interactive="chart"]').first();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toHaveAttribute('data-enhanced', 'true');
  const comparison = page.locator('[data-interactive="image-compare"]');
  await comparison.scrollIntoViewIfNeeded();
  await expect(comparison).toHaveAttribute('data-enhanced', 'true');
  await comparison.getByRole('slider').press('End');
  await expect(comparison.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  for (const image of await comparison.locator('img').all()) {
    await expect(image).toHaveAttribute('src', /^\/Glass\/media\//);
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBeGreaterThan(0);
  }
  const diagram = page.locator('[data-mermaid]').first();
  await diagram.scrollIntoViewIfNeeded();
  await diagram.locator('.mermaid-canvas').click();
  await expect(page.locator('dialog.media-viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(failed).toEqual([]);
});

test('static aliases and published pages remain useful without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4396/Glass/old-github-note/');
    await expect(page).toHaveURL('http://127.0.0.1:4396/Glass/post/github-components/');
    await expect(
      page.getByRole('heading', { name: 'GitHub Pages components', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.article-body mjx-container').first()).toBeVisible();
    await page.goto('http://127.0.0.1:4396/Glass/archive/page/2/');
    await expect(page.locator('[data-archive-results]')).toContainText('Archive example');
    await page.screenshot({
      path: test.info().outputPath('github-pages-no-js.png'),
      fullPage: false,
    });
  } finally {
    await context.close();
  }
});
