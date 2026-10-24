import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
test('dynamic search labels and result statuses follow both reader languages', async ({ page }) => {
  for (const [language, filter, count] of [
    ['zh-Hans', '按内容筛选', '个结果'],
    ['zh-Hant', '依內容篩選', '個結果'],
  ]) {
    await page.goto('/settings/');
    await page.locator('select[data-ui-language]').selectOption(language);
    await page.goto('/search/?q=tools');
    await expect(page.getByLabel(filter, { exact: true })).toBeVisible();
    await expect(page.locator('.search-summary')).toContainText(count);
    await expect(
      page.locator('.search-filters select').first().locator('option').first(),
    ).toHaveText('全部');
  }
});
test('service readiness shows permission gaps without claiming deployment success', async ({
  page,
}) => {
  await page.route('**/api/services/readiness', (route) =>
    route.fulfill({
      json: {
        checkedAt: new Date().toISOString(),
        accountId: 'test-account',
        ready: false,
        checks: [
          { id: 'workers', status: 'ready', codes: [] },
          { id: 'd1', status: 'denied', codes: [10000] },
          { id: 'access', status: 'missing', codes: [] },
          { id: 'zone', status: 'unavailable', codes: [] },
        ],
      },
    }),
  );
  await page.goto('/studio/#settings/connections');
  await page.getByRole('button', { name: 'Check service readiness', exact: true }).click();
  const panel = page.locator('.service-readiness');
  await expect(panel).toContainText('Read access verified');
  await expect(panel).toContainText('Permission required');
  await expect(panel).toContainText('Setup required');
  await expect(panel).toContainText('Check unavailable');
});

test('the public language switch previews, persists and overrides cached reader language without changing Studio', async ({
  page,
  request,
}) => {
  const bootstrap = async () => (await request.get('/api/bootstrap')).json();
  const original = await bootstrap();
  async function save(value: unknown) {
    const state = await bootstrap();
    const response = await request.put('/api/site', {
      headers: { 'X-Studio-Token': state.token, Origin: 'http://127.0.0.1:4387' },
      data: { value, revision: state.siteRevision },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  async function build() {
    const state = await bootstrap();
    const response = await request.post('/api/jobs', {
      headers: { 'X-Studio-Token': state.token, Origin: 'http://127.0.0.1:4387' },
      data: { action: 'build' },
    });
    expect(response.ok()).toBe(true);
    const job = await response.json();
    await expect
      .poll(
        async () =>
          (await bootstrap()).jobs.find((item: { id: string }) => item.id === job.id)?.state,
        { timeout: 60000 },
      )
      .toBe('succeeded');
  }
  await page.addInitScript(() => {
    localStorage.setItem('glass-reader-language-v1', 'zh-Hant');
    localStorage.setItem('glass-ui-reader-v1-zh-Hant', JSON.stringify({ Home: '首頁' }));
  });
  try {
    await page.goto('/studio/#settings/languages');
    const control = page.getByRole('switch', { name: 'Public language controls', exact: true });
    await expect(control).toBeChecked();
    await control.uncheck();
    await page.getByRole('button', { name: 'Preview site', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Site preview', exact: true });
    await expect(preview.frameLocator('iframe').locator('html')).toHaveAttribute(
      'data-ui-language-enabled',
      'false',
    );
    await expect(preview.frameLocator('iframe').locator('[data-ui-menu]')).toHaveCount(0);
    expect((await bootstrap()).site.localization.enabled).toBe(true);
    await preview.getByRole('button', { name: 'Close Site preview', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await bootstrap()).site.localization.enabled).toBe(false);
    await page.reload();
    await expect(control).not.toBeChecked();
    await build();
    const catalogs: string[] = [];
    page.on('request', (request) => {
      if (/zh-Han[st]\.public/.test(request.url())) catalogs.push(request.url());
    });
    for (const route of ['/', '/settings/']) {
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('html')).toHaveAttribute('data-ui-language-enabled', 'false');
      await expect(page.locator('[data-ui-menu],select[data-ui-language]')).toHaveCount(0);
      await expect(
        page.locator('[data-specimen-locale="zh-Hans"],[data-specimen-locale="zh-Hant"]'),
      ).toHaveCount(0);
    }
    expect(catalogs).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('glass-reader-language-v1'))).toBe(
      'zh-Hant',
    );
    await page.goto('/studio/#settings/languages');
    await expect(page.locator('.topbar-actions .studio-language-button')).toBeVisible();
    await expect(control).not.toBeChecked();
    await control.check();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await bootstrap()).site.localization.enabled).toBe(true);
    await build();
    await page.goto('/settings/');
    await expect(page.locator('select[data-ui-language]')).toHaveValue('zh-Hant');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  } finally {
    await page.close();
    await save(original.site);
    await build();
  }
});

test('reader languages persist independently, preserve authored text and update the real specimen', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/settings/');
  const language = page.locator('select[data-ui-language]');
  await language.selectOption('zh-Hans');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('找到舒适的阅读方式。');
  await expect(page.locator('[data-specimen-language]')).toHaveAttribute(
    'data-specimen-language',
    'zh-Hans',
  );
  await expect(page.locator('#reader-preview-reading h2').first()).toHaveText(
    '为一个想法留一点空间',
  );
  await page.locator('[data-preview-tab="materials"]').click();
  await expect(page.locator('#reader-preview-materials .code-filename')).toHaveText(
    'reading-notes.ts',
  );
  await expect(page.locator('#reader-preview-materials .copy-code')).toHaveAttribute(
    'aria-label',
    '复制代码',
  );
  await page.reload();
  await expect(language).toHaveValue('zh-Hans');
  await language.selectOption('zh-Hant');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('找到舒適的閱讀方式。');
  await page.goto('/blog/good-tools-get-out-of-the-way/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  await expect(page.locator('.article-body')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Good tools get out of the way',
  );
  await page.goto('/studio/#settings');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(errors).toEqual([]);
});

test('Studio language menu retains unsaved settings and supports keyboard selection and focus return', async ({
  page,
}) => {
  await page.goto('/studio/#settings');
  const input = page.locator('input[data-setting-field="name"]');
  const original = await input.inputValue();
  await input.fill('Unsaved language fixture');
  const button = page.locator('.topbar-actions .studio-language-button');
  await button.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.locator('.topbar-actions .studio-language-menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await expect(button).toBeFocused();
  await expect(input).toHaveValue('Unsaved language fixture');
  await button.click();
  await menu.getByRole('menuitemradio', { name: '繁體中文', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  await button.click();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await button.click();
  await menu.getByRole('menuitemradio', { name: 'English', exact: true }).click();
  await expect(input).toHaveValue('Unsaved language fixture');
  await input.fill(original);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await button.click();
    await expect(menu).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width + 2);
    await fs.mkdir('test-results/visuals', { recursive: true });
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-language-menu-${width}.png`,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
  }
});
