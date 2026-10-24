import { selectSettingsSection } from './settings-navigation.js';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp: typeof import('sharp').default = require('sharp');
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;
const session = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, url: string, method: string, data: unknown) {
  const model = await session(request);
  const response = await request.fetch(`/api/${url}`, {
    method,
    data,
    headers: { 'X-Studio-Token': model.token, Origin: 'http://127.0.0.1:4387' },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function build(request: APIRequestContext) {
  const job = await mutate(request, 'jobs', 'POST', { action: 'build' });
  await expect
    .poll(async () => (await session(request)).jobs.find((item: any) => item.id === job.id)?.state)
    .toBe('succeeded');
}
async function cleanupEntry(request: APIRequestContext, id: string) {
  const entry = (await session(request)).entries.find((item: any) => item.id === id);
  if (entry) await mutate(request, `content/${id}`, 'DELETE', { revision: entry.revision });
}
async function stable(page: Page) {
  await page.waitForFunction(() => !document.documentElement.matches(':active-view-transition'));
  if (await page.locator('.site-main').count())
    await expect
      .poll(() =>
        page.locator('html').evaluate((node) => getComputedStyle(node, '::before').opacity),
      )
      .toBe('0');
}

test('quiz feedback, reset, and tab keyboard navigation work independently', async ({ page }) => {
  await page.goto('/blog/component-showcase/');
  const quiz = page.locator('[data-interactive="quiz"]');
  await quiz.scrollIntoViewIfNeeded();
  await expect(quiz).toHaveAttribute('data-enhanced', 'true');
  const check = quiz.getByRole('button', { name: 'Check answer' });
  await expect(check).toBeDisabled();
  await quiz.getByRole('radio').first().check();
  await check.click();
  await expect(quiz.locator('.quiz-feedback')).toHaveAttribute('data-state', 'incorrect');
  await quiz.getByRole('radio').nth(1).check();
  await check.click();
  await expect(quiz.locator('.quiz-feedback')).toHaveAttribute('data-state', 'correct');
  await quiz.getByRole('button', { name: 'Reset' }).click();
  await expect(check).toBeDisabled();
  await expect(quiz.locator('.quiz-solution')).not.toHaveAttribute('open');
  const tabs = page.locator('[data-interactive="tabs"]');
  await tabs.scrollIntoViewIfNeeded();
  await expect(tabs.getByRole('tabpanel')).toHaveCount(1);
  await tabs.getByRole('tab').first().focus();
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab').last()).toBeFocused();
  await expect(tabs.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab').first()).toBeFocused();
  await expect(quiz.locator('.quiz-feedback')).toBeEmpty();
  await page.setViewportSize({ width: 390, height: 844 });
  await tabs.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true,
  );
});

test('history compares and restores saved Markdown in the History workspace', async ({
  page,
  request,
}) => {
  const workers: string[] = [],
    errors: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'History browser fixture',
    slug: `history-${test.info().project.name}`,
  });
  try {
    const earlier = await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: entry,
      body: 'An earlier sentence.',
      revision: entry.revision,
    });
    await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: earlier,
      body: 'A revised sentence.',
      revision: earlier.revision,
    });
    await page.goto('/studio/#writing');
    await page
      .locator('.managed-entry-open')
      .filter({ hasText: 'History browser fixture' })
      .click();
    await page.getByRole('button', { name: 'Revision history', exact: true }).click();
    const dialog = page.getByRole('region', { name: 'Revision history' });
    const comparison = dialog.getByRole('region', { name: 'Markdown differences' });
    await expect(comparison).toHaveAttribute('data-ready', 'true');
    await expect(comparison).toHaveAttribute('data-layout', 'split');
    await expect(comparison.locator('.cm-mergeView')).toBeVisible();
    await expect(comparison.locator('.cm-merge-a .cm-content')).toContainText(
      'An earlier sentence.',
    );
    await expect(comparison.locator('.cm-merge-b .cm-content')).toContainText(
      'A revised sentence.',
    );
    expect(await comparison.locator('.cm-changedText').count()).toBeGreaterThan(0);
    await comparison.locator('.cm-merge-b .cm-content').click({ position: { x: 30, y: 10 } });
    await page.keyboard.type('This comparison stays read only.');
    await expect(comparison.locator('.cm-merge-b .cm-content')).toContainText(
      'A revised sentence.',
    );
    await expect(comparison.locator('.cm-merge-b .cm-content')).not.toContainText('read only');
    await expect(dialog.locator('.diff-status')).toContainText('1 changed region');
    expect(workers.some((url) => url.includes('diff.worker'))).toBe(true);
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await page
      .getByRole('button', { name: 'Toggle Studio appearance' })
      .evaluate((node) => (node as HTMLButtonElement).click());
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(comparison.locator('.cm-mergeView')).toBeVisible();
    const audit = await new AxeBuilder({ page })
      .include('.revision-workspace')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      audit.violations.filter((item) => ['serious', 'critical'].includes(item.impact || '')),
    ).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(comparison).toHaveAttribute('data-layout', 'inline');
    await expect(comparison.locator('.cm-content[contenteditable=false]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    await dialog.getByRole('button', { name: 'Review restore' }).click();
    await page
      .getByRole('dialog', { name: 'Restore this revision?' })
      .getByRole('button', { name: 'Restore this revision', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(
        async () => (await session(request)).entries.find((item: any) => item.id === entry.id).body,
      )
      .toBe(earlier.body);
    await page.reload();
    await page
      .locator('.managed-entry-open')
      .filter({ hasText: 'History browser fixture' })
      .click();
    await expect(page.locator('.source-pane .cm-content')).toContainText('An earlier sentence.');
    expect(errors).toEqual([]);
  } finally {
    await cleanupEntry(request, entry.id);
  }
});

test('portable backup download, import review, and restore preserve a safety copy', async ({
  page,
  request,
}) => {
  await page.goto('/studio/#backups');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Create & download backup' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^glass-.*\.json\.gz$/);
  const file = await download.path();
  expect(file).toBeTruthy();
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Added after backup',
    slug: `after-backup-${test.info().project.name}`,
  });
  try {
    await page.getByLabel('Notebook backup').setInputFiles(file!);
    await expect(page.locator('.backup-review')).toContainText('files added');
    await page.getByRole('button', { name: 'Restore reviewed notebook' }).click();
    const modal = page.getByRole('dialog', { name: 'Restore this notebook?' });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Restore notebook', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Notebook restored');
    expect((await session(request)).entries.some((item: any) => item.id === entry.id)).toBe(false);
    await expect(page.locator('.backup-list')).toContainText('Before restore');
    const schedule = await (await request.get('/api/schedule')).json();
    expect(schedule.error).toContain('Review restored');
    await mutate(request, 'schedule/run', 'POST', {});
  } finally {
    await cleanupEntry(request, entry.id);
  }
});

