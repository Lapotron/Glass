import { selectSettingsSection } from './settings-navigation.js';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';
const state = async (request: APIRequestContext) => {
  const response = await request.get('/api/bootstrap');
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
};
async function mutate(request: APIRequestContext, endpoint: string, data: unknown) {
  const current = await state(request);
  const response = await request.post('/api/' + endpoint, {
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test('reviewed notebook reset keeps site settings, downloads recovery, rejects stale reviews and refreshes Studio', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const original = await state(request),
    connection = await (await request.get('/api/connections')).json();
  let archive: Buffer | undefined,
    resetRequested = false;
  try {
    await page.goto('/studio/#settings');
    await selectSettingsSection(page, 'reset');
    await page.getByRole('button', { name: 'Review data reset', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Reset notebook data?', exact: true });
    await expect(review).toBeVisible({ timeout: 60000 });
    await expect(review).toContainText('Cloudflare/R2 credentials');
    await expect(
      review.getByRole('button', { name: 'Reset notebook data', exact: true }),
    ).toBeDisabled();
    await review.getByLabel('Type RESET to confirm', { exact: true }).fill('reset');
    await expect(
      review.getByRole('button', { name: 'Reset notebook data', exact: true }),
    ).toBeDisabled();
    const downloadEvent = page.waitForEvent('download');
    await review.getByRole('link', { name: /Download recovery copy/ }).click();
    const downloaded = await downloadEvent;
    archive = await fs.readFile((await downloaded.path())!);
    expect(archive.length).toBeGreaterThan(100);
    const changed = await mutate(request, 'content', {
      kind: 'posts',
      title: 'A late reset review edit',
      slug: `late-reset-${test.info().project.name}`,
    });
    await review.getByLabel('Type RESET to confirm', { exact: true }).fill('RESET');
    await review.getByRole('button', { name: 'Reset notebook data', exact: true }).click();
    await expect(review.getByRole('alert')).toContainText('Nothing was reset');
    expect((await state(request)).entries.some((entry: any) => entry.id === changed.id)).toBe(true);
    await review.getByRole('button', { name: 'Review reset again', exact: true }).click();
    await expect(review.getByLabel('Type RESET to confirm', { exact: true })).toHaveValue('');
    const nextDownload = page.waitForEvent('download');
    await review.getByRole('link', { name: /Download recovery copy/ }).click();
    archive = await fs.readFile((await (await nextDownload).path())!);
    await page.screenshot({
      path: test.info().outputPath('reset-review-desktop.png'),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 320, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath('reset-review-phone.png'),
      animations: 'disabled',
    });
    await review.getByLabel('Type RESET to confirm', { exact: true }).fill('RESET');
    // A reset may still finish after an interrupted browser request. Always recover the fixture.
    resetRequested = true;
    await review.getByRole('button', { name: 'Reset notebook data', exact: true }).click();
    await expect(review).toBeHidden({ timeout: 60000 });
    await expect(
      page.getByRole('status').filter({ hasText: 'Notebook data reset.' }),
    ).toBeVisible();
    const blank = await state(request);
    expect(blank.entries).toEqual([]);
    expect(blank.library.photos).toEqual([]);
    expect(blank.about.body).toBe('');
    expect(blank.site).toEqual(original.site);
    expect((await (await request.get('/api/connections')).json()).revision).toBe(
      connection.revision,
    );
    expect(await (await request.get('/api/jobs')).json()).toEqual([]);
    expect(await (await request.get('/api/trash')).json()).toEqual([]);
    await page.reload();
    await selectSettingsSection(page, 'reset');
    await expect(
      page.getByRole('link', { name: 'Download the recovery copy', exact: true }),
    ).toBeVisible();
  } finally {
    await page.close();
    if (resetRequested && archive) {
      await expect
        .poll(async () => (await request.get('/api/bootstrap')).ok(), { timeout: 60000 })
        .toBe(true);
      const session = await state(request);
      const response = await request.post('/api/backups/review', {
        headers: { 'X-Studio-Token': session.token, Origin: 'http://127.0.0.1:4387' },
        multipart: {
          file: { name: 'before-reset.json.gz', mimeType: 'application/gzip', buffer: archive },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      const review = await response.json();
      await mutate(request, 'backups/' + review.id + '/restore', {
        sourceRevision: review.sourceRevision,
      });
    }
    const late = (await state(request)).entries.filter(
      (entry: any) => entry.slug === `late-reset-${test.info().project.name}`,
    );
    if (late.length)
      await mutate(request, 'content/batch', {
        action: 'trash',
        items: late.map(({ id, revision }: any) => ({ id, revision })),
      });
    const trash = (await (await request.get('/api/trash')).json()).filter((entry: any) =>
      late.some((item: any) => item.id === entry.id),
    );
    if (trash.length)
      await mutate(request, 'trash/batch', {
        action: 'purge',
        items: trash.map(({ id, revision }: any) => ({ id, revision })),
      });
    const job = await mutate(request, 'jobs', { action: 'build' });
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/jobs')).json()).find((item: any) => item.id === job.id)
            ?.state,
        { timeout: 30000 },
      )
      .toBe('succeeded');
  }
});
