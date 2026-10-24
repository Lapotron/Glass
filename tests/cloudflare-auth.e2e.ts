import { selectSettingsSection } from './settings-navigation.js';
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
const require = createRequire(import.meta.url);
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;

test('Pages connection distinguishes identity, account access and proxy notices without stale success', async ({
  page,
  request,
}) => {
  const original = await (await request.get('/api/bootstrap')).json(),
    accountId = 'a'.repeat(32),
    otherAccount = 'b'.repeat(32);
  const save = async (site: unknown, revision: string) => {
    const state = await (await request.get('/api/bootstrap')).json();
    const response = await request.put('/api/site', {
      headers: { 'X-Studio-Token': state.token, Origin: 'http://127.0.0.1:4387' },
      data: { value: site, revision },
    });
    expect(response.ok()).toBe(true);
  };
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    waiting = new Promise<void>((resolve) => (entered = resolve));
  try {
    await save(
      { ...original.site, cloudflare: { ...original.site.cloudflare, accountId } },
      original.siteRevision,
    );
    let verified = false,
      hold = false;
    await page.route('**/api/cloudflare', async (route) => {
      if (hold) {
        entered();
        await gate;
      }
      await route.fulfill({
        json: {
          authenticated: true,
          accounts: [
            { id: accountId, name: 'First account' },
            { id: otherAccount, name: 'Second account' },
          ],
          accountId,
          pagesAccess: verified ? 'verified' : 'denied',
          projects: verified ? [{ name: 'confirmed-project' }] : [],
          error: verified
            ? undefined
            : 'Cloudflare denied Pages access (code 10000). Save an API token with Account → Cloudflare Pages → Edit for the selected account. A saved token takes precedence over Wrangler login.',
          proxyDetected: !verified,
        },
      });
    });
    await page.goto('/studio/#settings');
    await selectSettingsSection(page, 'cloudflare');
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Pages access denied', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Pages access verified', exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('.error-message')).toContainText('code 10000');
    await expect(page.locator('.error-message')).toContainText('Cloudflare Pages → Edit');
    await expect(page.getByText('Proxy settings were detected.', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pages token setup' })).toHaveAttribute(
      'target',
      '_blank',
    );
    await selectSettingsSection(page, 'connections');
    await expect(page.getByLabel('Cloudflare API token', { exact: true })).toHaveValue('');
    await selectSettingsSection(page, 'cloudflare');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await fs.mkdir('test-results/visuals', { recursive: true });
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-pages-permission-error.png`,
      fullPage: true,
      animations: 'disabled',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')),
    ).toEqual([]);
    verified = true;
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Pages access verified', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.error-message')).toHaveCount(0);
    await expect(page.locator('#pages-projects option')).toHaveAttribute(
      'value',
      'confirmed-project',
    );
    hold = true;
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await waiting;
    await page.getByRole('textbox', { name: 'Cloudflare account ID' }).fill(otherAccount);
    release();
    await expect(page.getByRole('button', { name: 'Check connection', exact: true })).toBeEnabled();
    await expect(
      page.getByRole('heading', { name: 'Pages access verified', exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('#pages-projects option')).toHaveCount(0);
    // Switching tabs must not revive a result for the previous account.
    await selectSettingsSection(page, 'local');
  } finally {
    release();
    const current = await (await request.get('/api/bootstrap')).json();
    await save(original.site, current.siteRevision);
  }
});

test('missing Pages project recovers through verified creation before publishing', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const original = await (await request.get('/api/bootstrap')).json();
  const project = `recovery-${test.info().project.name}`;
  const save = async (site: unknown) => {
    const current = await (await request.get('/api/bootstrap')).json();
    const response = await request.put('/api/site', {
      headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
      data: { value: site, revision: current.siteRevision },
    });
    expect(response.ok()).toBe(true);
  };
  const publish = async () => {
    const started = page.waitForResponse(
      (response) => response.url().endsWith('/api/jobs') && response.request().method() === 'POST',
    );
    await page
      .locator('.studio-page')
      .getByRole('button', { name: 'Build & Publish', exact: true })
      .click();
    const { id } = await (await started).json();
    return page.locator(`.build-job[data-job-id="${id}"]`);
  };
  try {
    await save({
      ...original.site,
      url: 'https://fixture.pages.dev',
      cloudflare: { accountId: 'a'.repeat(32), projectName: project, productionBranch: 'main' },
      mediaDelivery: { ...original.site.mediaDelivery, mode: 'pages' },
    });
    await page.goto('/studio/#builds');
    const failed = await publish();
    await expect(failed.locator('.job-status')).toHaveText('Needs attention');
    await expect(failed.locator('.job-inline-error')).toContainText('does not exist');
    await expect(failed.locator('.job-inline-error')).toContainText('Create this Pages project');
    await expect(failed.locator('.job-progress-copy strong')).toHaveText(
      'Stopped · Checking Pages project',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await fs.mkdir('test-results/visuals', { recursive: true });
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-pages-project-recovery.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await failed.getByRole('button', { name: 'Open Pages settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Give your notebook a home' })).toBeVisible();
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect(
      page.getByText(
        `Pages project “${project}” has not been created in this account. Create it below before publishing, or choose an existing project.`,
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Create this Pages project', exact: true }).click();
    await expect(page.locator('.success-message')).toHaveText(
      `Pages project “${project}” is ready.`,
    );
    await expect(
      page.getByText(`Pages project “${project}” exists in this account.`, { exact: true }),
    ).toBeVisible();
    await expect(page.locator(`#pages-projects option[value="${project}"]`)).toHaveCount(1);
    await expect(page.locator('.error-message')).toHaveCount(0);
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-pages-project-ready.png`,
      fullPage: true,
      animations: 'disabled',
    });
    // Repeating setup must reuse the same project instead of failing or deploying it.
    await page.getByRole('button', { name: 'Create this Pages project', exact: true }).click();
    await expect(page.locator('.success-message')).toHaveText(
      `Pages project “${project}” is ready.`,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')),
    ).toEqual([]);
    await page.goto('/studio/#builds');
    const published = await publish();
    await expect(published.locator('.job-status')).toHaveText('Complete', {
      timeout: 60000,
    });
    await expect(
      published.getByRole('link', { name: 'https://controlled.fixture.pages.dev' }),
    ).toBeVisible();
  } finally {
    await save(original.site);
  }
});
