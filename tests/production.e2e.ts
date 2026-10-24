import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;
const origin = 'http://127.0.0.1:4174';

test('production diagrams, math and static components are complete without reader JavaScript', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto(origin + '/blog/component-showcase/');
    await expect(page.locator('[data-mermaid]')).toHaveCount(2);
    await expect(page.locator('[data-mermaid] .mermaid-canvas svg:visible')).toHaveCount(2);
    await expect(page.locator('.post-outline details')).not.toHaveAttribute('open');
    await page.locator('.post-outline summary').click();
    await expect(page.getByRole('navigation', { name: 'Table of contents' })).toBeVisible();
    await page.locator('.post-outline summary').click();
    expect(await page.locator('[role="math"] svg').count()).toBeGreaterThan(25);
    await expect(page.locator('[data-interactive]')).toHaveCount(8);
    for (const control of await page.locator('[data-interactive="function-plot"] input').all())
      await expect(control).toBeDisabled();
    const diagram = page.locator('[data-mermaid]').first();
    await diagram.scrollIntoViewIfNeeded();
    await diagram.getByText('View Mermaid source', { exact: true }).click();
    await expect(diagram.locator('pre')).toBeVisible();
    await fs.mkdir('test-results/visuals', { recursive: true });
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-production-no-js.png`,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const manifest = await (await request.get(origin + '/assets/reader-assets.json')).json();
    for (const url of [manifest.script, manifest.style, manifest.appearance]) {
      expect(url).toMatch(/^\/assets\/bundles\/[a-f0-9]{20}\//);
      const response = await request.get(origin + url);
      expect(response.ok()).toBe(true);
      expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    }
    const metadata = await request.get(origin + '/assets/media-details.json');
    expect(metadata.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
    expect((await request.get(origin + '/')).headers()['cache-control']).toBe(
      'public, max-age=0, must-revalidate',
    );
  } finally {
    await context.close();
  }
});

test('production loads only needed reader features and switches diagram themes without rendering', async ({
  page,
}) => {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  const assets: Promise<{ url: string; gzip: number }>[] = [],
    failed: string[] = [],
    errors: string[] = [];
  const measured = new Set<string>();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (/\.(?:js|css)(?:\?|$)/.test(response.url())) {
      if (!response.ok()) failed.push(response.url());
      else if (!measured.has(response.url())) {
        // Count the same asset graph as quality:report. WebKit can report both
        // preload and module responses when request routing disables its cache.
        measured.add(response.url());
        assets.push(
          response.body().then((body) => ({ url: response.url(), gzip: gzipSync(body).length })),
        );
      }
    }
  });
  await page.goto(origin + '/blog/component-showcase/');
  await expect(page.locator('[data-mermaid] .mermaid-canvas svg:visible')).toHaveCount(2);
  for (const node of await page.locator('[data-interactive]').all()) {
    await node.scrollIntoViewIfNeeded();
    await expect(node).toHaveAttribute('data-enhanced', 'true');
  }
  const plot = page.locator('[data-interactive="function-plot"]').first();
  await plot.scrollIntoViewIfNeeded();
  const path = plot.locator('.plot-curve'),
    initial = await path.getAttribute('d');
  await plot.getByRole('slider', { name: 'Amplitude', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(path).not.toHaveAttribute('d', initial!);
  const comparison = page.locator('[data-interactive="image-compare"]');
  await comparison.scrollIntoViewIfNeeded();
  await comparison.getByRole('slider').press('End');
  await expect(comparison.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  const diagram = page.locator('[data-mermaid]').first();
  const before = await diagram.locator('.mermaid-canvas').innerHTML();
  await page.getByRole('button', { name: 'Change appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-mermaid] [data-diagram-variant="dark"]:visible')).toHaveCount(2);
  expect(await diagram.locator('.mermaid-canvas').innerHTML()).toBe(before);
  await diagram.scrollIntoViewIfNeeded();
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-production-diagram-dark.png`,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => document.documentElement.style.setProperty('--font-scale', '1.15'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.waitForLoadState('networkidle');
  const loaded = await Promise.all(assets);
  expect(loaded.reduce((sum, asset) => sum + asset.gzip, 0)).toBeLessThanOrEqual(90 * 1024);
  expect(
    loaded.some((asset) =>
      /mermaid|mathjax|katex|reader-settings|image-viewer-dialog|photoswipe|monaco|codemirror|giscus/i.test(
        asset.url,
      ),
    ),
  ).toBe(false);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
  const audit = await new AxeBuilder({ page }).include('.article-body').analyze();
  expect(
    audit.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact || ''),
    ),
  ).toEqual([]);
});

test('deferred reader Settings and image dialog retain native loading, Escape and focus return', async ({
  page,
}) => {
  await page.goto('/settings/');
  await expect(page.getByRole('combobox', { name: 'Appearance', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
  await page.goto('/life/?view=photos');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    ready = new Promise<void>((resolve) => (entered = resolve));
  await page.route('**/image-viewer-dialog-*.js', async (route) => {
    entered();
    await gate;
    try {
      await route.continue();
    } catch (error) {
      if (!/already handled|Target.*closed/i.test((error as Error).message)) throw error;
    }
  });
  const opener = page.getByRole('link', { name: /Where the sea meets the morning/ });
  try {
    await opener.click();
    await ready;
    await expect(page.getByRole('dialog', { name: 'Image viewer' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Opening image' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Image viewer' })).toHaveCount(0);
    await expect(opener).toBeFocused();
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await opener.click();
    await expect(page.getByRole('toolbar', { name: 'Image controls' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
