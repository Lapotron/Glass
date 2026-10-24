import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
const publicOrigin = 'http://127.0.0.1:4174';
const model = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const state = await model(request);
  const response = await request.fetch('/api/' + path, {
    method,
    headers: { 'X-Studio-Token': state.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function shot(page: Page, name: string) {
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-${name}.png`,
    animations: 'disabled',
  });
}
async function draft(page: Page, request: APIRequestContext, body: string) {
  const title = `Components ${test.info().project.name} ${test.info().line}`;
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title,
    slug: `components-${test.info().project.name}-${test.info().line}`,
  });
  const saved = await mutate(request, `content/${entry.id}`, 'PUT', {
    metadata: entry,
    body,
    revision: entry.revision,
  });
  await page.goto('/studio/#writing');
  await page.locator('.managed-entry-open').filter({ hasText: title }).click();
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  return saved;
}
async function remove(request: APIRequestContext, id: string) {
  const entry = (await model(request)).entries.find((entry: any) => entry.id === id);
  if (entry) await mutate(request, `content/${id}`, 'DELETE', { revision: entry.revision });
}
const savedBody = async (request: APIRequestContext, id: string) =>
  (await model(request)).entries.find((entry: any) => entry.id === id).body as string;

test('outline navigation and browser-local focus preserve reading position and remain available on phones', async ({
  page,
}) => {
  await page.goto(publicOrigin + '/blog/good-tools-get-out-of-the-way/');
  const outline = page.locator('.post-outline'),
    toggle = outline.locator('[data-article-focus-toggle]');
  await expect(toggle).toBeEnabled();
  const link = outline.locator('[data-outline-link]').nth(1);
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'location');
  const href = await link.getAttribute('href');
  await expect(page.locator(href!)).toBeFocused();
  await page.waitForTimeout(500);
  const before = await page
    .locator(href!)
    .evaluate((element) => element.getBoundingClientRect().top);
  await toggle.click();
  await expect(page.locator('.site-header')).not.toBeVisible();
  await expect(outline.locator('details')).toHaveAttribute('open');
  await expect
    .poll(async () =>
      Math.abs(
        (await page.locator(href!).evaluate((element) => element.getBoundingClientRect().top)) -
          before,
      ),
    )
    .toBeLessThan(2);
  await expect(page.getByRole('button', { name: 'Exit focus', exact: true })).toBeVisible();
  expect((await page.locator('.article-shell').boundingBox())!.width).toBeGreaterThan(1300);
  await shot(page, 'article-focus-desktop');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.goto(publicOrigin + '/blog/component-showcase/');
  await expect(page.locator('[data-article-focus-exit]')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator('.outline-card')).not.toHaveAttribute('open');
  await page.locator('.outline-card > summary').click();
  await expect(page.getByRole('group', { name: 'Article navigation' })).toBeVisible();
  await shot(page, 'article-focus-phone');
  await page.getByRole('button', { name: 'Exit focus', exact: true }).click();
  await expect(page.locator('.site-header')).toBeVisible();
  await page.goto(publicOrigin + '/settings/');
  await page.getByRole('switch', { name: 'Article focus mode' }).check();
  await expect(page.locator('.site-header')).toBeVisible();
  await page.getByRole('switch', { name: 'Article focus mode' }).uncheck();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.locator('.site-main').boundingBox())!.width).toBeLessThanOrEqual(1280);
  const width = page.getByRole('slider', { name: 'Page width', exact: true });
  await expect(width).toHaveAttribute('max', '1600');
  await width.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = input.max;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('[data-reader-output=contentWidth]')).toHaveText('1600px');
  await page.reload();
  await expect(width).toHaveValue('1600');
  expect((await page.locator('.site-main').boundingBox())!.width).toBeGreaterThan(1300);
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect((await page.locator('.site-main').boundingBox())!.width).toBe(1600);
  await shot(page, 'reader-settings-width-control');
});

test('outline exposes every section without search and top/end controls target article boundaries', async ({
  page,
}) => {
  await page.goto(publicOrigin + '/blog/authoring-showcase/');
  const outline = page.locator('.post-outline');
  await expect(outline.getByRole('searchbox')).toHaveCount(0);
  expect(await outline.locator('[data-outline-link]').count()).toBeGreaterThan(8);
  await expect(outline.getByRole('link', { name: 'Sankey', exact: true })).toBeVisible();
  await expect(outline.getByRole('link', { name: 'Explore the data', exact: true })).toBeVisible();
  await outline.getByRole('link', { name: 'End of article', exact: true }).click();
  await expect(page.locator('#article-end')).toBeFocused();
  await expect(page.locator('[data-outline-progress]')).toHaveText('100%');
  await outline.getByRole('link', { name: 'Back to top', exact: true }).click();
  await expect(page.locator('#main')).toBeFocused();
});

test('paper styles print closed components and static graphics independently of screen theme and focus', async ({
  page,
  browserName,
}) => {
  await page.goto(publicOrigin + '/blog/component-showcase/');
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.articleFocus = 'true';
  });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.site-header')).not.toBeVisible();
  await expect(page.locator('.post-outline')).not.toBeVisible();
  await expect(page.locator('.article-footer-group')).not.toBeVisible();
  await expect(page.locator('.article-print-source')).toBeVisible();
  await expect(page.locator('#article-end')).not.toBeVisible();
  await expect(page.locator('.material-playground .material-grid')).not.toBeVisible();
  expect(
    await page
      .locator('.material-demo-lens')
      .evaluate((element) => getComputedStyle(element).position),
  ).toBe('static');
  expect(
    await page.locator('html').evaluate((element) => getComputedStyle(element, '::before').display),
  ).toBe('none');
  await expect(page.locator('.md-details').first().locator('p').first()).toBeVisible();
  await expect(page.locator('.widget-tab-panel').last()).toBeVisible();
  await expect(page.locator('[role=math] svg').first()).toBeVisible();
  await expect(page.locator('[data-chart-variant=light]').first()).toBeVisible();
  await expect(page.locator('[data-chart-variant=dark]').first()).not.toBeVisible();
  const pair = page.locator('.comparison').first();
  const a = (await pair.locator('.comparison-before img').boundingBox())!,
    b = (await pair.locator(':scope > img').boundingBox())!;
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
  expect(
    await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe('rgb(255, 255, 255)');
  await shot(page, 'article-paper');
  if (browserName === 'chromium') {
    await fs.mkdir('test-results/print', { recursive: true });
    for (const format of ['A4', 'Letter'] as const) {
      const pdf = await page.pdf({
        path: `test-results/print/component-showcase-${format}.pdf`,
        format,
        printBackground: false,
        tagged: true,
      });
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    }
  }
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.article-print-source')).not.toBeVisible();
});

test('table preview header tools open an undoable Markdown grid and keep Settings free of operations', async ({
  page,
  request,
}) => {
  const body =
    '## Editable table\n\n| Name | Value |\n| :--- | ---: |\n| A \\| B | $x^2$ |\n\nA closing paragraph.\n';
  const entry = await draft(page, request, body);
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  try {
    const preview = page.locator('[data-component-kind=table]');
    await expect(preview.getByRole('cell', { name: 'A | B', exact: true })).toBeVisible();
    await expect(preview.locator('[role=math] svg')).toBeVisible();
    await shot(page, 'source-table-preview');
    await preview.getByRole('button', { name: 'Edit table', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Edit table', exact: true });
    await dialog.getByRole('textbox', { name: 'Row 1 column 1', exact: true }).fill('**Changed**');
    await dialog.getByRole('button', { name: 'Add row', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Row 2 column 1', exact: true }).fill('Added');
    await dialog.getByRole('textbox', { name: 'Row 2 column 2', exact: true }).fill('2');
    await shot(page, 'source-table-dialog');
    await dialog.getByRole('button', { name: 'Apply table', exact: true }).click();
    await expect.poll(() => savedBody(request, entry.id)).toContain('**Changed**');
    await expect.poll(() => savedBody(request, entry.id)).toContain('Added');
    await source.press('ControlOrMeta+z');
    await expect.poll(() => savedBody(request, entry.id)).toBe(body);
    await preview.getByRole('button', { name: 'Edit table', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Edit table', exact: true });
    await dialog.getByRole('textbox', { name: 'Row 1 column 1', exact: true }).fill('Discard');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(() => savedBody(request, entry.id)).toBe(body);
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Table operations', exact: true })).toHaveCount(
      0,
    );
    await page.getByRole('switch', { name: 'Table previews', exact: true }).uncheck();
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await expect(preview).toHaveCount(0);
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('switch', { name: 'Table previews', exact: true }).check();
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 844 });
    await preview.getByRole('button', { name: 'Edit table', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Edit table', exact: true });
    await shot(page, 'source-table-phone');
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(
      true,
    );
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    await remove(request, entry.id);
  }
});

test('visual source previews render and edit actual Mermaid, mindmap, chart and comparison blocks', async ({
  page,
  request,
}) => {
  const body =
    '```mermaid\nflowchart LR\nA[Question] --> B[Experiment]\n```\n\n:::mindmap[Thinking]\n- Root\n  - Evidence\n  - Questions\n:::\n\n```interactive\n{"type":"chart","title":"Numbers","style":"line","labels":["A","B"],"series":[{"name":"Values","values":[1,2]}]}\n```\n\n```interactive\n{"type":"image-compare","title":"Pair","before":"/media/workspace.svg","after":"/media/coast-dawn.svg","beforeLabel":"Desk","afterLabel":"Coast"}\n```\n';
  const entry = await draft(page, request, body),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (const kind of ['mermaid', 'mindmap', 'chart', 'image-compare']) {
      const preview = page.locator(`[data-component-kind="${kind}"]`);
      await preview.scrollIntoViewIfNeeded();
      if (kind === 'image-compare') await expect(preview.locator('.comparison')).toBeVisible();
      else
        await expect(preview.locator('.source-component-body svg:visible').first()).toBeVisible();
      expect(await preview.innerText()).not.toContain('Preview unavailable');
      await shot(page, `source-preview-${kind}`);
    }
    const mermaid = page.locator('[data-component-kind=mermaid]');
    await mermaid.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit mermaid diagram', exact: true });
    await dialog
      .getByRole('textbox', { name: 'Mermaid source', exact: true })
      .fill('flowchart LR\nA[Changed] --> B[Result]');
    await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await expect.poll(() => savedBody(request, entry.id)).toContain('A[Changed]');
    const mindmap = page.locator('[data-component-kind=mindmap]');
    await mindmap.getByRole('button', { name: 'Expand', exact: true }).click();
    const expanded = page.getByRole('dialog', { name: 'Explore mindmap', exact: true });
    await expect(expanded.locator('[data-map-ready=true]')).toBeVisible();
    await expanded.getByRole('button', { name: 'Close', exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    await remove(request, entry.id);
  }
});

test('link Files tab uploads and searches managed attachments, inserts a portable link and supports undo', async ({
  page,
  request,
}) => {
  const body = '## File links\n\nA local attachment.\n',
    entry = await draft(page, request, body);
  const filename = `Lecture-notes-${test.info().project.name}.pdf`;
  try {
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.press('ControlOrMeta+End');
    await page.getByRole('button', { name: 'Insert link', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Insert link', exact: true });
    await dialog.getByRole('button', { name: 'Files', exact: true }).click();
    await dialog.getByLabel('Upload local attachment').setInputFiles({
      name: filename,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nA PDF attachment.\n%%EOF'),
    });
    const destination = dialog.getByRole('textbox', { name: 'Destination', exact: true });
    await expect(destination).toHaveValue(
      new RegExp(`^/media/Lecture-notes-${test.info().project.name}-.*\\.pdf$`),
    );
    const url = await destination.inputValue();
    await dialog.getByRole('searchbox', { name: 'Search local files' }).fill('no file matches');
    await expect(dialog.locator('.file-link-picker')).toContainText('No matching files');
    await dialog.getByRole('searchbox', { name: 'Search local files' }).fill(filename.slice(0, -4));
    await dialog.getByRole('combobox', { name: 'File type' }).selectOption('PDF');
    await expect(dialog.locator('.file-link-picker .link-target-list > button')).toHaveCount(1);
    await shot(page, 'link-files-tab');
    await dialog.getByRole('button', { name: 'Insert link', exact: true }).click();
    await expect.poll(() => savedBody(request, entry.id)).toContain(`[${filename}](${url})`);
    const response = await request.get(url);
    expect(response.headers()['content-type']).toBe('application/pdf');
    expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-');
    await source.press('ControlOrMeta+z');
    await expect.poll(() => savedBody(request, entry.id)).toBe(body);
  } finally {
    await remove(request, entry.id);
  }
});
