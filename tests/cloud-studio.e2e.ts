import { test, expect, type APIRequestContext } from '@playwright/test';
import { projectsSchema } from '../src/shared/projects.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  createLargeBackup,
  indexBackupFiles,
  extractLargeBackup,
} from '../src/engine/backup-archive.js';
import { cloudExportFilePath } from '../src/shared/cloud-migration.js';
import { portableNotebookPath, archiveNotebookPath } from '../src/shared/notebook-data.js';
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
async function preparedFixture(request: APIRequestContext, name: string, png: Buffer) {
  const output = await fs.readFile('tests/fixtures/cloud-portrait.webp'),
    checksum = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const session = await mutate(request, 'media/uploads', 'POST', {
    filename: name,
    original: { bytes: png.length, sha: checksum(png) },
    output: { bytes: output.length, sha: checksum(output) },
    width: 192,
    height: 192,
  });
  for (const [role, bytes] of [
    ['original', png],
    ['output', output],
  ] as const) {
    const transfer = await mutate(request, 'media/uploads/' + session.id + '/transfer', 'POST', {
      role,
    });
    if (transfer.reused) continue;
    const state = await (await request.get('/api/bootstrap')).json();
    const part = await request.put(
      '/api/media/uploads/' + session.id + '/transfers/' + transfer.id + '/parts/1',
      {
        headers: {
          Origin: 'http://127.0.0.1:4398',
          'X-Studio-Token': state.token,
          'X-Part-SHA256': checksum(bytes),
          'Content-Type': 'application/octet-stream',
        },
        data: bytes,
      },
    );
    expect(part.ok(), await part.text()).toBe(true);
    await mutate(
      request,
      'media/uploads/' + session.id + '/transfers/' + transfer.id + '/complete',
      'POST',
      {},
    );
  }
  return mutate(request, 'media/uploads/' + session.id + '/commit', 'POST', {});
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
test('credential checks report missing R2 setup without starting a build', async ({
  page,
  request,
}) => {
  const before = await (await request.get('/api/cloud/status')).json();
  const polls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/cloud-jobs/')) polls.push(request.url());
  });
  await page.goto('/#settings/connections');
  const response = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/connections/test',
  );
  await page.getByRole('button', { name: 'Test saved R2 connection', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(400);
  expect(await result.json()).toMatchObject({ error: expect.stringContaining('R2 needs:') });
  await expect(page.getByRole('alert').filter({ hasText: 'R2 needs:' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Test saved R2 connection', exact: true }),
  ).toBeEnabled();
  expect(polls).toEqual([]);
  const after = await (await request.get('/api/cloud/status')).json();
  expect(after.jobs.map((job: { id: string }) => job.id)).toEqual(
    before.jobs.map((job: { id: string }) => job.id),
  );
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
  const portrait = await preparedFixture(
    request,
    'private-preview-portrait.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAMAAAADAAQMAAABoEv5EAAAAA1BMVEVGcowqahjXAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHElEQVRYw+3BMQEAAADCoPVPbQ0PoAAAAADg1wASwAABCP6fUgAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
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
test('hosted media file picker prepares images and PDF attachments directly without CI', async ({
  page,
  request,
}) => {
  await page.goto('/#media');
  const input = page.getByLabel('Upload media files', { exact: true });
  const name = 'hosted-picker-' + test.info().project.name;
  await input.setInputFiles({
    name: name + '.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAMAAAADAAQMAAABoEv5EAAAAA1BMVEVGcowqahjXAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHElEQVRYw+3BMQEAAADCoPVPbQ0PoAAAAADg1wASwAABCP6fUgAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  const image = page.getByRole('dialog', { name: 'Prepare image', exact: true });
  await expect(image).toBeVisible();
  const apply = image.getByRole('button', { name: 'Apply & upload', exact: true });
  await expect(apply).toBeEnabled({ timeout: 60000 });
  await apply.click();
  await expect(image).not.toBeVisible({ timeout: 90000 });
  const files = await (await request.get('/api/media')).json();
  const uploaded = files.find(
    (file: any) => file.name.startsWith(name) && /\.(?:webp|png)$/.test(file.name),
  );
  expect(uploaded).toMatchObject({ width: 192, height: 192 });
  expect((await request.get(uploaded.url)).ok()).toBe(true);
  const pdf = Buffer.from('%PDF-1.7\nA private hosted upload fixture.\n%%EOF');
  await input.setInputFiles({ name: name + '.pdf', mimeType: 'application/pdf', buffer: pdf });
  const attachment = page.getByRole('dialog', { name: 'Prepare image', exact: true });
  await expect(attachment).toBeVisible();
  await attachment.getByRole('button', { name: 'Upload PDF', exact: true }).click();
  await expect(attachment).not.toBeVisible({ timeout: 90000 });
  const attachments = await (await request.get('/api/media')).json();
  const uploadedPdf = attachments.find(
    (file: any) => file.name.startsWith(name) && file.name.endsWith('.pdf'),
  );
  expect(uploadedPdf).toBeTruthy();
  expect(await (await request.get(uploadedPdf.url)).body()).toEqual(pdf);
});
test('hosting creates and downloads an immutable snapshot without a CI job or a stored archive', async ({
  page,
  request,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  );
  const before = await (await request.get('/api/cloud/status')).json();
  await page.goto('/#hosting');
  await expect(
    page.getByRole('heading', { name: 'Storage and history', exact: true }),
  ).toBeVisible();
  const snapshot = await mutate(request, 'backups', 'POST', {});
  expect(snapshot.snapshot).toBe(true);
  expect(snapshot.cloudJob).toBeUndefined();
  const after = await (await request.get('/api/cloud/status')).json();
  expect(after.jobs).toEqual(before.jobs);
  expect(after.files).toBe(before.files);
  await page.goto('/#backups');
  const row = page.locator('.backup-list article').filter({ hasText: snapshot.name });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Download', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export notebook', exact: true });
  await expect(dialog).toBeVisible();
  const link = dialog.getByRole('link', { name: /Download archive/ });
  await expect(link).toBeVisible({ timeout: 60000 });
  const download = page.waitForEvent('download');
  await link.click();
  const result = await download;
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-native-download-'));
  try {
    const archive = path.join(folder, 'notebook.tar.gz');
    await result.saveAs(archive);
    const manifest = await extractLargeBackup(archive, path.join(folder, 'unpacked'));
    expect(manifest.files.some((file) => file.path === 'content/site.json')).toBe(true);
    expect(manifest.files.some((file) => file.path.includes('builds/'))).toBe(false);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
});
test('hosting history supports reviewed batch deletion, recovery and narrow glass controls without CI', async ({
  page,
  request,
}) => {
  const before = await (await request.get('/api/cloud/status')).json();
  let entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'History operations ' + test.info().project.name,
    slug: 'native-history-' + test.info().project.name,
  });
  for (let index = 0; index < 7; index++)
    entry = await mutate(request, 'content/' + entry.id, 'PUT', {
      metadata: entry,
      body: 'Revision ' + index,
      revision: entry.revision,
    });
  await page.goto('/#hosting');
  const section = page.locator('.cloud-storage');
  await section.getByRole('button', { name: 'History', exact: true }).click();
  await section
    .getByRole('searchbox', { name: 'Search history', exact: true })
    .fill('/' + entry.id + '/');
  await expect(section.locator('.storage-history-list>li')).toHaveCount(7);
  await section.getByRole('button', { name: 'Select this page', exact: true }).click();
  await section.getByRole('button', { name: 'Delete selected (7)', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Delete selected history', exact: true });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(
    section.getByText('No history matches these filters.', { exact: true }),
  ).toBeVisible();
  await section.getByRole('button', { name: 'Recovery', exact: true }).click();
  const item = section.locator('.storage-history-list>li').filter({ hasText: entry.id }).first();
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(section.getByText('History restored.', { exact: true })).toBeVisible();
  const restored = await (
    await request.get('/api/history?' + new URLSearchParams({ q: '/' + entry.id + '/' }))
  ).json();
  expect(restored.items).toHaveLength(1);
  expect((await (await request.get('/api/cloud/status')).json()).jobs).toEqual(before.jobs);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('storage-desktop.png') });
  await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('storage-dark-mobile.png') });
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
test('old saved JSON archives can be reviewed by the browser worker without CI', async ({
  page,
  request,
}) => {
  const headers = { Authorization: 'Bearer fixture-ci-only-not-production-123456789' },
    original = await (await request.get('/__ci/workspace', { headers })).json(),
    before = await (await request.get('/api/cloud/status')).json();
  const bootstrap = await (await request.get('/api/bootstrap')).json(),
    payloads = new Map<string, Buffer>(),
    archiveFiles = [];
  for (const file of original.files.filter((file: any) => portableNotebookPath(file.path))) {
    const value = await (
      await request.get('/__ci/workspace/file?' + new URLSearchParams({ path: file.path }), {
        headers,
      })
    ).body();
    payloads.set(file.path, value);
    archiveFiles.push({
      path: archiveNotebookPath(file.path),
      sha256: createHash('sha256').update(value).digest('hex'),
      data: value.toString('base64'),
    });
  }
  const createdAt = new Date().toISOString(),
    id = Date.now() + '-' + randomBytes(4).toString('hex'),
    name = 'Legacy browser compatibility.json.gz',
    archive = gzipSync(
      JSON.stringify({ format: 'fieldnotes-notebook', version: 2, createdAt, files: archiveFiles }),
    );
  const record = Buffer.from(
    JSON.stringify({
      id,
      name,
      createdAt,
      reason: 'manual',
      files: archiveFiles.length,
      entries: bootstrap.entries.length,
      media: archiveFiles.filter((file) => file.path.startsWith('content/media/')).length,
      revisions: 0,
      bytes: archive.length,
      label: 'Legacy archive check',
    }),
  );
  const session = await mutate(request, 'cloud/migration', 'POST', { version: before.version }),
    manifest = [...original.files];
  for (const file of original.files) {
    const link = await mutate(request, 'cloud/migration/' + session.id + '/link', 'POST', file);
    if (!link.linked) {
      const value =
        payloads.get(file.path) ||
        (await (
          await request.get('/__ci/workspace/file?' + new URLSearchParams({ path: file.path }), {
            headers,
          })
        ).body());
      await request.put(
        '/api/cloud/migration/' + session.id + '/file?' + new URLSearchParams({ path: file.path }),
        {
          headers: { Origin: 'http://127.0.0.1:4398', 'X-Studio-Token': bootstrap.token },
          data: value,
        },
      );
    }
  }
  for (const [path, value] of [
    ['.studio/backups/' + id + '.json', record],
    ['.studio/backups/' + id + '.json.gz', archive],
  ] as const) {
    const response = await request.put(
      '/api/cloud/migration/' + session.id + '/file?' + new URLSearchParams({ path }),
      {
        headers: { Origin: 'http://127.0.0.1:4398', 'X-Studio-Token': bootstrap.token },
        data: value,
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    manifest.push(await response.json());
  }
  await mutate(request, 'cloud/migration/' + session.id + '/commit', 'POST', { files: manifest });
  await page.goto('/#backups');
  await page
    .locator('.backup-list article')
    .filter({ hasText: 'Legacy archive check' })
    .getByRole('button', { name: 'Review', exact: true })
    .click();
  await expect(page.getByText('Checksums verified', { exact: true })).toBeVisible({
    timeout: 60000,
  });
  expect((await (await request.get('/api/cloud/status')).json()).jobs).toEqual(before.jobs);
});
test('captured backup restoration and reset recovery retain their reviewed source and private download', async ({
  page,
  request,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  );
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
  expect(review.backupUrl).toMatch(/^\/api\/backups\//);
  const recoveryId = review.backupUrl.split('/')[3];
  expect((await request.get('/api/backups/' + recoveryId + '/manifest')).ok()).toBe(true);
  await operation(request, 'notebook/reset/' + review.id + '/commit', {
    sourceRevision: review.sourceRevision,
    confirmation: 'RESET',
  });
  const blank = await (await request.get('/api/bootstrap')).json();
  expect(blank.entries).toEqual([]);
  expect(blank.site.name).toBe(initial.site.name);
  const resets = await operation(request, 'notebook/reset', undefined, 'GET');
  expect(resets.recoveries.length).toBeGreaterThan(0);
  await page.goto('/#settings/reset');
  await page.getByRole('link', { name: 'Download the recovery copy', exact: true }).click();
  const download = page.getByRole('dialog', { name: 'Export notebook', exact: true });
  await expect(download.getByRole('link', { name: /Download archive/ })).toBeVisible({
    timeout: 60000,
  });
  await download.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Review data reset', exact: true }).click();
  const reset = page.getByRole('dialog', { name: 'Reset notebook data?', exact: true });
  await reset.getByRole('link', { name: /Download recovery copy/ }).click();
  await expect(download.getByRole('link', { name: /Download archive/ })).toBeVisible({
    timeout: 60000,
  });
  await download.getByRole('button', { name: 'Close', exact: true }).click();
  await reset.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('Hosting imports a large media file through private multipart R2 and verifies the resulting bytes', async ({
  page,
  request,
}) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-hosted-folder-'));
  const headers = { Authorization: 'Bearer fixture-ci-only-not-production-123456789' };
  const original = await (await request.get('/__ci/workspace', { headers })).json();
  const checksum = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  let imported = false;
  try {
    for (const file of original.files) {
      const response = await request.get(
        '/__ci/workspace/file?' + new URLSearchParams({ path: file.path }),
        { headers },
      );
      const target = path.join(folder, 'data', cloudExportFilePath(file.path));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, await response.body());
    }
    const bytes = randomBytes(9 * 1024 ** 2),
      name = 'content/media/hosted-multipart-' + test.info().project.name + '.bin';
    await fs.mkdir(path.join(folder, 'data/content/media'), { recursive: true });
    await fs.writeFile(path.join(folder, 'data', name), bytes);
    const manifest = {
      format: 'glass-cloud-workspace',
      version: 1,
      files: [
        ...original.files.map((file: any) => ({
          ...file,
          storagePath: cloudExportFilePath(file.path),
        })),
        {
          path: name,
          bytes: bytes.length,
          sha: checksum(bytes),
          modified: new Date().toISOString(),
        },
      ],
    };
    await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest));
    let parts = 0;
    page.on('request', (request) => {
      if (/\/migration\/[^/]+\/uploads\/[^/]+\/parts\//.test(request.url())) parts++;
    });
    await page.goto('/#hosting');
    await expect(page.getByLabel('Choose migration folder', { exact: true })).toBeEnabled();
    await page.getByLabel('Choose migration folder', { exact: true }).setInputFiles(folder);
    const dialog = page.getByRole('dialog', { name: 'Review notebook import', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Import reviewed notebook', exact: true }).click();
    await expect(
      page.getByText('Notebook imported. Reload Studio to open the cloud copy.', { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    imported = true;
    expect(parts).toBe(2);
    const media = await request.get('/media/' + path.basename(name));
    expect(media.ok()).toBe(true);
    expect(checksum(await media.body())).toBe(checksum(bytes));
    const state = await (await request.get('/__ci/workspace', { headers })).json();
    expect(state.files.find((file: any) => file.path === name).bytes).toBe(bytes.length);
    const archive = path.join(folder, 'cloud-import.tar.gz');
    await createLargeBackup(
      path.join(folder, 'data'),
      archive,
      await indexBackupFiles(path.join(folder, 'data')),
    );
    await page.goto('/#backups');
    await page.getByLabel('Notebook backup', { exact: true }).setInputFiles(archive);
    await expect(page.getByText('Checksums verified', { exact: true })).toBeVisible({
      timeout: 60000,
    });
    await page.getByRole('button', { name: 'Restore reviewed notebook', exact: true }).click();
    const restore = page.getByRole('dialog', { name: 'Restore this notebook?', exact: true });
    await restore.getByRole('button', { name: 'Restore notebook', exact: true }).click();
    await expect(
      page.getByText(/^Notebook restored\. The previous notebook is saved as safety backup/),
    ).toBeVisible({ timeout: 60000 });
    const restored = await request.get('/media/' + path.basename(name));
    expect(checksum(await restored.body())).toBe(checksum(bytes));
    await page.setViewportSize({ width: 320, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
  } finally {
    if (imported) {
      const status = await (await request.get('/api/cloud/status')).json();
      const session = await mutate(request, 'cloud/migration', 'POST', { version: status.version });
      const state = await (await request.get('/api/bootstrap')).json();
      for (const file of original.files) {
        const result = await request.put(
          '/api/cloud/migration/' +
            session.id +
            '/file?' +
            new URLSearchParams({ path: file.path }),
          {
            headers: {
              Origin: 'http://127.0.0.1:4398',
              'X-Studio-Token': state.token,
              'Content-Type': 'application/octet-stream',
              'X-File-Modified': file.modified,
            },
            data: await fs.readFile(path.join(folder, 'data', cloudExportFilePath(file.path))),
          },
        );
        expect(result.ok(), await result.text()).toBe(true);
      }
      await mutate(request, 'cloud/migration/' + session.id + '/commit', 'POST', {
        files: original.files,
      });
    }
    await fs.rm(folder, { recursive: true, force: true });
  }
});
