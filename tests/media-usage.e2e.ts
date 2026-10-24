import { test, expect, type APIRequestContext } from '@playwright/test';
const state = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(
  request: APIRequestContext,
  endpoint: string,
  data: unknown,
  method = 'POST',
) {
  const current = await state(request);
  const response = await request.fetch('/api/' + endpoint, {
    method,
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test('media cards and inspector expose exact current and retained locations with working Studio links', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const entry = await mutate(request, 'content', {
    kind: 'posts',
    title: `Media usage ${test.info().project.name}`,
    slug: `media-usage-${test.info().project.name}`,
  });
  const saved = await mutate(
    request,
    'content/' + entry.id,
    {
      metadata: { ...entry, cover: '/media/coast-dawn.svg' },
      body: '# Media\n\n![A morning](/media/coast-dawn.svg)\n',
      revision: entry.revision,
    },
    'PUT',
  );
  try {
    await page.goto('/studio/#media');
    await page.getByRole('searchbox', { name: 'Search media library' }).fill(entry.title);
    const card = page.locator('.media-card').filter({ hasText: 'coast-dawn.svg' });
    await expect(card).toContainText('current');
    await expect(card.locator('.media-reference-summary')).not.toBeEmpty();
    await card.click();
    const dialog = page.getByRole('dialog', { name: 'A closer look', exact: true }),
      usage = dialog.getByRole('region', { name: 'Media usage details' });
    await expect(usage).toContainText('Markdown line 3');
    await expect(usage).toContainText('Cover image');
    await expect(usage).toContainText(`content/posts/${entry.slug}.md`);
    await expect(usage).toContainText('draft');
    await expect(usage).toContainText('Album: Coastlines');
    await usage.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath('media-usage-light.png'),
      animations: 'disabled',
    });
    await usage.getByRole('button', { name: entry.title, exact: true }).first().click();
    await expect(page.locator('.editor-breadcrumb')).toContainText(entry.title);
    await page
      .getByRole('navigation', { name: 'Studio navigation' })
      .getByRole('button', { name: 'Media library', exact: true })
      .click();
    await expect(page.getByRole('searchbox', { name: 'Search media library' })).toBeVisible();
    await mutate(request, 'content/batch', {
      action: 'trash',
      items: [{ id: saved.id, revision: saved.revision }],
    });
    await page.getByRole('searchbox', { name: 'Search media library' }).fill(entry.title);
    await card.click();
    await usage.locator('summary').filter({ hasText: 'Retained for recovery' }).click();
    await expect(usage).toContainText('Trash · Deleted');
    await page.setViewportSize({ width: 320, height: 850 });
    await usage.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath('media-usage-phone.png'),
      animations: 'disabled',
    });
    await usage.getByRole('button', { name: entry.title, exact: true }).first().click();
    await expect(page.getByRole('searchbox', { name: 'Search Trash' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    const current = (await state(request)).entries.find((item: any) => item.id === entry.id);
    if (current)
      await mutate(request, 'content/batch', {
        action: 'trash',
        items: [{ id: current.id, revision: current.revision }],
      });
    const removed = (await (await request.get('/api/trash')).json()).find(
      (item: any) => item.id === entry.id,
    );
    if (removed)
      await mutate(request, 'trash/batch', {
        action: 'purge',
        items: [{ id: removed.id, revision: removed.revision }],
      });
  }
});
test('missing recovery images do not imply a current sample page and become warnings only when reused', async ({
  page,
  request,
}) => {
  const baseline = await (await request.get('/api/maintenance')).json();
  const entry = await mutate(request, 'content', {
    kind: 'posts',
    title: 'sample page ' + test.info().project.name,
    slug: 'missing-history-' + test.info().project.name,
  });
  const dawn = '/media/retained-dawn-' + test.info().project.name + '.svg';
  const dusk = '/media/retained-dusk-' + test.info().project.name + '.svg';
  const body = `![Dawn](${dawn})\n\n![Dusk](${dusk})`;
  try {
    const previous = await mutate(
      request,
      'content/' + entry.id,
      { metadata: entry, body, revision: entry.revision },
      'PUT',
    );
    const current = await mutate(
      request,
      'content/' + entry.id,
      {
        metadata: { ...previous, title: 'Renamed current article' },
        body: 'No current image references.',
        revision: previous.revision,
      },
      'PUT',
    );
    const summary = await (await request.get('/api/maintenance')).json();
    expect(summary.missing).toBe(baseline.missing);
    expect(summary.missingRecovery).toBe((baseline.missingRecovery || 0) + 2);
    const graph = await (await request.get('/api/media/usage')).json();
    expect(graph.items.find((item: { url: string }) => item.url === dawn).references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: entry.title,
          scope: 'history',
        }),
      ]),
    );
    await page.goto('/studio/#media');
    const warning = page.getByRole('region', { name: 'Missing media references', exact: true });
    if (!baseline.missing) await expect(warning).toBeHidden();
    await expect(page.locator('.media-missing-history')).toHaveCount(0);
    await expect(page.locator('.media-page').getByText(dawn, { exact: true })).toHaveCount(0);
    await expect(page.locator('.media-page').getByText(dusk, { exact: true })).toHaveCount(0);
    await expect(page.locator('.media-page')).not.toContainText(entry.title);
    await page.setViewportSize({ width: 320, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath('missing-recovery-media.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await mutate(
      request,
      'content/' + current.id,
      { metadata: current, body, revision: current.revision },
      'PUT',
    );
    await page.reload();
    await expect(warning.getByText(dawn, { exact: true })).toBeVisible();
    await expect(warning.getByText(dusk, { exact: true })).toBeVisible();
    const changed = await (await request.get('/api/maintenance')).json();
    expect(changed.missing).toBe(baseline.missing + 2);
    expect(changed.missingRecovery).toBe(baseline.missingRecovery || 0);
  } finally {
    await page.close();
    const current = (await state(request)).entries.find(
      (item: { id: string }) => item.id === entry.id,
    );
    if (current)
      await mutate(request, 'content/batch', {
        action: 'trash',
        items: [{ id: current.id, revision: current.revision }],
      });
    const trashed = (await (await request.get('/api/trash')).json()).find(
      (item: { id: string }) => item.id === entry.id,
    );
    if (trashed)
      await mutate(request, 'trash/batch', {
        action: 'purge',
        items: [{ id: trashed.id, revision: trashed.revision }],
      });
  }
});
