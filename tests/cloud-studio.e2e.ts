import { test, expect, type APIRequestContext } from '@playwright/test';
import { projectsSchema } from '../src/shared/projects.js';
test.beforeEach(async ({ request }) => {
  // A settings screen can leave a captured read job finishing after its tab closes.
  // Keep the shared fixture idle before the next test starts a heavy operation.
  await expect
    .poll(
      async () => {
        const state = await (await request.get('/api/bootstrap')).json();
        return !!state.runtime?.busy;
      },
      { timeout: 90000 },
    )
    .toBe(false);
});
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const state = await (await request.get('/api/bootstrap')).json();
  const result = await request.fetch('/api/' + path, {
    method,
    headers: { Origin: 'http://127.0.0.1:4398', 'X-Studio-Token': state.token },
    data,
  });
  expect(result.ok(), await result.text()).toBe(true);
  return result.json();
}
test('hosted Studio opens at root and redirects legacy bookmarks without losing their section', async ({
  page,
  request,
}) => {
  const root = await request.get('/', { maxRedirects: 0 });
  expect(root.status()).toBe(200);
  const html = await root.text();
  expect(html).toContain('data-studio');
  expect(html).toMatch(/src="\/assets\//);
  expect(html).not.toContain('/studio/assets/');
  const head = await request.head('/');
  expect(head.status()).toBe(200);
  const legacy = await request.get('/studio/?legacy=1', { maxRedirects: 0 });
  expect(legacy.status()).toBe(308);
  expect(legacy.headers().location).toBe('/?legacy=1');
  await page.goto('/studio/?legacy=1#hosting');
  await expect(page).toHaveURL('/?legacy=1#hosting');
  await expect(page.getByRole('heading', { name: 'Hosting', exact: true })).toBeVisible();
  const version = page.getByRole('button', { name: /^Studio version:/ });
  await expect(version.locator('code')).toHaveText(/^[a-f\d]{7}$/);
  await version.click();
  const details = page.getByRole('dialog', { name: 'Studio version', exact: true });
  await expect(details.locator('code')).toHaveText(/^[a-f\d]{40,64}$/);
  await expect(details.getByText('Production', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const guide = page.getByRole('link', { name: 'Hosting guide', exact: true });
  await expect(guide).toHaveAttribute('href', '/authoring/hosted-studio.md');
  expect((await request.get('/authoring/hosted-studio.md')).status()).toBe(200);
  const instructions = await request.get('/authoring/SKILL.md');
  expect(instructions.status()).toBe(200);
  const workflow = await instructions.text();
  expect(workflow).toContain('name: glass-markdown-authoring');
  expect(workflow).not.toContain('.agents/');
  for (const match of workflow.matchAll(/\]\(\.\/([^)]+)\)/g))
    expect((await request.get('/authoring/' + match[1])).status()).toBe(200);
  expect((await request.get('/cloud-reader-assets.json')).status()).toBe(200);
  expect((await request.get('/cloud-compiler/index.html')).status()).toBe(200);
  expect((await request.get('/missing-studio-page')).status()).toBe(404);
  const external = await request.get('/studio//external.test', { maxRedirects: 0 });
  expect(external.headers().location).toBe('/external.test');
});
test('Projects preview stays inside its card and scrolls independently in hosted Studio', async ({
  page,
  request,
}) => {
  const initial = await (await request.get('/api/bootstrap')).json();
  try {
    await mutate(request, 'projects', 'PUT', {
      revision: initial.projectsRevision,
      value: projectsSchema.parse({
        version: 1,
        projects: Array.from({ length: 8 }, (_, index) => ({
          id: 'preview-project-' + index,
          title: 'Preview project ' + (index + 1),
          description:
            'An intentionally detailed project description for a scrolling preview. '.repeat(5),
          technologies: ['TypeScript', 'Cloudflare'],
          visibility: 'public',
        })),
      }),
    });
    await page.goto('/#projects');
    const preview = page.locator('.project-preview');
    const frame = preview.locator('iframe:visible');
    const content = page.frameLocator('iframe[title="Projects preview"]');
    await expect(
      content.getByRole('heading', { name: 'Preview project 1', exact: true }),
    ).toBeVisible({ timeout: 60000 });
    for (const width of [320, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(async () => {
          const card = (await preview.boundingBox())!;
          const viewport = (await frame.boundingBox())!;
          return viewport.y + viewport.height <= card.y + card.height;
        })
        .toBe(true);
      await expect
        .poll(() => preview.evaluate((node) => node.scrollHeight <= node.clientHeight + 1))
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
    }
    const inner = page
      .frames()
      .find((candidate) => candidate !== page.mainFrame() && candidate.url().startsWith('blob:'))!;
    await inner.locator('.site-footer').scrollIntoViewIfNeeded();
    expect(await inner.evaluate(() => scrollY)).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const card = (await preview.boundingBox())!;
        const viewport = (await frame.boundingBox())!;
        return viewport.y + viewport.height <= card.y + card.height;
      })
      .toBe(true);
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-studio-projects-preview.png`,
      fullPage: true,
      animations: 'disabled',
    });
  } finally {
    const current = await (await request.get('/api/bootstrap')).json();
    await mutate(request, 'projects', 'PUT', {
      value: initial.projects,
      revision: current.projectsRevision,
    });
  }
});
test('hosted Studio does not load reports when ACA is disabled', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/analytics-status' || path.startsWith('/api/analytics/')) requests.push(path);
  });
  await page.goto('/#analytics/engagement?content=old-article');
  await expect(
    page.getByRole('heading', { name: 'Analytics is disabled', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Studio navigation' })
      .getByRole('button', { name: 'Analytics', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Configure ACA', exact: true }).click();
  await expect(page).toHaveURL(/#settings\/aca$/);
  expect(requests).toEqual([]);
});
test('hosted Studio edits canonical content and renders math, tables and Mermaid without private render APIs', async ({
  page,
  request,
}) => {
  const draft = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Cloud authoring ' + test.info().project.name,
    slug: 'cloud-' + test.info().project.name,
  });
  await mutate(request, 'content/' + draft.id, 'PUT', {
    metadata: draft,
    body: '# A hosted article\n\nMath $x^2$ and ==highlight==.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nflowchart LR\n A --> B\n```',
    revision: draft.revision,
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Writing \d+$/ }).click();
  await page.getByText(draft.title, { exact: true }).click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect(page.locator('.source-component-widget').first()).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.frameLocator('.preview-frame-wrap iframe');
  await expect(preview.locator('.article-body h1')).toHaveText('A hosted article', {
    timeout: 60000,
  });
  await expect(preview.locator('.article-body .math-inline')).toBeVisible();
  await expect(preview.locator('figure[data-mermaid]')).toBeVisible();
  await expect(preview.locator('table')).toBeVisible();
  const audits: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/media/usage') audits.push(request.url());
  });
  const files = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/media',
  );
  await page.getByRole('button', { name: 'Media library', exact: true }).click();
  expect((await files).ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Check usage', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'A collection starts with one image', exact: true }),
  ).toBeVisible();
  expect(audits).toEqual([]);
});
test('homepage and About previews load an unpublished private portrait without build-only variants', async ({
  page,
  request,
}) => {
  const initial = await (await request.get('/api/bootstrap')).json();
  const upload = await request.post('/api/media', {
    headers: { Origin: 'http://127.0.0.1:4398', 'X-Studio-Token': initial.token },
    multipart: {
      file: {
        name: 'private-preview-portrait.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAMAAAADAAQMAAABoEv5EAAAAA1BMVEVGcowqahjXAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHElEQVRYw+3BMQEAAADCoPVPbQ0PoAAAAADg1wASwAABCP6fUgAAAABJRU5ErkJggg==',
          'base64',
        ),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  const portrait = await operationResult(request, await upload.json());
  const current = await (await request.get('/api/bootstrap')).json();
  await mutate(request, 'site', 'PUT', {
    value: {
      ...current.site,
      home: { ...current.site.home, layout: 'profile' },
      profile: { ...current.site.profile, portrait: portrait.url },
    },
    revision: current.siteRevision,
  });
  await page.goto('/#homepage');
  const homeImage = page
    .frameLocator('iframe[title="Homepage preview"]')
    .locator('.about-portrait');
  await expect(homeImage).toHaveAttribute('src', portrait.url, { timeout: 60000 });
  await expect(homeImage).toHaveJSProperty('naturalWidth', 192);
  await expect(homeImage).not.toHaveAttribute('srcset');
  await page.getByRole('button', { name: 'About', exact: true }).click();
  const aboutImage = page.frameLocator('iframe[title="About preview"]').locator('.about-portrait');
  await expect(aboutImage).toHaveJSProperty('naturalWidth', 192, { timeout: 60000 });
});
test('hosting shows private storage and a queued backup completes through the cloud CI bridge', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Hosting', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hosting', exact: true })).toBeVisible();
  await expect(page.getByText('isolated-cloud-test', { exact: true })).toBeVisible();
  const response = await mutate(request, 'backups', 'POST', {});
  expect(response.cloudJob).toBeTruthy();
  await expect
    .poll(
      async () => {
        const row = await (await request.get('/api/cloud-jobs/' + response.cloudJob)).json();
        if (row.state === 'failed') throw new Error(row.error);
        return row.state;
      },
      { timeout: 90000 },
    )
    .toBe('succeeded');
  const backups = await (await request.get('/api/backups')).json();
  expect(backups.length).toBeGreaterThan(0);
  const archive = await request.get('/api/backups/' + backups[0].id + '/download');
  expect(archive.ok()).toBe(true);
  expect(archive.headers()['content-type']).toContain('gzip');
});
test('hosted media audits distinguish a renamed revision from current missing references', async ({
  page,
  request,
}) => {
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Historical sample ' + test.info().project.name,
    slug: 'historical-media-' + test.info().project.name,
  });
  const missing = '/media/historical-coast-' + test.info().project.name + '.svg';
  const saved = await mutate(request, 'content/' + entry.id, 'PUT', {
    metadata: entry,
    body: `![A previous image](${missing})`,
    revision: entry.revision,
  });
  const currentTitle = 'Renamed article ' + test.info().project.name;
  await mutate(request, 'content/' + saved.id, 'PUT', {
    metadata: { ...saved, title: currentTitle },
    body: 'The current article has no image references.',
    revision: saved.revision,
  });
  await page.goto('/#media');
  const response = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/media/usage',
  );
  await page.getByRole('button', { name: 'Check usage', exact: true }).click();
  const audit = await operationResult(request, await (await response).json());
  expect(audit.items.find((item: { url: string }) => item.url === missing).history).toContain(
    'Revision: ' + entry.title,
  );
  await expect(page.getByRole('button', { name: 'Check usage', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await expect(page.locator('.media-missing-history')).toHaveCount(0);
  await expect(page.locator('.media-page').getByText(missing, { exact: true })).toHaveCount(0);
});
async function operation(
  request: APIRequestContext,
  path: string,
  data: unknown = {},
  method = 'POST',
) {
  const queued =
    method === 'GET'
      ? await (
          await request.get('/api/' + path, {
            headers: {
              'X-Studio-Token': (await (await request.get('/api/bootstrap')).json()).token,
            },
          })
        ).json()
      : await mutate(request, path, method, data);
  return operationResult(request, queued);
}
async function operationResult(request: APIRequestContext, queued: any) {
  if (!queued.cloudJob) return queued;
  await expect
    .poll(
      async () => {
        const job = await (await request.get('/api/cloud-jobs/' + queued.cloudJob)).json();
        if (job.state === 'failed') throw new Error(job.error);
        return job.state;
      },
      { timeout: 90000 },
    )
    .toBe('succeeded');
  const result = await (await request.get('/api/cloud-jobs/' + queued.cloudJob + '/result')).json();
  expect(result.status).toBeLessThan(400);
  return result.body;
}
test('captured backup restoration and reset recovery retain their reviewed source and private download', async ({
  request,
}) => {
  const initial = await (await request.get('/api/bootstrap')).json();
  // The empty-cloud fixture has no portrait asset; recovery must preserve a valid settings snapshot.
  const cleared = { ...initial.site, profile: { ...initial.site.profile, portrait: '' } };
  await mutate(request, 'site', 'PUT', { value: cleared, revision: initial.siteRevision });
  const backup = await operation(request, 'backups');
  const temporary = await mutate(request, 'content', 'POST', {
    kind: 'lab',
    title: 'Temporary recovery draft',
    slug: 'temporary-recovery-' + test.info().project.name,
  });
  const restore = await operation(request, 'backups/' + backup.id + '/review');
  await operation(request, 'backups/' + restore.id + '/restore', {
    sourceRevision: restore.sourceRevision,
  });
  const restored = await (await request.get('/api/content')).json();
  expect(restored.some((entry: any) => entry.id === temporary.id)).toBe(false);
  const review = await operation(request, 'notebook/reset/review');
  expect(review.backupUrl).toMatch(/^\/api\/cloud-jobs\//);
  const recovery = await request.get(review.backupUrl);
  expect(recovery.ok()).toBe(true);
  expect(recovery.headers()['content-type']).toContain('gzip');
  await operation(request, 'notebook/reset/' + review.id + '/commit', {
    sourceRevision: review.sourceRevision,
    confirmation: 'RESET',
  });
  const blank = await (await request.get('/api/bootstrap')).json();
  expect(blank.entries).toEqual([]);
  expect(blank.site.name).toBe(initial.site.name);
  const resets = await operation(request, 'notebook/reset', undefined, 'GET');
  expect(resets.recoveries.length).toBeGreaterThan(0);
});
