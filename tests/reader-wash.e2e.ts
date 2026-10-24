import { selectSettingsSection } from './settings-navigation.js';
import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
const require = createRequire(import.meta.url);
const sharp: typeof import('sharp').default = require('sharp');
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;

async function picture() {
  return sharp({ create: { width: 480, height: 320, channels: 3, background: '#263d66' } })
    .png()
    .toBuffer();
}
async function capture(page: Page, name: string) {
  await expect
    .poll(() => page.locator('html').evaluate((node) => getComputedStyle(node, '::before').opacity))
    .toBe('0');
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-wash-${name}.png`,
    animations: 'disabled',
  });
}

test('wallpaper wash stays independent of appearance, synchronizes, and resets with background settings', async ({
  page,
  context,
  request,
}) => {
  const before = await (await request.get('/api/bootstrap')).json();
  const writes: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
  });
  await page.goto('/settings/');
  const appearance = page.getByRole('combobox', { name: 'Appearance', exact: true });
  const wash = page.getByRole('combobox', { name: 'Picture wash color', exact: true });
  await expect(wash).toHaveValue('auto');
  await appearance.selectOption('light');
  await page
    .getByLabel('Choose a background picture', { exact: true })
    .setInputFiles({ name: 'wallpaper.png', mimeType: 'image/png', buffer: await picture() });
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'true');
  await wash.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveCSS('--wallpaper-wash-tint', '16 20 30');
  await expect(page.locator('html')).toHaveCSS('--wallpaper-dim', '0.35');
  await wash.selectOption('auto');
  const strength = page.getByRole('slider', { name: 'Picture wash', exact: true });
  await strength.press('Home');
  await expect(strength).toHaveValue('0');
  await expect(page.locator('html')).toHaveCSS('--wallpaper-dim', '0');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const swatch = document.createElement('span');
        swatch.style.backgroundColor = 'var(--wallpaper-wash)';
        document.body.append(swatch);
        const color = getComputedStyle(swatch).backgroundColor;
        swatch.remove();
        return color;
      }),
    )
    .toBe('rgba(230, 239, 250, 0)');
  await strength.press('ArrowRight');
  await expect(strength).toHaveValue('0.01');
  await expect(page.locator('html')).toHaveCSS('--wallpaper-dim', '0.01');
  await strength.evaluate((node: HTMLInputElement) => {
    node.value = '0.35';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wash.selectOption('dark');
  await wash.scrollIntoViewIfNeeded();
  await capture(page, 'light-theme-dark-wash');
  const darkPixels = await sharp(
    await page.screenshot({ clip: { x: 4, y: 400, width: 4, height: 4 }, animations: 'disabled' }),
  )
    .removeAlpha()
    .raw()
    .toBuffer();
  await wash.selectOption('light');
  const lightPixels = await sharp(
    await page.screenshot({ clip: { x: 4, y: 400, width: 4, height: 4 }, animations: 'disabled' }),
  )
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(lightPixels[0] + lightPixels[1] + lightPixels[2]).toBeGreaterThan(
    darkPixels[0] + darkPixels[1] + darkPixels[2] + 100,
  );
  await wash.selectOption('dark');
  await page.reload();
  await expect(wash).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const second = await context.newPage();
  await second.goto('/about/');
  await expect(second.locator('html')).toHaveCSS('--wallpaper-wash-tint', '16 20 30');
  await appearance.selectOption('dark');
  await wash.selectOption('light');
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(second.locator('html')).toHaveCSS('--wallpaper-wash-tint', '230 239 250');
  await wash.scrollIntoViewIfNeeded();
  await capture(page, 'dark-theme-light-wash');
  await wash.selectOption('auto');
  await appearance.selectOption('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveCSS('--wallpaper-wash-tint', '16 20 30');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveCSS('--wallpaper-wash-tint', '230 239 250');
  await appearance.selectOption('light');
  await wash.selectOption('dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await wash.scrollIntoViewIfNeeded();
  await capture(page, 'phone');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.locator('[data-reader-section="background"] [data-reader-reset="background"]').click();
  await expect(wash).toHaveValue('auto');
  await expect(appearance).toHaveValue('light');
  await expect(second.locator('html')).toHaveAttribute('data-wallpaper-wash', 'auto');
  await expect(second.locator('html')).toHaveAttribute('data-wallpaper', 'false');
  await second.close();
  expect(writes).toEqual([]);
  expect((await (await request.get('/api/bootstrap')).json()).siteRevision).toBe(
    before.siteRevision,
  );
});

test('saved wash is applied by the production prepaint script without the reader module', async ({
  page,
}) => {
  const preview = 'data:image/png;base64,' + (await picture()).toString('base64');
  await page.addInitScript((wallpaperPreview) => {
    if (localStorage.getItem('fieldnotes-reader-v1')) return;
    localStorage.setItem(
      'fieldnotes-reader-v1',
      JSON.stringify({
        version: 1,
        theme: { appearance: 'light', wallpaperWash: 'dark' },
        wallpaper: 'local',
        wallpaperPreview,
      }),
    );
  }, preview);
  await page.route('**/site.js', (route) => route.abort());
  await page.goto('http://127.0.0.1:4174/settings/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-wash', 'dark');
  await expect(page.locator('html')).toHaveCSS('--wallpaper-wash-tint', '16 20 30');
  await expect(page.locator('html')).toHaveCSS('--wallpaper-dim', '0.35');
  await expect(
    page.getByRole('combobox', { name: 'Picture wash color', exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('fieldnotes-reader-v1')!);
    prefs.theme.wallpaperWash = 'auto';
    prefs.theme.wallpaperDim = 0;
    localStorage.setItem('fieldnotes-reader-v1', JSON.stringify(prefs));
  });
  await page.reload();
  await expect(page.locator('html')).toHaveCSS('--wallpaper-dim', '0');
  await expect
    .poll(() =>
      page
        .locator('html')
        .evaluate((node) => getComputedStyle(node).getPropertyValue('--protected-wash-light')),
    )
    .toBe('');
});

test('Studio previews and saves wallpaper wash defaults that readers can inherit and override', async ({
  page,
  request,
  browser,
}) => {
  const state = async () => (await request.get('/api/bootstrap')).json();
  const original = await state();
  const mutate = async (path: string, data: unknown) => {
    const current = await state();
    const response = await request.fetch('/api/' + path, {
      method: path === 'site' ? 'PUT' : 'POST',
      data,
      headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const build = async () => {
    const job = await mutate('jobs', { action: 'build' });
    await expect
      .poll(
        async () =>
          (await state()).jobs.find((value: { id: string; state: string }) => value.id === job.id)
            ?.state,
        { timeout: 20000 },
      )
      .toBe('succeeded');
  };
  try {
    await page.goto('/studio/#appearance');
    const wash = page.getByRole('combobox', { name: 'Wallpaper wash color', exact: true });
    const frame = page.frameLocator('iframe[title="Live appearance preview"]');
    await selectSettingsSection(page, 'wallpaper', true);
    await expect(wash).toHaveValue('auto');
    await selectSettingsSection(page, 'mode', true);
    await selectSettingsSection(page, 'mode', true);
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await selectSettingsSection(page, 'wallpaper', true);
    await selectSettingsSection(page, 'wallpaper', true);
    await page.getByRole('button', { name: 'Choose picture', exact: true }).click();
    await page.locator('.media-picker-grid button').filter({ hasText: 'coast-dusk.svg' }).click();
    await wash.selectOption('dark');
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(frame.locator('html')).toHaveAttribute('data-wallpaper-wash', 'dark');
    await expect(frame.locator('html')).toHaveCSS('--wallpaper-wash-tint', '16 20 30');
    expect((await state()).siteRevision).toBe(original.siteRevision);
    await wash.selectOption('light');
    await selectSettingsSection(page, 'mode', true);
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await selectSettingsSection(page, 'wallpaper', true);
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(frame.locator('html')).toHaveCSS('--wallpaper-wash-tint', '230 239 250');
    await wash.selectOption('auto');
    await expect(frame.locator('html')).toHaveCSS('--wallpaper-wash-tint', '16 20 30');
    await selectSettingsSection(page, 'mode', true);
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await selectSettingsSection(page, 'wallpaper', true);
    await wash.selectOption('auto');
    await page.getByRole('slider', { name: 'Wallpaper wash', exact: true }).press('Home');
    await expect(frame.locator('html')).toHaveCSS('--wallpaper-dim', '0');
    await expect
      .poll(() =>
        frame
          .locator('html')
          .evaluate((node) => getComputedStyle(node).getPropertyValue('--protected-wash-light')),
      )
      .toBe('');
    await wash.selectOption('dark');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await state()).site.theme.wallpaperWash).toBe('dark');
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-wash', 'dark');
    await page.reload();
    await expect(wash).toHaveValue('dark');
    await expect(page.getByRole('slider', { name: 'Wallpaper wash', exact: true })).toHaveValue(
      '0',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await wash.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await fs.mkdir('test-results/visuals', { recursive: true });
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-studio-wallpaper-wash.png`,
      animations: 'disabled',
    });
    await build();
    const saved = await state();
    await page.goto('/settings/');
    const readerWash = page.getByRole('combobox', { name: 'Picture wash color', exact: true });
    await expect(readerWash).toHaveValue('dark');
    await expect(page.locator('html')).toHaveCSS('--wallpaper-dim', '0');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await readerWash.selectOption('light');
    await page.reload();
    await expect(readerWash).toHaveValue('light');
    await page.locator('[data-reader-reset="background"]').click();
    await expect(readerWash).toHaveValue('dark');
    expect((await state()).siteRevision).toBe(saved.siteRevision);
    await readerWash.selectOption('light');
    await page.goto('/studio/#appearance');
    await expect(frame.locator('html')).toHaveAttribute('data-preview', 'true');
    await expect(frame.locator('html')).toHaveAttribute('data-wallpaper-wash', 'dark');
    const staticContext = await browser.newContext({ javaScriptEnabled: false });
    try {
      const staticPage = await staticContext.newPage();
      await staticPage.goto('http://127.0.0.1:4387/settings/');
      await expect(staticPage.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(staticPage.locator('html')).toHaveAttribute('data-wallpaper-wash', 'dark');
      await expect(staticPage.locator('html')).toHaveCSS('--wallpaper-wash-tint', '16 20 30');
      await expect(staticPage.locator('html')).toHaveCSS('--wallpaper-dim', '0');
    } finally {
      await staticContext.close();
    }
  } finally {
    const current = await state();
    await mutate('site', { value: original.site, revision: current.siteRevision });
    await build();
  }
});
