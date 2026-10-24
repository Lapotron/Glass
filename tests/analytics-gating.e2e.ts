import { test, expect, type APIRequestContext } from '@playwright/test';

const state = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function saveSite(request: APIRequestContext, value: unknown) {
  const current = await state(request);
  const response = await request.put('/api/site', {
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data: { value, revision: current.siteRevision },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
test('disabled ACA gates navigation and deep links, avoids report requests and closes an active dashboard', async ({
  page,
  request,
}) => {
  const original = await state(request);
  const analyticsRequests: string[] = [],
    modules: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/analytics-status' || path.startsWith('/api/analytics/'))
      analyticsRequests.push(path);
    if (/\/Analytics-[^/]+\.(?:js|css)$/.test(path)) modules.push(path);
  });
  await page.route('**/api/analytics-status', (route) =>
    route.fulfill({
      json: { protocol: 3, enabled: true, paused: false, pendingDays: 0, networkMode: 'daily' },
    }),
  );
  await page.route('**/api/analytics/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/segments')) return route.continue();
    return route.fulfill({
      json: {
        name: url.pathname.split('/').pop(),
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        timezone: 'UTC',
        generatedAt: new Date().toISOString(),
        metrics: [{ label: 'Page views', value: 1 }],
        series: [],
        rows: [],
        notes: [],
      },
    });
  });
  const configured = {
    ...original.site,
    integrations: {
      ...original.site.integrations,
      aca: {
        ...original.site.integrations.aca,
        enabled: false,
        endpoint: 'https://aca-gate.example',
        siteId: 'gate-fixture',
      },
    },
  };
  try {
    await saveSite(request, configured);
    await page.goto('/studio/#analytics/engagement?content=historic-article');
    const destination = page
      .getByRole('navigation', { name: 'Studio navigation' })
      .getByRole('button', { name: 'Analytics', exact: true });
    await expect(destination).toBeDisabled();
    await expect(
      page.getByRole('heading', { name: 'Analytics is disabled', exact: true }),
    ).toBeVisible();
    expect(analyticsRequests).toEqual([]);
    expect(modules).toEqual([]);
    await page.getByRole('button', { name: 'Configure ACA', exact: true }).click();
    await expect(page).toHaveURL(/#settings\/aca$/);
    await expect(page.getByRole('switch', { name: 'Enable ACA', exact: true })).toBeVisible();
    expect(analyticsRequests).toEqual([]);
    await saveSite(request, {
      ...configured,
      integrations: {
        ...configured.integrations,
        aca: { ...configured.integrations.aca, enabled: true },
      },
    });
    await page.goto('/studio/#analytics');
    await expect(destination).toBeEnabled();
    await expect(page.locator('.aca-metric')).toHaveCount(1);
    expect(analyticsRequests).toContain('/api/analytics-status');
    expect(analyticsRequests).toContain('/api/analytics/overview');
    await saveSite(request, configured);
    await expect(
      page.getByRole('heading', { name: 'Analytics is disabled', exact: true }),
    ).toBeVisible();
    await expect(destination).toBeDisabled();
    const count = analyticsRequests.length;
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Analytics is disabled', exact: true }),
    ).toBeVisible();
    expect(analyticsRequests).toHaveLength(count);
    await page.setViewportSize({ width: 320, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath('analytics-disabled.png'),
      animations: 'disabled',
    });
  } finally {
    await page.close();
    await saveSite(request, original.site);
  }
});
