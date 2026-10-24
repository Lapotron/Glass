import { test, expect, type APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { selectSettingsSection } from './settings-navigation.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp: typeof import('sharp').default = require('sharp');
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;

async function state(request: APIRequestContext) {
  return (await request.get('/api/bootstrap')).json();
}
async function restore(request: APIRequestContext, site: unknown) {
  const current = await state(request);
  const response = await request.put('/api/site', {
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data: { value: site, revision: current.siteRevision },
  });
  expect(response.ok()).toBe(true);
}
async function build(request: APIRequestContext) {
  const current = await state(request);
  const response = await request.post('/api/jobs', {
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data: { action: 'build' },
  });
  expect(response.ok()).toBe(true);
  const job = await response.json();
  await waitForBuild(request, job.id);
}
async function waitForBuild(request: APIRequestContext, id: string) {
  await expect
    .poll(
      async () => {
        const jobs = await (await request.get('/api/jobs')).json();
        return jobs.find((value: { id: string }) => value.id === id)?.state;
      },
      { timeout: 20000 },
    )
    .toBe('succeeded');
}

test('favicon crop uploads, branding controls, unsaved preview, save and generated icons work together', async ({
  page,
  request,
}) => {
  const original = await state(request),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/studio/#settings');
    await selectSettingsSection(page, 'icons');
    await page.getByRole('button', { name: 'Choose favicon', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose from your media', exact: true });
    // Existing SVG illustrations remain viewable, but are not accepted as uploaded brand artwork.
    await expect(picker.locator('.media-picker-grid img[src$=".svg"]')).toHaveCount(0);
    const image = await sharp({
      create: { width: 800, height: 600, channels: 4, background: '#3569be' },
    })
      .png()
      .toBuffer();
    await picker
      .locator('input[type=file]')
      .setInputFiles({ name: 'branding-review.png', mimeType: 'image/png', buffer: image });
    const crop = page.getByRole('dialog', { name: 'Prepare image', exact: true });
    await expect(crop.locator('.crop-selection')).toBeVisible();
    await crop.getByRole('combobox', { name: 'Crop ratio', exact: true }).selectOption('1');
    await crop.getByLabel('Output width', { exact: true }).fill('512');
    await crop.getByLabel('Output width', { exact: true }).blur();
    await expect(crop.getByLabel('Output height', { exact: true })).toHaveValue('512');
    await crop.getByRole('button', { name: 'Apply & upload', exact: true }).click();
    await expect(crop).toHaveCount(0);
    await expect(picker).toHaveCount(0);
    const favicon = page.getByRole('group', { name: 'Favicon', exact: true }).locator('img');
    await expect(favicon).toHaveAttribute('src', /\/media\/branding-review-.*\.webp$/);
    const selected = await favicon.getAttribute('src');
    await selectSettingsSection(page, 'branding');
    await page.getByRole('button', { name: 'Choose logo', exact: true }).click();
    await picker
      .locator('button')
      .filter({ has: page.locator(`img[src="${selected}"]`) })
      .click();
    await selectSettingsSection(page, 'browser');
    await page.getByLabel('Short name', { exact: true }).fill('Notes');
    await page
      .getByRole('combobox', { name: 'Shortcut display', exact: true })
      .selectOption('standalone');
    await selectSettingsSection(page, 'branding');
    await page.getByRole('switch', { name: 'Show the accent period', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Preview site', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Site preview', exact: true });
    const frame = page.frameLocator('iframe[title="Site settings preview"]');
    await expect(frame.locator('.site-header .brand-mark-image img')).toHaveAttribute(
      'src',
      selected!,
    );
    await expect(frame.locator('.brand-period')).toHaveCount(0);
    await expect(frame.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    );
    await expect(frame.locator('link[rel="icon"]')).toHaveAttribute('href', selected!);
    expect((await state(request)).site.branding.favicon).toBe('');
    await modal.getByRole('button', { name: 'Close Site preview', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await state(request)).site.branding.favicon).toBe(selected);
    await page.reload();
    await selectSettingsSection(page, 'browser');
    await expect(page.getByLabel('Short name', { exact: true })).toHaveValue('Notes');
    await selectSettingsSection(page, 'icons');
    await expect(favicon).toHaveAttribute('src', selected!);
    await page.goto('/studio/#builds');
    const started = page.waitForResponse(
      (response) => response.url().endsWith('/api/jobs') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Build site', exact: true }).click();
    await waitForBuild(request, (await (await started).json()).id);
    await expect(page.locator('.build-job').first().locator('.job-status')).toHaveText('Complete', {
      timeout: 20000,
    });
    const manifestResponse = await request.get('/site.webmanifest');
    expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
    const manifest = await manifestResponse.json();
    expect(manifest).toMatchObject({ short_name: 'Notes', display: 'standalone' });
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
    expect((await request.get('/favicon.ico')).headers()['content-type']).toContain('image/x-icon');
    const touch = await sharp(await (await request.get('/apple-touch-icon.png')).body()).metadata();
    expect([touch.width, touch.height]).toEqual([180, 180]);
    await page.goto('/');
    await expect(page.locator('.site-header .brand-mark-image img')).toHaveAttribute(
      'src',
      /\/assets\/brand-logo.png\?v=/,
    );
    await expect(page.locator('.brand-period')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await restore(request, original.site);
    await build(request);
  }
});

test('metadata, footer, navigation and feeds persist through tabs and compile into public pages', async ({
  page,
  request,
}) => {
  const original = await state(request);
  try {
    await page.goto('/studio/#settings');
    await selectSettingsSection(page, 'languages');
    await page.getByLabel('Default content language', { exact: true }).selectOption('zh-CN');
    await selectSettingsSection(page, 'metadata');
    await page.getByLabel('Home page title', { exact: true }).fill('A quiet notebook');
    await page.getByLabel('Page title template', { exact: true }).fill('{title} | {site}');
    await selectSettingsSection(page, 'sharing');
    await page.getByLabel('X / Twitter site handle', { exact: true }).fill('@notebook');
    await selectSettingsSection(page, 'indexing');
    await page.getByLabel('Google verification token', { exact: true }).fill('test_abc-123');
    await selectSettingsSection(page, 'footer');
    await page.getByLabel('Footer tagline', { exact: true }).fill('Room for another thought.');
    await page.getByLabel('Copyright name', { exact: true }).fill('Notebook owner');
    await page.getByLabel('Copyright start year', { exact: true }).fill('2020');
    await page.getByRole('button', { name: 'Add footer link', exact: true }).click();
    await page.getByLabel('Link 1 label', { exact: true }).fill('Our project');
    await page.getByLabel('Link 1 address', { exact: true }).fill('https://project.example.org');
    await selectSettingsSection(page, 'feeds');
    await page.getByRole('switch', { name: 'RSS feed', exact: true }).uncheck();
    await page.getByRole('switch', { name: 'Atom feed', exact: true }).check();
    await page.getByRole('switch', { name: 'JSON feed', exact: true }).check();
    await page.getByLabel('Feed title', { exact: true }).fill('Notebook updates');
    await page.getByLabel('Maximum feed entries', { exact: true }).fill('2');
    await selectSettingsSection(page, 'navigation');
    await page.getByRole('switch', { name: 'Show search', exact: true }).uncheck();
    await page.getByRole('switch', { name: 'Show reader settings', exact: true }).uncheck();
    await selectSettingsSection(page, 'metadata');
    await expect(page.getByLabel('Home page title', { exact: true })).toHaveValue(
      'A quiet notebook',
    );
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect
      .poll(async () => (await state(request)).site.metadata.homeTitle)
      .toBe('A quiet notebook');
    await build(request);
    await page.goto('/');
    await expect(page).toHaveTitle('A quiet notebook');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('data-content-language', 'zh-CN');
    await expect(page.locator('meta[name="google-site-verification"]')).toHaveAttribute(
      'content',
      'test_abc-123',
    );
    await expect(page.getByRole('button', { name: 'Search this notebook' })).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+k');
    expect(
      await page.evaluate(() => {
        const shortcut = new KeyboardEvent('keydown', {
          key: 'k',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(shortcut);
        return shortcut.defaultPrevented;
      }),
    ).toBe(false);
    await expect(page.locator('#search-dialog')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Reader settings', exact: true })).toHaveCount(0);
    const footer = page.locator('.site-footer');
    await expect(footer).toContainText('Room for another thought.');
    await expect(footer).toContainText('2020–');
    await expect(footer.getByRole('link', { name: 'Our project', exact: true })).toHaveAttribute(
      'target',
      '_blank',
    );
    await expect(footer.getByRole('link', { name: 'RSS feed', exact: true })).toHaveCount(0);
    await expect(footer.getByRole('link', { name: 'Atom feed', exact: true })).toBeVisible();
    await expect(page.locator('link[rel=alternate]')).toHaveCount(2);
    const atom = await (await request.get('/atom.xml')).text();
    expect(
      await page.evaluate(
        (xml) =>
          new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('parsererror')
            .length,
        atom,
      ),
    ).toBe(0);
    const feed = await (await request.get('/feed.json')).json();
    expect(feed.title).toBe('Notebook updates');
    expect(feed.items).toHaveLength(2);
    expect((await request.get('/feed.xml')).status()).toBe(404);
    await page.goto('/blog/good-tools-get-out-of-the-way/');
    await expect(page).toHaveTitle('Good tools get out of the way | Fieldnotes');
    await page.getByRole('button', { name: 'Change appearance', exact: true }).click();
    await expect(page.locator('meta[data-theme-color=dark]')).toHaveAttribute('media', 'all');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await fs.mkdir('test-results/visuals', { recursive: true });
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-configured-footer-mobile.png`,
      fullPage: true,
    });
  } finally {
    await restore(request, original.site);
    await build(request);
  }
});

test('settings controls keep tidy glass layouts and accessible labels in both themes and on phones', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/studio/#settings');
  await expect(page.locator('.settings-section-rail a[href="#settings/general"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
  await fs.mkdir('test-results/visuals', { recursive: true });
  for (const theme of ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme)
      await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    for (const name of [
      'Content',
      'Branding',
      'Metadata & sharing',
      'Footer',
      'Feeds',
      'Navigation',
    ]) {
      await selectSettingsSection(
        page,
        (
          {
            Content: 'collections',
            Branding: 'branding',
            'Metadata & sharing': 'metadata',
            Footer: 'footer',
            Feeds: 'feeds',
            Navigation: 'navigation',
            'Local Studio': 'local',
          } as Record<string, string>
        )[name],
      );
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation instanceof CSSTransition)
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const audit = await new AxeBuilder({ page }).include('.settings-page').analyze();
      expect(
        audit.violations.filter((violation) =>
          ['serious', 'critical'].includes(violation.impact || ''),
        ),
      ).toEqual([]);
    }
    await selectSettingsSection(page, 'branding');
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-branding-${theme}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of [
    'Content',
    'Branding',
    'Metadata & sharing',
    'Footer',
    'Feeds',
    'Local Studio',
  ]) {
    await selectSettingsSection(
      page,
      (
        {
          Content: 'collections',
          Branding: 'branding',
          'Metadata & sharing': 'metadata',
          Footer: 'footer',
          Feeds: 'feeds',
          Navigation: 'navigation',
          'Local Studio': 'local',
        } as Record<string, string>
      )[name],
    );
    // Resize and optical layers settle on the next rendering frame in Chromium.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(391);
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      overflow: [...document.querySelectorAll('body *')]
        .map((node) => ({
          className: node.getAttribute('class'),
          tag: node.tagName,
          left: node.getBoundingClientRect().left,
          right: node.getBoundingClientRect().right,
        }))
        .filter((node) => node.left >= 0 && node.right > innerWidth + 1)
        .slice(0, 15),
    }));
    expect(geometry.width, JSON.stringify({ name, ...geometry })).toBeLessThanOrEqual(
      geometry.viewport + 1,
    );
  }
  await selectSettingsSection(page, 'footer');
  await page.getByRole('button', { name: 'Add footer link', exact: true }).click();
  await expect(page.getByLabel('Link 1 address', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-footer-settings-mobile.png`,
    fullPage: true,
  });
  // Clear the reversible local draft before the test exits.
  await page.getByRole('button', { name: 'Remove link 1', exact: true }).click();
  expect(errors).toEqual([]);
});

test('archive routes have no visible archive heading while retaining filters and screen-reader titles', async ({
  page,
}) => {
  for (const route of ['/archive/', '/blog/', '/lab/', '/tags/design/']) {
    await page.goto(route);
    await expect(page.locator('.archive-heading')).toHaveCount(0);
    await expect(page.locator('#main > header, #main > .page-heading')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveClass('sr-only');
    await expect(
      page.locator('#main a[href^="/blog/"], #main a[href^="/lab/"]').first(),
    ).toBeVisible();
  }
});
