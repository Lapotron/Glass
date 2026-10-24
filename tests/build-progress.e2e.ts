import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import type { Job } from '../src/shared/contracts.js';
const require = createRequire(import.meta.url);
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;

test('build progress shows honest stages, measured counts and quiet accessible glass states', async ({
  page,
}) => {
  const startedAt = new Date(Date.now() - 23000).toISOString();
  let job: Job = {
    id: 'visual-progress',
    action: 'publish',
    state: 'building',
    mediaDelivery: 'r2',
    startedAt,
    logs: ['Rendering the saved notebook…'],
  };
  let reduceMotion = false,
    reduceTransparency = false;
  await page.addInitScript(() => localStorage.setItem('fieldnotes-appearance', 'light'));
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch(),
      snapshot = await response.json();
    await route.fulfill({
      response,
      json: {
        ...snapshot,
        jobs: [job],
        site: {
          ...snapshot.site,
          theme: { ...snapshot.site.theme, reduceMotion, reduceTransparency },
        },
      },
    });
  });
  await page.goto('/studio/#builds');
  const progress = page.getByRole('region', { name: 'Job progress' });
  await expect(progress.locator('.job-progress-copy strong')).toHaveText('Building static pages');
  await expect(progress.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  await expect(progress.locator('[aria-current="step"]')).toHaveAttribute('data-stage', 'build');
  await expect(progress.locator('.job-progress-time')).toContainText(/\d+s/);
  const elapsed = await progress.locator('.job-progress-time').textContent();
  await expect.poll(() => progress.locator('.job-progress-time').textContent()).not.toBe(elapsed);
  await expect(page.getByRole('button', { name: 'Build site', exact: true })).toBeDisabled();
  await fs.mkdir('test-results/visuals', { recursive: true });
  const capture = async (name: string) => {
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-build-progress-${name}.png`,
      animations: 'disabled',
    });
  };
  await capture('light');
  await page.getByRole('button', { name: 'Toggle Studio appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await capture('dark');
  let audit = await new AxeBuilder({ page }).include('.studio-page').analyze();
  expect(audit.violations).toEqual([]);

  job = {
    ...job,
    state: 'verifying-media',
    mediaProgress: { done: 5, total: 8, uploaded: 3, bytes: 3145728 },
  };
  await page.reload();
  await expect(
    progress.getByRole('progressbar', { name: 'Media verification progress' }),
  ).toHaveAttribute('aria-valuenow', '5');
  await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '8');
  await expect(progress.locator('.job-progress-fill')).toHaveAttribute('style', 'width: 62.5%;');
  await expect(progress.locator('[aria-current="step"]')).toHaveAttribute('data-stage', 'media');
  await expect(progress.locator('.job-progress-metrics')).toContainText('3 uploaded');
  await page.setViewportSize({ width: 390, height: 844 });
  await progress.scrollIntoViewIfNeeded();
  await capture('phone');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => document.documentElement.style.setProperty('--font-scale', '1.5'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const stageBounds = await progress.locator('.job-progress-stages li').evaluateAll((nodes) =>
    nodes.map((node) => ({
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
    })),
  );
  expect(stageBounds.every((bounds) => bounds.left >= 0 && bounds.right <= 320)).toBe(true);

  job = {
    ...job,
    state: 'failed',
    failedAt: 'verifying-media',
    completedAt: new Date(Date.parse(startedAt) + 63000).toISOString(),
    error: 'Media verification failed. Check the media domain’s CORS policy.',
  };
  await page.reload();
  await expect(progress.locator('.job-progress-copy strong')).toHaveText(
    'Stopped · Verifying CDN images',
  );
  await expect(progress.locator('[data-status="failed"]')).toHaveAttribute('data-stage', 'media');
  await expect(progress.locator('[data-stage="upload"]')).toHaveAttribute('data-status', 'waiting');
  await expect(progress.locator('.job-progress-time')).toHaveText('1m 03s');
  await expect(progress.locator('.job-progress-fill')).toHaveCSS('animation-name', 'none');
  await expect(page.getByRole('button', { name: 'Build site', exact: true })).toBeEnabled();
  await progress.scrollIntoViewIfNeeded();
  await capture('stopped');
  audit = await new AxeBuilder({ page }).include('.studio-page').analyze();
  expect(audit.violations).toEqual([]);

  job = {
    ...job,
    state: 'uploading',
    failedAt: undefined,
    completedAt: undefined,
    error: undefined,
  };
  reduceMotion = true;
  reduceTransparency = true;
  await page.reload();
  await expect(progress.locator('.job-progress-fill')).toHaveCSS('animation-name', 'none');
  await expect(progress.locator('.job-progress-fill')).toHaveCSS(
    'width',
    await progress.locator('.job-progress-track').evaluate((node) => `${node.clientWidth}px`),
  );
  await expect(progress).toHaveCSS('box-shadow', 'none');
  await expect(progress.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  reduceMotion = false;
  reduceTransparency = false;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(progress.locator('.job-progress-fill')).toHaveCSS('animation-name', 'none');

  job = {
    ...job,
    state: 'succeeded',
    completedAt: new Date(Date.parse(startedAt) + 63000).toISOString(),
  };
  await page.reload();
  await expect(progress.locator('.job-progress-copy strong')).toHaveText('Published & verified');
  await expect(progress.locator('[data-status="done"]')).toHaveCount(4);
  await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await expect(progress.locator('.job-progress-time')).toHaveText('1m 03s');
});
