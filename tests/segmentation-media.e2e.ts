import AxeBuilder from '@axe-core/playwright';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { enableAnalyticsInterface } from './fixtures/analytics-interface.js';
const bootstrap = async (request: APIRequestContext) =>
  (await request.get('/api/bootstrap')).json();
async function put(request: APIRequestContext, path: string, data: unknown) {
  const state = await bootstrap(request),
    response = await request.put('/api/' + path, {
      headers: { 'X-Studio-Token': state.token, Origin: 'http://127.0.0.1:4387' },
      data,
    });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test('combines audience filters, persists saved segments, compares the same segment and links table drilldowns', async ({
  page,
  request,
}) => {
  await enableAnalyticsInterface(page);
  const original = await (await request.get('/api/analytics/segments')).json();
  const queries: URL[] = [];
  await page.route('**/api/analytics-status', (route) =>
    route.fulfill({
      json: {
        protocol: 3,
        enabled: true,
        paused: false,
        pendingDays: 0,
        networkMode: 'off',
        capabilities: ['segmentation-v1'],
      },
    }),
  );
  await page.route('**/api/analytics/segment-options?*', (route) =>
    route.fulfill({
      json: {
        options: {
          country: ['US', 'FR'],
          device: ['desktop', 'phone'],
          browser: ['Chrome'],
          os: ['Windows'],
          source: ['google', 'direct'],
          campaign: ['(none)'],
          language: ['en', 'zh'],
        },
        coverage: { days: 1, coveredDays: 1, missingDays: [], from: null, to: null },
      },
    }),
  );
  await page.route(
    /\/api\/analytics\/(overview|reach|content|engagement|audience|quality|technology|geography|visits)\?/,
    (route) => {
      const url = new URL(route.request().url());
      queries.push(url);
      return route.fulfill({
        json: {
          name: url.pathname.split('/').at(-1),
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          timezone: 'UTC',
          generatedAt: new Date().toISOString(),
          freshness: new Date().toISOString(),
          metrics: [{ label: 'Page views', value: url.searchParams.has('segment') ? 12 : 42 }],
          series: [],
          rows: [{ country: 'US', views: 12 }],
          retention: [],
          cohorts: [],
          notes: [],
          segment: JSON.parse(url.searchParams.get('segment') || '{}'),
        },
      });
    },
  );
  try {
    await page.goto('/studio/#analytics/overview');
    await page.getByRole('button', { name: 'Filter audience', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Audience segment', exact: true });
    await dialog.getByLabel('United States', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Device', exact: true }).click();
    await dialog.getByLabel('Desktop', { exact: true }).check();
    const accessibility = await new AxeBuilder({ page }).include('.aca-segment-dialog').analyze();
    expect(
      accessibility.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
    ).toEqual([]);
    await dialog.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect
      .poll(() =>
        queries.some((url) => {
          const segment = JSON.parse(url.searchParams.get('segment') || '{}');
          return segment.country?.[0] === 'US' && segment.device?.[0] === 'desktop';
        }),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Save segment', exact: true }).click();
    await page.getByLabel('Segment name', { exact: true }).fill('Desktop readers');
    await page
      .getByRole('dialog', { name: 'Save segment', exact: true })
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(page.getByRole('combobox', { name: 'Saved segments', exact: true })).toHaveValue(
      /.+/,
    );
    await page.reload();
    await expect(
      page
        .getByRole('combobox', { name: 'Saved segments', exact: true })
        .locator('option', { hasText: 'Desktop readers' }),
    ).toHaveCount(1);
    await page.getByLabel('Compare previous period', { exact: true }).check();
    await expect
      .poll(() => queries.filter((url) => url.searchParams.has('segment')).length)
      .toBeGreaterThan(2);
    const last = queries.filter((url) => url.searchParams.has('segment')).slice(-2);
    expect(last[0].searchParams.get('segment')).toBe(last[1].searchParams.get('segment'));
    expect(last[0].searchParams.get('from')).not.toBe(last[1].searchParams.get('from'));
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page
      .locator('.aca-table')
      .getByRole('button', { name: 'United States', exact: true })
      .click();
    await expect(page.locator('.aca-segment-chips')).toContainText('United States');
    await fs.mkdir('test-results/visuals', { recursive: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width + 2);
      await page.locator('.aca-filter-panel').scrollIntoViewIfNeeded();
      await page.screenshot({
        animations: 'disabled',
        scale: 'css',
        path: `test-results/visuals/${test.info().project.name}-segments-${width}.png`,
      });
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await page.locator('.aca-filter-panel').scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: 'disabled',
      scale: 'css',
      path: `test-results/visuals/${test.info().project.name}-segments-dark.png`,
    });
  } finally {
    const latest = await (await request.get('/api/analytics/segments')).json();
    await put(request, 'analytics/segments', { value: original.value, revision: latest.revision });
  }
});
test('media naming retains canonical paths and uses tidy sharing controls at narrow widths', async ({
  page,
  request,
}) => {
  const original = await bootstrap(request);
  try {
    await page.goto('/studio/#media');
    await page.locator('.media-card').filter({ hasText: 'wave.svg' }).click();
    const dialog = page.getByRole('dialog', { name: 'A closer look' });
    await dialog.getByLabel('Display name', { exact: true }).fill('Wave, study');
    await dialog.getByLabel('Media short code', { exact: true }).fill('wave-demo-link');
    await dialog.getByRole('switch', { name: 'Publish for sharing', exact: true }).check();
    await dialog.getByRole('button', { name: 'Save media settings', exact: true }).click();
    await expect(dialog.locator('.media-detail-name')).toHaveText('Wave, study');
    await expect(dialog.getByRole('button', { name: 'Copy local URL', exact: true })).toBeVisible();
    const metadata = await (
      await request.get('/api/media/metadata?url=%2Fmedia%2Fwave.svg')
    ).json();
    expect(metadata.url).toBe('/media/wave.svg');
    expect(metadata.metadata).toMatchObject({
      displayName: 'Wave, study',
      shortCode: 'wave-demo-link',
      publishForSharing: true,
    });
    const redirect = await request.get('/m/wave-demo-link', { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers().location).toBe('/media/wave.svg');
    await fs.mkdir('test-results/visuals', { recursive: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width + 2);
      await dialog.getByLabel('Display name', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({
        animations: 'disabled',
        scale: 'css',
        path: `test-results/visuals/${test.info().project.name}-media-names-${width}.png`,
      });
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await dialog.getByLabel('Display name', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: 'disabled',
      scale: 'css',
      path: `test-results/visuals/${test.info().project.name}-media-names-dark.png`,
    });
  } finally {
    const current = await bootstrap(request);
    await put(request, 'library', { value: original.library, revision: current.libraryRevision });
  }
});
test('language options show native names while retaining stable language codes', async ({
  page,
}) => {
  await page.goto('/studio/#settings/languages');
  const language = page.getByLabel('Default content language', { exact: true });
  await expect(language).toHaveJSProperty('tagName', 'SELECT');
  await expect(language.locator('option[value="zh-Hans"]')).toHaveText('简体中文');
  await expect(language.locator('option[value="es"]')).toHaveText('Español');
  await page.goto('/search/');
  await page.getByRole('searchbox').first().fill('glass');
  await expect(page.getByLabel('Filter by language').locator('option[value="en"]')).toHaveText(
    'English',
  );
});

test('asset protection defaults and host separators save through ordinary site settings', async ({
  page,
  request,
}) => {
  const original = await bootstrap(request);
  try {
    await page.goto('/studio/#settings/media-delivery');
    await expect(
      page.getByRole('switch', { name: 'Discourage asset indexing', exact: true }),
    ).toBeChecked();
    const toggle = page.getByRole('switch', { name: 'Block foreign media embeds', exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    const hosts = page.getByLabel('Trusted embedding hosts');
    await hosts.fill('partner.example,');
    await hosts.press('End');
    await hosts.pressSequentially(' second.example');
    await expect(hosts).toHaveValue('partner.example, second.example');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect
      .poll(async () => (await bootstrap(request)).site.mediaProtection.allowedHosts)
      .toEqual(['partner.example', 'second.example']);
    await expect(
      page.getByRole('button', { name: 'Check Cloudflare protection', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply scoped rules', exact: true })).toHaveCount(
      0,
    );
  } finally {
    const current = await bootstrap(request);
    await put(request, 'site', { value: original.site, revision: current.siteRevision });
  }
});
