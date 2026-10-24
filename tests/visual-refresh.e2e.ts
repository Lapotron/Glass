import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
const require = createRequire(import.meta.url);
const sharp: typeof import('sharp').default = require('sharp');
const session = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, url: string, method: string, data: unknown) {
  const s = await session(request);
  const r = await request.fetch(`/api/${url}`, {
    method,
    headers: { 'X-Studio-Token': s.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
async function build(request: APIRequestContext) {
  const job = await mutate(request, 'jobs', 'POST', { action: 'build' });
  await expect
    .poll(async () => (await session(request)).jobs.find((j: any) => j.id === job.id)?.state)
    .toBe('succeeded');
}
async function shot(page: Page, name: string) {
  await page.waitForFunction(() => !document.documentElement.matches(':active-view-transition'));
  if (await page.locator('.site-main').count())
    await expect
      .poll(() => page.locator('html').evaluate((n) => getComputedStyle(n, '::before').opacity))
      .toBe('0');
  const viewer = page.locator('dialog.media-viewer[open]');
  if (await viewer.count()) {
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await expect(viewer.locator('img.pswp__img').first()).toBeVisible();
    await expect
      .poll(() =>
        viewer
          .locator('img.pswp__img')
          .first()
          .evaluate(
            (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
          ),
      )
      .toBe(true);
  }
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-${name}.png`,
    fullPage: false,
  });
}
async function searchIcon(page: Page, selector: string) {
  const icon = page.locator(`${selector} > svg`).first();
  await expect(icon).toBeVisible();
  await expect(icon).toHaveCSS('flex-shrink', '0');
  expect((await icon.boundingBox())!.width).toBeGreaterThanOrEqual(15);
  if (selector !== '.search-top') await expect(icon).toHaveCSS('z-index', '2');
}

test('visual chapters and the five destinations stay clean at three viewport sizes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.site-nav a')).toHaveText([
    'Home',
    'Archive',
    'Projects',
    'Life',
    'About',
  ]);
  await expect(page.locator('.home-hero,.home-section,.profile-card')).toHaveCount(0);
  await expect(page.locator('[data-chapter]')).toHaveCount(6);
  await expect(page.locator('[data-chapter-link]').first()).toHaveAttribute(
    'aria-current',
    'location',
  );
  await shot(page, 'visual-home-desktop');
  await page.locator('[data-chapter-link]').nth(1).click();
  await expect(page.locator('[data-chapter-link]').nth(1)).toHaveAttribute(
    'aria-current',
    'location',
  );
  for (const width of [834, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    await shot(page, `visual-home-${width}`);
  }
  expect(errors).toEqual([]);
});
test('search icons remain visible above inputs in Archive and Studio', async ({ page }) => {
  await page.goto('/archive/');
  await searchIcon(page, '.archive-search');
  await page.getByRole('searchbox', { name: 'Filter archive', exact: true }).fill('wave');
  await expect(page.locator('[data-timeline-count]')).toContainText('1 published');
  await expect(page).toHaveURL(/q=wave/);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Filter archive', exact: true })).toHaveValue(
    'wave',
  );
  await shot(page, 'archive-search-icon');
  await page.getByRole('button', { name: 'Search this notebook' }).click();
  await searchIcon(page, '.search-top');
  await shot(page, 'search-dialog-icon');
  await page.keyboard.press('Escape');
  await page.goto('/studio/#media');
  await searchIcon(page, '.search-field');
  await shot(page, 'studio-search-icon');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/archive/');
  await searchIcon(page, '.archive-search');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true,
  );
  await shot(page, 'archive-mobile');
});
test('rich Markdown tabs, disclosures and the article viewer work with keyboard input', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/blog/component-showcase/');
  const tabs = page.locator('.md-tabs');
  await tabs.getByRole('tab', { name: 'An explanation', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab', { name: 'A small example', exact: true })).toBeFocused();
  await expect(tabs.locator('.md-tab:visible')).toContainText('refractedAngle');
  await page.locator('.md-details summary').click();
  await expect(page.locator('.md-details')).toHaveAttribute('open');
  const image = page.locator('.md-figure img').first();
  await image.scrollIntoViewIfNeeded();
  await image.focus();
  await page.keyboard.press('Enter');
  const viewer = page.getByRole('dialog', { name: 'Image viewer', exact: true });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('img.pswp__img').first()).toBeVisible();
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(viewer.locator('.viewer-caption')).toContainText('coastline');
  await shot(page, 'article-image-viewer');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(image).toBeFocused();
  expect(errors).toEqual([]);
});
test('crop and resize uploads, re-edit originals, and open a viewer above the media dialog', async ({
  page,
  request,
}) => {
  const image = await sharp({
    create: {
      width: 800,
      height: 400,
      channels: 4,
      background: { r: 80, g: 130, b: 170, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  await page.goto('/studio/#media');
  await page
    .getByLabel('Upload media files')
    .setInputFiles({ name: 'crop-review.png', mimeType: 'image/png', buffer: image });
  const editor = page.getByRole('dialog', { name: 'Prepare image', exact: true });
  await expect(editor.locator('.crop-selection')).toBeVisible();
  await editor.getByRole('combobox', { name: 'Crop ratio', exact: true }).selectOption('1');
  await editor.getByLabel('Output width', { exact: true }).fill('200');
  await editor.getByLabel('Output width', { exact: true }).blur();
  await expect(editor.getByLabel('Output height', { exact: true })).toHaveValue('200');
  await shot(page, 'crop-editor');
  await editor.getByRole('button', { name: 'Apply & upload', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const list = await (await request.get('/api/media')).json();
  const file = list.find((f: any) => f.name.startsWith('crop-review-'));
  expect([file.width, file.height]).toEqual([200, 200]);
  expect(file.canEdit).toBe(true);
  await page.getByRole('searchbox', { name: 'Search media library' }).fill('crop-review');
  await page.locator('.media-card').first().click();
  await page.getByRole('button', { name: 'Open image viewer', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Image viewer', exact: true });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('img.pswp__img').first()).toBeVisible();
  await shot(page, 'studio-image-viewer');
  const toolbar = viewer.getByRole('toolbar', { name: 'Image controls', exact: true });
  await expect(toolbar).toHaveCount(1);
  await expect(toolbar).toHaveCSS('position', 'absolute');
  const navigation = viewer.getByRole('group', { name: 'Image navigation', exact: true });
  await expect(navigation).toHaveCSS('position', 'absolute');
  const toolbarBounds = (await toolbar.boundingBox())!;
  const navigationBounds = (await navigation.boundingBox())!;
  expect(toolbarBounds.width).toBeLessThan(page.viewportSize()!.width - 32);
  expect(navigationBounds.y).toBeGreaterThan(toolbarBounds.y + toolbarBounds.height);
  await expect(viewer.getByRole('button', { name: 'Close image viewer', exact: true })).toHaveCount(
    1,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const phoneToolbar = (await toolbar.boundingBox())!;
  const phoneNavigation = (await navigation.boundingBox())!;
  expect(phoneToolbar.x).toBeGreaterThanOrEqual(8);
  expect(phoneToolbar.x + phoneToolbar.width).toBeLessThanOrEqual(382);
  expect(phoneNavigation.y).toBeGreaterThan(phoneToolbar.y + phoneToolbar.height);
  await shot(page, 'studio-image-viewer-mobile');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'A closer look', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open image viewer', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Edit original', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Edit image', exact: true }).locator('.crop-settings'),
  ).toContainText('800 × 400');
  await page
    .getByRole('dialog', { name: 'Edit image', exact: true })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
});
test('About edits save on navigation, preview, and compare revisions with CodeMirror', async ({
  page,
  request,
}) => {
  const original = (await session(request)).about;
  try {
    await page.goto('/studio/#about');
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await expect(editor).toBeVisible();
    await editor.fill('# A thoughtful About\n\nA paragraph for the visual refresh.');
    await page.getByRole('button', { name: 'Save About', exact: true }).click();
    await expect
      .poll(async () => (await session(request)).about.body)
      .toContain('A thoughtful About');
    await expect(
      page
        .frameLocator('iframe[title="About preview"]')
        .getByRole('heading', { name: 'A thoughtful About', exact: true }),
    ).toBeVisible();
    await editor.fill('# A thoughtful About\n\nA second paragraph.');
    await page.getByRole('button', { name: 'Revisions', exact: true }).click();
    await page.locator('.page-revisions button').first().click();
    await expect(page.locator('.markdown-diff-editor')).toHaveAttribute('data-ready', 'true');
    await shot(page, 'about-revisions');
    await page.getByRole('button', { name: 'Close About revisions', exact: true }).click();
    await page.getByRole('button', { name: 'Media library', exact: true }).click();
    await expect
      .poll(async () => (await session(request)).about.body)
      .toContain('A second paragraph');
  } finally {
    const now = (await session(request)).about;
    await mutate(request, 'pages/about', 'PUT', { body: original.body, revision: now.revision });
  }
});
test('curated chapters save, preview, reorder, and publish without changing article URLs', async ({
  page,
  request,
}) => {
  const original = await session(request);
  let saves = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/site') saves++;
  });
  try {
    await page.goto('/studio/#homepage');
    await page.getByRole('button', { name: 'Add chapter', exact: true }).click();
    const chapter = page.locator('.home-slide-edit').last();
    await chapter.locator('summary').click();
    await chapter.getByLabel('Title override', { exact: true }).fill('A curated visual');
    await chapter.getByRole('button', { name: 'Choose image', exact: true }).click();
    await page.locator('.media-picker-grid button').filter({ hasText: 'coast-dusk.svg' }).click();
    await chapter.getByLabel('Destination override', { exact: true }).fill('/archive/');
    expect(saves).toBe(0);
    expect((await session(request)).siteRevision).toBe(original.siteRevision);
    await page.getByRole('button', { name: 'Save homepage', exact: true }).click();
    await expect
      .poll(async () => (await session(request)).site.home.slides?.at(-1)?.title)
      .toBe('A curated visual');
    await expect(page.getByRole('button', { name: 'Save homepage', exact: true })).toBeDisabled();
    expect(saves).toBe(1);
    await build(request);
    await page.goto('/');
    await expect(page.locator('[data-chapter]').last()).toContainText('A curated visual');
    await expect(page.locator('.site-nav a')).toHaveText([
      'Home',
      'Archive',
      'Projects',
      'Life',
      'About',
    ]);
  } finally {
    const now = await session(request);
    await mutate(request, 'site', 'PUT', { value: original.site, revision: now.siteRevision });
    await build(request);
  }
});
test('article discussion switch keeps its track and thumb geometry in the metadata panel', async ({
  page,
}) => {
  await page.goto('/studio/#writing');
  await page
    .getByRole('button', { name: /Good tools get out of the way/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Discussion', exact: true }).click();
  const control = page.getByRole('switch', { name: 'Allow article discussion', exact: true });
  await expect(control).toBeVisible();
  await expect(control).toHaveCSS('width', '48px');
  await expect(control).toHaveCSS('height', '28px');
  await expect
    .poll(() => control.evaluate((n) => getComputedStyle(n, '::after').marginTop))
    .toBe('0px');
  await shot(page, 'article-discussion-switch');
});

test('section discussions load independently and preserve stable thread mappings', async ({
  page,
  request,
}) => {
  const original = await session(request);
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Section discussion fixture',
    slug: `section-discussion-${test.info().project.name}`,
  });
  try {
    await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: { ...entry, status: 'published' },
      body: ':::discussion[First question]{#first comments="true"}\nA first idea.\n:::\n\n:::discussion[Second question]{#second comments="true"}\nAnother idea.\n:::',
      revision: entry.revision,
    });
    await mutate(request, 'site', 'PUT', {
      value: {
        ...original.site,
        integrations: {
          ...original.site.integrations,
          comments: {
            ...original.site.integrations.comments,
            enabled: true,
            repo: 'example/notebook',
            repoId: 'R_test',
            categoryId: 'DIC_test',
          },
        },
      },
      revision: original.siteRevision,
    });
    await build(request);
    let loads = 0;
    await page.route('https://giscus.app/**', (route) => {
      loads++;
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body>Section provider fixture</body></html>',
      });
    });
    await page.goto(`/blog/${entry.slug}/`);
    await expect(page.locator('giscus-widget')).toHaveCount(0);
    const threads = page.locator('[data-section-thread]');
    await threads.nth(0).locator('summary').click();
    await expect(threads.nth(0).locator('giscus-widget')).toHaveAttribute(
      'term',
      `entry/${entry.id}/section/first`,
    );
    await expect(threads.nth(0).locator('iframe')).toBeVisible();
    await expect(threads.nth(1).locator('giscus-widget')).toHaveCount(0);
    await threads.nth(1).locator('summary').click();
    await expect(threads.nth(1).locator('giscus-widget')).toHaveAttribute(
      'term',
      `entry/${entry.id}/section/second`,
    );
    await expect(threads.nth(1).locator('iframe')).toBeVisible();
    await threads.nth(1).locator('iframe').scrollIntoViewIfNeeded();
    await expect(threads.nth(1).frameLocator('iframe').locator('body')).toContainText(
      'Section provider fixture',
    );
    await expect.poll(() => loads).toBe(2);
    await page.getByRole('button', { name: 'Load discussion', exact: true }).click();
    await expect(page.locator('.article-discussion giscus-widget')).toHaveAttribute(
      'term',
      `/blog/${entry.slug}/`,
    );
    await expect(page.locator('giscus-widget')).toHaveCount(3);
  } finally {
    const current = await session(request);
    await mutate(request, 'site', 'PUT', { value: original.site, revision: current.siteRevision });
    const saved = (await session(request)).entries.find((e: any) => e.id === entry.id);
    if (saved) await mutate(request, `content/${entry.id}`, 'DELETE', { revision: saved.revision });
    await build(request);
  }
});

test('public raster viewer loads full source detail and respects reduced motion', async ({
  page,
  request,
}) => {
  const model = await session(request);
  const bytes = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#678eaa' },
  })
    .png()
    .toBuffer();
  const response = await request.post('/api/media', {
    headers: { 'X-Studio-Token': model.token, Origin: 'http://127.0.0.1:4387' },
    multipart: { file: { name: 'viewer-detail.png', mimeType: 'image/png', buffer: bytes } },
  });
  expect(response.ok()).toBe(true);
  const image = await response.json();
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Raster viewer fixture',
    slug: `raster-viewer-${test.info().project.name}`,
  });
  try {
    await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: { ...entry, status: 'published' },
      body: `![A photograph with full detail](${image.url})`,
      revision: entry.revision,
    });
    await build(request);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/blog/${entry.slug}/`);
    await page.locator('.article-body img').click();
    const viewer = page.getByRole('dialog', { name: 'Image viewer', exact: true });
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await expect(viewer.getByRole('toolbar', { name: 'Image controls', exact: true })).toHaveCount(
      1,
    );
    await expect(viewer.locator('.viewer-navigation')).toBeHidden();
    const picture = viewer.locator('img.pswp__img').first();
    await expect(picture).toBeVisible();
    await expect(picture).toHaveAttribute('src', /^blob:/);
    await expect
      .poll(() => picture.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(1200);
    expect(await picture.getAttribute('srcset')).toBeNull();
    await viewer.getByRole('button', { name: 'Actual size', exact: true }).click();
    await expect
      .poll(() =>
        picture.evaluate(
          (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    await shot(page, 'raster-image-viewer');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
  } finally {
    const saved = (await session(request)).entries.find((e: any) => e.id === entry.id);
    if (saved) await mutate(request, `content/${entry.id}`, 'DELETE', { revision: saved.revision });
    await build(request);
  }
});

test('outline anchors reveal headings inside rich Markdown tabs and survive reload', async ({
  page,
  request,
}) => {
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Tab anchor fixture',
    slug: `tab-anchor-${test.info().project.name}`,
  });
  try {
    await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: { ...entry, status: 'published' },
      body: '::::tabs\n:::tab[First view]\nA first paragraph.\n:::\n\n:::tab[Second view]\n## A hidden heading\n\nA linked paragraph in the second panel.\n:::\n::::',
      revision: entry.revision,
    });
    await build(request);
    await page.goto(`/blog/${entry.slug}/`);
    const second = page.getByRole('tab', { name: 'Second view', exact: true });
    await expect(second).toHaveAttribute('aria-selected', 'false');
    await page.locator('[data-outline-link]').filter({ hasText: 'A hidden heading' }).click();
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('heading', { name: 'A hidden heading', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('heading', { name: 'A hidden heading', exact: true }),
    ).toBeVisible();
  } finally {
    const saved = (await session(request)).entries.find((e: any) => e.id === entry.id);
    if (saved) await mutate(request, `content/${entry.id}`, 'DELETE', { revision: saved.revision });
    await build(request);
  }
});
