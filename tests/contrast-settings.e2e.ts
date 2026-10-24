import { selectSettingsSection } from './settings-navigation.js';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
const require = createRequire(import.meta.url);
const sharp: typeof import('sharp').default = require('sharp');
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;
async function state(request: APIRequestContext) {
  return (await request.get('/api/bootstrap')).json();
}
async function change(request: APIRequestContext, url: string, value: unknown, method = 'PUT') {
  const model = await state(request),
    response = await request.fetch('/api/' + url, {
      method,
      data: value,
      headers: { 'X-Studio-Token': model.token, Origin: 'http://127.0.0.1:4387' },
    });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function capture(page: import('@playwright/test').Page, name: string) {
  await page.waitForFunction(
    () =>
      !CSS.supports('selector(:active-view-transition)') ||
      !document.documentElement.matches(':active-view-transition'),
  );
  if (await page.locator('.site-main').count())
    await expect
      .poll(() =>
        page.locator('html').evaluate((node) => getComputedStyle(node, '::before').opacity),
      )
      .toBe('0');
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-${name}.png`,
    animations: 'disabled',
  });
}

test('a delayed filesystem refresh preserves newer build progress and completion', async ({
  page,
  request,
}) => {
  await page.goto('/studio/#builds');
  await expect(page.locator('.studio-page-heading')).toBeVisible();
  let release!: () => void, captured!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    ready = new Promise<void>((resolve) => (captured = resolve));
  await page.route(
    '**/api/bootstrap',
    async (route) => {
      const response = await route.fetch(),
        snapshot = await response.json();
      captured();
      await gate;
      await route.fulfill({
        response,
        json: { ...snapshot, site: { ...snapshot.site, name: 'Delayed refresh fixture' } },
      });
    },
    { times: 1 },
  );
  try {
    const original = await state(request);
    await change(request, 'site', { value: original.site, revision: original.siteRevision });
    await ready;
    await page.getByRole('button', { name: 'Build site', exact: true }).click();
    await expect(page.locator('.build-job').first().locator('.job-status')).toHaveText('Complete');
    release();
    await expect(page.locator('.studio-brand')).toContainText('Delayed refresh fixture');
    await expect(page.locator('.build-job').first().locator('.job-status')).toHaveText('Complete');
  } finally {
    release();
    await page.unroute('**/api/bootstrap');
  }
});

test('reader contrast controls preserve local choices and protect text over an uploaded picture', async ({
  page,
  request,
  context,
}) => {
  const before = await state(request),
    writes: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
  });
  await page.goto('/settings/');
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
  await page.getByLabel('Contrast preset', { exact: true }).selectOption('high');
  await page.getByText('Advanced text colors', { exact: true }).click();
  await page.getByLabel('Light body text color', { exact: true }).fill('#778899');
  await page.getByRole('switch', { name: /Automatic wallpaper protection/ }).uncheck();
  await expect(page.locator('html')).toHaveCSS('--foreground-body-light', '#778899');
  await page.getByText('Readability & effective colors', { exact: true }).click();
  await expect(page.locator('[data-contrast-result="light.body"]')).toContainText(
    'Needs attention',
  );
  const picture = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel('Choose a background picture', { exact: true })
    .setInputFiles({ name: 'bright-picture.png', mimeType: 'image/png', buffer: picture });
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'true');
  await page.getByRole('slider', { name: 'Glass tint', exact: true }).press('End');
  await page.getByRole('slider', { name: 'Article background tint', exact: true }).press('End');
  await page.getByRole('switch', { name: /Automatic wallpaper protection/ }).check();
  await expect(page.locator('[data-contrast-result="light.body"]')).not.toContainText(
    'Needs attention',
  );
  await expect
    .poll(() =>
      page
        .locator('html')
        .evaluate((node) =>
          parseFloat(getComputedStyle(node).getPropertyValue('--protected-glass-light')),
        ),
    )
    .toBeGreaterThanOrEqual(0.58);
  await expect(page.locator('html')).toHaveCSS('--wallpaper-dim', '0.35');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Contrast preset', exact: true })).toHaveValue(
    'high',
  );
  await page.getByText('Advanced text colors', { exact: true }).click();
  await expect(page.getByLabel('Light body text color', { exact: true })).toHaveValue('#778899');
  const second = await context.newPage();
  await second.goto('/about/');
  await page
    .getByRole('combobox', { name: 'Contrast preset', exact: true })
    .selectOption('balanced');
  await expect(second.locator('html')).toHaveCSS(
    '--foreground-body-light',
    await page
      .locator('html')
      .evaluate((node) => getComputedStyle(node).getPropertyValue('--foreground-body-light')),
  );
  await page.getByRole('button', { name: 'Reset contrast', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'reader-contrast-phone');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Reset everything', exact: true }).click();
  await second.close();
  expect(writes).toEqual([]);
  expect((await state(request)).siteRevision).toBe(before.siteRevision);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
});

test('Studio saves write-only credentials, retains a conflicting draft and stages next-launch settings', async ({
  page,
  request,
}) => {
  const original = await (await request.get('/api/runtime-settings')).json();
  try {
    await page.goto('/studio/#settings');
    await selectSettingsSection(page, 'connections');
    await page
      .getByLabel('Cloudflare API token', { exact: true })
      .fill('studio-cloudflare-canary-12345');
    await page
      .getByLabel('R2 access key ID', { exact: true })
      .fill('studio-r2-access-canary-12345');
    await page
      .getByLabel('R2 secret access key', { exact: true })
      .fill('studio-r2-secret-canary-12345');
    await page.getByRole('button', { name: 'Save credentials', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Credentials saved privately');
    await expect(page.getByLabel('Cloudflare API token', { exact: true })).toHaveValue('');
    const status = await (await request.get('/api/connections')).json();
    expect(JSON.stringify(status)).not.toContain('canary');
    await change(request, 'connections', {
      revision: status.revision,
      set: { cloudflareApiToken: 'external-cloudflare-canary-12345' },
    });
    await page
      .getByLabel('Cloudflare API token', { exact: true })
      .fill('my-conflicting-cloudflare-12345');
    await page.getByRole('button', { name: 'Save credentials', exact: true }).click();
    await expect(page.locator('.local-connections')).toContainText('Local settings changed');
    await expect(page.getByLabel('Cloudflare API token', { exact: true })).toHaveValue(
      'my-conflicting-cloudflare-12345',
    );
    await page.getByRole('button', { name: 'Reload credential status', exact: true }).click();
    await page.getByRole('button', { name: 'Save credentials', exact: true }).click();
    await expect(page.getByLabel('Cloudflare API token', { exact: true })).toHaveValue('');
    await capture(page, 'studio-private-connections');
    await selectSettingsSection(page, 'local');
    await page.getByLabel('Studio port', { exact: true }).fill('4419');
    await page.getByRole('button', { name: 'Save startup settings', exact: true }).click();
    await expect(page.locator('.local-runtime')).toContainText('next launch');
    await expect
      .poll(async () => (await (await request.get('/api/runtime-settings')).json()).saved.port)
      .toBe(4419);
    const pending = await (await request.get('/api/runtime-settings')).json();
    expect(pending.active.port).toBe(4387);
    expect(pending.saved.port).toBe(4419);
    await page.reload();
    await selectSettingsSection(page, 'local');
    await expect(page.getByLabel('Studio port', { exact: true })).toHaveValue('4419');
    await page
      .getByLabel('Notebook folder', { exact: true })
      .fill(original.active.notebookRoot + '/absent-folder');
    await page.getByRole('button', { name: 'Save startup settings', exact: true }).click();
    await expect(page.locator('.local-runtime')).toContainText('Choose a writable notebook folder');
    await page.getByLabel('Notebook folder', { exact: true }).fill(original.active.notebookRoot);
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, 'studio-local-startup-phone');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  } finally {
    const runtime = await (await request.get('/api/runtime-settings')).json();
    await change(request, 'runtime-settings', {
      value: original.saved,
      revision: runtime.revision,
    });
    const credentials = await (await request.get('/api/connections')).json();
    await change(request, 'connections', {
      revision: credentials.revision,
      remove: ['cloudflareApiToken', 'r2AccessKeyId', 'r2SecretAccessKey'],
    });
  }
});

test('author contrast drafts preview and publish through the shared theme without rewriting reader preferences', async ({
  page,
  request,
}) => {
  const original = await state(request);
  try {
    await page.goto('/studio/#appearance');
    await selectSettingsSection(page, 'contrast', true);
    await page.getByText('Advanced text colors', { exact: true }).click();
    await page.getByRole('switch', { name: /Automatic wallpaper protection/ }).uncheck();
    await page.getByLabel('Dark body text color', { exact: true }).fill('#d1e2f3');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect
      .poll(async () => (await state(request)).site.theme.contrast.colors.dark.body)
      .toBe('#d1e2f3');
    await expect(page.locator('html')).toHaveCSS('--foreground-body-dark', '#d1e2f3');
    await expect(
      page.frameLocator('iframe[title="Live appearance preview"]').locator('html'),
    ).toHaveCSS('--foreground-body-dark', '#d1e2f3');
    const job = await change(request, 'jobs', { action: 'build' }, 'POST');
    await expect
      .poll(
        async () => (await state(request)).jobs.find((value: any) => value.id === job.id)?.state,
        { timeout: 20000 },
      )
      .toBe('succeeded');
    await page.goto('/about/');
    await expect(page.locator('html')).toHaveCSS('--foreground-body-dark', '#d1e2f3');
    await capture(page, 'author-contrast-about');
  } finally {
    const current = await state(request);
    await change(request, 'site', { value: original.site, revision: current.siteRevision });
    const job = await change(request, 'jobs', { action: 'build' }, 'POST');
    await expect
      .poll(
        async () => (await state(request)).jobs.find((value: any) => value.id === job.id)?.state,
        { timeout: 20000 },
      )
      .toBe('succeeded');
  }
});
