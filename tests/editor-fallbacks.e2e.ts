import { test, expect, type APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';

const state = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const current = await state(request);
  const response = await request.fetch('/api/' + path, {
    method,
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test('failed source worker and CodeMirror imports preserve local analysis, saved source and downloads', async ({
  page,
  request,
}) => {
  await page.route('**/source-analysis.worker-*.js', (route) => route.abort());
  await page.route('**/codemirror-diff-*.js', (route) => route.abort());
  const title = `Fallback source ${test.info().project.name}`;
  const created = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title,
    slug: `fallback-source-${test.info().project.name}`,
  });
  const saved = await mutate(request, `content/${created.id}`, 'PUT', {
    metadata: created,
    body: '# A local heading\n\nA complete saved source.',
    revision: created.revision,
  });
  try {
    await page.goto('/studio/#writing');
    await page.locator('.managed-entry-open').filter({ hasText: title }).click();
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Markdown headings' })).toContainText(
      'A local heading',
    );
    await page.getByRole('button', { name: 'Revision history', exact: true }).click();
    const history = page.getByRole('region', { name: 'Revision history', exact: true });
    await expect(history.locator('.diff-load-error')).toBeVisible();
    await expect(
      history.getByRole('textbox', { name: 'Current Markdown source', exact: true }),
    ).toHaveValue(saved.body);
    const download = page.waitForEvent('download');
    await history.getByRole('button', { name: 'Download current', exact: true }).click();
    expect(await fs.readFile((await (await download).path())!, 'utf8')).toBe(saved.body);
    expect((await state(request)).entries.find((e: any) => e.id === saved.id).body).toBe(
      saved.body,
    );
  } finally {
    const current = (await state(request)).entries.find((e: any) => e.id === saved.id);
    if (current)
      await mutate(request, `content/${saved.id}`, 'DELETE', { revision: current.revision });
  }
});
test('failed mindmap enhancement retains a fitting themed SVG and the full readable outline', async ({
  page,
}) => {
  await page.route('**/mindmap-*.js', (route) => route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4174/blog/authoring-showcase/');
  const map = page.locator('.md-mindmap'),
    stage = map.locator('[data-map-document]'),
    canvas = map.locator('.mindmap-canvas');
  await canvas.focus();
  await expect(stage).not.toHaveAttribute('data-map-ready', 'true');
  await expect(map.getByRole('button', { name: 'Tree', exact: true })).toBeDisabled();
  const boundary = (await canvas.boundingBox())!,
    drawing = (await map.locator('[data-diagram-variant="light"] .mindmap-drawing').boundingBox())!;
  expect(drawing.width).toBeLessThanOrEqual(boundary.width);
  expect(drawing.height).toBeLessThanOrEqual(boundary.height);
  await map.getByText('Read text outline', { exact: true }).click();
  await expect(map.locator('.mindmap-outline')).toContainText('Share the evidence');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true,
  );
});
