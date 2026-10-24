import { test, expect } from '@playwright/test';
import type { Job } from '../src/shared/contracts.js';
test('an uploaded build can be rechecked from history without another build or upload', async ({
  page,
  request,
}) => {
  const state = await (await request.get('/api/bootstrap')).json();
  const job: Job = {
    id: 'recorded-upload',
    revision: 'captured-revision',
    action: 'publish',
    state: 'failed',
    failedAt: 'verifying-deployment',
    error: 'Initial verification failed.',
    logs: ['Initial verification failed.'],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    target: { canonicalUrl: 'https://saved.example.org', project: 'project', branch: 'main' },
    build: {
      id: 'saved-build',
      outputDir: '/temporary/dist',
      pages: 2,
      manifest: ['index.html', 'assets/deployment.json'],
      diagnostics: [],
      sourceRevision: 'a'.repeat(64),
      completedAt: new Date().toISOString(),
    },
    deployment: {
      url: 'https://saved.project.pages.dev',
      project: 'project',
      buildId: 'saved-build',
      completedAt: new Date().toISOString(),
    },
  };
  let builds = 0,
    rechecks = 0;
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({ json: { ...state, jobs: [job] } }),
  );
  await page.route('**/api/jobs', (route) => {
    builds++;
    return route.abort();
  });
  await page.route('**/api/jobs/recorded-upload/recheck', (route) => {
    expect(route.request().postDataJSON()).toEqual({ revision: 'captured-revision' });
    rechecks++;
    job.state = 'succeeded';
    job.error = undefined;
    job.failedAt = undefined;
    return route.fulfill({ json: job });
  });
  await page.goto('/studio/#builds');
  const card = page.locator('[data-job-id="recorded-upload"]');
  await expect(card).toContainText('Unverified upload');
  await card.getByRole('button', { name: 'Recheck deployment', exact: true }).click();
  await expect(
    page.getByText('Deployment verified. No files were uploaded.', { exact: true }),
  ).toBeVisible();
  await expect(card.getByText('Unverified upload', { exact: true })).toHaveCount(0);
  await expect(
    card.getByRole('link', { name: 'https://saved.project.pages.dev', exact: true }),
  ).toBeVisible();
  expect(rechecks).toBe(1);
  expect(builds).toBe(0);
});
