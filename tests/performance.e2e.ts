import { test, expect } from '@playwright/test';

test('a failed search module retries without reloading or losing the query', async ({ page }) => {
  await page.route(/\/search-[A-Za-z0-9_-]+\.js(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'text/javascript',
      headers: { 'Cache-Control': 'no-store' },
      body: 'Temporarily unavailable',
    }),
  );
  await page.goto('http://127.0.0.1:4174/');
  await page.getByRole('button', { name: 'Search this notebook' }).click();
  await expect(page.locator('.search-results')).toContainText('Search couldn’t load');
  await page.getByRole('searchbox', { name: 'Search Writing and Lab' }).fill('curiosity');
  await page.unrouteAll();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.search-result')).not.toHaveCount(0);
});

for (const fallback of [false, true]) {
  test(`search loads on intent and preserves results with ${fallback ? 'worker fallback' : 'a local worker'}`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [],
      requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    context.on('request', (request) => requests.push(request.url()));
    if (fallback)
      await page.addInitScript(() => {
        Object.defineProperty(window, 'Worker', {
          value: class {
            constructor() {
              throw new Error('Controlled worker unavailable');
            }
          },
        });
      });
    await page.goto('http://127.0.0.1:4174/');
    await expect(page.locator('.site-header')).toBeVisible();
    expect(requests.some((url) => url.endsWith('/search.json'))).toBe(false);
    await page.getByRole('button', { name: 'Search this notebook' }).click();
    const input = page.getByRole('searchbox', { name: 'Search Writing and Lab' });
    await input.fill('curiosity');
    await expect(page.locator('.search-result')).not.toHaveCount(0);
    await expect(page.locator('.search-results')).toContainText('curiosity', { ignoreCase: true });
    await input.fill('zzzzzq938475');
    await expect(page.locator('.search-results')).toContainText('No matches');
    await input.fill('curiosity');
    await expect(page.locator('.search-result')).not.toHaveCount(0);
    await input.fill('');
    await expect(page.locator('.search-results')).toContainText('Search writing');
    await page.keyboard.press('Escape');
    await expect(page.locator('#search-dialog')).not.toBeVisible();
    expect(requests.filter((url) => url.endsWith('/search.json'))).toHaveLength(0);
    expect(
      requests.some((url) => url.includes('/assets/search/') && url.includes('pagefind.js')),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
