import { test, expect, type APIRequestContext, type Browser } from '@playwright/test';
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
}
async function build(request: APIRequestContext) {
  const current = await state(request);
  const response = await request.post('/api/jobs', {
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data: { action: 'build' },
  });
  expect(response.ok()).toBe(true);
  const job = await response.json();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/jobs')).json()).find(
          (item: { id: string }) => item.id === job.id,
        )?.state,
      { timeout: 30000 },
    )
    .toBe('succeeded');
}

test('Studio configures GA4 independently, normalizes its ID and keeps private previews untracked', async ({
  page,
  request,
}) => {
  const original = await state(request),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/studio/#settings');
    await page
      .getByRole('navigation', { name: 'Site settings sections' })
      .getByRole('link', { name: 'Google Analytics', exact: true })
      .click();
    const google = page.getByRole('region', { name: 'Google Analytics 4', exact: true });
    await expect(
      google.getByRole('switch', { name: 'Enable Google Analytics 4', exact: true }),
    ).not.toBeChecked();
    await google.getByRole('switch', { name: 'Enable Google Analytics 4', exact: true }).check();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('measurement ID');
    expect((await state(request)).site.integrations.googleAnalytics.enabled).toBe(false);
    await google.getByLabel('GA4 measurement ID', { exact: true }).fill('g-test123456');
    await google.getByRole('switch', { name: 'Google Analytics debug mode', exact: true }).check();
    await page.getByRole('button', { name: 'Preview site', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Site preview', exact: true });
    await expect(preview.frameLocator('iframe').locator('html')).toHaveAttribute(
      'data-preview',
      'true',
    );
    await expect(preview.frameLocator('iframe').locator('[data-google-analytics]')).toHaveCount(0);
    await expect(
      preview.frameLocator('iframe').locator('script[src*="googletagmanager"]'),
    ).toHaveCount(0);
    await preview.getByRole('button', { name: 'Close Site preview', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(google.getByLabel('GA4 measurement ID', { exact: true })).toHaveValue(
      'G-TEST123456',
    );
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    const saved = await state(request);
    expect(saved.site.integrations.analytics).toEqual(original.site.integrations.analytics);
    expect(saved.site.integrations.googleAnalytics).toEqual({
      enabled: true,
      measurementId: 'G-TEST123456',
      respectPrivacy: true,
      debugMode: true,
    });
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Site settings sections' })
      .getByRole('link', { name: 'Google Analytics', exact: true })
      .click();
    await expect(
      google.getByRole('switch', { name: 'Google Analytics debug mode', exact: true }),
    ).toBeChecked();
    await google.scrollIntoViewIfNeeded();
    const audit = await new AxeBuilder({ page })
      .include('[aria-labelledby="google-analytics-heading"]')
      .analyze();
    expect(
      audit.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact || '')),
    ).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath('google-analytics-settings-light.png'),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await google.getByLabel('GA4 measurement ID', { exact: true }).scrollIntoViewIfNeeded();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(391);
    await page.screenshot({
      path: test.info().outputPath('google-analytics-settings-phone-dark.png'),
      animations: 'disabled',
    });
    await build(request);
    const response = await request.get('/blog/component-showcase/');
    expect(response.headers()['content-security-policy']).toContain(
      'https://*.google-analytics.com',
    );
    await page.goto('/blog/component-showcase/');
    await expect(page.locator('[data-google-analytics]')).toHaveCount(1);
    await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await save(request, original.site);
    await build(request);
  }
});

async function reader(
  browser: Browser,
  request: APIRequestContext,
  options: {
    dnt?: string;
    gpc?: boolean;
    optOut?: boolean;
    path?: string;
    existing?: boolean;
  } = {},
) {
  const context = await browser.newContext();
  let scripts = 0,
    hits = 0;
  const violations: string[] = [],
    errors: string[] = [];
  await context.addInitScript(({ dnt, gpc, optOut }) => {
    Object.defineProperty(navigator, 'doNotTrack', { value: dnt || '0', configurable: true });
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: !!gpc, configurable: true });
    if (optOut) (window as any)['ga-disable-G-TEST123456'] = true;
  }, options);
  await context.route('https://analytics-fixture.test/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await request.get('http://127.0.0.1:4387' + url.pathname + url.search);
    if (options.existing && response.headers()['content-type']?.includes('text/html')) {
      const body = (await response.text()).replace(
        '</head>',
        '<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST123456"></script></head>',
      );
      await route.fulfill({ response, body });
    } else await route.fulfill({ response });
  });
  await context.route('https://www.googletagmanager.com/**', async (route) => {
    scripts++;
    await route.fulfill({
      contentType: 'text/javascript',
      body: `window.__gaCalls=(window.dataLayer||[]).map(item=>Array.from(item));window.__gaLoaded=true;fetch('https://region1.google-analytics.com/g/collect?fixture=1',{method:'POST',mode:'no-cors',body:'controlled fixture'});`,
    });
  });
  await context.route('https://region1.google-analytics.com/**', async (route) => {
    hits++;
    await route.fulfill({ status: 204, body: '' });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|violates/.test(message.text()))
      violations.push(message.text());
  });
  try {
    await page.goto(
      'https://analytics-fixture.test' + (options.path || '/blog/component-showcase/'),
    );
    await page.waitForLoadState('networkidle');
    const calls = await page.evaluate(() => (window as any).__gaCalls || []);
    expect(errors).toEqual([]);
    expect(violations).toEqual([]);
    return {
      scripts,
      hits,
      calls,
      configHosts: await page.locator('[data-google-analytics]').count(),
    };
  } finally {
    await context.close();
  }
}

