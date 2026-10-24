import { test, expect, type APIRequestContext } from '@playwright/test';
import { selectSettingsSection } from './settings-navigation.js';

test.use({ actionTimeout: 10000 });

async function state(request: APIRequestContext) {
  return (await request.get('/api/bootstrap')).json();
}
async function change(request: APIRequestContext, path: string, data: unknown, method = 'PUT') {
  const current = await state(request);
  const response = await request.fetch('/api/' + path, {
    method,
    data,
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function build(request: APIRequestContext) {
  const job = await change(request, 'jobs', { action: 'build' }, 'POST');
  await expect
    .poll(
      async () =>
        (await state(request)).jobs.find((value: { id: string }) => value.id === job.id)?.state,
      { timeout: 20000 },
    )
    .toBe('succeeded');
}

test('Article background tint reaches zero without reading floors changing the panel or other glass', async ({
  page,
  request,
}) => {
  const original = await state(request);
  try {
    await change(request, 'site', {
      revision: original.siteRevision,
      value: {
        ...original.site,
        theme: {
          ...original.site.theme,
          appearance: 'light',
          background: 'sky',
          backgroundImage: '/media/coast-dusk.svg',
          wallpaperDim: 0,
          glassOpacity: 0.4,
          readingOpacity: 0.5,
          focusMode: false,
          reduceTransparency: false,
          reduceMotion: true,
          contrast: {
            ...original.site.theme.contrast,
            automatic: true,
            glassFloor: 1,
            readingFloor: 1,
          },
        },
      },
    });
    await page.goto('/studio/#appearance');
    await selectSettingsSection(page, 'typography', true);
    await page.getByRole('combobox', { name: 'Preview page' }).selectOption({ label: 'Article' });
    const tint = page.getByRole('slider', { name: 'Article background tint', exact: true });
    await expect(
      page.getByRole('slider', { name: 'Minimum reading glass tint', exact: true }),
    ).toHaveCount(0);
    await tint.press('Home');
    const frame = page.frameLocator('iframe[title="Live appearance preview"]');
    await expect(frame.locator('.article-body')).toHaveCSS(
      'background-color',
      'rgba(208, 225, 247, 0)',
    );
    await selectSettingsSection(page, 'contrast', true);
    await expect(page.locator('[data-contrast-protection="light"]')).toContainText(
      'Article tint: 0%',
    );
    await expect(page.locator('[data-contrast-result="light.body"]')).toContainText(
      'Needs attention',
    );
    await expect
      .poll(() =>
        frame
          .locator('html')
          .evaluate((node) => getComputedStyle(node).getPropertyValue('--protected-reading-light')),
      )
      .toBe('');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await state(request)).site.theme.readingOpacity).toBe(0);
    await page.reload();
    await selectSettingsSection(page, 'typography', true);
    await expect(tint).toHaveValue('0');
    await build(request);
    const saved = await state(request);
    await page.goto('/settings/');
    const readerTint = page.getByRole('slider', { name: 'Article background tint', exact: true });
    const reading = page.getByRole('region', { name: 'Typography preview', exact: true });
    await expect(readerTint).toHaveValue('0');
    await expect(reading).toHaveCSS('background-color', 'rgba(208, 225, 247, 0)');
    await expect(page.locator('[data-contrast-protection="light"]')).toContainText(
      'Article tint: 0%',
    );
    await expect(page.locator('.header-inner')).toHaveAttribute('data-liquid', 'optic');
    await expect(page.locator('.header-inner')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const navigation = await page
      .locator('.header-inner')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    await readerTint.press('End');
    await expect(reading).toHaveCSS('background-color', 'rgba(208, 225, 247, 0.4)');
    await expect(page.locator('.header-inner')).toHaveCSS('background-color', navigation);
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
    await expect(reading).toHaveCSS('background-color', 'rgba(31, 44, 65, 0.6)');
    await readerTint.press('Home');
    await expect(reading).toHaveCSS('background-color', 'rgba(31, 44, 65, 0)');
    await page.reload();
    await expect(readerTint).toHaveValue('0');
    await page.goto('/blog/good-tools-get-out-of-the-way/');
    await expect(page.locator('.article-body')).toHaveCSS(
      'background-color',
      'rgba(31, 44, 65, 0)',
    );
    expect((await state(request)).siteRevision).toBe(saved.siteRevision);
  } finally {
    const current = await state(request);
    await change(request, 'site', { value: original.site, revision: current.siteRevision });
    await build(request);
  }
});

test('Studio sets complete reader defaults while personal choices and resets preserve inheritance', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(60000);
  const original = await state(request);
  const readers = await browser.newContext();
  const staticReaders = await browser.newContext({ javaScriptEnabled: false });
  try {
    await page.goto('/studio/#appearance');
    await selectSettingsSection(page, 'typography', true);
    await page.getByRole('combobox', { name: 'Preview page' }).selectOption({ label: 'Article' });
    const size = page.getByRole('slider', { name: 'Reading text size', exact: true });
    await size.press('Home');
    for (let i = 0; i < 11; i++) await size.press('ArrowRight');
    await page.getByRole('switch', { name: 'Default article focus mode', exact: true }).check();
    await selectSettingsSection(page, 'accessibility', true);
    await page.getByRole('switch', { name: /^Reduce motion/ }).check();
    await page.getByRole('switch', { name: /^Reduce transparency/ }).check();
    const frame = page.frameLocator('iframe[title="Live appearance preview"]');
    await expect(frame.locator('html')).toHaveCSS('--reader-text-scale', '1.35');
    await expect(frame.locator('html')).toHaveAttribute('data-article-focus', 'true');
    await expect(frame.locator('.site-header')).not.toBeVisible();
    await page.locator('.appearance-preview').scrollIntoViewIfNeeded();
    await frame.getByRole('button', { name: 'Exit focus', exact: true }).click();
    await expect(frame.locator('.site-header')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('fieldnotes-reader-v1'))).toBeNull();
    expect((await state(request)).siteRevision).toBe(original.siteRevision);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await state(request)).site.theme.textScale).toBe(1.35);
    await page.reload();
    await selectSettingsSection(page, 'typography', true);
    await expect(size).toHaveValue('1.35');
    await expect(
      page.getByRole('switch', { name: 'Default article focus mode', exact: true }),
    ).toBeChecked();
    await build(request);
    const saved = await state(request);
    const reader = await readers.newPage(),
      writes: string[] = [];
    reader.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
    });
    await reader.goto('http://127.0.0.1:4387/settings/');
    const focus = reader.getByRole('switch', { name: 'Article focus mode', exact: true });
    await expect(
      reader.getByRole('slider', { name: 'Reading text size', exact: true }),
    ).toHaveValue('1.35');
    await expect(focus).toBeChecked();
    await reader.goto('http://127.0.0.1:4387/blog/good-tools-get-out-of-the-way/');
    await expect(reader.locator('.site-header')).not.toBeVisible();
    await reader.getByRole('button', { name: 'Exit focus', exact: true }).click();
    await expect(reader.locator('.site-header')).toBeVisible();
    await reader.goto('http://127.0.0.1:4387/settings/');
    await expect(focus).not.toBeChecked();
    await reader.getByRole('slider', { name: 'Reading text size', exact: true }).press('End');
    await reader.getByRole('switch', { name: /^Reduce motion/ }).uncheck();
    await reader.getByRole('switch', { name: /^Reduce transparency/ }).uncheck();
    await expect(reader.locator('html')).toHaveAttribute('data-reduce-motion', 'false');
    await expect(reader.locator('html')).toHaveAttribute('data-reduce-transparency', 'false');
    await reader.reload();
    await expect(
      reader.getByRole('slider', { name: 'Reading text size', exact: true }),
    ).toHaveValue('2');
    await expect(focus).not.toBeChecked();
    await expect(reader.getByRole('switch', { name: /^Reduce motion/ })).not.toBeChecked();
    await reader.locator('[data-reader-section="reading"] [data-reader-reset]').click();
    await expect(focus).toBeChecked();
    await expect(
      reader.getByRole('slider', { name: 'Reading text size', exact: true }),
    ).toHaveValue('1.35');
    await reader.locator('[data-reader-section="glass"] [data-reader-reset]').click();
    await expect(reader.getByRole('switch', { name: /^Reduce motion/ })).toBeChecked();
    await expect(reader.getByRole('switch', { name: /^Reduce transparency/ })).toBeChecked();
    await focus.uncheck();
    await reader.getByRole('slider', { name: 'Reading text size', exact: true }).press('End');
    const prefs = await reader.evaluate(() =>
      JSON.parse(localStorage.getItem('fieldnotes-reader-v1')!),
    );
    const early = await browser.newContext();
    try {
      await early.addInitScript(
        (prefs) => localStorage.setItem('fieldnotes-reader-v1', JSON.stringify(prefs)),
        prefs,
      );
      const prepaint = await early.newPage();
      await prepaint.route('**/site.js', (route) => route.abort());
      await prepaint.goto('http://127.0.0.1:4387/blog/good-tools-get-out-of-the-way/');
      await expect(prepaint.locator('html')).toHaveCSS('--reader-text-scale', '2');
      await expect(prepaint.locator('html')).toHaveAttribute('data-article-focus', 'false');
    } finally {
      await early.close();
    }
    await reader.getByRole('button', { name: 'Reset everything', exact: true }).click();
    await expect(focus).toBeChecked();
    await expect(
      reader.getByRole('slider', { name: 'Reading text size', exact: true }),
    ).toHaveValue('1.35');
    expect(writes).toEqual([]);
    expect((await state(request)).siteRevision).toBe(saved.siteRevision);
    const staticPage = await staticReaders.newPage();
    await staticPage.goto('http://127.0.0.1:4387/blog/good-tools-get-out-of-the-way/');
    await expect(staticPage.locator('html')).toHaveCSS('--reader-text-scale', '1.35');
    await expect(staticPage.locator('.site-header')).toBeVisible();
  } finally {
    await readers.close();
    await staticReaders.close();
    const current = await state(request);
    await change(request, 'site', { value: original.site, revision: current.siteRevision });
    await build(request);
  }
});
