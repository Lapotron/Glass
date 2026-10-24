import { test, expect, type APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';
import type { AcaReport } from '../src/shared/aca.js';
import AxeBuilder from '@axe-core/playwright';
import { routeFor, type PublicEntry } from '../src/shared/contracts.js';
import { enableAnalyticsInterface } from './fixtures/analytics-interface.js';
const state = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, url: string, method: string, data: unknown) {
  const current = await state(request);
  const response = await request.fetch('/api/' + url, {
    method,
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function build(request: APIRequestContext) {
  await expect
    .poll(
      async () =>
        !(await state(request)).jobs.some(
          (job: { state: string }) => !['succeeded', 'failed'].includes(job.state),
        ),
      { timeout: 60000 },
    )
    .toBe(true);
  const job = await mutate(request, 'jobs', 'POST', { action: 'build' });
  await expect
    .poll(
      async () =>
        (await state(request)).jobs.find((item: { id: string }) => item.id === job.id)?.state,
      {
        timeout: 60000,
      },
    )
    .toBe('succeeded');
}

test('Pagefind searches full code and Chinese content with filters, section links and shareable state', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/search/?q=amplitude');
  const input = page.getByRole('searchbox', { name: 'Search this site', exact: true });
  await expect(page.locator('.search-result')).not.toHaveCount(0);
  const notebook = await state(request);
  const firstRoute = new URL(
    (await page.locator('.search-result').first().getAttribute('href'))!,
    'https://reader.test',
  ).pathname;
  const target = notebook.entries.find(
    (entry: PublicEntry) => routeFor(entry, notebook.site.collections) === firstRoute,
  );
  expect(target).toBeTruthy();
  await expect(page.locator('.search-result').first()).toHaveAttribute('data-aca-item', target.id);
  await expect(page.locator('[data-search-page] .search-results')).toContainText('amplitude', {
    ignoreCase: true,
  });
  await input.fill('思考');
  await expect(page.locator('[data-search-page] .search-results')).toContainText('把想法留在纸上');
  await page.getByLabel('Filter by language').selectOption('zh');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await expect(page).toHaveURL(/language=zh/);
  await input.fill('curiosity');
  await expect(page.locator('[data-search-page] .search-results')).toContainText('No matches');
  await page.getByLabel('Filter by language').selectOption('');
  await expect(page.locator('.search-result')).not.toHaveCount(0);
  await input.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.search-result').first()).toBeFocused();
  expect(errors).toEqual([]);
});

test('Expressive Code preserves source for copying, adapts themes and keeps the reading panel responsive', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    });
  });
  await page.goto('http://127.0.0.1:4174/blog/component-showcase/');
  await page.getByRole('tab', { name: 'A small example', exact: true }).click();
  const block = page.locator('.code-enhanced:visible').first();
  await block.scrollIntoViewIfNeeded();
  await expect(block.locator('.expressive-code')).toBeVisible();
  await expect(block.locator('.code-toolbar')).toHaveCount(1);
  const expected = await block.locator('[data-code-line]').allTextContents();
  await block.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { copied: string }).copied))
    .toBe(expected.join('\n'));
  await block.getByRole('button', { name: 'Wrap', exact: true }).click();
  await expect(block).toHaveClass(/code-wrapped/);
  const token = block.locator('[data-code-line] span[style]').first();
  const light = await token.evaluate((node) => getComputedStyle(node).color);
  await page.locator('html').evaluate((node) => (node.dataset.theme = 'dark'));
  await expect.poll(() => token.evaluate((node) => getComputedStyle(node).color)).not.toBe(light);
  const download = page.waitForEvent('download');
  await block.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toBeTruthy();
  await page
    .getByRole('heading', { name: 'Two perspectives', exact: true })
    .scrollIntoViewIfNeeded();
  await page.getByRole('tab', { name: 'A small example', exact: true }).click();
  const fileId = await page
    .locator('.code-enhanced')
    .filter({ has: page.locator('.code-filename').filter({ hasText: 'A ray entering water' }) })
    .first()
    .getAttribute('id');
  const fileBlock = page.locator(`[id="${fileId}"]`);
  await expect(fileBlock.locator('.code-toolbar')).toHaveCount(1);
  await expect(fileBlock.locator('figure.frame')).not.toHaveClass(/has-title/);
  await expect(fileBlock.locator('.code-toolbar .code-filename')).toHaveText(
    'A ray entering water',
  );
  await expect(fileBlock.locator('.code-language')).toHaveText('typescript');
  await fileBlock.locator('.code-filename').evaluate((node) => {
    node.textContent = 'src/components/a-deliberately-long-and-descriptive-filename.example.ts';
    node.setAttribute('title', node.textContent);
  });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await fileBlock.locator('.code-toolbar').boundingBox())!.height).toBeLessThanOrEqual(
      44,
    );
    if (width === 320)
      expect(
        await fileBlock
          .locator('.code-filename')
          .evaluate((node) => node.scrollWidth > node.clientWidth),
      ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
  }
  await fs.mkdir('test-results/visuals', { recursive: true });
  await fileBlock.screenshot({
    path: `test-results/visuals/${test.info().project.name}-expressive-code.png`,
    animations: 'disabled',
  });
});

