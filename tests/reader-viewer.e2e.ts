import { selectSettingsSection } from './settings-navigation.js';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { cameraPicture } from './fixtures/camera.js';
const require = createRequire(import.meta.url);
const sharp: typeof import('sharp').default = require('sharp');
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;
const session = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const state = await session(request);
  const response = await request.fetch('/api/' + path, {
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
      async () => (await session(request)).jobs.find((value: any) => value.id === job.id)?.state,
      { timeout: 20000 },
    )
    .toBe('succeeded');
}
async function screenshot(page: Page, name: string) {
  await page.waitForFunction(() => !document.documentElement.matches(':active-view-transition'));
  if (await page.locator('.site-main').count())
    await expect
      .poll(() =>
        page.locator('html').evaluate((node) => getComputedStyle(node, '::before').opacity),
      )
      .toBe('0');
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: 'test-results/visuals/' + test.info().project.name + '-' + name + '.png',
  });
}
async function cameraVisible(page: Page) {
  const point = await page.locator('dialog.media-viewer img.pswp__img').evaluateAll((nodes) => {
    const image = nodes.find((node) => {
      const r = node.getBoundingClientRect();
      return (
        (node as HTMLImageElement).complete &&
        r.width > 1 &&
        r.left >= 0 &&
        r.left < innerWidth - 40
      );
    });
    if (!image) return null;
    const r = image.getBoundingClientRect();
    return {
      x: Math.round(Math.min(innerWidth - 3, r.left + r.width / 2)),
      y: Math.round(Math.min(innerHeight - 3, r.top + r.height / 2)),
    };
  });
  if (!point) return false;
  const pixels = await sharp(await page.screenshot({ clip: { ...point, width: 2, height: 2 } }))
    .removeAlpha()
    .raw()
    .toBuffer();
  return pixels[0] > 40 && pixels[0] < 90 && pixels[1] > 70 && pixels[2] > 100;
}
async function range(page: Page, name: string, value: string) {
  await page.getByRole('slider', { name, exact: true }).evaluate((node, value) => {
    (node as HTMLInputElement).value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function scaleReadingText(page: Page) {
  await range(page, 'Reading text size', '1');
  const initialHeading = await page
    .locator('#reader-preview-reading h2:not(.sr-only)')
    .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  await range(page, 'Reading text size', '1.3');
  await expect
    .poll(() =>
      page
        .locator('#reader-preview-reading h2:not(.sr-only)')
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    )
    .toBeGreaterThan(initialHeading * 1.29);
}

test('reader settings personalize this browser, retain a local picture, synchronize tabs and reset cleanly', async ({
  page,
  context,
  request,
}) => {
  const before = await session(request),
    writes: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.method() !== 'HEAD') writes.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const gear = page.getByRole('link', { name: 'Reader settings', exact: true });
  await expect(gear.locator('svg')).toBeVisible();
  await gear.click();
  await expect(page).toHaveURL(/\/settings\/$/);
  await expect(page.locator('.site-nav a')).toHaveText([
    'Home',
    'Archive',
    'Projects',
    'Life',
    'About',
  ]);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  await expect(page.getByRole('combobox', { name: 'Appearance', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
  await page.getByRole('combobox', { name: 'Atmosphere', exact: true }).selectOption('sand');
  await page.getByRole('combobox', { name: 'Reading typeface', exact: true }).selectOption('serif');
  await scaleReadingText(page);
  await range(page, 'Glass blur', '22');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('--reader-text-scale', '1.3');
  await expect(page.locator('html')).toHaveCSS('--glass-blur', '22px');
  await screenshot(page, 'reader-settings-dark');
  const second = await context.newPage();
  await second.goto('/about/');
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Choose a background picture', { exact: true }).setInputFiles({
    name: 'reader-picture.jpg',
    mimeType: 'image/jpeg',
    buffer: await cameraPicture(),
  });
  await expect(page.locator('[data-reader-status]')).toHaveText('Saved in this browser');
  await expect(page.locator('[data-reader-picture] img')).toBeVisible();
  await expect
    .poll(() =>
      page.locator('html').evaluate((node) => node.getAttribute('data-reader-wallpaper') || ''),
    )
    .toMatch(/^blob:/);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'true');
  await expect
    .poll(() =>
      page.locator('html').evaluate((node) => node.getAttribute('data-reader-wallpaper') || ''),
    )
    .toMatch(/^blob:/);
  await page
    .getByLabel('Choose a background picture', { exact: true })
    .setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.locator('[data-reader-status]')).toContainText('Choose a JPEG');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/');
  await scaleReadingText(page);
  await screenshot(page, 'reader-settings-mobile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Reset everything', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('--reader-text-scale', '1');
  await expect(page.getByRole('combobox', { name: 'Reading typeface', exact: true })).toHaveValue(
    before.site.theme.fontFamily,
  );
  await expect(second.locator('html')).toHaveAttribute(
    'data-theme',
    before.site.theme.appearance === 'dark' ? 'dark' : 'light',
  );
  await second.close();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  expect((await session(request)).siteRevision).toBe(before.siteRevision);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('reader controls honor system preferences and remain usable when browser storage is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'setItem', {
      value: () => {
        throw new DOMException('Storage unavailable');
      },
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('/settings/');
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('switch', { name: /Reduce transparency/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-glass-renderer', 'solid');
  await expect(page.locator('[data-reader-status]')).toContainText(
    'Browser storage is unavailable',
  );
  await range(page, 'Interface scale', '1.15');
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await screenshot(page, 'reader-settings-solid-320');
});

async function alignment(page: Page) {
  return page.locator('.cm-editor').evaluate((editor) => {
    const source = [...editor.querySelectorAll<HTMLElement>('.cm-content > .cm-line')];
    const numbers = [
      ...editor.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement'),
    ].filter((node) => node.style.visibility !== 'hidden');
    const viewport = editor.querySelector('.cm-scroller')!.getBoundingClientRect();
    return numbers
      .filter((number) => {
        const rect = number.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
      })
      .map((number) => ({
        delta: Math.min(
          ...source.map((line) =>
            Math.abs(line.getBoundingClientRect().top - number.getBoundingClientRect().top),
          ),
        ),
        number: number.textContent,
      }));
  });
}
test('Markdown source line numbers align through wrapping, scrolling, font scales and both shared editors', async ({
  page,
  request,
}) => {
  const before = await session(request),
    article = before.entries.find((entry: any) => entry.kind === 'posts');
  const story = Array.from({ length: 140 }, (_, i) =>
    i % 9 === 0
      ? ('Line ' + (i + 1) + ' keeps a careful observation. 中文段落也应该与行号对齐。 ').repeat(4)
      : i % 7 === 0
        ? ''
        : 'const observation' + i + ' = ' + i + ';',
  ).join('\n');
  try {
    await mutate(request, 'pages/about', 'PUT', { body: story, revision: before.about.revision });
    await page.goto('/studio/#about');
    await expect(page.locator('.cm-line').first()).toBeVisible();
    for (const scale of ['0.9', '1', '1.15']) {
      await page
        .locator('html')
        .evaluate(
          (node, scale) => (node as HTMLElement).style.setProperty('--font-scale', scale),
          scale,
        );
      await expect
        .poll(async () => Math.max(...(await alignment(page)).map((row) => row.delta)))
        .toBeLessThan(1);
      await page.locator('.cm-scroller').evaluate((node) => (node.scrollTop = 900));
      await expect
        .poll(async () => Math.max(...(await alignment(page)).map((row) => row.delta)))
        .toBeLessThan(1);
      await page.locator('.cm-scroller').evaluate((node) => (node.scrollTop = 0));
    }
    await screenshot(page, 'editor-aligned-about');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => Math.max(...(await alignment(page)).map((row) => row.delta)))
      .toBeLessThan(1);
    await page.goto('/studio/#writing');
    await page.getByRole('button', { name: article.title, exact: false }).first().click();
    await expect(page.locator('.cm-line').first()).toBeVisible();
    await expect
      .poll(async () => Math.max(...(await alignment(page)).map((row) => row.delta)))
      .toBeLessThan(1);
    await screenshot(page, 'editor-aligned-post-mobile');
  } finally {
    const now = await session(request);
    await mutate(request, 'pages/about', 'PUT', {
      body: before.about.body,
      revision: now.about.revision,
    });
  }
});

test('Write mode keeps source history and usable tools across themes, scales and narrow screens', async ({
  page,
  request,
}) => {
  test.setTimeout(75000);
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'A quiet writing canvas',
    slug: `writing-canvas-${test.info().project.name}`,
  });
  const story = [
    '## A place to think',
    '',
    'A [reference](https://example.com/notes), **strong words**, and a little `code`.',
    '',
    ...Array.from({ length: 140 }, (_, i) =>
      i % 5 === 0
        ? `Observation ${i + 1}. 中文段落和换行应该保留清楚的行号。 `.repeat(5)
        : `A small observation, number ${i + 1}.`,
    ),
    '',
  ].join('\n');
  try {
    await mutate(request, 'content/' + entry.id, 'PUT', {
      metadata: { ...entry, summary: 'Space for the next idea, with every tool close at hand.' },
      body: story,
      revision: entry.revision,
    });
    await page.goto('/studio/#writing');
    await page.locator('.managed-entry-open').filter({ hasText: entry.title }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await expect(source).toBeVisible();
    const original = await page.locator('.cm-editor').elementHandle();
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    const assistanceHeight = (await page.locator('.editor-assistance').boundingBox())!.height;
    expect((await page.locator('.editor-source-tools').boundingBox())!.height).toBe(
      assistanceHeight,
    );
    await page.locator('.editor-syntax-status').focus();
    await page.keyboard.press('Tab');
    await expect(
      test.info().project.name === 'webkit'
        ? page.getByRole('combobox', { name: 'Publication status', exact: true })
        : page.getByRole('button', { name: 'Insert bold text', exact: true }),
    ).toBeFocused();
    await source.focus();
    await source.press('ControlOrMeta+a');
    await source.press('ArrowRight');
    await page.keyboard.insertText('\nAn edit retained across modes.');
    await expect(source).toContainText('An edit retained across modes.');
    await expect
      .poll(async () => (await session(request)).entries.find((e: any) => e.id === entry.id)?.body)
      .toContain('An edit retained across modes.');
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    expect(
      await page.locator('.cm-editor').evaluate((node, original) => node === original, original),
    ).toBe(true);
    await source.press('ControlOrMeta+z');
    await expect
      .poll(async () => (await session(request)).entries.find((e: any) => e.id === entry.id)?.body)
      .toBe(story);

    for (const scale of ['0.9', '1', '1.15']) {
      await page
        .locator('html')
        .evaluate(
          (node, value) => (node as HTMLElement).style.setProperty('--font-scale', value),
          scale,
        );
      await page.locator('.cm-scroller').evaluate((node) => (node.scrollTop = 900));
      await expect
        .poll(async () => Math.max(...(await alignment(page)).map((row) => row.delta)))
        .toBeLessThan(1);
    }
    await page
      .locator('html')
      .evaluate((node) => (node as HTMLElement).style.removeProperty('--font-scale'));
    await page.locator('.cm-scroller').evaluate((node) => (node.scrollTop = 0));
    await screenshot(page, 'writing-canvas-light');
    if ((await page.locator('html').getAttribute('data-theme')) !== 'dark')
      await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('.editor-workspace').evaluate(async (node) => {
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
    await screenshot(page, 'writing-canvas-dark');
    const audit = await new AxeBuilder({ page }).include('.editor-workspace').analyze();
    expect(audit.violations).toEqual([]);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page
        .locator('html')
        .evaluate((node) => (node as HTMLElement).style.setProperty('--font-scale', '1.15'));
      await expect
        .poll(async () => Math.max(...(await alignment(page)).map((row) => row.delta)))
        .toBeLessThan(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const clipped = await page.locator('.editor-workspace').evaluate((node) =>
        [
          ...node.querySelectorAll<HTMLElement>(
            '.editor-toolbar button, .writing-tools button, .editor-source-tools select, .editor-assistance > *, .editor-foot > *',
          ),
        ]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && (rect.left < 0 || rect.right > innerWidth);
          })
          .map((element) => element.getAttribute('aria-label') || element.textContent),
      );
      expect(clipped).toEqual([]);
      await expect(page.locator('.editor-foot .source-position')).toBeVisible();
      await expect(page.locator('.editor-foot .source-statistics')).toBeVisible();
      expect((await page.locator('.editor-source-tools').boundingBox())!.height).toBe(
        assistanceHeight,
      );
      const footerItems = await page
        .locator('.editor-foot')
        .evaluate((node) =>
          [...node.children]
            .map((child) => child.getBoundingClientRect())
            .filter((rect) => rect.width > 0),
        );
      expect(
        Math.max(...footerItems.map((rect) => rect.top + rect.height / 2)) -
          Math.min(...footerItems.map((rect) => rect.top + rect.height / 2)),
      ).toBeLessThan(1);
      await screenshot(page, `writing-canvas-${width}`);
    }
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await settings.focus();
    await settings.press('Enter');
    await page
      .getByRole('region', { name: 'Entry settings', exact: true })
      .getByRole('button', { name: 'Back to editor', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Write', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Insert component', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Bring an idea to life', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    expect(
      await page.locator('.cm-editor').evaluate((node, original) => node === original, original),
    ).toBe(true);
  } finally {
    await page.close();
    const latest = (await session(request)).entries.find((e: any) => e.id === entry.id);
    if (latest)
      await mutate(request, 'content/' + entry.id, 'DELETE', { revision: latest.revision });
  }
});

test('viewer exposes safe opt-in camera details, downloads the public image and keeps a compact mobile toolbar', async ({
  page,
  request,
}) => {
  const before = await session(request);
  const upload = await request.post('/api/media', {
    headers: { 'X-Studio-Token': before.token, Origin: 'http://127.0.0.1:4387' },
    multipart: {
      file: { name: 'camera-viewer.jpg', mimeType: 'image/jpeg', buffer: await cameraPicture() },
    },
  });
  expect(upload.ok()).toBe(true);
  const image = await upload.json();
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Camera viewer fixture',
    slug: 'camera-viewer-' + test.info().project.name,
  });
  try {
    await mutate(request, 'content/' + entry.id, 'PUT', {
      metadata: { ...entry, status: 'published', comments: false },
      body: '## A small view\n\n![Camera study](' + image.url + ')',
      revision: entry.revision,
    });
    await page.goto('/studio/#media');
    await page
      .getByRole('searchbox', { name: 'Search media library', exact: true })
      .fill('camera-viewer');
    await page.locator('.media-card').first().click();
    const detail = page.getByRole('dialog', { name: 'A closer look', exact: true });
    await expect(detail.locator('.media-camera-facts')).toContainText('Test Camera');
    const publish = detail.getByRole('switch', { name: /Publish camera EXIF/ });
    await publish.check();
    await expect(detail.getByRole('status')).toContainText('next public build');
    await detail.getByRole('button', { name: 'Open image viewer', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: 'Image viewer', exact: true });
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await viewer.getByRole('button', { name: 'Image information', exact: true }).click();
    const info = viewer.getByRole('complementary', { name: 'Image information', exact: true });
    await expect(info).toContainText('Lens Study');
    await expect(info).toContainText('1/125 s');
    await expect(info.getByRole('link', { name: 'Download original', exact: true })).toBeVisible();
    await info.getByRole('button', { name: 'Close image information', exact: true }).click();
    await expect(info).toBeHidden();
    await viewer.getByRole('button', { name: 'Image information', exact: true }).click();
    await expect(info).toContainText('Lens Study');
    await screenshot(page, 'viewer-information-studio');
    await page.keyboard.press('Escape');
    await expect(info).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(detail).toBeVisible();
    await build(request);
    await page.goto('/blog/' + entry.slug + '/');
    await page.locator('.article-body img').click();
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await viewer.getByRole('button', { name: 'Image information', exact: true }).click();
    await expect(info).toContainText('Lens Study');
    await expect(info).not.toContainText(/PRIVATE|Private owner|photographer/);
    await expect(info.getByRole('link', { name: 'Download original', exact: true })).toHaveCount(0);
    const downloadEvent = page.waitForEvent('download');
    await viewer.getByRole('button', { name: 'Download image', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(image.name);
    const bytes = await fs.readFile((await download.path())!);
    expect(bytes).toEqual(await (await request.get(image.url)).body());
    await expect(info).toHaveCSS('z-index', '25');
    await expect(viewer.locator('.pswp')).toHaveCSS('z-index', '1');
    await expect.poll(() => cameraVisible(page)).toBe(true);
    await screenshot(page, 'viewer-information-public');
    await page.setViewportSize({ width: 390, height: 844 });
    const toolbar = viewer.getByRole('toolbar', { name: 'Image controls', exact: true });
    const bounds = (await toolbar.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(8);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(382);
    await viewer.getByRole('button', { name: 'More image actions', exact: true }).click();
    await expect(
      viewer.getByRole('group', { name: 'More image actions', exact: true }),
    ).toBeVisible();
    await screenshot(page, 'viewer-information-mobile');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const state = await session(request);
    await mutate(request, 'media/details', 'PUT', {
      url: image.url,
      publishCameraExif: false,
      revision: state.libraryRevision,
    });
    await build(request);
    await page.reload();
    await page.locator('.article-body img').click();
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await viewer.getByRole('button', { name: 'Image information', exact: true }).click();
    await expect(info).toContainText('No camera information shared');
  } finally {
    const now = await session(request);
    const current = now.entries.find((value: any) => value.id === entry.id);
    if (current)
      await mutate(request, 'content/' + current.id, 'DELETE', { revision: current.revision });
    const latest = await session(request);
    await mutate(request, 'library', 'PUT', {
      value: before.library,
      revision: latest.libraryRevision,
    });
    await build(request);
  }
});

test('R2 configuration stays private, exposes missing prerequisites and defaults to standalone Pages builds', async ({
  page,
  request,
}) => {
  const before = await session(request);
  try {
    await page.goto('/studio/#settings');
    await selectSettingsSection(page, 'media-delivery');
    await page.getByRole('combobox', { name: 'Media delivery', exact: true }).selectOption('r2');
    await page.getByLabel('R2 bucket', { exact: true }).fill('reader-media');
    await page.getByLabel(/Public media origin/).fill('https://media.example.net');
    await page.getByRole('button', { name: 'Check R2 configuration', exact: true }).click();
    await expect(page.locator('.media-delivery-settings [role="status"]')).toContainText(
      'R2_ACCESS_KEY_ID',
    );
    await screenshot(page, 'r2-configuration');
    const status = await (await request.get('/api/cloudflare/media')).json();
    expect(JSON.stringify(status)).not.toContain('test-secret');
    await build(request);
    const response = await request.get('/settings/');
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain('R2_SECRET_ACCESS_KEY');
  } finally {
    const current = await session(request);
    await mutate(request, 'site', 'PUT', { value: before.site, revision: current.siteRevision });
    await build(request);
  }
});

test('viewer retries metadata and handles CORS downloads and fullscreen without losing the image', async ({
  page,
  request,
}) => {
  const before = await session(request);
  const uploaded = await request.post('/api/media', {
    headers: { 'X-Studio-Token': before.token, Origin: 'http://127.0.0.1:4387' },
    multipart: {
      file: { name: 'cdn-viewer.jpg', mimeType: 'image/jpeg', buffer: await cameraPicture() },
    },
  });
  expect(uploaded.ok()).toBe(true);
  const image = await uploaded.json();
  const bytes = await (await request.get(image.url)).body();
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'CDN viewer fixture',
    slug: 'cdn-viewer-' + test.info().project.name,
  });
  let metadataAttempts = 0,
    imageReads = 0;
  try {
    await mutate(request, 'site', 'PUT', {
      value: {
        ...before.site,
        mediaDelivery: {
          mode: 'r2',
          bucket: 'viewer-media',
          prefix: 'media',
          publicOrigin: 'https://media.viewer.test',
        },
      },
      revision: before.siteRevision,
    });
    await mutate(request, 'content/' + entry.id, 'PUT', {
      metadata: { ...entry, status: 'published', comments: false, cover: image.url },
      body: '![A CDN image](https://media.viewer.test' + image.url + ')',
      revision: entry.revision,
    });
    await build(request);
    await page.route('**/assets/media-details.json', (route) =>
      ++metadataAttempts === 1 ? route.fulfill({ status: 503, body: '{}' }) : route.continue(),
    );
    await page.route('https://media.viewer.test/**', (route) => {
      if (route.request().resourceType() === 'fetch') imageReads++;
      return route.fulfill({
        status: 200,
        contentType: 'image/webp',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: bytes,
      });
    });
    await page.goto('/blog/' + entry.slug + '/');
    const opener = page.locator('.article-body img');
    await expect
      .poll(() =>
        opener.evaluate(
          (node) =>
            (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    await opener.click();
    const viewer = page.getByRole('dialog', { name: 'Image viewer', exact: true });
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await viewer.getByRole('button', { name: 'Image information', exact: true }).click();
    await viewer.getByRole('button', { name: 'Retry information', exact: true }).click();
    await expect(viewer.locator('.viewer-facts')).toContainText('640 × 360');
    await expect(viewer.locator('img.pswp__img').first()).toHaveAttribute('src', /^blob:/);
    const downloading = page.waitForEvent('download');
    await viewer.getByRole('button', { name: 'Download image', exact: true }).click();
    const download = await downloading;
    expect(await fs.readFile((await download.path())!)).toEqual(bytes);
    expect(imageReads).toBe(1);
    await viewer.getByRole('button', { name: 'More image actions', exact: true }).click();
    const fullscreen = viewer.getByRole('button', { name: 'Enter fullscreen', exact: true });
    if (await page.evaluate(() => document.fullscreenEnabled)) {
      await fullscreen.click();
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
      await viewer.getByRole('button', { name: 'More image actions', exact: true }).click();
      await viewer.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    } else await expect(fullscreen).toBeHidden();
    await viewer.getByRole('button', { name: 'Close image viewer', exact: true }).click();
    await expect(opener).toBeFocused();
  } finally {
    const now = await session(request),
      current = now.entries.find((item: any) => item.id === entry.id);
    if (current)
      await mutate(request, 'content/' + current.id, 'DELETE', { revision: current.revision });
    const latest = await session(request);
    await mutate(request, 'site', 'PUT', { value: before.site, revision: latest.siteRevision });
    await build(request);
  }
});
