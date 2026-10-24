import { test, expect, type APIRequestContext } from '@playwright/test';
import { enableAnalyticsInterface } from './fixtures/analytics-interface.js';
import { promises as fs } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { routeFor } from '../src/shared/contracts.js';
const bootstrap = async (request: APIRequestContext) =>
  (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, url: string, method: string, data: unknown) {
  const state = await bootstrap(request);
  const response = await request.fetch('/api/' + url, {
    method,
    headers: { 'X-Studio-Token': state.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function build(request: APIRequestContext) {
  const job = await mutate(request, 'jobs', 'POST', { action: 'build' });
  await expect
    .poll(
      async () =>
        (await bootstrap(request)).jobs.find((j: { id: string }) => j.id === job.id)?.state,
      { timeout: 60000 },
    )
    .toBe('succeeded');
}
const report = (name: string) => ({
  name,
  from: '2026-10-01',
  to: '2026-10-23',
  generatedAt: new Date().toISOString(),
  timezone: 'UTC',
  metrics: [{ label: 'Observed locations', value: 3 }],
  series: [],
  retention: [],
  cohorts: [],
  freshness: new Date().toISOString(),
  notes: [],
  rows:
    name === 'geography'
      ? [
          {
            country: 'JP',
            continent: 'AS',
            region: 'Tokyo',
            city: 'Tokyo',
            timezone: 'Asia/Tokyo',
            latitude: 35.68,
            longitude: 139.65,
            views: 120,
            qualified: 76,
            activeMs: 900000,
          },
          {
            country: 'DE',
            continent: 'EU',
            region: 'Berlin',
            city: 'Berlin',
            timezone: 'Europe/Berlin',
            latitude: 52.52,
            longitude: 13.4,
            views: 65,
            qualified: 31,
            activeMs: 420000,
          },
          {
            country: 'US',
            continent: 'NA',
            region: 'New York',
            city: 'New York',
            timezone: 'America/New_York',
            latitude: 40.71,
            longitude: -74,
            views: 45,
            qualified: 26,
            activeMs: 360000,
          },
        ]
      : [],
});
test('private Earth loads on intent, renders local textures and retains a narrow accessible map/table fallback', async ({
  page,
}) => {
  await enableAnalyticsInterface(page);
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#dce5df" d="M0 0h256v256H0z"/><path stroke="#b4c6c3" fill="none" d="M0 64h256M0 192h256M64 0v256M192 0v256"/></svg>',
    }),
  );
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.route('**/api/analytics-status', (route) =>
    route.fulfill({
      json: {
        protocol: 3,
        enabled: true,
        paused: false,
        pendingDays: 0,
        networkMode: 'daily',
        historyMode: 'optional-consent',
      },
    }),
  );
  await page.route('**/api/analytics/**', (route) => {
    if(new URL(route.request().url()).pathname.endsWith('/segments'))return route.continue();
    return route.fulfill({ json: report(new URL(route.request().url()).pathname.split('/').pop()!) });
  });
  await page.goto('/studio/#analytics');
  await expect(page.locator('.aca-metric').first()).toBeVisible();
  expect(requests.some((url) => /globe\.gl-/.test(url))).toBe(false);
  await page.getByRole('tab', { name: 'Audience', exact: true }).click();
  await page
    .locator('.aca-audience-tabs')
    .getByRole('button', { name: 'Geography', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Audience Earth' })).toBeVisible();
  await page.locator('.aca-earth').scrollIntoViewIfNeeded();
  await expect(page.locator('.aca-osm-stage .leaflet-tile-loaded').first()).toBeVisible();
  await expect(page.locator('.aca-osm-stage .aca-map-marker')).toHaveCount(3);
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
  await page.locator('.aca-earth').getByRole('button', { name: '3D Earth', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.locator('.aca-earth-stage canvas').count()) ||
        (await page.locator('.aca-earth-map').count()),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  if (await page.locator('.aca-earth-stage canvas').count()) {
    await expect
      .poll(() =>
        requests.some((url) => url.includes('earth-day-') || url.includes('earth-night-')),
      )
      .toBe(true);
    await page.waitForTimeout(1400);
    await page.locator('.aca-earth-stage').focus();
    await page.keyboard.press('ArrowRight');
  }
  await fs.mkdir('test-results/visuals', { recursive: true });
  for (const appearance of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, appearance);
    await page.waitForTimeout(250);
    await page.locator('.aca-earth').screenshot({
      path: `test-results/visuals/${test.info().project.name}-audience-earth-${appearance}.png`,
    });
  }
  await page
    .locator('.aca-earth')
    .getByRole('button', { name: 'Offline map', exact: true })
    .click();
  await expect(page.locator('.aca-earth-map')).toBeVisible();
  await expect(page.locator('.aca-earth-map circle')).toHaveCount(3);
  await page.locator('.aca-earth').getByLabel('Country', { exact: true }).selectOption('JP');
  await expect(page.locator('.aca-earth-map circle')).toHaveCount(1);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const accessibility = await new AxeBuilder({ page }).include('.aca-earth').analyze();
  expect(
    accessibility.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
  ).toEqual([]);
});
test('reading list preserves stable entries, resumes a real scroll position, and supports clear/import', async ({
  page,
  request,
}) => {
  const state = await bootstrap(request),
    entry = state.entries.find(
      (e: { status: string; kind: string }) => e.status === 'published' && e.kind === 'posts',
    );
  const route = routeFor(entry, state.site.collections);
  await page.goto(route);
  await expect(page.locator('[data-reading-bookmark]')).toBeEnabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    const article = document.querySelector<HTMLElement>('.article-body')!;
    scrollTo(0, article.getBoundingClientRect().top + scrollY + article.offsetHeight * 0.35);
  });
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('glass-reading-v1') || '[]').length),
    )
    .toBeGreaterThan(0);
  const records = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('glass-reading-v1') || '[]'),
  );
  expect(records[0].id).toBe(entry.id);
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('glass-reading-v1') || '[]')[0]?.progress || 0,
      ),
    )
    .toBeGreaterThan(3);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume reading', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume reading', exact: true }).click();
  await page.locator('[data-reading-bookmark]').click();
  await expect(page.locator('[data-reading-bookmark]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-reading-list]').click();
  const dialog = page.getByRole('dialog', { name: 'Reading list', exact: true });
  await expect(
    dialog.getByRole('link', {
      name: new RegExp(entry.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('glass-reading-v1') || '[]'),
  );
  await dialog.getByRole('button', { name: 'Clear reading list', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm clear', exact: true }).click();
  await expect(dialog).toContainText('No saved reading yet');
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'reading.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, entries: saved })),
  });
  await expect(dialog).toContainText('Reading list imported.');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-reading-list]')).toBeFocused();
});
test('privacy opt-in and withdrawal are explicit and credential-free', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const original = await bootstrap(request);
  try {
    await mutate(request, 'site', 'PUT', {
      revision: original.siteRevision,
      value: {
        ...original.site,
        integrations: {
          ...original.site.integrations,
          aca: {
            ...original.site.integrations.aca,
            enabled: true,
            endpoint: 'https://metrics.reader.example',
            siteId: 'test',
            optionalHistory: true,
          },
        },
      },
    });
    await build(request);
    let forgot = false;
    await page.route('https://metrics.reader.example/**', async (route) => {
      const origin = 'http://127.0.0.1:4387';
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
          },
        });
      forgot = true;
      expect(route.request().headers().cookie).toBeUndefined();
      return route.fulfill({
        json: { ok: true },
        headers: { 'Access-Control-Allow-Origin': origin },
      });
    });
    await page.goto('/');
    await expect(
      page.locator('.site-footer').getByRole('button', { name: 'Privacy', exact: true }),
    ).toHaveCount(0);
    await page.goto('/settings/#privacy');
    const dialog = page.getByRole('dialog', { name: 'Analytics privacy' });
    await dialog.getByLabel('Your choice').selectOption('opt-in');
    await dialog.getByRole('button', { name: 'Save preference', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Preference saved');
    expect(
      await page.evaluate(() => localStorage.getItem('fieldnotes-aca-identity')),
    ).not.toBeNull();
    await dialog.getByLabel('Your choice').selectOption('anonymous');
    await dialog.getByRole('button', { name: 'Save preference', exact: true }).click();
    await expect.poll(() => forgot).toBe(true);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('fieldnotes-aca-identity')))
      .toBeNull();
    await page.keyboard.press('Escape');
    await page.goto('/settings/');
    await expect(page.getByText('Your analytics preference', { exact: true })).toHaveCount(0);
  } finally {
    const current = await bootstrap(request);
    await mutate(request, 'site', 'PUT', { revision: current.siteRevision, value: original.site });
    await build(request);
  }
});
test('Search Console imports are reviewed, private and removable', async ({ page, request }) => {
  await enableAnalyticsInterface(page);
  await page.route('**/api/analytics/**', (route) => {
    if(new URL(route.request().url()).pathname.endsWith('/segments'))return route.continue();
    return route.fulfill({ json: report(new URL(route.request().url()).pathname.split('/').pop()!) });
  });
  await page.goto('/studio/#analytics/reach');
  await expect(
    page.getByRole('heading', { name: 'Search performance', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Performance CSV').setInputFiles({
    name: 'Pages.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Top pages,Clicks,Impressions,CTR,Position\nhttps://example.com/post/a,2,20,10%,3.2',
    ),
  });
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await expect(page.getByLabel('Imported reports')).toBeVisible();
  await expect(page.getByText('https://example.com/post/a', { exact: true })).toBeVisible();
  const datasets = await (await request.get('/api/search-console')).json();
  expect(datasets).toHaveLength(1);
  await page.getByRole('button', { name: 'Remove imported report', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get('/api/search-console')).json()).length)
    .toBe(0);
});