test('Projects curates drafts, previews unsaved changes, publishes responsive cards and recovers a removal', async ({
  page,
  request,
}) => {
  const original = await state(request);
  try {
    await page.goto('/studio/#projects');
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('A curated software project');
    await page
      .getByLabel('Description', { exact: true })
      .fill('A small experiment in careful interface design.');
    const technologies = page.getByLabel('Technologies', { exact: true });
    await technologies.pressSequentially('TypeScript,');
    await expect(technologies).toHaveValue('TypeScript,');
    await technologies.pressSequentially(' Rust,  React');
    await expect(technologies).toHaveValue('TypeScript, Rust,  React');
    await technologies.blur();
    await page.getByLabel('Visibility', { exact: true }).selectOption('public');
    await expect(technologies).toHaveValue('TypeScript, Rust, React');
    await expect(
      page
        .frameLocator('iframe[title="Projects preview"]')
        .getByRole('heading', { name: 'A curated software project' }),
    ).toBeVisible();
    const previewCard = page.locator('.project-preview');
    const previewFrame = previewCard.locator('iframe:visible');
    for (const width of [320, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(async () => {
          const card = (await previewCard.boundingBox())!;
          const frame = (await previewFrame.boundingBox())!;
          return frame.y + frame.height <= card.y + card.height;
        })
        .toBe(true);
      expect((await previewFrame.boundingBox())!.height).toBeGreaterThanOrEqual(360);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Save projects', exact: true }).click();
    await expect(page.getByText('All changes saved', { exact: true }).first()).toBeVisible();
    expect(
      (await state(request)).projects.projects.find(
        (project: { title: string }) => project.title === 'A curated software project',
      )?.technologies,
    ).toEqual(['TypeScript', 'Rust', 'React']);
    await build(request);
    await page.goto('/projects/');
    await expect(page.getByRole('heading', { name: 'A curated software project' })).toBeVisible();
    await expect(page.locator('.project-status')).toContainText('In development');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const links = await nav.locator('a').allTextContents();
    expect(links.map((s) => s.trim())).toEqual(['Home', 'Archive', 'Projects', 'Life', 'About']);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
        .toBe(true);
    }
    await fs.mkdir('test-results/visuals', { recursive: true });
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-projects.png`,
      animations: 'disabled',
    });
    await page.goto('/studio/#projects');
    await page.getByRole('button', { name: 'Remove project', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Remove A curated software project?' });
    await modal.getByRole('button', { name: 'Remove project', exact: true }).click();
    await page.getByRole('button', { name: 'Save projects', exact: true }).click();
    await page.getByRole('button', { name: 'Undo last save', exact: true }).click();
    await expect(page.getByRole('button', { name: /A curated software project/ })).toBeVisible();
  } finally {
    const current = await state(request);
    await mutate(request, 'projects', 'PUT', {
      value: original.projects,
      revision: current.projectsRevision,
    });
    await build(request);
  }
});

test('Cloudflare-managed analytics persists in Studio and allows one edge-injected beacon under the real CSP', async ({
  page,
  request,
}) => {
  const original = await state(request);
  const errors: string[] = [];
  let beacons = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/studio/#settings/cloudflare-analytics');
    const mode = page.getByLabel('Beacon installation', { exact: true });
    await expect(mode).toHaveValue('manual');
    await mode.selectOption('managed');
    await page
      .getByRole('switch', { name: 'Enable Cloudflare Web Analytics', exact: true })
      .check();
    await expect(page.getByLabel('Public analytics token', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('note')).toContainText('Cloudflare controls injection');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    const saved = await state(request);
    expect(saved.site.integrations.analytics).toMatchObject({
      enabled: true,
      mode: 'managed',
      token: '',
    });
    expect(saved.site.integrations.aca).toEqual(original.site.integrations.aca);
    await page.reload();
    await expect(mode).toHaveValue('managed');
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath('cloudflare-managed-phone.png'),
      animations: 'disabled',
    });
    await build(request);
    await page.route('https://managed-reader.test/**', async (route) => {
      const url = new URL(route.request().url());
      const response = await request.get('http://127.0.0.1:4387' + url.pathname);
      if (!response.headers()['content-type']?.includes('text/html'))
        return route.fulfill({ response });
      const body = (await response.text()).replace(
        '</body>',
        '<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/fixture" data-cf-beacon="{}"></script></body>',
      );
      return route.fulfill({ response, body });
    });
    await page.route('https://static.cloudflareinsights.com/**', async (route) => {
      beacons++;
      await route.fulfill({
        contentType: 'text/javascript',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: 'document.documentElement.dataset.fixtureBeacon = "loaded";',
      });
    });
    const response = await page.goto('https://managed-reader.test/');
    expect(response?.headers()['content-security-policy']).toContain(
      'https://static.cloudflareinsights.com',
    );
    await expect(page.locator('html')).toHaveAttribute('data-fixture-beacon', 'loaded');
    await expect(page.locator('[data-analytics]')).toHaveCount(0);
    await expect(page.locator('script[src*="beacon.min.js"]')).toHaveCount(1);
    expect(beacons).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    const current = await state(request);
    await mutate(request, 'site', 'PUT', { value: original.site, revision: current.siteRevision });
    await build(request);
  }
});

test('ACA observes anonymous active time without retaining identity or raw search text, and pauses hidden tabs', async ({
  page,
  request,
}) => {
  const batches: {
    active: number;
    consent: string;
    visitor?: string;
    route: string;
    ended?: boolean;
  }[] = [];
  const cookies: string[] = [],
    failures: string[] = [];
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('https://metrics.reader.test/'))
      failures.push(request.failure()?.errorText || 'Request failed');
  });
  await page.context().addCookies([
    {
      name: 'session-canary',
      value: 'never-send-to-aca',
      domain: '.reader.test',
      path: '/',
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.addInitScript(() => {
    const state = { calls: [] as { credentials: string; keepalive: boolean }[], beacons: 0 };
    Object.assign(window, { acaTransport: state });
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('https://metrics.reader.test/')) {
        state.calls.push({
          credentials:
            init?.credentials || (input instanceof Request ? input.credentials : 'same-origin'),
          keepalive: init?.keepalive || (input instanceof Request && input.keepalive),
        });
        if (typeof init?.body === 'string' && JSON.parse(init.body).ended)
          sessionStorage.setItem('aca-exit-transport', JSON.stringify(state.calls.at(-1)));
      }
      return original(input, init);
    };
    const beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      state.beacons++;
      return beacon(url, data);
    };
  });
  await page.route('https://metrics.reader.test/**', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': 'https://reader.test',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    cookies.push((await route.request().allHeaders()).cookie || '');
    batches.push(route.request().postDataJSON());
    await route.fulfill({
      json: { ok: true },
      headers: { 'Access-Control-Allow-Origin': 'https://reader.test' },
    });
  });
  await page.route('https://reader.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/aca-navigation-complete/')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Navigation complete</title>',
      });
    const response = await request.get('http://127.0.0.1:4174' + url.pathname);
    if (!response.headers()['content-type']?.includes('text/html'))
      return route.fulfill({ response });
    const config = JSON.stringify({
      enabled: true,
      endpoint: 'https://metrics.reader.test',
      siteId: 'fixture',
      collectInteractions: true,
      collectVitals: false,
    }).replaceAll('"', '&quot;');
    const body = (await response.text()).replace(
      '</head>',
      `<meta name="aca-config" content="${config}"><meta name="aca-content" content="{&quot;id&quot;:&quot;post-showcase&quot;,&quot;revision&quot;:&quot;${'a'.repeat(64)}&quot;}"></head>`,
    );
    const headers = {
      ...response.headers(),
      'content-security-policy':
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://metrics.reader.test; worker-src 'self' blob:",
    };
    await route.fulfill({ response, body, headers });
  });
  await page.clock.install();
  await page.goto('https://reader.test/blog/component-showcase/?q=private_search_term');
  await expect.poll(() => batches.length).toBeGreaterThan(0);
  await page.clock.runFor(21000);
  await expect.poll(() => batches.at(-1)?.active || 0).toBeGreaterThanOrEqual(10000);
  expect(batches.every((b) => b.consent === 'anonymous' && !b.visitor)).toBe(true);
  expect(JSON.stringify(batches)).not.toContain('private_search_term');
  expect(await page.evaluate(() => localStorage.getItem('fieldnotes-aca-identity'))).toBeNull();
  const beforeHidden = batches.length;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => batches.length).toBeGreaterThan(beforeHidden);
  const before = batches.at(-1)?.active || 0;
  await page.clock.runFor(30000);
  expect(batches.at(-1)?.active || 0).toBeLessThanOrEqual(Math.max(before + 1000, 22000));
  const transport = await page.evaluate(
    () =>
      (
        window as unknown as {
          acaTransport: { calls: { credentials: string; keepalive: boolean }[]; beacons: number };
        }
      ).acaTransport,
  );
  expect(transport.beacons).toBe(0);
  expect(transport.calls.every((call) => call.credentials === 'omit')).toBe(true);
  expect(transport.calls.some((call) => call.keepalive)).toBe(true);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect.poll(() => batches.some((batch) => batch.ended)).toBe(true);
  expect(cookies.every((cookie) => cookie === '')).toBe(true);
  expect(failures).toEqual([]);
  await page.evaluate(() => sessionStorage.removeItem('aca-exit-transport'));
  await page.goto('https://reader.test/aca-navigation-complete/');
  // Chromium can hand keepalive requests outside Playwright's old-frame routing.
  // Observe the native navigation's dispatch separately from controlled CORS delivery.
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('aca-exit-transport') || 'null')),
  ).toEqual({ credentials: 'omit', keepalive: true });
});

test('private Analytics supports charts, keyboard tabs, comparison, article drilldown and recoverable report failures', async ({
  page,
  request,
}) => {
  await enableAnalyticsInterface(page);
  const notebook = await state(request);
  const entry = notebook.entries.find((item: { status: string }) => item.status === 'published');
  const requests: URL[] = [],
    errors: string[] = [];
  let unavailable = false;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/analytics/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/segments')) return route.continue();
    requests.push(url);
    if (unavailable)
      return route.fulfill({ status: 503, json: { error: 'Controlled analytics outage' } });
    const name = url.pathname.split('/').at(-1) as AcaReport['name'];
    const from = url.searchParams.get('from')!,
      to = url.searchParams.get('to')!;
    const report: AcaReport = {
      name,
      from,
      to,
      generatedAt: new Date().toISOString(),
      timezone: 'UTC',
      metrics: [
        { label: 'Page views', value: 240 },
        { label: 'Qualified reads', value: 180 },
        { label: 'Active reading', value: 720, unit: 'min' },
        { label: 'Opt-in unique browsers', value: 86 },
        { label: 'Impressions', value: 640 },
        { label: 'On-site CTR', value: 12.5, unit: '%' },
      ],
      series: Array.from({ length: 28 }, (_, index) => ({
        day: new Date(Date.parse(from) + index * 86400000).toISOString().slice(0, 10),
        views: 20 + index * 3,
        qualified: 10 + index,
        active: 180 + index * 35,
        impressions: 42 + index,
        clicks: 4 + index,
        visitors: 8 + index,
      })),
      rows:
        name === 'engagement'
          ? [{ section: 'introduction', activeSeconds: 1400, views: 180 }]
          : [{ content: entry.id, revision: entry.revision, views: 240, qualified: 180 }],
      retention:
        name === 'engagement'
          ? Array.from({ length: 20 }, (_, index) => ({
              progress: index * 5,
              reached: 180 - index * 6,
              activeMs: 140000 - index * 1000,
              dropoffs: index,
            }))
          : [],
      cohorts:
        name === 'audience'
          ? [
              {
                cohort: '2026-09',
                browsers: 36,
                day1: 40,
                day7: 25,
                day30: -1,
                day90: -1,
                day180: -1,
              },
            ]
          : [],
      freshness: new Date().toISOString(),
      notes: ['Synthetic browser fixture. Opt-in unique browsers are not people.'],
    };
    return route.fulfill({ json: report });
  });
  await page.goto('/studio/#analytics');
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  await expect(page.locator('.aca-metric')).toHaveCount(6);
  await expect(page.locator('.aca-chart svg')).toBeVisible();
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Reach', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Reach', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await page.getByRole('button', { name: entry.title, exact: true }).click();
  await expect(page.locator('.aca-content-picker')).toHaveText(entry.title);
  await expect(page.getByLabel('Revision', { exact: true })).toHaveValue(entry.revision);
  await expect(page.getByRole('heading', { name: 'Reading retention', exact: true })).toBeVisible();
  await expect(page.locator('.aca-chart svg')).toHaveCount(2);
  await page.getByLabel('Compare previous period').check();
  await expect
    .poll(() => requests.filter((url) => url.searchParams.get('content') === entry.id).length)
    .toBeGreaterThan(2);
  await expect(page.locator('.aca-comparison').first()).toContainText('vs previous');
  await page.getByLabel('Chart metric').selectOption('active');
  await expect(
    page.getByRole('img', {
      name: 'Active reading (s) by day. Use the data table for exact values.',
    }),
  ).toBeVisible();
  await fs.mkdir('test-results/visuals', { recursive: true });
  for (const appearance of ['light', 'dark']) {
    if (appearance === 'dark')
      await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
        .toBe(true);
      await page.locator('.aca-chart').first().scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `test-results/visuals/${test.info().project.name}-aca-${appearance}-${width}.png`,
        animations: 'disabled',
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export report CSV', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('aca-engagement-');
  await page.getByLabel('From (UTC)').fill('');
  await page.getByRole('button', { name: 'Apply range', exact: true }).click();
  await expect(page.getByText('Choose real start and end dates.')).toBeVisible();
  await page
    .getByLabel('From (UTC)')
    .fill(new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10));
  unavailable = true;
  await page.getByRole('button', { name: 'Refresh reports', exact: true }).click();
  await expect(page.getByText('Controlled analytics outage', { exact: true })).toBeVisible();
  await expect(page.getByText('Showing the last successful report', { exact: true })).toBeVisible();
  await expect(page.locator('.aca-metric')).toHaveCount(6);
  unavailable = false;
  await page.getByRole('button', { name: 'Refresh reports', exact: true }).click();
  await expect(page.getByText('Controlled analytics outage', { exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});

test('Giscus has a complete local style specimen with light/dark materials and no provider connection', async ({
  page,
  request,
}) => {
  const before = await state(request),
    external: string[] = [];
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)
    )
      external.push(request.url());
  });
  await page.goto('/studio/#settings');
  await page.locator('.settings-section-rail a[href="#settings/discussions"]').click();
  const opener = page.getByRole('button', { name: 'Preview discussion styles', exact: true });
  await opener.click();
  const modal = page.getByRole('dialog', { name: 'Discussion styles', exact: true });
  const frame = page.frameLocator('iframe[title="Discussion style specimen"]');
  await expect(frame.locator('.gsc-comment-box')).toBeVisible();
  const light = await frame.locator('body').evaluate((node) => getComputedStyle(node).color);
  await frame.locator('textarea').fill('An editable, local sample.');
  await frame.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(frame.locator('[data-demo-preview]')).toHaveText('An editable, local sample.');
  await frame.getByRole('button', { name: 'Write', exact: true }).click();
  await frame.getByRole('button', { name: 'Try a sample reaction' }).first().click();
  await expect(
    frame.getByRole('button', { name: 'Try a sample reaction' }).first(),
  ).toHaveAttribute('aria-pressed', 'true');
  await fs.mkdir('test-results/visuals', { recursive: true });
  for (const appearance of ['Light', 'Dark']) {
    await modal.getByRole('button', { name: appearance, exact: true }).click();
    await expect(modal.locator('iframe')).toHaveAttribute('aria-busy', 'false');
    // Model Primer's opaque utility class behind the real nested editor markup.
    await frame.locator('head').evaluate((head) => {
      const style = document.createElement('style');
      style.textContent =
        '.color-bg-primary { background: white; }.rounded-md { border-radius: 6px !important; }';
      head.append(style);
      document.querySelector('.gsc-comment-box-main')?.classList.add('color-bg-primary');
      document.querySelector('.gsc-comment-box-buttons .btn')?.classList.add('rounded-md');
    });
    await expect(frame.locator('.gsc-comment-box-buttons .btn')).toHaveCSS('border-radius', '10px');
    for (const selector of [
      'main',
      '.gsc-comment-box-main',
      '.gsc-comment-box-write',
      '.gsc-comment-box-textarea',
    ]) {
      await expect
        .poll(() =>
          frame
            .locator(selector)
            .first()
            .evaluate((node) => getComputedStyle(node).backgroundColor),
        )
        .toBe('rgba(0, 0, 0, 0)');
    }
    const panelAlpha = await frame.locator('.gsc-comment-box').evaluate((node) => {
      const color = getComputedStyle(node).backgroundColor;
      return color === 'rgba(0, 0, 0, 0)' ? 0 : Number(color.match(/,\s*([\d.]+)\)$/)?.[1] ?? 1);
    });
    expect(panelAlpha).toBeLessThanOrEqual(0.12);
    if (appearance === 'Dark')
      await expect
        .poll(() => frame.locator('body').evaluate((node) => getComputedStyle(node).color))
        .not.toBe(light);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
        .toBe(true);
      expect(
        await frame
          .locator('body')
          .evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
      ).toBe(true);
      await modal.screenshot({
        path: `test-results/visuals/${test.info().project.name}-giscus-${appearance.toLowerCase()}-${width}.png`,
        animations: 'disabled',
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(
      (await new AxeBuilder({ page }).include('.giscus-style-preview').analyze()).violations,
    ).toEqual([]);
  }
  await modal.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(opener).toBeFocused();
  expect((await state(request)).siteRevision).toBe(before.siteRevision);
  expect(external).toEqual([]);
});
