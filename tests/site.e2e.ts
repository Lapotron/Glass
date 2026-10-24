import { selectSettingsSection } from './settings-navigation.js';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
// Load CJS tooling synchronously to avoid Node 22's concurrent CJS/ESM linking bug.
const require = createRequire(import.meta.url);
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;
const sharp: typeof import('sharp').default = require('sharp');

const shot = async (page: Page, name: string, fullPage = true) => {
  const directory = path.join(process.cwd(), 'test-results/visuals');
  await fs.mkdir(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, `${test.info().project.name}-${name}.png`),
    fullPage,
  });
};
async function session(request: APIRequestContext) {
  return (await request.get('/api/bootstrap')).json();
}
async function mutate(request: APIRequestContext, url: string, method: string, value: unknown) {
  const data = await session(request);
  return request.fetch(`/api/${url}`, {
    method,
    headers: { 'X-Studio-Token': data.token, Origin: 'http://127.0.0.1:4387' },
    data: value,
  });
}
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true,
  );
async function settlePage(page: Page) {
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
}

test('public home, static routes, search, appearance, and photo lightbox', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Good tools get out of the way');
  await shot(page, 'home-light');
  await noOverflow(page);
  await page.getByRole('button', { name: 'Search this notebook' }).click();
  await page.getByRole('searchbox', { name: 'Search Writing and Lab' }).fill('curiosity');
  await expect(page.locator('.search-result').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Change appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await shot(page, 'home-dark');
  await page.goto('/life/?view=photos');
  await page.getByRole('link', { name: /Where the sea meets the morning/ }).click();
  await expect(page.getByRole('dialog', { name: 'Image viewer' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.viewer-caption')).toContainText('A little further');
  await page.keyboard.press('Escape');
  const missing = await request.get('/this-page-does-not-exist/');
  expect(missing.status()).toBe(404);
  expect((await request.get('/search.json')).ok()).toBe(true);
  expect(errors).toEqual([]);
});
test('articles and MathJax remain readable without browser JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4387/blog/a-small-case-for-curiosity/');
  await expect(
    page.getByRole('heading', { name: 'A small case for curiosity', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[role=math] svg').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Follow a smaller question' })).toBeVisible();
  await page.goto(
    'http://127.0.0.1:4387/blog/%E6%8A%8A%E6%83%B3%E6%B3%95%E7%95%99%E5%9C%A8%E7%BA%B8%E4%B8%8A/',
  );
  await expect(page.locator('.article-shell')).toHaveAttribute('lang', 'zh');
  await page.goto('http://127.0.0.1:4387/blog/component-showcase/');
  await expect(page.locator('[data-interactive]')).toHaveCount(8);
  await expect(page.locator('.widget-tab-panel')).toHaveCount(3);
  await expect(page.locator('[data-interactive="tabs"] [role="tablist"]')).toBeHidden();
  await page.locator('.quiz-solution summary').click();
  await expect(page.locator('.quiz-solution p').last()).toBeVisible();
  expect(await page.locator('[role=math] svg').count()).toBeGreaterThan(10);
  await expect(page.locator('[data-mermaid] pre')).toHaveCount(2);
  await page.goto('http://127.0.0.1:4387/archive/');
  await expect(page.locator('.post-timeline-item').first()).toContainText('The component showcase');
  await context.close();
});
test('navigation glass follows the pointer and keyboard focus, then settles on the current page', async ({
  page,
}) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const lens = nav.locator('.nav-lens');
  const lab = nav.locator('a[href="/life/"]');
  const archive = nav.locator('a[href="/archive/"]');
  await expect(nav).toHaveAttribute('data-nav-enhanced', 'true');
  await expect(nav).toHaveAttribute('data-nav-target', '/');
  await lab.hover();
  await expect(nav).toHaveAttribute('data-nav-target', '/life/');
  await expect
    .poll(async () => {
      const shape = (await lens.boundingBox())!;
      const item = (await lab.boundingBox())!;
      return Math.abs(shape.x + shape.width / 2 - item.x - item.width / 2);
    })
    .toBeLessThan(4);
  const light = await lens.evaluate((node) => node.style.getPropertyValue('--nav-light-x'));
  const bounds = (await lab.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height / 2);
  await expect
    .poll(() => lens.evaluate((node) => node.style.getPropertyValue('--nav-light-x')))
    .not.toBe(light);
  await archive.hover();
  await expect(nav).toHaveAttribute('data-nav-target', '/archive/');
  await shot(page, 'navigation-liquid-hover', false);
  await page.mouse.move(10, 200);
  await expect(nav).toHaveAttribute('data-nav-target', '/');
  await lab.focus();
  await expect(nav).toHaveAttribute('data-nav-target', '/life/');
  // Safari's default macOS tab policy reaches links with Option-Tab.
  await page.keyboard.press(test.info().project.name === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(nav).toHaveAttribute('data-nav-target', '/about/');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/about\/$/);
  await expect(nav.locator('a[aria-current="page"]')).toHaveAttribute('href', '/about/');
  await expect(nav).toHaveAttribute('data-nav-target', '/about/');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await archive.focus();
  await expect(nav).toHaveAttribute('data-nav-target', '/archive/');
  await expect
    .poll(async () => {
      const shape = (await lens.boundingBox())!;
      const item = (await archive.boundingBox())!;
      return Math.abs(shape.y + shape.height / 2 - item.y - item.height / 2);
    })
    .toBeLessThan(3);
  await shot(page, 'navigation-mobile-focus', false);
  await noOverflow(page);
});
test('static page loading uses native transitions, slow-load feedback, history, and reduced motion', async ({
  page,
}) => {
  await page.addInitScript(() => {
    addEventListener('pagereveal', (event) => {
      document.documentElement.dataset.testPageTransition = String(
        Boolean((event as any).viewTransition),
      );
    });
  });
  await page.goto('/');
  await page.evaluate(() => {
    new MutationObserver(() => {
      if (document.documentElement.dataset.navigating === 'true')
        setTimeout(() => {
          const progress = document.querySelector('.navigation-progress')!;
          sessionStorage.setItem('test-loading-opacity', getComputedStyle(progress).opacity);
        }, 200);
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-navigating'],
    });
  });
  const native = await page.evaluate(
    () => 'CSSViewTransitionRule' in window && 'onpagereveal' in window,
  );
  await page.route('**/archive/', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .locator('a[href="/archive/"]')
    .click();
  await expect(page).toHaveURL(/\/archive\/$/);
  expect(await page.evaluate(() => sessionStorage.getItem('test-loading-opacity'))).toBe('1');
  if (native)
    await expect(page.locator('html')).toHaveAttribute('data-test-page-transition', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-navigating');
  await page.goBack();
  await expect(page).toHaveURL('http://127.0.0.1:4387/');
  await expect(page.locator('html')).not.toHaveAttribute('data-navigating');
  await expect(page.locator('.site-nav')).toHaveAttribute('data-nav-target', '/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.site-main')).toHaveCSS('animation-name', 'none');
  await expect
    .poll(() => page.locator('html').evaluate((node) => getComputedStyle(node, '::before').display))
    .toBe('none');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.locator('a[href="/life/"]').hover();
  await expect(nav).toHaveAttribute('data-nav-target', '/life/');
  await expect
    .poll(() =>
      nav.locator('.nav-lens').evaluate((node) => getComputedStyle(node, '::before').scale),
    )
    .toBe('1');
  await expect(nav.locator('.nav-lens')).toHaveCSS('transition-property', 'opacity');
  await nav.locator('a[href="/life/"]').click();
  await expect(page).toHaveURL(/\/life\/$/);
  if (native)
    await expect(page.locator('html')).toHaveAttribute('data-test-page-transition', 'false');
});
test('glass form primitives keep native input, selection, range, and toggle behavior', async ({
  page,
}) => {
  await page.goto('/__components/');
  await settlePage(page);
  const forms = page.locator('#material-forms');
  await forms.scrollIntoViewIfNeeded();
  await forms.getByRole('textbox', { name: 'Field label', exact: true }).fill('A small detail');
  await forms.getByRole('combobox', { name: 'Reading mode' }).selectOption('compact');
  await expect(forms.getByRole('combobox', { name: 'Reading mode' })).toHaveValue('compact');
  await expect(forms.getByRole('textbox', { name: 'Unavailable field' })).toBeDisabled();
  await expect(forms.getByRole('textbox', { name: 'Read only' })).toHaveAttribute('readonly');
  const ordinaryBorder = await forms
    .getByRole('textbox', { name: 'Read only' })
    .evaluate((node) => getComputedStyle(node).borderColor);
  expect(
    await forms
      .getByRole('textbox', { name: 'Invalid example' })
      .evaluate((node) => getComputedStyle(node).borderColor),
  ).not.toBe(ordinaryBorder);
  const checkbox = forms.getByRole('checkbox', { name: 'Send a quiet reminder' });
  await expect(forms.getByRole('checkbox', { name: 'Archived preference' })).toBeDisabled();
  const mixed = forms.getByRole('checkbox', { name: 'Some details selected' });
  expect(await mixed.evaluate((node) => (node as HTMLInputElement).indeterminate)).toBe(true);
  await mixed.press('Space');
  await expect(mixed).toBeChecked();
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await forms.getByRole('radio', { name: 'A little closer' }).check();
  await expect(forms.getByRole('radio', { name: 'Room to breathe' })).not.toBeChecked();
  const toggle = forms.getByRole('switch', { name: 'Sample switch' });
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).not.toBeChecked();
  const slider = forms.getByRole('slider', { name: 'Sample intensity' });
  await slider.press('End');
  await expect(slider).toHaveValue('100');
  await expect(slider).toHaveCSS('--range-fill', '100%');
  await slider.press('Home');
  await expect(slider).toHaveCSS('--range-fill', '0%');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    await shot(page, `forms-${theme}`, false);
    const audit = await new AxeBuilder({ page })
      .include('#material-forms')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      audit.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')),
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await forms.scrollIntoViewIfNeeded();
  await shot(page, 'forms-mobile', false);
  await noOverflow(page);
});
test('one continuous article panel contains stationary interactive insets', async ({ page }) => {
  await page.goto('/blog/component-showcase/');
  await settlePage(page);
  const article = page.locator('.article-body.reading-surface');
  await expect(article).toHaveCount(1);
  await expect(article).toHaveClass(/\bglass-panel\b/);
  await expect(article.locator('.reading-surface, .reading-segment')).toHaveCount(0);
  expect(
    await page
      .locator('.interactive')
      .evaluateAll((nodes) =>
        nodes.every((node) => node.closest('.reading-surface')?.matches('.article-body')),
      ),
  ).toBe(true);
  await expect(article).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const assertTranslucentMaterial = async () => {
    const material = await article.evaluate((node) => {
      const style = getComputedStyle(node);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.fillStyle = style.backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return {
        alpha: context.getImageData(0, 0, 1, 1).data[3] / 255,
        sheen: style.backgroundImage,
        blur: style.backdropFilter,
        textFilter: style.filter,
      };
    });
    expect(material.alpha).toBeGreaterThan(0.1);
    expect(material.alpha).toBeLessThan(0.8);
    expect(material.sheen).toContain('linear-gradient');
    expect(material.blur).toContain('blur(');
    expect(material.textFilter).toBe('none');
  };
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((node, theme) => (node.dataset.theme = theme), theme);
    await assertTranslucentMaterial();
    await article.evaluate((node) =>
      scrollTo({ top: scrollY + node.getBoundingClientRect().top - 125, behavior: 'instant' }),
    );
    await shot(page, `reading-glass-${theme}`, false);
  }
  await page.locator('html').evaluate((node) => (node.dataset.theme = 'light'));
  const plot = page.locator('[data-interactive="function-plot"]').first();
  await plot.scrollIntoViewIfNeeded();
  const before = (await plot.boundingBox())!;
  await plot.hover();
  await plot.getByRole('slider', { name: 'Amplitude', exact: true }).focus();
  const after = (await plot.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  const slider = plot.getByRole('slider', { name: 'Amplitude', exact: true });
  const start = await slider.evaluate((node) => node.style.getPropertyValue('--range-fill'));
  await slider.press('End');
  await expect(slider).toHaveCSS('--range-fill', '100%');
  await plot.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(slider).toHaveCSS('--range-fill', start);
  await page.evaluate(() => {
    const root = document.documentElement;
    root.dataset.wallpaper = 'true';
    root.style.setProperty('--page-background-image', 'url("/media/coast-dusk.svg")');
  });
  await shot(page, 'interactive-glass-picture', false);
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((node, theme) => (node.dataset.theme = theme), theme);
    await assertTranslucentMaterial();
    await article.evaluate((node) =>
      scrollTo({ top: scrollY + node.getBoundingClientRect().top - 125, behavior: 'instant' }),
    );
    await shot(page, `reading-glass-wallpaper-${theme}`, false);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await assertTranslucentMaterial();
  await shot(page, 'reading-glass-wallpaper-mobile', false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('html').evaluate((node) => (node.dataset.theme = 'light'));
  const audit = await new AxeBuilder({ page })
    .include('[data-interactive="function-plot"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(audit.violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''))).toEqual(
    [],
  );
  await page.locator('html').evaluate((node) => (node.dataset.reduceTransparency = 'true'));
  await expect(article).toHaveCSS('backdrop-filter', 'none');
  expect(
    await article.evaluate((node) => {
      const swatch = document.createElement('span');
      swatch.style.backgroundColor = 'var(--surface-solid)';
      node.append(swatch);
      const matches =
        getComputedStyle(node).backgroundColor === getComputedStyle(swatch).backgroundColor;
      swatch.remove();
      return matches;
    }),
  ).toBe(true);
});
test('Archive gathers published writing and Lab entries into a searchable timeline', async ({
  page,
  request,
}) => {
  const model = await session(request);
  const published = model.entries.filter(
    (entry: { status: string }) => entry.status === 'published',
  );
  const cover = page.locator('.timeline-cover').first();
  async function inlineCover() {
    await cover.scrollIntoViewIfNeeded();
    await expect(cover).toBeVisible();
    await expect(cover).toHaveCSS('opacity', '1');
    await expect
      .poll(() =>
        cover.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0),
      )
      .toBe(true);
    // Sample one layout frame: separate protocol calls can straddle the Studio's responsive resize.
    const { image, entry, text } = await cover.evaluate((node) => {
      const box = (element: Element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const entry = node.parentElement!;
      return {
        image: box(node),
        entry: box(entry),
        text: box(entry.querySelector('.timeline-entry-content')!),
      };
    });
    expect(image.width).toBeGreaterThanOrEqual(74);
    expect(image.height).toBeGreaterThanOrEqual(55);
    expect(image.x).toBeGreaterThanOrEqual(entry.x);
    expect(image.y).toBeGreaterThanOrEqual(entry.y);
    expect(image.x + image.width).toBeLessThanOrEqual(entry.x + entry.width + 1);
    expect(image.y + image.height).toBeLessThanOrEqual(entry.y + entry.height + 1);
    expect(image.x >= text.x + text.width - 1 || image.y + image.height <= text.y + 1).toBe(true);
    return { image, entry, text };
  }
  await page.goto('/archive/');
  await expect(page.locator('.archive-heading')).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Filter archive', exact: true })).toBeVisible();
  await expect(page.locator('.post-timeline-item')).toHaveCount(published.length);
  await expect(page.locator('.post-timeline')).not.toContainText('A thought in progress');
  const dates = await page
    .locator('.post-timeline-item > time')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('datetime')));
  expect(dates).toEqual([...dates].sort().reverse());
  await expect(page.locator('.timeline-cover')).toHaveCount(
    published.filter((entry: { cover: string }) => entry.cover).length,
  );
  await settlePage(page);
  const initial = await inlineCover();
  await cover.hover();
  expect(await inlineCover()).toEqual(initial);
  await cover.locator('..').focus();
  expect(await inlineCover()).toEqual(initial);
  await shot(page, 'archive-desktop');
  await page
    .getByRole('group', { name: 'Filter archive by kind' })
    .getByRole('button', { name: 'Lab', exact: true })
    .click();
  await expect(page.locator('.post-timeline-item:visible')).toHaveCount(
    published.filter((entry: { kind: string }) => entry.kind === 'lab').length,
  );
  await page.getByRole('searchbox', { name: 'Filter archive', exact: true }).fill('shape');
  await expect(page.locator('.post-timeline-item:visible')).toHaveCount(1);
  await expect(page.locator('.post-timeline-item:visible')).toContainText('The shape of a wave');
  await page
    .getByRole('searchbox', { name: 'Filter archive', exact: true })
    .fill('no-such-archived-page');
  await expect(page.locator('[data-timeline-empty]')).toBeVisible();
  await expect(page.locator('[data-timeline-year]:visible')).toHaveCount(0);
  await page.setViewportSize({ width: 834, height: 1000 });
  await page.goto('/archive/');
  await settlePage(page);
  await inlineCover();
  await noOverflow(page);
  await shot(page, 'archive-tablet');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/archive/');
  await settlePage(page);
  await inlineCover();
  await noOverflow(page);
  await shot(page, 'archive-mobile');
  await page.getByRole('button', { name: 'Change appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await inlineCover();
  await shot(page, 'archive-mobile-dark');
  const destination = new URL((await cover.locator('..').getAttribute('href'))!, page.url()).href;
  await cover.click();
  await expect(page).toHaveURL(destination);
  await page.goto('/studio/#archive');
  await expect(page.locator('.post-timeline-item')).toHaveCount(published.length);
  await inlineCover();
  await shot(page, 'archive-studio-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await inlineCover();
  await noOverflow(page);
  await shot(page, 'archive-studio-desktop');
  await page
    .getByRole('searchbox', { name: 'Filter archive', exact: true })
    .fill('component showcase');
  await expect(page.locator('.post-timeline-item')).toHaveCount(1);
  await noOverflow(page);
  await page
    .getByRole('button', { name: 'Edit The component showcase', exact: true })
    .locator('.timeline-cover')
    .click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  const redirect = await request.get('/news/', { maxRedirects: 0 });
  expect(redirect.status()).toBe(301);
  expect(redirect.headers().location).toBe('/archive/');
});
test('showcase renders every component variant independently and follows appearance changes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/blog/component-showcase/');
  const plots = page.locator('[data-interactive="function-plot"]');
  await expect(plots).toHaveCount(3);
  for (const plot of await plots.all()) {
    await plot.scrollIntoViewIfNeeded();
    await expect(plot).toHaveAttribute('data-enhanced', 'true');
    const before = await plot.locator('.plot-curve').getAttribute('d');
    await plot.getByRole('slider', { name: 'Amplitude', exact: true }).press('ArrowRight');
    await expect(plot.locator('.plot-curve')).not.toHaveAttribute('d', before!);
    await plot.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(plot.locator('.plot-curve')).toHaveAttribute('d', before!);
  }
  const charts = page.locator('[data-interactive="chart"]');
  await expect(charts).toHaveCount(2);
  for (const chart of await charts.all()) {
    await chart.scrollIntoViewIfNeeded();
    await chart.getByRole('button', { name: 'Reading', exact: true }).click();
    await expect(chart.getByRole('button', { name: 'Reading', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await chart.locator('summary').click();
    await expect(chart.getByRole('table')).toBeVisible();
    await expect(chart.getByRole('row')).toHaveCount(7);
  }
  const comparison = page.locator('[data-interactive="image-compare"]');
  await comparison.scrollIntoViewIfNeeded();
  await comparison.getByRole('slider').press('ArrowRight');
  await expect(comparison.locator('.comparison')).toHaveAttribute('style', /51%/);
  await page.locator('[data-mermaid]').first().scrollIntoViewIfNeeded();
  await expect(page.locator('[data-mermaid] .mermaid-canvas svg:visible')).toHaveCount(2);
  await page.getByRole('button', { name: 'Change appearance' }).click();
  await expect(page.locator('[data-mermaid] [data-diagram-variant="dark"]:visible')).toHaveCount(2);
  await page.getByText('Open a quieter note', { exact: true }).click();
  await expect(page.locator('.prose > details').first()).toHaveAttribute('open');
  const brokenFootnotes = await page
    .locator('[data-footnote-ref], [data-footnote-backref]')
    .evaluateAll((nodes) =>
      nodes.some((node) => !document.getElementById((node as HTMLAnchorElement).hash.slice(1))),
    );
  expect(brokenFootnotes).toBe(false);
  // Audit the painted theme after the footer link's finite color transition.
  await page
    .locator('.article-bottom .text-link')
    .first()
    .evaluate(async (node) => {
      getComputedStyle(node).getPropertyValue('color');
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await Promise.allSettled(node.getAnimations().map((animation) => animation.finished));
    });
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    audit.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact || ''),
    ),
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-interactive="image-compare"]').scrollIntoViewIfNeeded();
  await noOverflow(page);
  await shot(page, 'showcase-mobile', false);
  expect(errors).toEqual([]);
});
test('Liquid Glass renders a refractive optical layer and a solid accessibility fallback', async ({
  page,
}) => {
  await page.goto('/__components/');
  await settlePage(page);
  // A high-contrast probe and known optical settings isolate refraction from author preferences.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--glass-strength', '1');
    document.documentElement.style.setProperty('--glass-blur', '8px');
    document.documentElement.style.setProperty('--glass-saturation', '175%');
    const grid = document.querySelector<HTMLElement>('.material-grid')!;
    grid.style.backgroundImage =
      'linear-gradient(#ffffff99 1px, transparent 1px), linear-gradient(90deg, #ffffff99 1px, transparent 1px)';
  });
  const lens = page.locator('.material-demo-lens');
  await lens.scrollIntoViewIfNeeded();
  await expect(lens).toHaveAttribute('data-liquid', 'optic');
  await expect(lens.locator('h3')).toHaveCSS('filter', 'none');
  await expect
    .poll(() => lens.evaluate((node) => getComputedStyle(node, '::before').backdropFilter))
    .toMatch(/blur\(/);
  if (test.info().project.name === 'chromium') {
    await expect(page.locator('html')).toHaveAttribute('data-glass-renderer', 'svg');
    await expect
      .poll(() => lens.evaluate((node) => node.style.getPropertyValue('--liquid-refraction')))
      .toContain('url(');
    await expect
      .poll(() => lens.evaluate((node) => node.style.getPropertyValue('--liquid-refraction')))
      .toContain('blur(5.20px)');
    const original = await lens.evaluate((node) =>
      node.style.getPropertyValue('--liquid-refraction'),
    );
    const refracted = await lens.screenshot({ animations: 'disabled' });
    await lens.evaluate(
      (node, value) =>
        node.style.setProperty('--liquid-refraction', value.replace(/^url\([^)]+\)\s*/, '')),
      original,
    );
    const flat = await lens.screenshot({ animations: 'disabled' });
    const first = await sharp(refracted).raw().toBuffer(),
      second = await sharp(flat).raw().toBuffer();
    let difference = 0;
    for (let index = 0; index < first.length; index++)
      difference += Math.abs(first[index] - second[index]);
    expect(difference / first.length).toBeGreaterThan(0.25);
    await lens.evaluate(
      (node, value) => node.style.setProperty('--liquid-refraction', value),
      original,
    );
  } else await expect(page.locator('html')).toHaveAttribute('data-glass-renderer', 'css');
  const bounds = (await lens.boundingBox())!;
  await page.mouse.move(bounds.x + 25, bounds.y + 30);
  await expect(lens).toHaveAttribute('data-liquid-hover', 'true');
  await shot(page, 'liquid-glass-specimen', false);
  await page.setViewportSize({ width: 390, height: 844 });
  await lens.scrollIntoViewIfNeeded();
  await noOverflow(page);
  await page.evaluate(() => {
    document.documentElement.dataset.reduceTransparency = 'true';
  });
  await expect(page.locator('html')).toHaveAttribute('data-glass-renderer', 'solid');
  await expect
    .poll(() => lens.evaluate((node) => getComputedStyle(node, '::before').display))
    .toBe('none');
});
test('post outline floats beside the article and folds into a mobile control', async ({ page }) => {
  await page.goto('/blog/good-tools-get-out-of-the-way/');
  const outline = page.getByRole('complementary', { name: 'Article outline' });
  const disclosure = outline.locator('details');
  const nav = outline.getByRole('navigation', { name: 'Table of contents' });
  const section = nav.getByRole('link', { name: 'A material with a purpose' });
  const articleBox = await page.locator('.article-body').boundingBox();
  const outlineBox = await outline.boundingBox();
  expect(outlineBox!.x + outlineBox!.width).toBeLessThan(articleBox!.x);
  await expect(disclosure).toHaveAttribute('open');
  await expect
    .poll(() => disclosure.evaluate((node) => getComputedStyle(node, '::before').backdropFilter))
    .toMatch(/blur\(/);
  await section.click();
  await expect(section).toHaveAttribute('aria-current', 'location');
  await expect.poll(async () => (await outline.boundingBox())!.y).toBeLessThan(120);
  await expect(page.locator('[data-outline-progress]')).not.toHaveText('0%');
  await shot(page, 'post-floating-outline', false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/blog/good-tools-get-out-of-the-way/');
  await expect(disclosure).not.toHaveAttribute('open');
  await expect(outline).toBeVisible();
  expect((await outline.boundingBox())!.x).toBeLessThan(40);
  await outline.locator('summary').click();
  await expect(nav).toBeVisible();
  await section.click();
  await expect(page).toHaveURL(/#a-material-with-a-purpose$/);
  await expect(disclosure).not.toHaveAttribute('open');
  await outline.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('open');
  await expect(section).toHaveAttribute('aria-current', 'location');
  await shot(page, 'post-mobile-outline', false);
  await noOverflow(page);
});
test('lab controls enhance generated SVG, tables, comparisons and diagrams', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab/the-shape-of-a-wave/');
  const plot = page.locator('[data-interactive="function-plot"]');
  await plot.scrollIntoViewIfNeeded();
  await expect(plot).toHaveAttribute('data-enhanced', 'true');
  const before = await plot.locator('.plot-curve').getAttribute('d');
  await page.getByRole('slider', { name: 'Amplitude', exact: true }).press('ArrowRight');
  await expect(plot.locator('.plot-curve')).not.toHaveAttribute('d', before!);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Amplitude', exact: true })).toHaveValue('1.5');
  await page.locator('[data-mermaid]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-mermaid] .mermaid-canvas svg:visible')).toBeVisible();
  await shot(page, 'wave-article');
  await page.goto('/lab/a-change-in-the-light/');
  const compare = page.locator('[data-interactive="image-compare"]');
  await compare.scrollIntoViewIfNeeded();
  await expect(compare).toHaveAttribute('data-enhanced', 'true');
  await page.getByRole('slider', { name: 'Comparison position' }).press('ArrowRight');
  await expect(compare.locator('.comparison')).toHaveAttribute('style', /51%/);
  const divider = compare.getByRole('slider', { name: 'Comparison position' });
  await expect(compare.locator('input[type="range"]')).toHaveCount(0);
  await divider.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '0');
  await divider.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '100');
  await divider.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '99');
  const imageBounds = (await compare.locator('.comparison').boundingBox())!;
  await page.mouse.move(
    imageBounds.x + imageBounds.width - 3,
    imageBounds.y + imageBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    imageBounds.x + imageBounds.width * 0.25,
    imageBounds.y + imageBounds.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '25');
  await shot(page, 'comparison-divider', false);
  const chart = page.locator('[data-interactive="chart"]');
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toHaveAttribute('data-enhanced', 'true');
  await chart.getByRole('button', { name: 'Reading', exact: true }).click();
  await expect(chart.getByRole('button', { name: 'Reading', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await chart.locator('summary').click();
  await expect(chart.locator('table')).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});
test('mobile public navigation and Studio use responsive layouts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await noOverflow(page);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .locator('a[href="/archive/"]')
    .click();
  await expect(page.getByRole('searchbox', { name: 'Filter archive', exact: true })).toBeVisible();
  await shot(page, 'mobile-writing');
  await noOverflow(page);
  await page.goto('/studio/');
  await expect(page).toHaveTitle('Glass Studio');
  await expect(page.getByRole('heading', { name: 'A little room to create.' })).toBeVisible();
  await noOverflow(page);
  await shot(page, 'mobile-studio');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page
    .getByRole('navigation', { name: 'Studio navigation' })
    .getByRole('button', { name: 'Appearance', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'A material, a mood.' })).toBeVisible();
  await noOverflow(page);
});
test('Studio creates, autosaves, previews, inserts math, and recovers an entry', async ({
  page,
  request,
}) => {
  const title = `Browser notebook ${test.info().project.name}`;
  let id = '';
  await page.goto('/studio/');
  await expect(page.getByRole('heading', { name: 'A little room to create.' })).toBeVisible();
  await shot(page, 'studio-overview');
  await page.getByRole('button', { name: 'Start a new entry' }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Article title' })).toHaveValue(title);
  id = (await session(request)).entries.find((e: any) => e.title === title).id;
  try {
    await page
      .getByRole('textbox', { name: 'Article summary' })
      .fill('A saved thought from the browser test.');
    await expect
      .poll(async () => (await session(request)).entries.find((e: any) => e.id === id).summary)
      .toBe('A saved thought from the browser test.');
    await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
    await page.getByRole('button', { name: 'Insert component' }).click();
    await page.getByRole('button', { name: 'Equation', exact: true }).click();
    await page.getByRole('textbox', { name: 'LaTeX equation' }).fill('E = mc^2');
    await page.getByRole('button', { name: 'Insert into Markdown' }).click();
    await expect
      .poll(async () => (await session(request)).entries.find((e: any) => e.id === id).body)
      .toContain('E = mc^2');
    const frame = page.frameLocator('iframe[title="Live article preview"]');
    await expect(frame.locator('[role=math] svg').first()).toBeVisible();
    await shot(page, 'studio-editor');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Move this entry to Trash?' })
      .getByRole('button', { name: 'Move to Trash', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Thoughts taking shape.' })).toBeVisible();
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    const row = page.locator('.managed-entry-row').filter({ hasText: title });
    await row.getByRole('button', { name: 'Restore entry' }).click();
    await page
      .getByRole('dialog', { name: 'Restore selected entries?' })
      .getByRole('button', { name: 'Restore entries', exact: true })
      .click();
    await expect
      .poll(async () => (await session(request)).entries.some((e: any) => e.id === id))
      .toBe(true);
  } finally {
    const entry = (await session(request)).entries.find((e: any) => e.id === id);
    if (entry) await mutate(request, `content/${id}`, 'DELETE', { revision: entry.revision });
  }
});
test('an external edit preserves unsaved text and exposes conflict resolution', async ({
  page,
  request,
}) => {
  const create = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Conflict fixture',
    slug: `conflict-${test.info().project.name}`,
  });
  const entry = await create.json();
  try {
    await page.goto('/studio/#writing');
    await page.locator('.managed-entry-open').filter({ hasText: 'Conflict fixture' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('textbox', { name: 'Article summary' }).fill('My local unsaved words');
    await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
    await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: { ...entry, summary: 'Changed externally' },
      body: entry.body,
      revision: entry.revision,
    });
    await expect(page.getByRole('button', { name: 'Reload latest file' })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Article summary' })).toHaveValue(
      'My local unsaved words',
    );
    await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
    await page.getByRole('button', { name: 'Reload latest file' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Article summary' })).toHaveValue(
      'Changed externally',
    );
  } finally {
    const current = (await session(request)).entries.find((e: any) => e.id === entry.id);
    if (current)
      await mutate(request, `content/${entry.id}`, 'DELETE', { revision: current.revision });
  }
});
test('appearance settings preview and persist without changing the notebook content', async ({
  page,
  request,
}) => {
  const original = await session(request);
  try {
    await page.goto('/studio/#appearance');
    await expect(page.getByRole('heading', { name: 'A material, a mood.' })).toBeVisible();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    const frame = page.frameLocator('iframe[title="Live appearance preview"]');
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
    await selectSettingsSection(page, 'wallpaper', true);
    await page.getByRole('button', { name: 'Choose picture', exact: true }).click();
    await page.locator('.media-picker-grid button').filter({ hasText: 'coast-dusk.svg' }).click();
    await expect(frame.locator('html')).toHaveAttribute('data-wallpaper', 'true');
    await expect(frame.locator('html')).toHaveCSS(
      '--page-background-image',
      'url("/media/coast-dusk.svg")',
    );
    await selectSettingsSection(page, 'typography', true);
    const typeScale = page.getByRole('slider', { name: 'Interface scale', exact: true });
    await typeScale.press('End');
    await expect(frame.locator('html')).toHaveCSS('--font-scale', '1.5');
    const largerText = await frame
      .locator('.chapter-copy p')
      .first()
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    await typeScale.press('Home');
    await expect(frame.locator('html')).toHaveCSS('--font-scale', '0.8');
    await expect
      .poll(() =>
        frame
          .locator('.chapter-copy p')
          .first()
          .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
      )
      .toBeLessThan(largerText);
    await shot(page, 'studio-appearance');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await session(request)).site.theme.appearance).toBe('dark');
    await expect
      .poll(async () => (await session(request)).site.theme.backgroundImage)
      .toBe('/media/coast-dusk.svg');
    await page.reload();
    await selectSettingsSection(page, 'mode', true);
    await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await selectSettingsSection(page, 'wallpaper', true);
    await expect(page.getByAltText('Background picture preview')).toBeVisible();
    await page.getByRole('button', { name: 'Clear picture', exact: true }).click();
    await expect(frame.locator('html')).not.toHaveAttribute('data-wallpaper', 'true');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await session(request)).site.theme.backgroundImage).toBe('');
  } finally {
    const now = await session(request);
    await mutate(request, 'site', 'PUT', { value: original.site, revision: now.siteRevision });
  }
});
test('build button completes a real static build and shows validation progress', async ({
  page,
}) => {
  await page.goto('/studio/#builds');
  const started = page.waitForResponse(
    (response) => response.url().endsWith('/api/jobs') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Build site', exact: true }).click();
  const { id } = await (await started).json();
  const job = page.locator(`.build-job[data-job-id="${id}"]`);
  await expect(job.locator('.job-status')).toHaveText('Complete');
  await expect(job.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await expect(job.locator('.job-progress-stages [data-status="done"]')).toHaveCount(2);
  const summary = job.locator('.build-job-summary');
  if ((await summary.getAttribute('aria-expanded')) === 'false') await summary.click();
  await expect(job.locator('.job-log')).toContainText('passed validation');
  await shot(page, 'studio-builds');
});
test('photo journal edits persist and can be undone', async ({ page, request }) => {
  const original = await session(request);
  try {
    await page.goto('/studio/#photos');
    await page.getByRole('button', { name: 'Add a moment', exact: true }).click();
    await page.getByRole('button', { name: 'Choose a photo', exact: true }).click();
    await page.locator('.media-picker-grid button').filter({ hasText: 'coast-dawn.svg' }).click();
    await page
      .getByRole('textbox', { name: 'Caption', exact: true })
      .fill('A temporary journal moment');
    await page
      .getByRole('textbox', { name: 'Image description' })
      .fill('A quiet illustrated coastline');
    await page.getByRole('button', { name: 'Save to collection', exact: true }).click();
    await expect(
      page.locator('.studio-photo-card').filter({ hasText: 'A temporary journal moment' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(
      page.locator('.studio-photo-card').filter({ hasText: 'A temporary journal moment' }),
    ).toHaveCount(0);
  } finally {
    const now = await session(request);
    if (JSON.stringify(now.library) !== JSON.stringify(original.library))
      await mutate(request, 'library', 'PUT', {
        value: original.library,
        revision: now.libraryRevision,
      });
  }
});
test('media upload produces an editable local asset and can be found by name', async ({ page }) => {
  await page.goto('/studio/#media');
  const image = await sharp({
    create: { width: 24, height: 16, channels: 3, background: '#c5d6ee' },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel('Upload media files')
    .setInputFiles({ name: 'browser-check.png', mimeType: 'image/png', buffer: image });
  await page.getByRole('button', { name: 'Apply & upload' }).click();
  await expect(
    page.locator('.media-card').filter({ hasText: 'browser-check-' }).first(),
  ).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search media library' }).fill('browser-check');
  await page.locator('.media-card').first().click();
  await expect(page.getByRole('dialog', { name: 'A closer look' })).toBeVisible();
  await expect(page.locator('.media-detail-name')).toContainText('.webp');
});
test('Build & Publish uploads only after a real build using the controlled Cloudflare runner', async ({
  page,
  request,
}) => {
  const original = await session(request);
  try {
    const config = {
      ...original.site,
      url: 'https://fixture.pages.dev',
      cloudflare: { accountId: 'a'.repeat(32), projectName: 'fixture', productionBranch: 'main' },
    };
    expect(
      (
        await mutate(request, 'site', 'PUT', { value: config, revision: original.siteRevision })
      ).ok(),
    ).toBe(true);
    await page.goto('/studio/#builds');
    const started = page.waitForResponse(
      (response) => response.url().endsWith('/api/jobs') && response.request().method() === 'POST',
    );
    await page
      .locator('.studio-page')
      .getByRole('button', { name: 'Build & Publish', exact: true })
      .click();
    const { id } = await (await started).json();
    const job = page.locator(`.build-job[data-job-id="${id}"]`);
    await expect(job.locator('.job-status')).toHaveText('Complete');
    await expect(job.locator('.job-progress-copy strong')).toHaveText('Published & verified');
    await expect(job.locator('.job-progress-stages [data-status="done"]')).toHaveCount(3);
    await expect(
      job.getByRole('link', { name: 'https://controlled.fixture.pages.dev' }),
    ).toBeVisible();
    await job.locator('.build-job-summary').click();
    await expect(job.locator('.job-log')).toContainText('passed validation');
    await expect(job.locator('.job-log')).toContainText(
      'Published and verified: https://controlled.fixture.pages.dev',
    );
  } finally {
    const now = await session(request);
    await mutate(request, 'site', 'PUT', { value: original.site, revision: now.siteRevision });
  }
});
test('representative public and Studio views have no serious automated accessibility violations', async ({
  page,
}) => {
  const failures: unknown[] = [];
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('fieldnotes-appearance', 'light'));
  for (const route of [
    '/',
    '/lab/the-shape-of-a-wave/',
    '/blog/component-showcase/',
    '/settings/',
    '/studio/',
    '/studio/#media',
    '/studio/#settings',
    '/studio/#writing',
  ]) {
    await page.goto(route);
    if (route.startsWith('/studio'))
      await expect(page.locator('.studio-page-heading')).toBeVisible();
    else await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (route.endsWith('#writing'))
      await page
        .locator('.managed-entry-open')
        .filter({ hasText: 'A thought in progress' })
        .click();
    await settlePage(page);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const violations = result.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact || ''),
    );
    failures.push(
      ...violations.map((v) => ({
        route,
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    );
  }
  await page.goto('/settings/');
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
  // Studio retains its separate local appearance preference.
  await page.evaluate(() => localStorage.setItem('fieldnotes-appearance', 'dark'));
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const route of [
    '/',
    '/settings/',
    '/lab/the-shape-of-a-wave/',
    '/blog/component-showcase/',
    '/studio/',
  ]) {
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    if (route.startsWith('/studio'))
      await expect(page.locator('.studio-page-heading')).toBeVisible();
    else await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settlePage(page);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    failures.push(
      ...result.violations
        .filter((v) => ['serious', 'critical'].includes(v.impact || ''))
        .map((v) => ({
          route: route + ' (dark)',
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
    );
    if (route === '/studio/') await shot(page, 'studio-dark');
  }
  expect(failures).toEqual([]);
});
test('reduced motion and solid materials remain usable on a tablet viewport', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await noOverflow(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/studio/#appearance');
  await selectSettingsSection(page, 'accessibility', true);
  await page.getByRole('switch', { name: 'Reduce transparency' }).check();
  const frame = page.frameLocator('iframe[title="Live appearance preview"]');
  await expect(frame.locator('html')).toHaveAttribute('data-reduce-transparency', 'true');
  await expect(frame.locator('.header-inner')).toHaveCSS('backdrop-filter', 'none');
  await expect
    .poll(() =>
      frame.locator('.header-inner').evaluate((node) => getComputedStyle(node, '::before').display),
    )
    .toBe('none');
  await noOverflow(page);
});
test('a delayed save response is recognized as our own filesystem change', async ({
  page,
  request,
}) => {
  const response = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Slow save fixture',
    slug: `slow-save-${test.info().project.name}`,
  });
  const entry = await response.json();
  try {
    await page.route(`**/api/content/${entry.id}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      const saved = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({ response: saved });
    });
    await page.goto('/studio/#writing');
    await page.locator('.managed-entry-open').filter({ hasText: 'Slow save fixture' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Article summary' })
      .fill('Keep this thought through a slow save.');
    await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
    await expect(page.locator('.save-status')).toHaveText('All changes saved');
    await expect
      .poll(
        async () => (await session(request)).entries.find((e: any) => e.id === entry.id).summary,
      )
      .toBe('Keep this thought through a slow save.');
    await expect(page.getByRole('button', { name: 'Reload latest file' })).toHaveCount(0);
  } finally {
    const now = (await session(request)).entries.find((e: any) => e.id === entry.id);
    if (now) await mutate(request, `content/${entry.id}`, 'DELETE', { revision: now.revision });
  }
});
test('Cloudflare Pages emulator serves direct routes, CSP-safe widgets, and a true 404', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const response = await page.goto('http://127.0.0.1:4174/lab/the-shape-of-a-wave/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
  await expect(page.locator('[role=math] svg').first()).toBeVisible();
  const plot = page.locator('[data-interactive]');
  await plot.scrollIntoViewIfNeeded();
  await expect(plot).toHaveAttribute('data-enhanced', 'true');
  await page.locator('[data-mermaid]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-mermaid] .mermaid-canvas svg:visible')).toBeVisible();
  expect((await request.get('http://127.0.0.1:4174/no-such-page/')).status()).toBe(404);
  expect(errors).toEqual([]);
});
