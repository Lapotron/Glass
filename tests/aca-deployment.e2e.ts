import { test, expect, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { AcaDeploymentSummary } from '../src/shared/aca-deployment.js';
const bootstrap = async (request: APIRequestContext) =>
  (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, pathname: string, method: string, data: unknown) {
  const state = await bootstrap(request);
  const response = await request.fetch('/api/' + pathname, {
    method,
    data,
    headers: { 'X-Studio-Token': state.token, Origin: 'http://127.0.0.1:4387' },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
const summary = async (request: APIRequestContext): Promise<AcaDeploymentSummary> =>
  (await request.get('/api/aca/deployment')).json();
test('ACA setup creates and verifies an independent service, fills its public connection and retains private settings', async ({
  page,
  request,
}) => {
  const original = await bootstrap(request),
    previous = await summary(request);
  const credentials = await (await request.get('/api/connections')).json();
  const name = 'browser-' + test.info().project.name + '-aca';
  try {
    await mutate(request, 'site', 'PUT', {
      value: {
        ...original.site,
        url: 'https://reader.example.org',
        cloudflare: { ...original.site.cloudflare, accountId: 'a'.repeat(32) },
      },
      revision: original.siteRevision,
    });
    await mutate(request, 'connections', 'PUT', {
      revision: credentials.revision,
      set: { cloudflareApiToken: 'browser-cloudflare-test-canary-token' },
    });
    await page.goto('/studio/#settings/aca');
    const setup = page.getByRole('region', { name: 'ACA service deployment', exact: true });
    await expect(setup.getByLabel('Worker name', { exact: true })).toBeVisible();
    await setup.getByLabel('Worker name', { exact: true }).fill(name);
    await setup.getByLabel('D1 database name', { exact: true }).fill(name);
    await setup
      .getByLabel('Analytics custom domain', { exact: true })
      .fill('analytics.reader.example.org');
    await setup.getByLabel('Service site ID', { exact: true }).fill('reader');
    await setup.getByRole('button', { name: 'Check ACA connection', exact: true }).click();
    await expect(setup).toContainText('ACA read access verified');
    await expect(setup.locator('.aca-setup-check')).not.toContainText('Access organization');
    await setup.getByRole('button', { name: 'Set up ACA', exact: true }).click();
    await expect
      .poll(async () => {
        const state = await summary(request);
        return !state.busy && state.job?.state === 'succeeded';
      })
      .toBe(true);
    await expect(setup).toContainText('Saved privately');
    expect((await summary(request)).job?.deploymentUrl).toBeUndefined();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/connections')).json()).fields.acaReportToken.configured,
      )
      .toBe(true);
    await setup.getByRole('button', { name: 'Deploy ACA', exact: true }).click();
    await expect
      .poll(async () => {
        const state = await summary(request);
        return !state.busy && state.job?.verified;
      })
      .toBe(true);
    await expect(page.getByLabel('ACA Worker origin', { exact: true })).toHaveValue(
      'https://analytics.reader.example.org',
    );
    await expect(page.getByLabel('Public site ID', { exact: true })).toHaveValue('reader');
    await expect(setup).toContainText('Service verified');
    await expect(page.getByRole('switch', { name: 'Enable ACA', exact: true })).not.toBeChecked();
    await setup.locator('summary').filter({ hasText: 'Deployment log' }).click();
    await expect(setup.locator('.aca-setup-log')).toContainText('[redacted]');
    await expect(setup.locator('.aca-setup-log')).not.toContainText(
      'browser-cloudflare-test-canary-token',
    );
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
        ).toBe(true);
        await setup.screenshot({
          path: test.info().outputPath(`aca-setup-${theme}-${width}.png`),
          animations: 'disabled',
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect((await new AxeBuilder({ page }).include('.aca-setup').analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.reload();
    await expect(page.getByLabel('Worker name', { exact: true })).toHaveValue(name);
    await expect(setup).toContainText('Service verified');
    expect((await bootstrap(request)).jobs.map((job: { id: string }) => job.id)).toEqual(
      original.jobs.map((job: { id: string }) => job.id),
    );
  } finally {
    const current = await bootstrap(request);
    await mutate(request, 'site', 'PUT', { value: original.site, revision: current.siteRevision });
    const latest = await summary(request);
    await mutate(request, 'aca/deployment', 'PUT', {
      value: previous.options,
      revision: latest.revision,
    });
    const connection = await (await request.get('/api/connections')).json();
    await mutate(request, 'connections', 'PUT', {
      revision: connection.revision,
      remove: ['cloudflareApiToken', 'acaReportToken'],
    });
  }
});

test('ACA setup preserves its configured target after a failed permission check', async ({
  page,
  request,
}) => {
  const previous = await summary(request);
  try {
    await page.route('**/api/aca/deployment/check', (route) =>
      route.fulfill({
        json: {
          readiness: {
            checkedAt: new Date().toISOString(),
            accountId: 'a'.repeat(32),
            ready: false,
            checks: [
              { id: 'workers', status: 'ready', codes: [] },
              { id: 'd1', status: 'denied', codes: [10000] },
            ],
          },
        },
      }),
    );
    await page.goto('/studio/#settings/aca');
    const setup = page.locator('.aca-setup');
    await setup.getByLabel('Worker name', { exact: true }).fill('retry-safe-aca');
    await setup.getByRole('button', { name: 'Check ACA connection', exact: true }).click();
    await expect(setup).toContainText('ACA connection needs attention');
    await expect(setup).toContainText('10000');
    await expect(setup.getByLabel('Worker name', { exact: true })).toHaveValue('retry-safe-aca');
    await page.locator('.settings-section-rail a[href="#settings/cloudflare"]').click();
    await page.getByLabel('Cloudflare account ID', { exact: true }).fill('b'.repeat(32));
    await page.locator('.settings-section-rail a[href="#settings/aca"]').click();
    await expect(setup.locator('.aca-setup-check')).toBeHidden();
  } finally {
    const latest = await summary(request);
    await mutate(request, 'aca/deployment', 'PUT', {
      value: previous.options,
      revision: latest.revision,
    });
  }
});