test('an editor schedule stays private until a manual Automation check builds it', async ({
  page,
  request,
}) => {
  const original = await session(request);
  const config = {
    ...original.site,
    publishing: { scheduleEnabled: false, scheduleAction: 'build' },
  };
  await mutate(request, 'site', 'PUT', { value: config, revision: original.siteRevision });
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Scheduled browser fixture',
    slug: `scheduled-${test.info().project.name}`,
  });
  try {
    await page.goto('/studio/#writing');
    await page
      .locator('.managed-entry-open')
      .filter({ hasText: 'Scheduled browser fixture' })
      .click();
    await page.getByRole('combobox', { name: 'Publication status' }).selectOption('scheduled');
    await page.getByLabel('Publish at', { exact: false }).fill('2020-01-02T09:00');
    await expect
      .poll(
        async () =>
          (await session(request)).entries.find((item: any) => item.id === entry.id).status,
      )
      .toBe('scheduled');
    expect((await request.get(`/blog/${entry.slug}/`)).status()).toBe(404);
    await page.goto('/studio/#settings');
    await selectSettingsSection(page, 'automation');
    await expect(page.locator('.scheduled-list')).toContainText(entry.title);
    await page.getByRole('button', { name: 'Check due entries & build', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await session(request)).entries.find((item: any) => item.id === entry.id).status,
      )
      .toBe('published');
    await expect(page.locator('.scheduled-list')).not.toContainText(entry.title);
    expect((await request.get(`/blog/${entry.slug}/`)).status()).toBe(200);
  } finally {
    await cleanupEntry(request, entry.id);
    const model = await session(request);
    await mutate(request, 'site', 'PUT', { value: original.site, revision: model.siteRevision });
    await build(request);
  }
});