test('GA4 initializes once with conditional CSP and honors DNT, GPC, opt-out and utility exclusions', async ({
  browser,
  request,
}) => {
  test.setTimeout(90000);
  const original = await state(request);
  const configured = {
    ...original.site,
    integrations: {
      ...original.site.integrations,
      googleAnalytics: {
        enabled: true,
        measurementId: 'G-TEST123456',
        respectPrivacy: true,
        debugMode: true,
      },
    },
  };
  try {
    await save(request, configured);
    await build(request);
    const positive = await reader(browser, request);
    expect(positive.scripts).toBe(1);
    expect(positive.hits).toBe(1);
    const configs = positive.calls.filter((call: unknown[]) => call[0] === 'config');
    expect(configs).toEqual([
      [
        'config',
        'G-TEST123456',
        {
          send_page_view: true,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
          debug_mode: true,
        },
      ],
    ]);
    for (const signal of [
      { dnt: '1' },
      { gpc: true },
      { optOut: true },
      { path: '/settings/' },
      { path: '/missing-analytics-page/' },
    ]) {
      const skipped = await reader(browser, request, signal);
      expect(skipped.scripts).toBe(0);
      expect(skipped.hits).toBe(0);
    }
    const existing = await reader(browser, request, { existing: true });
    expect(existing.scripts).toBe(1);
    expect(existing.calls.filter((call: unknown[]) => call[0] === 'config')).toHaveLength(0);
    await save(request, {
      ...configured,
      integrations: {
        ...configured.integrations,
        googleAnalytics: { ...configured.integrations.googleAnalytics, respectPrivacy: false },
      },
    });
    await build(request);
    expect((await reader(browser, request, { dnt: '1', gpc: true })).scripts).toBe(1);
    await save(request, {
      ...configured,
      integrations: {
        ...configured.integrations,
        googleAnalytics: { ...configured.integrations.googleAnalytics, enabled: false },
      },
    });
    await build(request);
    const disabled = await reader(browser, request);
    expect(disabled.configHosts).toBe(0);
    expect(disabled.scripts).toBe(0);
    expect((await request.get('/')).headers()['content-security-policy']).not.toContain(
      'googletagmanager',
    );
  } finally {
    await save(request, original.site);
    await build(request);
  }
});
