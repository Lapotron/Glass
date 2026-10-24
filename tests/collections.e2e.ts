import { selectSettingsSection } from './settings-navigation.js';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;
const state = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function save(request: APIRequestContext, value: unknown) {
  const current = await state(request);
  const response = await request.put('/api/site', {
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data: { value, revision: current.siteRevision },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function build(request: APIRequestContext) {
  const current = await state(request);
  const started = await request.post('/api/jobs', {
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data: { action: 'build' },
  });
  expect(started.ok()).toBe(true);
  const job = await started.json();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/jobs')).json()).find(
          (item: { id: string }) => item.id === job.id,
        )?.state,
      { timeout: 30000 },
    )
    .toBe('succeeded');
  return (await (await request.get('/api/jobs')).json()).find(
    (item: { id: string }) => item.id === job.id,
  );
}
async function openContent(page: Page) {
  await page.goto('/studio/#settings');
  await selectSettingsSection(page, 'collections');
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

test('collection names and paths flow through unsaved preview, Studio, builds and native Pages redirects', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const original = await state(request),
    errors: string[] = [];
  let pages: ChildProcess | undefined;
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await openContent(page);
    const posts = page.locator('[data-collection-kind="posts"]');
    const articles = page.locator('[data-collection-kind="lab"]');
    await posts.getByLabel('Collection name', { exact: true }).fill('Posts');
    await posts.getByLabel('Singular name', { exact: true }).fill('Post');
    await posts.getByLabel('Public path', { exact: true }).fill('/POST/');
    await articles.getByLabel('Collection name', { exact: true }).fill('Articles');
    await articles.getByLabel('Singular name', { exact: true }).fill('Article');
    await articles.getByLabel('Public path', { exact: true }).fill('/article/');
    await expect(posts.locator('.collection-route-preview')).toContainText('/post/your-title/');
    await page.getByRole('button', { name: 'Preview site', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Site preview', exact: true });
    const frame = modal.frameLocator('iframe');
    await expect(frame.locator('a[href^="/post/"]').first()).toBeAttached();
    await expect(frame.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    );
    expect((await state(request)).site.collections.posts.path).toBe(
      original.site.collections.posts.path,
    );
    await modal.getByRole('button', { name: 'Close Site preview', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(posts.getByLabel('Public path', { exact: true })).toHaveValue('post');
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Reload latest settings', exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await selectSettingsSection(page, 'collections');
    await expect(posts.getByLabel('Collection name', { exact: true })).toHaveValue('Posts');
    const navigation = page.getByRole('navigation', { name: 'Studio navigation' });
    await navigation.getByRole('button', { name: /^Posts/ }).click();
    await page.getByRole('button', { name: 'New post', exact: true }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Title', { exact: true }).fill('A new thought');
    await expect(create).toContainText('/post/a-new-thought/');
    await create.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('.managed-entry-open').first().click();
    await expect(page.locator('.editor-breadcrumb')).toContainText('Posts');
    await expect(page.locator('.preview-route')).toContainText('/post/');
    await navigation.getByRole('button', { name: /^Articles/ }).click();
    await expect(page.getByRole('button', { name: 'New article', exact: true })).toBeVisible();
    await navigation.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Posts', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Articles', exact: true })).toBeVisible();
    await openContent(page);
    const axe = await new AxeBuilder({ page })
      .include('.settings-form')
      .withRules(['color-contrast', 'label', 'aria-valid-attr-value'])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath('content-settings-light.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Toggle Studio appearance' }).click();
    await page.screenshot({
      path: test.info().outputPath('content-settings-dark.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 320, height: 850 });
    await page.evaluate(() => document.documentElement.style.setProperty('--font-scale', '1.25'));
    await expect(posts.getByLabel('Public path', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath('content-settings-phone.png'),
      fullPage: true,
      animations: 'disabled',
    });

    const job = await build(request);
    expect(job.build.collectionNames).toEqual({ posts: 'Posts', lab: 'Articles' });
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    };
    delete environment.CLOUDFLARE_API_TOKEN;
    delete environment.R2_ACCESS_KEY_ID;
    delete environment.R2_SECRET_ACCESS_KEY;
    pages = spawn(
      process.execPath,
      [
        path.resolve('node_modules/wrangler/bin/wrangler.js'),
        'pages',
        'dev',
        job.build.outputDir,
        '--port',
        '4175',
        '--ip',
        '127.0.0.1',
      ],
      { env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let logs = '';
    pages.stdout?.on('data', (chunk) => {
      logs = (logs + chunk).slice(-6000);
    });
    pages.stderr?.on('data', (chunk) => {
      logs = (logs + chunk).slice(-6000);
    });
    await expect
      .poll(
        async () => {
          try {
            return (await request.get('http://127.0.0.1:4175/')).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30000, message: logs },
      )
      .toBe(200);
    const post = original.entries.find(
      (entry: { kind: string; status: string; slug: string }) =>
        entry.kind === 'posts' &&
        entry.status === 'published' &&
        entry.slug === 'a-small-case-for-curiosity',
    );
    const article = original.entries.find(
      (entry: { kind: string; status: string }) =>
        entry.kind === 'lab' && entry.status === 'published',
    );
    for (const [old, target] of [
      ['/blog', '/post/'],
      ['/blog/', '/post/'],
      ['/lab/', '/article/'],
      [`/blog/${post.slug}/?source=old`, `/post/${post.slug}/?source=old`],
      [`/lab/${article.slug}/`, `/article/${article.slug}/`],
    ]) {
      const response = await request.get('http://127.0.0.1:4175' + old, { maxRedirects: 0 });
      expect(response.status(), logs).toBe(301);
      const destination = new URL(response.headers().location, 'http://127.0.0.1:4175');
      expect(destination.pathname + destination.search).toBe(target);
    }
    const short = await request.get('http://127.0.0.1:4175/s/' + post.shortCode, {
      maxRedirects: 0,
    });
    expect(short.status()).toBe(302);
    expect(short.headers().location).toContain('/post/' + post.slug + '/');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('http://127.0.0.1:4175/archive/');
    await expect(page.getByRole('button', { name: 'Posts', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Articles', exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/post/${post.slug}/"]`)).toBeVisible();
    await page.goto(`http://127.0.0.1:4175/blog/${post.slug}/?source=old#discussion`);
    await expect(page).toHaveURL(`http://127.0.0.1:4175/post/${post.slug}/?source=old#discussion`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new URL('/post/' + post.slug + '/', original.site.url).href,
    );
    expect(errors).toEqual([]);
  } finally {
    await stop(pages);
    await page.close();
    await save(request, original.site);
    await build(request);
  }
});

test('a normalized save retains edits made during a delayed response and recognizes its own filesystem event', async ({
  page,
  request,
}) => {
  const original = await state(request);
  let release = () => {};
  let held = false;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await openContent(page);
    const posts = page.locator('[data-collection-kind="posts"]');
    await posts.getByLabel('Collection name', { exact: true }).fill('Posts');
    await posts.getByLabel('Public path', { exact: true }).fill('/POST/');
    await page.route('**/api/site', async (route) => {
      if (route.request().method() !== 'PUT' || held) return route.continue();
      held = true;
      const response = await route.fetch();
      await delayed;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await state(request)).site.collections.posts.path).toBe('post');
    await posts.getByLabel('Collection name', { exact: true }).fill('Collected notes');
    await posts.getByLabel('Public path', { exact: true }).fill('notes');
    release();
    await expect.poll(async () => (await state(request)).site.collections.posts.path).toBe('notes');
    await expect(posts.getByLabel('Collection name', { exact: true })).toHaveValue(
      'Collected notes',
    );
    await expect(posts.getByLabel('Public path', { exact: true })).toHaveValue('notes');
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Reload latest settings', exact: true }),
    ).toHaveCount(0);
    expect((await state(request)).site.collections.posts.aliases).toContain('post');
  } finally {
    release();
    await page.close();
    await save(request, original.site);
  }
});

test('invalid paths retain drafts, repeated renames keep aliases and settings conflicts preserve input', async ({
  page,
  request,
}) => {
  const original = await state(request);
  try {
    await openContent(page);
    const posts = page.locator('[data-collection-kind="posts"]');
    await posts.getByLabel('Public path', { exact: true }).fill('archive');
    await expect(posts.getByRole('status')).toContainText('reserved');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('reserved');
    expect((await state(request)).site.collections.posts.path).toBe(
      original.site.collections.posts.path,
    );
    await posts.getByLabel('Public path', { exact: true }).fill('post');
    await posts.getByLabel('Collection name', { exact: true }).fill('Posts');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await posts.getByLabel('Public path', { exact: true }).fill('notes');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(posts.locator('.collection-aliases')).toContainText('/post/');
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Reload latest settings', exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await selectSettingsSection(page, 'collections');
    await expect(posts.getByLabel('Public path', { exact: true })).toHaveValue('notes');
    await posts.getByLabel('Collection name', { exact: true }).fill('My unsaved notes');
    const current = await state(request);
    await save(request, { ...current.site, description: 'A change from another editor.' });
    await expect(
      page.getByRole('button', { name: 'Reload latest settings', exact: true }),
    ).toBeVisible();
    await expect(posts.getByLabel('Collection name', { exact: true })).toHaveValue(
      'My unsaved notes',
    );
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  } finally {
    await page.close();
    await save(request, original.site);
  }
});