test('reading and material controls survive preview, save, reload, and static build', async ({
  page,
  request,
}) => {
  const original = await session(request);
  try {
    await page.goto('/studio/#appearance');
    await selectSettingsSection(page, 'typography', true);
    await page.getByRole('combobox', { name: 'Preview page' }).selectOption({ label: 'Article' });
    await page.getByRole('combobox', { name: 'Reading typeface' }).selectOption('serif');
    await selectSettingsSection(page, 'layout', true);
    await page.getByRole('slider', { name: 'Article width', exact: true }).press('Home');
    await selectSettingsSection(page, 'glass', true);
    await page.getByRole('slider', { name: 'Glass saturation', exact: true }).press('End');
    await selectSettingsSection(page, 'reading', true);
    await page.getByRole('switch', { name: 'Reading progress', exact: true }).uncheck();
    await page.getByRole('switch', { name: 'Floating outline', exact: true }).check();
    await page.getByRole('switch', { name: 'Code line numbers', exact: true }).check();
    const frame = page.frameLocator('iframe[title="Live appearance preview"]');
    await expect(frame.locator('html')).toHaveCSS('--article-width', '480px');
    await expect(frame.locator('html')).toHaveCSS('--glass-saturation', '300%');
    await expect(frame.locator('.article-progress')).toHaveCount(0);
    await expect(frame.locator('.article-body.reading-surface')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await session(request)).site.theme.fontFamily).toBe('serif');
    await page.reload();
    await selectSettingsSection(page, 'typography', true);
    await expect(page.getByRole('combobox', { name: 'Reading typeface' })).toHaveValue('serif');
    await selectSettingsSection(page, 'glass', true);
    await expect(page.getByRole('slider', { name: 'Glass saturation', exact: true })).toHaveValue(
      '300',
    );
    await build(request);
    await page.goto('/blog/component-showcase/');
    await stable(page);
    await expect(page.locator('html')).toHaveCSS('--article-width', '480px');
    await expect(page.locator('.article-progress')).toHaveCount(0);
    const links = page.locator('.post-outline a');
    await links.nth(2).click();
    await expect(links.nth(2)).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('.article-body')).toHaveAttribute('data-code-lines', 'true');
  } finally {
    const model = await session(request);
    await mutate(request, 'site', 'PUT', { value: original.site, revision: model.siteRevision });
    await build(request);
  }
});

test('optional providers use gated loading, transparent themes, stable mapping, and conditional CSP', async ({
  page,
  request,
}) => {
  const original = await session(request);
  const config = {
    ...original.site,
    url: 'https://notebook.test',
    integrations: {
      comments: {
        ...original.site.integrations.comments,
        enabled: true,
        repo: 'example/notebook',
        repoId: 'R_test',
        categoryId: 'DIC_test',
        onDemand: true,
      },
      analytics: { enabled: true, token: 'a'.repeat(32), respectPrivacy: true },
      newsletter: {
        ...original.site.integrations.newsletter,
        enabled: true,
        url: 'https://example.org/subscribe',
      },
    },
  };
  try {
    await mutate(request, 'site', 'PUT', { value: config, revision: original.siteRevision });
    await build(request);
    let loads = 0;
    await page.route('https://giscus.app/**', (route) => {
      loads++;
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><title>Discussion fixture</title><body>Provider fixture<script>addEventListener("message", e=>{if(e.data.giscus)document.documentElement.dataset.theme=e.data.giscus.setConfig.theme})</script></body></html>',
      });
    });
    const response = await page.goto('/blog/component-showcase/');
    expect(response?.headers()['content-security-policy']).toContain('https://giscus.app');
    expect(response?.headers()['content-security-policy']).toContain(
      'https://static.cloudflareinsights.com',
    );
    await stable(page);
    await expect(page.locator('.newsletter-invitation a')).toHaveAttribute(
      'href',
      'https://example.org/subscribe',
    );
    expect(loads).toBe(0);
    expect(await page.locator('script[src*="beacon.min.js"]').count()).toBe(0);
    await page.getByRole('button', { name: 'Load discussion', exact: true }).click();
    await expect(page.frameLocator('iframe[title="Comments"]').locator('body')).toContainText(
      'Provider fixture',
    );
    await expect(page.locator('giscus-widget')).toHaveAttribute(
      'term',
      '/blog/component-showcase/',
    );
    const initialTheme = await page.locator('giscus-widget').getAttribute('theme');
    expect(initialTheme).toMatch(/^(light|transparent_dark)$/);
    await page.getByRole('button', { name: 'Change appearance' }).click();
    await expect(page.frameLocator('iframe[title="Comments"]').locator('html')).toHaveAttribute(
      'data-theme',
      /^(light|transparent_dark)$/,
    );
    await expect(page.frameLocator('iframe[title="Comments"]').locator('html')).not.toHaveAttribute(
      'data-theme',
      initialTheme!,
    );
    const themed = await request.get('/assets/discussion-light.css');
    expect(await themed.text()).toMatch(/background:\s*transparent\b/);
    expect(themed.headers()['access-control-allow-origin']).toBe('*');
    const preview = await mutate(request, 'preview', 'POST', {
      site: config,
      route: '/blog/component-showcase/',
    });
    await page.goto(preview.url);
    await expect(page.getByRole('button', { name: 'Load discussion', exact: true })).toBeDisabled();
    expect(loads).toBe(1);
    expect(await page.locator('script[src*="beacon.min.js"]').count()).toBe(0);
    const media = await request.get('/media/coast-dawn.svg');
    expect(media.headers()['content-security-policy']).toContain('sandbox');
    let beacons = 0;
    await page.route('https://notebook.test/**', async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({ response: await request.get(url.pathname + url.search) });
    });
    await page.route('https://static.cloudflareinsights.com/beacon.min.js', async (route) => {
      beacons++;
      await route.fulfill({
        contentType: 'text/javascript',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: 'globalThis.__fixtureBeacon = true;',
      });
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'doNotTrack', {
        get: () => sessionStorage.getItem('fixture-dnt') || 'unspecified',
      });
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        get: () => sessionStorage.getItem('fixture-gpc') === 'true',
      });
    });
    await page.goto('https://notebook.test/blog/component-showcase/');
    await expect.poll(() => beacons).toBe(1);
    await expect(page.locator('script[src*="beacon.min.js"]')).toHaveAttribute('type', 'module');
    await expect(page.locator('script[src*="beacon.min.js"]')).toHaveAttribute(
      'data-cf-beacon',
      JSON.stringify({ token: 'a'.repeat(32), spa: false }),
    );
    await page.evaluate(() => sessionStorage.setItem('fixture-dnt', '1'));
    await page.reload();
    await stable(page);
    await expect(page.locator('script[src*="beacon.min.js"]')).toHaveCount(0);
    await page.evaluate(() => {
      sessionStorage.removeItem('fixture-dnt');
      sessionStorage.setItem('fixture-gpc', 'true');
    });
    await page.reload();
    await stable(page);
    await expect(page.locator('script[src*="beacon.min.js"]')).toHaveCount(0);
    expect(beacons).toBe(1);
  } finally {
    const model = await session(request);
    await mutate(request, 'site', 'PUT', { value: original.site, revision: model.siteRevision });
    await build(request);
  }
});

