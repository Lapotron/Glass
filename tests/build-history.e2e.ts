import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Job } from '../src/shared/contracts.js';
const require = createRequire(import.meta.url);
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;
const bootstrap = async (request: APIRequestContext) =>
  (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, url: string, body: unknown, method = 'POST') {
  const { token } = await bootstrap(request);
  const response = await request.fetch('/api/' + url, {
    method,
    data: body,
    headers: { 'X-Studio-Token': token, Origin: 'http://127.0.0.1:4387' },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function completed(request: APIRequestContext, id: string) {
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/jobs')).json()).find((job: Job) => job.id === id)?.state,
    )
    .toBe('succeeded');
  return (await (await request.get('/api/jobs')).json()).find((job: Job) => job.id === id) as Job;
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: test.info().outputPath(name + '.png'),
    fullPage: true,
    animations: 'disabled',
  });
}

test('build history captures destinations, exports accepted artifacts and supports grouped removal with undo', async ({
  page,
  request,
}) => {
  const original = await bootstrap(request),
    created: string[] = [];
  try {
    const first = await mutate(request, 'jobs', { action: 'build' });
    created.push(first.id);
    await completed(request, first.id);
    await page.goto('/studio/#builds');
    const oldRun = page.locator(`[data-job-id="${first.id}"]`);
    await expect(
      oldRun.getByRole('link', { name: new URL(original.site.url).href, exact: true }),
    ).toBeVisible();
    const current = await bootstrap(request);
    await mutate(
      request,
      'site',
      {
        value: {
          ...current.site,
          url: 'https://canonical-history.example.org',
          cloudflare: { ...current.site.cloudflare, projectName: 'history-notebook' },
        },
        revision: current.siteRevision,
      },
      'PUT',
    );
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Publishing destination' })).toContainText(
      'https://canonical-history.example.org',
    );
    await expect(oldRun).toContainText(new URL(original.site.url).href);
    await oldRun.locator('.build-job-summary').click();
    const started = page.waitForResponse(
      (response) => response.url().endsWith('/api/jobs') && response.request().method() === 'POST',
    );
    await oldRun.getByRole('button', { name: 'Build again', exact: true }).click();
    const second = await (await started).json();
    created.push(second.id);
    await completed(request, second.id);
    const latest = page.locator(`[data-job-id="${second.id}"]`);
    await expect(latest).toContainText('https://canonical-history.example.org/');
    await latest.locator('.build-job-summary').click();
    await expect(latest).toContainText('Writing');
    await expect(latest.locator('.build-job-facts')).toContainText(/KiB|MiB/);
    const artifactEvent = page.waitForEvent('download');
    await latest.getByRole('button', { name: 'Download artifact' }).click();
    const artifact = await artifactEvent;
    expect(artifact.suggestedFilename()).toBe(`glass-build-${second.id}.tar.gz`);
    const names = execFileSync('tar', ['-tzf', (await artifact.path())!], { encoding: 'utf8' });
    expect(names).toContain('index.html');
    expect(names).toContain('assets/deployment.json');
    const marker = execFileSync(
      'tar',
      ['-xOzf', (await artifact.path())!, 'assets/deployment.json'],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(marker)).toEqual({ version: 1, id: second.id });
    expect(names).not.toMatch(/source\.json|content\/|\.studio\/|console/);
    const logEvent = page.waitForEvent('download');
    await latest.getByRole('link', { name: 'Download log' }).click();
    const log = await logEvent;
    expect(log.suggestedFilename()).toBe(`glass-job-${second.id}.log`);
    expect(await fs.readFile((await log.path())!, 'utf8')).toContain('passed validation');
    for (const id of created)
      await page.getByRole('checkbox', { name: 'Select job ' + id, exact: true }).check();
    const actions = page.getByRole('region', { name: 'Selection actions' });
    await expect(actions).toContainText('2 selected');
    const reportEvent = page.waitForEvent('download');
    await actions.getByRole('button', { name: 'Export reports' }).click();
    const reportFile = await reportEvent;
    expect(reportFile.suggestedFilename()).toBe('glass-build-history.json');
    const reports = JSON.parse(await fs.readFile((await reportFile.path())!, 'utf8'));
    expect(new Set(reports.jobs.map((job: Job) => job.target?.canonicalUrl))).toEqual(
      new Set([new URL(original.site.url).href, 'https://canonical-history.example.org/']),
    );
    await actions.getByRole('button', { name: 'Remove from history', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Remove runs from history?' });
    await expect(review).toContainText('Retained artifacts');
    await review.getByRole('button', { name: 'Remove from history', exact: true }).click();
    await expect(oldRun).toBeHidden();
    await expect(latest).toBeHidden();
    await page.getByRole('button', { name: 'Undo removal' }).click();
    await expect(oldRun).toBeVisible();
    await expect(latest).toBeVisible();
    await page.reload();
    await expect(latest).toBeVisible();
    await screenshot(page, 'history-real-light');
  } finally {
    const current = await bootstrap(request);
    await mutate(request, 'site', { value: original.site, revision: current.siteRevision }, 'PUT');
    const items = (await (await request.get('/api/jobs')).json())
      .filter((job: Job) => created.includes(job.id))
      .map(({ id, revision }: Job) => ({ id, revision }));
    if (items.length) await mutate(request, 'jobs/history/remove', { items });
  }
});

test('history filters and pagination stay tidy on desktop and compact mobile layouts', async ({
  page,
}) => {
  const jobs: Job[] = Array.from({ length: 36 }, (_, index) => ({
    id: `visual-history-${index}`,
    revision: 'a'.repeat(64),
    action: index % 2 ? 'publish' : 'build',
    state: index % 3 ? 'succeeded' : 'failed',
    failedAt: index % 3 ? undefined : 'uploading',
    logs: ['A retained, redacted build log.'],
    error:
      index % 3
        ? undefined
        : 'A delivery check failed. Review the retained artifact and Pages settings.',
    startedAt: new Date(Date.UTC(2026, 9, 20, 12, 0, -index * 60)).toISOString(),
    completedAt: new Date(Date.UTC(2026, 9, 20, 12, 0, 13 - index * 60)).toISOString(),
    mediaDelivery: 'pages',
    target: {
      canonicalUrl: `https://historical-${index}.example.org/`,
      project: 'personal-notebook',
      branch: 'main',
    },
    ...(index % 2 && index % 5
      ? {
          deployment: {
            url: `https://preview-${index}.pages.dev`,
            project: 'personal-notebook',
            buildId: `visual-history-${index}`,
            completedAt: '2026-10-20T12:00:13Z',
          },
        }
      : {}),
    build: {
      id: `visual-history-${index}`,
      outputDir: '/private/retained/public',
      pages: 17,
      manifest: ['index.html', 'assets/site.js', 'blog/a-thought/index.html'],
      diagnostics: [],
      sourceRevision: 'b'.repeat(64),
      completedAt: '2026-10-20T12:00:13Z',
      totalBytes: 256789,
      contentCounts: { posts: 4, lab: 2, media: 7 },
    },
  }));
  await page.addInitScript(() => localStorage.setItem('fieldnotes-appearance', 'light'));
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), jobs } });
  });
  await page.goto('/studio/#builds');
  const history = page.getByRole('region', { name: 'Build history', exact: true });
  await expect(history.locator('.build-job')).toHaveCount(10);
  await expect(history.locator('.build-job-deployment')).toHaveCount(10);
  await expect(
    history.locator('[data-job-id="visual-history-0"] .build-job-deployment'),
  ).toContainText('Not published');
  const published = history.locator('[data-job-id="visual-history-1"] .build-job-deployment');
  await expect(published.getByRole('link')).toHaveAttribute('href', 'https://preview-1.pages.dev');
  await expect(published.getByRole('link')).toHaveAttribute('target', '_blank');
  await expect(
    published.getByRole('button', { name: 'Copy deployment URL for visual-history-1' }),
  ).toBeVisible();
  await expect(
    history.locator('[data-job-id="visual-history-3"] .build-job-deployment'),
  ).toContainText('Unverified upload');
  await expect(
    history.locator('[data-job-id="visual-history-5"] .build-job-deployment'),
  ).toContainText('URL not recorded');
  await page
    .getByRole('searchbox', { name: 'Search build history' })
    .fill('https://preview-1.pages.dev');
  await expect(history.locator('.build-job')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search build history' }).fill('');
  await expect(history.locator('.build-job')).toHaveCount(10);
  await history.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(history).toContainText('11–20 of 36');
  await page.getByRole('combobox', { name: 'Filter build status' }).selectOption('failed');
  await expect(history).toContainText('1–10 of 12');
  await page.getByRole('combobox', { name: 'Filter build action' }).selectOption('publish');
  await expect(history.locator('.build-job')).toHaveCount(6);
  await page.getByRole('searchbox', { name: 'Search build history' }).fill('no-such-build');
  await expect(page.getByRole('heading', { name: 'No matching runs' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page.getByRole('combobox', { name: 'Sort build history' }).selectOption('oldest');
  await expect(history.locator('.build-job').first()).toHaveAttribute(
    'data-job-id',
    'visual-history-35',
  );
  await screenshot(page, 'history-list-desktop');
  await page.getByRole('searchbox', { name: 'Search build history' }).fill('visual-history-0');
  await history.locator('.build-job-summary').click();
  await screenshot(page, 'history-details-light');
  let audit = await new AxeBuilder({ page }).include('.builds-page').analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole('button', { name: 'Toggle Studio appearance' }).click();
  await screenshot(page, 'history-details-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'history-mobile');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--font-scale', '1.5');
    document.documentElement.dataset.reduceTransparency = 'true';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await screenshot(page, 'history-compact-solid');
  audit = await new AxeBuilder({ page }).include('.builds-page').analyze();
  expect(audit.violations).toEqual([]);
  await page
    .getByRole('searchbox', { name: 'Search build history' })
    .fill('https://preview-3.pages.dev');
  await expect(history.locator('.build-job-deployment').getByRole('link')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await screenshot(page, 'history-deployment-mobile');
});

test('history removal cannot be resurrected by a delayed bootstrap response', async ({
  page,
  request,
}) => {
  const job = await mutate(request, 'jobs', { action: 'build' });
  await completed(request, job.id);
  await page.goto('/studio/#builds');
  const row = page.locator(`[data-job-id="${job.id}"]`);
  await expect(row).toBeVisible();
  let release!: () => void, captured!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route(
    '**/api/bootstrap',
    async (route) => {
      const response = await route.fetch();
      captured();
      await waiting;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await read;
  const current = (await (await request.get('/api/jobs')).json()).find(
    (item: Job) => item.id === job.id,
  );
  const removed = await mutate(request, 'jobs/history/remove', {
    items: [{ id: current.id, revision: current.revision }],
  });
  await expect(row).toBeHidden();
  release();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(row).toBeHidden();
  await mutate(request, `jobs/history/${removed.undoId}/restore`, {});
  await expect(row).toBeVisible();
  const restored = (await (await request.get('/api/jobs')).json()).find(
    (item: Job) => item.id === job.id,
  );
  await mutate(request, 'jobs/history/remove', {
    items: [{ id: restored.id, revision: restored.revision }],
  });
});

test('a broken article link opens its source and restoration permits a fresh build', async ({
  page,
  request,
}) => {
  const original = await bootstrap(request),
    created: string[] = [];
  const target = original.entries.find((entry: any) => entry.slug === 'a-small-case-for-curiosity');
  try {
    await mutate(
      request,
      'site',
      {
        value: {
          ...original.site,
          url: 'https://fixture.pages.dev',
          cloudflare: {
            accountId: 'a'.repeat(32),
            projectName: 'fixture',
            productionBranch: 'main',
          },
        },
        revision: original.siteRevision,
      },
      'PUT',
    );
    await mutate(request, 'content/batch', {
      action: 'trash',
      items: [{ id: target.id, revision: target.revision }],
    });
    await page.goto('/studio/#builds');
    const started = page.waitForResponse(
      (response) => response.url().endsWith('/api/jobs') && response.request().method() === 'POST',
    );
    await page
      .locator('.builds-page')
      .getByRole('button', { name: 'Build & Publish', exact: true })
      .click();
    const { id } = await (await started).json();
    created.push(id);
    const row = page.locator(`[data-job-id="${id}"]`);
    await expect(row.locator('.job-status')).toHaveText('Needs attention');
    await expect(row).toContainText('posts/component-showcase.md');
    await expect(row).toContainText('update/remove this link');
    await expect(row.getByRole('button', { name: 'Open Pages settings' })).toBeHidden();
    await screenshot(page, 'broken-link-recovery');
    await row.getByRole('button', { name: 'Open source article' }).click();
    await expect(page.locator('.editor-breadcrumb')).toContainText('The component showcase');
    const trashed = (await (await request.get('/api/trash')).json()).find(
      (entry: any) => entry.id === target.id,
    );
    await mutate(request, 'trash/batch', {
      action: 'restore',
      items: [{ id: trashed.id, revision: trashed.revision }],
    });
    const next = await mutate(request, 'jobs', { action: 'build' });
    created.push(next.id);
    await completed(request, next.id);
  } finally {
    const current = await bootstrap(request);
    await mutate(request, 'site', { value: original.site, revision: current.siteRevision }, 'PUT');
    const trashed = (await (await request.get('/api/trash')).json()).find(
      (entry: any) => entry.id === target.id,
    );
    if (trashed)
      await mutate(request, 'trash/batch', {
        action: 'restore',
        items: [{ id: trashed.id, revision: trashed.revision }],
      });
    const items = (await (await request.get('/api/jobs')).json())
      .filter((job: Job) => created.includes(job.id))
      .map(({ id, revision }: Job) => ({ id, revision }));
    if (items.length) await mutate(request, 'jobs/history/remove', { items });
  }
});
