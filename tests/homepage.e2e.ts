import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
const require = createRequire(import.meta.url);
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;

async function state(request: APIRequestContext) {
  return (await request.get('/api/bootstrap')).json();
}
async function change(request: APIRequestContext, url: string, data: unknown, method = 'PUT') {
  const current = await state(request);
  const response = await request.fetch('/api/' + url, {
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
        (await state(request)).jobs.find((item: { id: string }) => item.id === job.id)?.state,
      { timeout: 20000 },
    )
    .toBe('succeeded');
}
async function restore(request: APIRequestContext, site: unknown) {
  const current = await state(request);
  await change(request, 'site', { value: site, revision: current.siteRevision });
  await build(request);
}
async function capture(page: Page, name: string) {
  await expect
    .poll(() => page.locator('html').evaluate((node) => getComputedStyle(node, '::before').opacity))
    .toBe('0');
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-home-${name}.png`,
    animations: 'disabled',
  });
}

test('Homepage previews unsaved composition, retains chapters, and flushes before profile navigation and builds', async ({
  page,
  request,
}) => {
  const original = await state(request);
  try {
    await page.goto('/studio/#homepage');
    await expect(
      page.getByRole('heading', { name: 'Your homepage, thoughtfully arranged.' }),
    ).toBeVisible();
    await page.getByRole('radio', { name: /Profile & recent writing/ }).check();
    await page.getByRole('combobox', { name: 'Number of recent entries' }).selectOption('2');
    await page
      .getByRole('checkbox', { name: original.site.collections.lab.name, exact: true })
      .uncheck();
    await page.getByRole('switch', { name: 'Portrait', exact: true }).uncheck();
    const frame = page.frameLocator('iframe[title="Homepage preview"]');
    await expect(frame.locator('body')).toHaveAttribute('data-home-layout', 'profile');
    await expect(frame.locator('.home-entry')).toHaveCount(2);
    await expect(frame.locator('.home-profile .about-portrait')).toHaveCount(0);
    expect((await state(request)).siteRevision).toBe(original.siteRevision);
    await page.getByRole('button', { name: 'Save homepage', exact: true }).click();
    await expect.poll(async () => (await state(request)).site.home.recent.limit).toBe(2);
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Number of recent entries' })).toHaveValue('2');
    await expect(frame.locator('.home-profile h1')).toHaveText(original.site.profile.name);
    for (const appearance of ['light', 'dark']) {
      if (appearance === 'dark')
        await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => scrollTo(0, 0));
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await fs.mkdir('test-results/visuals', { recursive: true });
        await page.screenshot({
          path: `test-results/visuals/${test.info().project.name}-home-studio-${appearance}-${width}.png`,
          animations: 'disabled',
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('radio', { name: /Visual chapters/ }).check();
    await expect(page.getByRole('button', { name: 'Add chapter', exact: true })).toBeVisible();
    await expect(frame.locator('.visual-chapters')).toBeVisible();
    await page.getByRole('radio', { name: /Profile & recent writing/ }).check();
    await page.getByRole('combobox', { name: 'Number of recent entries' }).selectOption('3');
    await page.getByRole('button', { name: 'Edit profile in About', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect((await state(request)).site.home.recent.limit).toBe(3);
    expect((await state(request)).site.home.slides).toEqual(original.site.home.slides);
    await page.getByRole('button', { name: 'Homepage', exact: true }).click();
    await page.getByRole('combobox', { name: 'Number of recent entries' }).selectOption('1');
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await expect.poll(async () => (await state(request)).site.home.recent.limit).toBe(1);
    await expect(page.locator('.build-job').first().locator('.job-status')).toHaveText('Complete');
    await page.goto('/');
    await expect(page.locator('.home-entry')).toHaveCount(1);
    await page.goto('/studio/#appearance');
    await expect(page.getByRole('button', { name: 'Add chapter', exact: true })).toHaveCount(0);
  } finally {
    await restore(request, original.site);
  }
});

test('Homepage rebases unrelated profile changes and preserves dirty settings on a home conflict', async ({
  page,
  request,
}) => {
  const original = await state(request);
  try {
    await page.goto('/studio/#homepage');
    await page.getByRole('radio', { name: /Profile & recent writing/ }).check();
    await page.getByRole('combobox', { name: 'Number of recent entries' }).selectOption('4');
    let current = await state(request);
    await change(request, 'site', {
      value: {
        ...current.site,
        profile: { ...current.site.profile, headline: 'A refreshed profile from another window.' },
      },
      revision: current.siteRevision,
    });
    await expect(page.locator('.home-profile-context')).toContainText(
      'A refreshed profile from another window.',
    );
    await expect(page.getByRole('combobox', { name: 'Number of recent entries' })).toHaveValue('4');
    await page.getByRole('button', { name: 'Save homepage', exact: true }).click();
    await expect.poll(async () => (await state(request)).site.home.recent.limit).toBe(4);
    await expect(page.locator('.settings-save')).toContainText('Your homepage is saved locally.');
    expect((await state(request)).site.profile.headline).toBe(
      'A refreshed profile from another window.',
    );
    await page.getByRole('combobox', { name: 'Number of recent entries' }).selectOption('5');
    current = await state(request);
    await change(request, 'site', {
      value: {
        ...current.site,
        home: { ...current.site.home, recent: { ...current.site.home.recent, limit: 8 } },
      },
      revision: current.siteRevision,
    });
    await expect(
      page.getByRole('button', { name: 'Reload latest homepage settings', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Number of recent entries' })).toHaveValue('5');
    await expect(page.getByRole('button', { name: 'Save homepage', exact: true })).toBeDisabled();
    await page
      .getByRole('button', { name: 'Reload latest homepage settings', exact: true })
      .click();
    await expect(page.getByRole('combobox', { name: 'Number of recent entries' })).toHaveValue('8');
  } finally {
    await restore(request, original.site);
  }
});

test('Homepage pins select either collection, preview order, persist safely and render without JavaScript', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const original = await state(request);
  const post = original.entries.find((entry: { id: string }) => entry.id === 'post-curiosity');
  const article = original.entries.find((entry: { id: string }) => entry.id === 'lab-light');
  const draft = original.entries.find((entry: { status: string }) => entry.status === 'draft');
  const list = page.getByRole('list', { name: 'Pinned homepage entries', exact: true });
  const picker = page.getByRole('combobox', { name: 'Choose an entry to pin', exact: true });
  const frame = page.frameLocator('iframe[title="Homepage preview"]');
  try {
    await page.goto('/studio/#homepage');
    await page.getByRole('radio', { name: /Profile & recent writing/ }).check();
    await page.getByRole('combobox', { name: 'Number of recent entries' }).selectOption('2');
    await page
      .getByRole('checkbox', { name: original.site.collections.lab.name, exact: true })
      .uncheck();
    await picker.selectOption(article.id);
    await expect(picker.locator(`option[value="${article.id}"]`)).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search entries to pin' }).fill('curiosity');
    await expect(picker.locator('option[value]:not([value=""])')).toHaveCount(1);
    await picker.selectOption(post.id);
    await expect(page.getByRole('searchbox', { name: 'Search entries to pin' })).toHaveValue('');
    await picker.selectOption(draft.id);
    await expect(list.locator('li')).toHaveCount(3);
    await expect(list.locator('li').last()).toContainText('Appears after publication.');
    await page.getByRole('button', { name: `Move ${post.title} up`, exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(list.locator('li').first().locator('strong')).toHaveText(post.title);
    await expect(frame.locator('.home-entry[data-home-pinned="true"] h3')).toHaveText([
      post.title,
      article.title,
    ]);
    await expect(frame.locator('.home-entry')).toHaveCount(4);
    await expect(frame.locator('.home-entry-list')).not.toContainText(draft.title);
    expect((await state(request)).siteRevision).toBe(original.siteRevision);
    await page.getByRole('button', { name: 'Save homepage', exact: true }).click();
    const expected = [post.id, article.id, draft.id];
    await expect.poll(async () => (await state(request)).site.home.pinned).toEqual(expected);
    await page.reload();
    await expect(list.locator('li')).toHaveCount(3);
    await expect(list.locator('li').first().locator('strong')).toHaveText(post.title);
    const saved = await state(request);
    expect(saved.entries.map((entry: { revision: string }) => entry.revision)).toEqual(
      original.entries.map((entry: { revision: string }) => entry.revision),
    );
    await page.getByRole('radio', { name: /Visual chapters/ }).check();
    await expect(frame.locator('.visual-chapters')).toBeVisible();
    await page.getByRole('radio', { name: /Profile & recent writing/ }).check();
    await expect(list.locator('li')).toHaveCount(3);
    for (const appearance of ['light', 'dark']) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      if (appearance === 'dark')
        await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator('.home-pins').scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await fs.mkdir('test-results/visuals', { recursive: true });
        await page.locator('.home-pins').screenshot({
          path: `test-results/visuals/${test.info().project.name}-home-pins-studio-${appearance}-${width}.png`,
          animations: 'disabled',
        });
      }
      expect((await new AxeBuilder({ page }).include('.home-pins').analyze()).violations).toEqual(
        [],
      );
    }
    await build(request);
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const staticPage = await context.newPage();
      await staticPage.goto('http://127.0.0.1:4387/');
      await expect(staticPage.locator('.home-entry[data-home-pinned="true"] h3')).toHaveText([
        post.title,
        article.title,
      ]);
      await expect(staticPage.locator('.home-entry')).toHaveCount(4);
      await expect(staticPage.locator('.home-entry-list')).not.toContainText(draft.title);
      await staticPage.screenshot({
        path: `test-results/visuals/${test.info().project.name}-home-pins-static.png`,
        fullPage: true,
        animations: 'disabled',
      });
    } finally {
      await context.close();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: `Unpin ${post.title}`, exact: true }).click();
    await expect(frame.locator('.home-entry[data-home-pinned="true"] h3')).toHaveText([
      article.title,
    ]);
    await page.getByRole('button', { name: 'Save homepage', exact: true }).click();
    await expect
      .poll(async () => (await state(request)).site.home.pinned)
      .toEqual([article.id, draft.id]);
  } finally {
    await restore(request, original.site);
  }
});

test('Profile homepage stays useful without JavaScript, fits narrow screens and respects reduced motion', async ({
  page,
  browser,
  request,
}) => {
  const original = await state(request);
  try {
    await change(request, 'site', {
      value: {
        ...original.site,
        home: {
          ...original.site.home,
          layout: 'profile',
          recent: {
            ...original.site.home.recent,
            sources: ['posts', 'lab'],
            limit: 6,
            showCover: true,
          },
        },
      },
      revision: original.siteRevision,
    });
    await build(request);
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1440, height: 1000 },
    });
    try {
      const staticPage = await context.newPage();
      await staticPage.goto('http://127.0.0.1:4387/');
      await expect(staticPage.locator('.home-entry')).toHaveCount(6);
      await expect(staticPage.locator('.home-profile h1')).toHaveText(original.site.profile.name);
      await expect(staticPage.locator('.site-nav a')).toHaveText([
        'Home',
        'Archive',
        'Projects',
        'Life',
        'About',
      ]);
      await expect(staticPage.locator('.home-entry-list')).not.toContainText('Draft');
    } finally {
      await context.close();
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('.home-profile')).toHaveCSS('animation-name', 'none');
    for (const theme of ['light', 'dark']) {
      await page.evaluate((appearance) => {
        localStorage.setItem(
          'fieldnotes-reader-v1',
          JSON.stringify({ version: 1, theme: { appearance } }),
        );
      }, theme);
      await page.reload();
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
        await capture(page, `profile-${theme}-${width}`);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        const widths = await page.evaluate(() =>
          ['.site-header', '.site-main', '.site-footer'].map(
            (selector) => document.querySelector(selector)!.getBoundingClientRect().width,
          ),
        );
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  } finally {
    await restore(request, original.site);
  }
});

test('Reader specimen supports keyboard scenes, local-only demos, shared bounds and mobile expansion', async ({
  page,
  context,
  request,
}) => {
  const before = await state(request),
    writes: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
  });
  await page.goto('/settings/');
  const reading = page.getByRole('region', { name: 'Typography preview', exact: true });
  const readingSurface = page.locator('#reader-preview-reading');
  await expect(reading.locator('mjx-container')).toHaveCount(2);
  await expect(reading.locator('.prose-table-scroll')).toHaveCount(1);
  await expect(readingSurface).toHaveAttribute('data-liquid', 'surface');
  await expect(readingSurface).toHaveCSS('overflow-x', 'clip');
  await expect(reading).toHaveClass(/glass-panel/);
  await expect
    .poll(() => reading.evaluate((node) => getComputedStyle(node, '::after').display))
    .toBe('none');
  await expect(reading).toHaveCSS('overflow-y', 'auto');
  const surfaceBounds = await readingSurface.boundingBox();
  await reading.evaluate((node) => {
    node.scrollTop = 250;
  });
  expect(await readingSurface.evaluate((node) => node.scrollTop)).toBe(0);
  expect(await readingSurface.boundingBox()).toEqual(surfaceBounds);
  await capture(page, 'specimen-reading-scrolled');
  await reading.focus();
  await expect(readingSurface).toHaveCSS('outline-style', 'solid');
  await page.getByRole('tab', { name: 'Reading', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Controls', exact: true })).toBeFocused();
  const controls = page.getByRole('region', { name: 'Controls preview', exact: true });
  await expect(controls).not.toHaveClass(/glass-panel/);
  await expect(page.locator('#reader-preview-controls')).toHaveAttribute('data-liquid', 'surface');
  await expect(page.locator('#reader-preview-controls')).toHaveCSS('overflow-x', 'clip');
  const stored = await page.evaluate(() => localStorage.getItem('fieldnotes-reader-v1'));
  await page.getByRole('textbox', { name: 'Preview field', exact: true }).fill('A demo');
  await page.getByRole('slider', { name: 'Demo light', exact: true }).press('End');
  await expect(page.locator('[data-demo-range-output]')).toHaveText('100%');
  await page.getByRole('button', { name: 'Try a button', exact: true }).click();
  await expect(page.locator('[data-demo-status]')).toContainText('A little feedback');
  expect(await page.evaluate(() => localStorage.getItem('fieldnotes-reader-v1'))).toBe(stored);
  await capture(page, 'specimen-controls');
  await page.getByRole('tab', { name: 'Materials', exact: true }).click();
  await page.getByRole('button', { name: 'Save demo note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unsave demo note', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await capture(page, 'specimen-materials');
  await page.getByRole('tab', { name: 'Materials', exact: true }).press('Home');
  await expect(reading).toBeVisible();
  expect(await reading.evaluate((node) => node.scrollTop)).toBe(250);
  const rangeBounds = [
    ['glassBlur', '0'],
    ['cornerRadius', '0'],
    ['ambientIntensity', '2'],
    ['contentWidth', '1600'],
    ['textScale', '2'],
  ] as const;
  for (const [key, value] of rangeBounds) {
    const control = page.locator(`[data-reader-control="${key}"]`);
    await control.press(value === '0' ? 'Home' : 'End');
    await expect(control).toHaveValue(value);
  }
  await page.reload();
  await expect(page.locator('[data-reader-control="glassBlur"]')).toHaveValue('0');
  await expect(page.locator('html')).toHaveCSS('--glass-blur', '0px');
  await expect(readingSurface).toHaveCSS('border-radius', '0px');
  const other = await context.newPage();
  await other.goto('/about/');
  await expect(other.locator('html')).toHaveCSS('--ambient-intensity', '2');
  await expect(other.locator('html')).toHaveCSS('--reader-text-scale', '2');
  await other.close();
  await page.getByRole('button', { name: 'Reset everything', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption(theme);
    for (const scene of ['Reading', 'Controls', 'Materials']) {
      await page.getByRole('tab', { name: scene, exact: true }).click();
      await capture(page, `specimen-${scene.toLowerCase()}-${theme}`);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  }
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('tab', { name: 'Reading', exact: true }).click();
    if (width < 680) {
      await page.getByRole('button', { name: 'Expand preview', exact: true }).click();
      await expect(page.locator('[data-reader-specimen]')).toHaveAttribute('data-expanded', 'true');
      await expect
        .poll(() => reading.evaluate((node) => parseFloat(getComputedStyle(node).maxHeight)))
        .toBeGreaterThan(500);
      await page.getByRole('button', { name: 'Collapse preview', exact: true }).click();
    }
    await capture(page, `specimen-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  expect(writes).toEqual([]);
  expect((await state(request)).siteRevision).toBe(before.siteRevision);
});