test('dialogs render optical pixels, contain focus, and retain solid and mobile fallbacks', async ({
  page,
}) => {
  await page.goto('/');
  await stable(page);
  await page.getByRole('button', { name: 'Search this notebook' }).click();
  const dialog = page.locator('#search-dialog');
  await page.evaluate(() => {
    const pattern = document.createElement('div');
    pattern.style.cssText =
      'position:fixed;inset:0;z-index:1000;pointer-events:none;background:repeating-linear-gradient(90deg,#4458c6 0 8px,#e2b57f 8px 16px)';
    document.body.append(pattern);
    document.documentElement.style.setProperty('--glass-strength', '1');
    document.documentElement.style.setProperty('--glass-blur', '2px');
    document
      .querySelector<HTMLElement>('#search-dialog')!
      .style.setProperty('--lens-fill', 'rgb(208 225 247 / .16)');
  });
  await page.waitForFunction(() =>
    document
      .querySelector('dialog')!
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  if (test.info().project.name === 'chromium') {
    await expect(dialog).toHaveAttribute('data-liquid', 'optic');
    await expect
      .poll(() => dialog.evaluate((node) => node.style.getPropertyValue('--liquid-refraction')))
      .toMatch(/blur\(1\.3/);
    const filter = await dialog.evaluate((node) =>
      node.style.getPropertyValue('--liquid-refraction'),
    );
    const optical = await dialog.screenshot({ animations: 'disabled' });
    await dialog.evaluate(
      (node, value) =>
        node.style.setProperty('--liquid-refraction', value.replace(/^url\([^)]+\)\s*/, '')),
      filter,
    );
    const flat = await dialog.screenshot({ animations: 'disabled' });
    const first = await sharp(optical).raw().toBuffer(),
      second = await sharp(flat).raw().toBuffer();
    let difference = 0;
    for (let index = 0; index < first.length; index++)
      difference += Math.abs(first[index] - second[index]);
    expect(difference / first.length).toBeGreaterThan(0.25);
    await dialog.evaluate(
      (node, value) => node.style.setProperty('--liquid-refraction', value),
      filter,
    );
  } else {
    await expect(dialog).toHaveAttribute('data-liquid', 'surface');
    await expect(dialog).toHaveCSS('backdrop-filter', /blur\(/);
  }
  for (let index = 0; index < 8; index++) await page.keyboard.press('Tab');
  // Native dialogs may send focus to browser chrome between cycles, but never to the inert page.
  expect(
    await dialog.evaluate(
      (node) => document.activeElement === document.body || node.contains(document.activeElement),
    ),
  ).toBe(true);
  await dialog.locator('input').focus();
  await page.locator('[data-search-open]').evaluate((node) => (node as HTMLElement).focus());
  await expect(dialog.locator('input')).toBeFocused();
  await page.evaluate(() => (document.documentElement.dataset.reduceTransparency = 'true'));
  await expect(dialog).toHaveCSS('backdrop-filter', 'none');
  await expect
    .poll(() => dialog.evaluate((node) => getComputedStyle(node, '::before').display))
    .toBe('none');
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
