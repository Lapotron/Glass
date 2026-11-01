import { test, expect } from '@playwright/test';
import { enableAnalyticsInterface } from './fixtures/analytics-interface.js';

test('Google Search Console credentials stay private and can be removed', async ({
  page,
  request,
}) => {
  await enableAnalyticsInterface(page);
  await page.route('**/api/analytics/**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/segments')) return route.continue();
    return route.fulfill({
      json: {
        name: 'reach',
        from: '2026-10-01',
        to: '2026-10-23',
        generatedAt: new Date().toISOString(),
        timezone: 'UTC',
        metrics: [],
        series: [],
        retention: [],
        cohorts: [],
        freshness: new Date().toISOString(),
        notes: [],
        rows: [],
      },
    });
  });
  await page.goto('/studio/#analytics/reach');
  const connection = page
    .locator('.settings-card')
    .filter({ has: page.getByRole('heading', { name: 'Connect Google Search Console' }) })
    .last();
  await expect(connection).toBeVisible();
  await connection.getByLabel('Google OAuth client ID').fill('example.apps.googleusercontent.com');
  await connection.getByLabel('Google OAuth client secret').fill('browser-fixture-secret');
  await connection.getByRole('button', { name: 'Save Google client' }).click();
  await expect(connection.getByText('Client saved; connect Google to continue.')).toBeVisible();
  expect(await (await request.get('/api/search-console/oauth/status')).text()).not.toContain(
    'browser-fixture-secret',
  );
  await connection.getByRole('button', { name: 'Remove Google client' }).click();
  await connection.getByRole('button', { name: 'Confirm removal' }).click();
  await expect(connection.getByText('No Google client configured.')).toBeVisible();
});
