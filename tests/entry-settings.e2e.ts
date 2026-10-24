import { selectSettingsSection } from './settings-navigation.js';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';

const state = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const current = await state(request);
  const response = await request.fetch('/api/' + path, {
    method,
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function build(request: APIRequestContext) {
  const job = await mutate(request, 'jobs', 'POST', { action: 'build' });
  await expect
    .poll(
      async () => (await state(request)).jobs.find((value: any) => value.id === job.id)?.state,
      { timeout: 30000 },
    )
    .toBe('succeeded');
}
async function shot(page: Page, name: string) {
  await page.locator('.entry-settings-workspace').evaluate(async (node) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await Promise.allSettled(
      node
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    );
  });
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({ path: `test-results/visuals/${test.info().project.name}-${name}.png` });
}
const overflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true,
  );

test('article settings mode preserves the editor, saves overrides, previews and opens the cover viewer', async ({
  page,
  request,
}) => {
  test.setTimeout(100000);
  const title = `Settings specimen ${test.info().project.name}`;
  const created = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title,
    slug: `settings-${test.info().project.name}`,
  });
  let accepted: any;
  try {
    await page.goto('/studio/#writing');
    await page.locator('.managed-entry-open').filter({ hasText: title }).click();
    await expect(page.locator('.cm-editor')).toBeVisible();
    const width = (await page.locator('.source-pane').boundingBox())!.width;
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const sheet = page.getByRole('region', { name: 'Entry settings', exact: true });
    await expect(sheet.getByRole('tab')).toHaveCount(6);
    await expect(sheet.getByRole('tab', { name: 'Mathematics', exact: true })).toBeVisible();
    await expect(page.locator('.source-pane')).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Entry settings' })).toHaveCount(0);
    const workspace = (await page.locator('.editor-workspace').boundingBox())!;
    expect((await sheet.boundingBox())!.width).toBeGreaterThan(workspace.width - 4);
    await sheet.getByLabel('Publication status', { exact: true }).selectOption('published');
    await sheet.getByLabel('Updated date', { exact: true }).fill('2026-10-20');
    await sheet.getByRole('tab', { name: 'Cover', exact: true }).click();
    await sheet.getByLabel('Cover image', { exact: true }).fill('/media/coast-dawn.svg');
    await sheet.getByLabel('Cover alt text', { exact: true }).fill('Sunrise along the coast');
    await sheet.getByLabel('Cover caption', { exact: true }).fill('A quiet place to start.');
    await sheet.getByLabel('Cover aspect ratio', { exact: true }).selectOption('wide');
    const trigger = sheet.getByRole('link', { name: 'View cover image', exact: true });
    await trigger.click();
    const viewer = page.getByRole('dialog', { name: 'Image viewer', exact: true });
    await expect(viewer.locator('.viewer-toolbar')).toHaveCount(1);
    await expect(viewer.locator('.viewer-caption')).toContainText('A quiet place to start.');
    await viewer.getByRole('button', { name: 'Close image viewer', exact: true }).click();
    await expect(sheet).toBeVisible();
    await expect(trigger).toBeFocused();
    await shot(page, 'article-settings-cover-light');
    await sheet.getByRole('button', { name: 'Replace cover', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose from your media', exact: true });
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('tab', { name: 'Reading', exact: true }).click();
    await sheet.getByLabel('Reading progress', { exact: true }).selectOption('false');
    await sheet.getByLabel('Code line numbers', { exact: true }).selectOption('true');
    await sheet.getByLabel('Related articles', { exact: true }).selectOption('0');
    await sheet.getByLabel('Reading typeface', { exact: true }).selectOption('serif');
    const readingWidth = sheet.getByRole('slider', { name: /Reading width/ });
    await readingWidth.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
    await sheet.getByRole('tab', { name: 'Discussion', exact: true }).click();
    await sheet.getByRole('switch', { name: 'Article conversation', exact: true }).uncheck();
    await sheet.getByRole('switch', { name: 'Markdown discussion blocks', exact: true }).uncheck();
    await expect(
      sheet.getByRole('switch', { name: 'Line annotations', exact: true }),
    ).toBeChecked();
    await sheet.getByRole('tab', { name: 'Sharing', exact: true }).click();
    await sheet.getByLabel('Sharing title', { exact: true }).fill('A custom search title');
    await sheet
      .getByLabel('Sharing description', { exact: true })
      .fill('A custom search description.');
    await sheet.getByLabel('Search engine indexing', { exact: true }).selectOption('noindex');
    await expect(sheet.locator('.entry-sharing-preview')).toContainText('A custom search title');
    await expect
      .poll(
        async () =>
          (await state(request)).entries.find((e: any) => e.id === created.id)?.seo?.title,
      )
      .toBe('A custom search title');
    await expect(sheet.getByRole('status').last()).toContainText('All changes saved');
    accepted = (await state(request)).entries.find((e: any) => e.id === created.id);
    expect(accepted.reading).toMatchObject({
      progress: false,
      codeLineNumbers: true,
      relatedCount: 0,
    });
    expect(accepted.typography).toMatchObject({ fontFamily: 'serif', articleWidth: 720 });
    await sheet.getByRole('button', { name: 'Back to editor', exact: true }).click();
    expect((await page.locator('.source-pane').boundingBox())!.width).toBe(width);
    const frame = page.frameLocator('iframe[title="Live article preview"]');
    await expect(frame.locator('.article-cover')).toHaveAttribute('alt', 'Sunrise along the coast');
    await expect
      .poll(() =>
        frame
          .locator('html')
          .evaluate((node) => getComputedStyle(node).getPropertyValue('--article-width')),
      )
      .toBe('720px');
    await expect(frame.locator('.article-body')).toHaveAttribute('data-code-lines', 'true');
    const previewCoverBox = (await frame.locator('.article-cover').boundingBox())!;
    expect(previewCoverBox.width / previewCoverBox.height).toBeCloseTo(16 / 9, 2);
    await page.reload();
    await page.locator('.managed-entry-open').filter({ hasText: title }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await sheet.getByRole('tab', { name: 'Reading', exact: true }).click();
    await expect(sheet.getByLabel('Reading typeface', { exact: true })).toHaveValue('serif');
    await sheet.getByRole('button', { name: 'Back to editor', exact: true }).click();
    if ((await page.locator('html').getAttribute('data-theme')) !== 'dark')
      await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await sheet.getByRole('tab', { name: 'Reading', exact: true }).click();
    await shot(page, 'article-settings-reading-dark');
    await sheet.getByRole('button', { name: 'Use site typography', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await state(request)).entries.find((e: any) => e.id === created.id)?.typography,
      )
      .toBeUndefined();
    await sheet.getByRole('button', { name: 'Back to editor', exact: true }).click();
    await build(request);
    await page.goto(`/blog/settings-${test.info().project.name}/`);
    await expect(page).toHaveTitle(/A custom search title/);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const publicCover = page.getByRole('link', {
      name: 'View cover image: Sunrise along the coast',
      exact: true,
    });
    const publicCoverBox = (await publicCover.locator('img').boundingBox())!;
    expect(publicCoverBox.width / publicCoverBox.height).toBeCloseTo(16 / 9, 2);
    await publicCover.click();
    await expect(viewer.locator('.viewer-toolbar')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(publicCover).toBeFocused();
    await overflow(page);
  } finally {
    const current = (await state(request)).entries.find((e: any) => e.id === created.id);
    if (current)
      await mutate(request, 'content/' + created.id, 'DELETE', { revision: current.revision });
    await build(request);
  }
});

test('settings mode stays usable at 320px and keyboard tabs preserve drafts and invalid settings', async ({
  page,
  request,
}) => {
  const created = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Narrow settings specimen',
    slug: `narrow-settings-${test.info().project.name}`,
  });
  try {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/studio/#writing');
    await page
      .locator('.managed-entry-open')
      .filter({ hasText: 'Narrow settings specimen' })
      .click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const sheet = page.getByRole('region', { name: 'Entry settings', exact: true });
    const box = (await sheet.boundingBox())!,
      workspace = (await page.locator('.editor-workspace').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(workspace.x);
    expect(box.x + box.width).toBeLessThanOrEqual(workspace.x + workspace.width);
    expect(box.height).toBeGreaterThan(300);
    await expect(page.getByRole('group', { name: 'Editor view' }).getByRole('button')).toHaveText([
      'Write',
      'Preview',
      'Settings',
    ]);
    await expect(sheet.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal');
    await sheet.getByLabel('URL slug', { exact: true }).fill('invalid/path');
    await sheet.getByRole('tab', { name: 'General', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(sheet.getByRole('tab', { name: 'Cover', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('End');
    await expect(sheet.getByRole('tab', { name: 'Sharing', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await sheet
      .getByLabel('Sharing description', { exact: true })
      .fill('Keep this draft while switching tabs.');
    await sheet.getByRole('button', { name: 'Back to editor', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(sheet.getByRole('tab', { name: 'Sharing' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await sheet.getByRole('tab', { name: 'General', exact: true }).click();
    await expect(sheet.getByLabel('URL slug', { exact: true })).toHaveValue('invalid/path');
    await sheet.getByLabel('URL slug', { exact: true }).fill(created.slug);
    await sheet.getByRole('tab', { name: 'Sharing', exact: true }).click();
    await expect(sheet.getByLabel('Sharing description', { exact: true })).toHaveValue(
      'Keep this draft while switching tabs.',
    );
    await expect
      .poll(
        async () =>
          (await state(request)).entries.find((e: any) => e.id === created.id)?.seo?.description,
      )
      .toBe('Keep this draft while switching tabs.');
    await shot(page, 'article-settings-mobile');
    await overflow(page);
  } finally {
    const current = (await state(request)).entries.find((e: any) => e.id === created.id);
    if (current)
      await mutate(request, 'content/' + created.id, 'DELETE', { revision: current.revision });
  }
});

test('comparison has a compact visible divider with a generous keyboard and pointer target', async ({
  page,
}) => {
  await page.goto('/blog/component-showcase/');
  const handle = page.getByRole('slider', { name: 'Comparison position', exact: true });
  await handle.scrollIntoViewIfNeeded();
  await expect(handle).toHaveAttribute('aria-disabled', 'false');
  await expect(handle).toHaveCSS('width', '44px');
  await expect(handle.locator('.compare-grip')).toHaveCSS('width', '28px');
  await expect
    .poll(() => handle.evaluate((node) => getComputedStyle(node, '::before').width))
    .toBe('1px');
  await handle.focus();
  await page.keyboard.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', '100');
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuenow', '0');
  const box = (await page.locator('.comparison').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '75');
  await expect(page.locator('dialog.media-viewer')).toHaveCount(0);
});

test('Life naming and path settings update preview, navigation, albums and retained URLs', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const original = await state(request);
  try {
    await page.goto('/studio/#settings');
    await selectSettingsSection(page, 'collections');
    const life = page.locator('[data-collection-kind="life"]');
    await life.getByLabel('Collection name', { exact: true }).fill('Gallery');
    await life.getByLabel('Singular name', { exact: true }).fill('Photograph');
    await life.getByLabel('Public path', { exact: true }).fill('/gallery/');
    await page.getByRole('button', { name: 'Preview site', exact: true }).click();
    const preview = page.frameLocator('iframe[title="Site settings preview"]');
    await expect(preview.locator('.site-nav a[href="/gallery/"]')).toHaveText('Gallery');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect
      .poll(async () => (await state(request)).site.collections.life.path)
      .toBe('gallery');
    await page.getByRole('button', { name: 'Gallery', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add a photograph', exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: /^Edit album / })
      .first()
      .click();
    await expect(page.locator('.album-path')).toContainText('/gallery/');
    await page.keyboard.press('Escape');
    await build(request);
    await page.goto('/life/');
    await expect(page).toHaveURL(/\/gallery\/$/);
    await expect(page.locator('.site-nav a[aria-current="page"]')).toHaveText('Gallery');
    await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
    await page.locator('.life-album-card').first().click();
    await expect(page).toHaveURL(/\/gallery\/[^/]+\/$/);
    await expect(page.getByRole('link', { name: 'Back to Gallery', exact: true })).toHaveAttribute(
      'href',
      '/gallery/',
    );
  } finally {
    const current = await state(request);
    await mutate(request, 'site', 'PUT', { value: original.site, revision: current.siteRevision });
    await build(request);
  }
});
