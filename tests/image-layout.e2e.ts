import { test, expect, type APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';
const state = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, route: string, method: string, data: unknown) {
  const current = await state(request);
  const response = await request.fetch('/api/' + route, {
    method,
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test('image tools write responsive size metadata, preserve undo, and render unclipped at desktop and phone widths', async ({
  page,
  request,
}) => {
  const title = `Image sizing ${test.info().project.name}`;
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title,
    slug: `image-sizing-${test.info().project.name}`,
  });
  const body = '## A single image\n\n![A writing desk](/media/workspace.svg)\n';
  await mutate(request, `content/${entry.id}`, 'PUT', {
    metadata: entry,
    body,
    revision: entry.revision,
  });
  const saved = async () => (await state(request)).entries.find((e: any) => e.id === entry.id);
  try {
    await page.goto('/studio/#writing');
    await page.locator('.managed-entry-open').filter({ hasText: title }).click();
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    await page.getByRole('button', { name: 'Image tools: A writing desk', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Image tools', exact: true });
    await dialog.getByLabel('Display width', { exact: true }).fill('invalid');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).toContainText('Image width must be');
    await dialog.getByLabel('Display width', { exact: true }).fill('480');
    await dialog.getByRole('spinbutton', { name: 'Maximum height', exact: true }).fill('220');
    await dialog
      .getByRole('combobox', { name: 'Image alignment', exact: true })
      .selectOption('right');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect
      .poll(async () => (await saved()).body)
      .toContain('width="480" max-height="220" align="right"');
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.press('ControlOrMeta+z');
    await expect.poll(async () => (await saved()).body).toBe(body);
    await source.press('ControlOrMeta+Shift+z');
    await expect.poll(async () => (await saved()).body).toContain('width="480"');
    await page.getByRole('button', { name: 'Image tools: A writing desk', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Image tools', exact: true });
    await expect(dialog.getByLabel('Display width', { exact: true })).toHaveValue('480');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const frame = page.frameLocator('.preview-pane iframe');
    const figure = frame.locator('.md-figure[data-image-width="480"]'),
      image = figure.locator('img');
    await expect(image).toBeVisible();
    expect((await figure.boundingBox())!.width).toBeLessThanOrEqual(481);
    expect((await image.boundingBox())!.height).toBeLessThanOrEqual(221);
    await fs.mkdir('test-results/visuals', { recursive: true });
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-sized-image.png`,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(image).toBeVisible();
    expect((await figure.boundingBox())!.width).toBeLessThanOrEqual(
      (await frame.locator('.article-body').boundingBox())!.width,
    );
    expect(await frame.locator('html').evaluate((node) => node.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
  } finally {
    const latest = await saved();
    if (latest)
      await mutate(request, `content/${entry.id}`, 'DELETE', { revision: latest.revision });
  }
});
