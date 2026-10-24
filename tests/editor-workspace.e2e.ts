import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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
async function openEntry(page: Page, request: APIRequestContext, body: string) {
  const title = `Editor workspace ${test.info().project.name} ${test.info().line}`;
  const draft = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title,
    slug: `editor-workspace-${test.info().project.name}-${test.info().line}`,
  });
  const entry = await mutate(request, `content/${draft.id}`, 'PUT', {
    metadata: draft,
    body,
    revision: draft.revision,
  });
  await page.goto('/studio/#writing');
  await page.locator('.managed-entry-open').filter({ hasText: title }).click();
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toBeVisible();
  return entry;
}
async function remove(request: APIRequestContext, id: string) {
  const entry = (await state(request)).entries.find((e: any) => e.id === id);
  if (entry) await mutate(request, 'content/' + id, 'DELETE', { revision: entry.revision });
}
async function shot(page: Page, name: string) {
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-${name}.png`,
    animations: 'disabled',
  });
}

test('title and summary use settings while source retains its height, selection and undo', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request, '# An idea\n\nThe source stays here.');
  try {
    await expect(page.getByRole('textbox', { name: 'Article title' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Article summary' })).toHaveCount(0);
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('# An idea\n\nA longer thought.');
    const before = (await page.locator('.code-editor').boundingBox())!;
    expect(before.height).toBeGreaterThan(350);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('region', { name: 'Entry settings', exact: true });
    await settings.getByLabel('Article title', { exact: true }).fill('A title in settings');
    await settings.getByLabel('Article summary', { exact: true }).fill('A concise introduction.');
    await settings.getByRole('button', { name: 'Back to editor', exact: true }).click();
    await expect(page.locator('.editor-breadcrumb')).toContainText('A title in settings');
    expect((await page.locator('.code-editor').boundingBox())!.height).toBe(before.height);
    await expect
      .poll(async () => (await state(request)).entries.find((e: any) => e.id === entry.id)?.summary)
      .toBe('A concise introduction.');
    await source.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(source).toContainText('The source stays here.');
    await shot(page, 'source-workspace');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(settings.getByLabel('Article title', { exact: true })).toHaveValue(
      'A title in settings',
    );
    await settings.getByRole('button', { name: 'Back to editor', exact: true }).click();
    const audit = await new AxeBuilder({ page })
      .include('.editor-workspace')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      audit.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')),
    ).toEqual([]);
  } finally {
    await remove(request, entry.id);
  }
});

test('editor modes retain source position and settings drafts with one combined footer', async ({
  page,
  request,
}) => {
  const body = Array.from({ length: 180 }, (_, n) =>
    n % 30 === 0 ? `## Chapter ${n}` : `Line ${n}: a thought to develop.`,
  ).join('\n');
  const entry = await openEntry(page, request, body);
  try {
    const modes = page.getByRole('group', { name: 'Editor view', exact: true }),
      source = page.getByRole('textbox', { name: 'Markdown source', exact: true }),
      scroller = page.locator('.code-editor .cm-scroller'),
      footer = page.locator('.source-edit-panel > .editor-foot');
    await expect(modes.getByRole('button')).toHaveText(['Write', 'Split', 'Preview', 'Settings']);
    await expect(footer).toHaveCount(1);
    await expect(page.locator('.editor-workspace .editor-foot')).toHaveCount(1);
    await expect(footer).toContainText('words');
    await expect(footer).toContainText('min');
    await expect(footer).toContainText('Saved as Markdown');
    await footer.getByRole('button', { name: /Ln/ }).click();
    const goTo = page.getByRole('textbox', { name: 'Go to line:', exact: true });
    await goTo.fill('60:2');
    await goTo.press('Enter');
    await expect(footer.locator('.source-position')).toContainText('Ln 60, Col 3');
    await page.keyboard.insertText('A retained edit');
    await page.keyboard.press('Shift+Home');
    await expect(footer.locator('.source-position')).toContainText('selected');
    const position = await footer.locator('.source-position').innerText(),
      original = await page.locator('.cm-editor').elementHandle();
    await scroller.evaluate((node) => {
      node.scrollTop = 900;
    });
    const scrollTop = await scroller.evaluate((node) => node.scrollTop);
    await modes.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('region', { name: 'Entry settings', exact: true });
    await expect(source).toBeHidden();
    await settings.getByRole('tab', { name: 'Sharing', exact: true }).click();
    await settings.getByLabel('Sharing title', { exact: true }).fill('A retained sharing title');
    await shot(page, 'editor-settings-mode');
    const audit = await new AxeBuilder({ page }).include('.editor-workspace').analyze();
    expect(audit.violations).toEqual([]);
    const modeSettings = modes.getByRole('button', { name: 'Settings', exact: true });
    await modeSettings.focus();
    await modeSettings.press('ArrowLeft');
    await expect(modes.getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('ArrowRight');
    await expect(settings.getByRole('tab', { name: 'Sharing', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(settings.getByLabel('Sharing title', { exact: true })).toHaveValue(
      'A retained sharing title',
    );
    await page.keyboard.press('Home');
    await expect(modes.getByRole('button', { name: 'Write', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(footer.locator('.source-position')).toHaveText(position);
    expect(
      await page.locator('.cm-editor').evaluate((node, previous) => node === previous, original),
    ).toBe(true);
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(scrollTop, 0);
    await source.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(source).not.toContainText('A retained edit');
  } finally {
    await remove(request, entry.id);
  }
});

test('Split divider resizes both panes with pointer and keyboard without replacing source', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request, '# A resizable workspace\n\nA thought to develop.');
  try {
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    const divider = page.getByRole('separator', { name: 'Resize editor and preview' }),
      source = page.getByRole('textbox', { name: 'Markdown source', exact: true }),
      original = await page.locator('.cm-editor').elementHandle(),
      panes = page.locator('.editor-panes');
    await expect(divider).toHaveAttribute('aria-valuenow', '50');
    await expect(page.locator('.editor-workspace .editor-foot')).toHaveCount(1);
    await source.press('ControlOrMeta+End');
    await page.keyboard.insertText(' A retained edit.');
    const rect = (await panes.boundingBox())!,
      grip = (await divider.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.68, grip.y + grip.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => Number(await divider.getAttribute('aria-valuenow')))
      .toBeGreaterThan(65);
    expect((await page.locator('.source-pane').boundingBox())!.width).toBeGreaterThan(
      rect.width * 0.65,
    );
    expect((await page.locator('.preview-pane').boundingBox())!.width).toBeGreaterThanOrEqual(299);
    await expect(panes).not.toHaveAttribute('data-resizing', 'true');
    await divider.press('Home');
    expect((await page.locator('.source-pane').boundingBox())!.width).toBeCloseTo(300, 0);
    await shot(page, 'editor-split-source-minimum');
    await divider.press('End');
    expect((await page.locator('.preview-pane').boundingBox())!.width).toBeCloseTo(300, 0);
    await divider.press('Enter');
    await expect(divider).toHaveAttribute('aria-valuenow', '50');
    await divider.press('Shift+ArrowRight');
    await expect(divider).toHaveAttribute('aria-valuenow', '60');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
    await expect(divider).toHaveAttribute('aria-valuenow', '60');
    await divider.dblclick();
    await expect(divider).toHaveAttribute('aria-valuenow', '50');
    await divider.press('Shift+ArrowRight');
    await page.setViewportSize({ width: 1180, height: 1000 });
    expect((await page.locator('.source-pane').boundingBox())!.width).toBeGreaterThanOrEqual(299);
    expect((await page.locator('.preview-pane').boundingBox())!.width).toBeGreaterThanOrEqual(299);
    const audit = await new AxeBuilder({ page }).include('.editor-workspace').analyze();
    expect(audit.violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(divider).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Write', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(divider).toHaveAttribute('aria-valuenow', '60');
    expect(
      await page.locator('.cm-editor').evaluate((node, previous) => node === previous, original),
    ).toBe(true);
    await source.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(source).not.toContainText('A retained edit.');
    await shot(page, 'editor-split-resizable');
  } finally {
    await remove(request, entry.id);
  }
});

test('media picker searches filenames, clears empty results and inserts the chosen image', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request, '# A media search\n\nA thought to illustrate.');
  try {
    const insert = page.getByRole('button', { name: 'Insert image', exact: true });
    await insert.focus();
    await insert.press('Enter');
    const picker = page.getByRole('dialog', { name: 'Choose from your media', exact: true }),
      search = picker.getByRole('searchbox', { name: 'Search media', exact: true }),
      images = picker.locator('.media-picker-grid > button');
    await expect(search).toBeFocused();
    await expect(picker.getByRole('status')).not.toContainText('Loading');
    const total = await images.count();
    expect(total).toBeGreaterThan(2);
    await search.fill(' COAST  DAWN ');
    await expect(images).toHaveCount(1);
    await expect(picker.getByRole('button', { name: 'coast-dawn.svg', exact: true })).toBeVisible();
    await expect(picker.getByRole('status')).toHaveText(`1 of ${total} images`);
    const height = await picker.evaluate((node) => node.clientHeight);
    await search.fill('no-such-image-in-this-notebook');
    await expect(images).toHaveCount(0);
    await expect(picker).toContainText('No images match');
    expect(await picker.evaluate((node) => node.clientHeight)).toBe(height);
    await picker.getByRole('button', { name: 'Clear media search', exact: true }).click();
    await expect(search).toBeFocused();
    await expect(images).toHaveCount(total);
    await search.fill('coast');
    await shot(page, 'editor-media-search');
    const audit = await new AxeBuilder({ page }).include('.media-picker-dialog').analyze();
    expect(audit.violations).toEqual([]);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await expect(
      picker.getByRole('button', { name: 'Clear media search', exact: true }),
    ).toBeVisible();
    await shot(page, 'editor-media-search-mobile');
    await search.fill('coast dawn');
    await picker.getByRole('button', { name: 'coast-dawn.svg', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toContainText(
      '/media/coast-dawn.svg',
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Cover', exact: true }).click();
    await page.getByRole('button', { name: 'Choose cover', exact: true }).click();
    await expect(search).toHaveValue('');
    await search.fill('coast dusk');
    await picker.getByRole('button', { name: 'coast-dusk.svg', exact: true }).click();
    await expect(page.getByLabel('Cover image', { exact: true })).toHaveValue(
      '/media/coast-dusk.svg',
    );
    await expect
      .poll(async () => (await state(request)).entries.find((e: any) => e.id === entry.id)?.cover)
      .toBe('/media/coast-dusk.svg');
  } finally {
    await remove(request, entry.id);
  }
});

test('minimap viewport follows ordinary scrolling, edits, wraps and dragging without moving the caret', async ({
  page,
  request,
}) => {
  const body = Array.from({ length: 300 }, (_, n) =>
    n % 30 === 0 ? `## Chapter ${n}` : `Line ${n}: a thought to develop.`,
  ).join('\n');
  const entry = await openEntry(page, request, body);
  try {
    const minimap = page.getByRole('slider', { name: 'Document minimap', exact: true }),
      scroller = page.locator('.code-editor .cm-scroller');
    await expect(minimap).toBeVisible();
    await scroller.evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect(minimap).toHaveAttribute('aria-valuenow', '1');
    const initialTop = await minimap
      .locator('.source-minimap-window')
      .evaluate((node) => parseFloat(node.style.top));
    // A short scroll often stays inside CodeMirror's buffered viewport. It must still move the window.
    await scroller.evaluate((node) => {
      node.scrollTop += 45;
    });
    await expect
      .poll(() =>
        minimap.locator('.source-minimap-window').evaluate((node) => parseFloat(node.style.top)),
      )
      .toBeGreaterThan(initialTop);
    await scroller.evaluate((node) => {
      node.scrollTop = node.scrollHeight * 0.55;
    });
    await expect
      .poll(async () => Number(await minimap.getAttribute('aria-valuenow')))
      .toBeGreaterThan(120);
    const position = await page.locator('.editor-foot .source-position').innerText();
    const box = (await minimap.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () => Number(await minimap.getAttribute('aria-valuenow')))
      .toBeGreaterThan(190);
    expect(await page.locator('.editor-foot .source-position').innerText()).toBe(position);
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.focus();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('A new final line');
    await expect
      .poll(async () => Number(await minimap.getAttribute('aria-valuemax')))
      .toBeGreaterThan(300);
    await expect
      .poll(async () => Number(await minimap.getAttribute('aria-valuenow')))
      .toBeGreaterThan(260);
    await minimap.focus();
    await page.keyboard.press('Home');
    await expect(minimap).toHaveAttribute('aria-valuenow', '1');
    await shot(page, 'source-minimap-follow');
  } finally {
    await remove(request, entry.id);
  }
});

test('long document scrolling and cursor movement reuse the minimap drawing', async ({
  page,
  request,
}) => {
  const body = Array.from({ length: 5000 }, (_, n) =>
    n % 100 === 0 ? `## Chapter ${n}` : `Line ${n}: a clear thought to develop.`,
  ).join('\n');
  const entry = await openEntry(page, request, body);
  try {
    await expect(page.locator('.source-heading')).toHaveCount(50);
    const minimap = page.getByRole('slider', { name: 'Document minimap', exact: true });
    await expect(minimap).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const canvas = minimap.locator('canvas');
    const before = Number(await canvas.getAttribute('data-paints'));
    expect(before).toBeGreaterThan(0);
    await page.locator('.code-editor .cm-scroller').evaluate((node) => {
      node.scrollTop = node.scrollHeight * 0.4;
    });
    await expect
      .poll(async () => Number(await minimap.getAttribute('aria-valuenow')))
      .toBeGreaterThan(1000);
    expect(Number(await canvas.getAttribute('data-paints'))).toBe(before);
    await page.getByRole('textbox', { name: 'Markdown source', exact: true }).focus();
    await page.keyboard.press('ControlOrMeta+End');
    await expect
      .poll(async () => Number(await minimap.getAttribute('aria-valuenow')))
      .toBeGreaterThan(4500);
    expect(Number(await canvas.getAttribute('data-paints'))).toBe(before);
    await page.getByRole('button', { name: 'Find in Markdown', exact: true }).click();
    await page.getByRole('textbox', { name: 'Find in Markdown', exact: true }).fill('thought');
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-paints')))
      .toBeGreaterThan(before);
  } finally {
    await remove(request, entry.id);
  }
});

test('find replace, outline and commands work with undo and persist only scoped preferences', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request, '# First\n\nfoo foo\n\nSecond\n------\n\nbar');
  try {
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.focus();
    await page.keyboard.press('ControlOrMeta+f');
    const find = page.getByRole('textbox', { name: 'Find in Markdown', exact: true });
    await expect(find).toBeFocused();
    await find.fill('foo');
    await expect(page.locator('.source-search-count')).toContainText('of 2');
    await page.getByRole('textbox', { name: 'Replace with', exact: true }).fill('word');
    await page.getByRole('button', { name: 'Replace all', exact: true }).click();
    await expect(source).toContainText('word word');
    await find.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(source).toContainText('foo foo');
    await page.getByRole('button', { name: 'Find in Markdown', exact: true }).click();
    await find.fill('[');
    await page.getByRole('checkbox', { name: 'Regex', exact: true }).check();
    await expect(page.locator('.source-search-count')).toHaveText('Invalid regular expression');
    await expect(page.getByRole('button', { name: 'Replace all', exact: true })).toBeDisabled();
    await find.press('Escape');
    await expect(
      page.getByRole('navigation', { name: 'Markdown headings' }).getByRole('button'),
    ).toHaveCount(2);
    await page
      .getByRole('navigation', { name: 'Markdown headings' })
      .getByRole('button', { name: /Second/ })
      .click();
    await expect(page.locator('.editor-foot')).toContainText('Ln 5');
    await source.focus();
    await page.keyboard.press('ControlOrMeta+Shift+p');
    const commands = page.getByRole('dialog', { name: 'Editor commands', exact: true });
    await commands.getByRole('combobox', { name: 'Search editor commands' }).fill('task list');
    await page.keyboard.press('Enter');
    await expect(source).toContainText('- [ ] Second');
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    const preferences = page.getByRole('tabpanel', { name: 'Settings', exact: true });
    await preferences.getByRole('switch', { name: 'Document minimap', exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('slider', { name: 'Document minimap' })).toHaveCount(0);
    const stored = await page.evaluate(() =>
      Object.entries(localStorage).filter(([key]) => key.startsWith('fieldnotes-editor:')),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0][1]).not.toContain('foo');
    await page.reload();
    await page.locator('.managed-entry-open').filter({ hasText: entry.title }).click();
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Toggle minimap' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Reset preferences', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(source).toBeVisible();
    await page.setViewportSize({ width: 320, height: 740 });
    await page.getByRole('button', { name: 'Toggle document outline' }).click();
    await expect(page.getByRole('complementary', { name: 'Editor navigator' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    await shot(page, 'source-workspace-mobile');
  } finally {
    await remove(request, entry.id);
  }
});

test('mindmaps support selection, branch collapse, searching, layouts, modal focus and exports', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4174/blog/authoring-showcase/');
  const outer = page.locator('.md-mindmap').first(),
    stage = outer.locator('[data-map-document]');
  const canvas = stage.locator('.mindmap-canvas');
  await canvas.focus();
  await expect(stage).toHaveAttribute('data-map-ready', 'true');
  const variant = stage.locator('[data-diagram-variant="light"]');
  const initial = await variant.locator('[data-map-node]').count();
  await variant.locator('[data-map-toggle]').first().click();
  await expect(variant.locator('[data-map-node]')).toHaveCount(1);
  await canvas.press('ArrowRight');
  await expect(variant.locator('[data-map-node]')).toHaveCount(initial);
  await stage.getByRole('button', { name: 'Tree', exact: true }).click();
  await expect(stage.getByRole('button', { name: 'Tree', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const label = await variant.locator('[data-map-node]').last().getAttribute('aria-label');
  await stage.getByRole('searchbox', { name: 'Find mindmap nodes' }).fill(label!);
  await expect(stage.locator('[data-map-matches]')).not.toContainText('No matches');
  await expect(variant.locator('.is-selected')).toHaveAttribute('aria-label', label!);
  await stage.getByRole('button', { name: 'Expand mindmap', exact: true }).click();
  const dialog = page.locator('dialog.mindmap-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-map-document]')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close expanded mindmap' }).click();
  await expect(stage.getByRole('button', { name: 'Expand mindmap', exact: true })).toBeFocused();
  await stage.getByText('More', { exact: true }).click();
  for (const format of ['SVG', 'PNG']) {
    const download = page.waitForEvent('download');
    await stage.getByRole('button', { name: `Download ${format}`, exact: true }).click();
    const result = await download,
      bytes = await fs.readFile((await result.path())!);
    expect(bytes.length).toBeGreaterThan(100);
    if (format === 'SVG') expect(bytes.toString()).toContain('<svg');
    else expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  }
  const audit = await new AxeBuilder({ page })
    .include('.md-mindmap')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''))).toEqual(
    [],
  );
  await shot(page, 'mindmap-tree');
  await page.setViewportSize({ width: 390, height: 844 });
  await outer.scrollIntoViewIfNeeded();
  if (test.info().project.name === 'chromium') {
    await stage.getByRole('button', { name: '100%', exact: true }).click();
    await stage.getByRole('button', { name: 'Explore map', exact: true }).click();
    await canvas.scrollIntoViewIfNeeded();
    const bounds = (await canvas.boundingBox())!,
      x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const before = await stage.locator('.mindmap-transform').getAttribute('style');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - 45, y }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(stage.locator('.mindmap-transform')).not.toHaveAttribute('style', before!);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 40, y, id: 1 },
        { x: x + 40, y, id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 65, y, id: 1 },
        { x: x + 65, y, id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(async () => parseFloat((await stage.locator('[data-map-zoom]').textContent())!))
      .toBeGreaterThan(110);
    await cdp.detach();
    await stage.getByRole('button', { name: 'Explore map', exact: true }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true,
  );
  await shot(page, 'mindmap-mobile');
  expect(errors).toEqual([]);
});

test('diff accessible mode and minimap controls navigate changes and Escape stays within history', async ({
  page,
  request,
}) => {
  const before =
    '# Earlier\n\nFirst change.\n\n' +
    Array.from({ length: 35 }, (_, i) => `Unchanged ${i}.`).join('\n') +
    '\n\nLast change.\n';
  const entry = await openEntry(page, request, before);
  try {
    const current = await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: entry,
      body: before
        .replace('First change.', 'First revision.')
        .replace('Last change.', 'Last revision.'),
      revision: entry.revision,
    });
    await page.reload();
    await page.locator('.managed-entry-open').filter({ hasText: entry.title }).click();
    await page.getByRole('button', { name: 'Revision history', exact: true }).click();
    const history = page.getByRole('region', { name: 'Revision history', exact: true }),
      comparison = history.getByRole('region', { name: 'Markdown differences' });
    await expect(comparison).toHaveAttribute('data-ready', 'true');
    await expect(history.locator('.diff-status')).toContainText('2 changed regions');
    await expect(comparison.locator('.diff-minimap canvas').first()).toBeVisible();
    expect(await comparison.locator('.cm-changedLine').count()).toBeGreaterThan(0);
    await history.getByRole('button', { name: 'Accessible view', exact: true }).click();
    await expect(comparison).toHaveAttribute('data-layout', 'accessible');
    await expect(
      history.getByRole('button', { name: 'Accessible view', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(comparison.locator('.diff-accessible-blocks')).toBeVisible();
    await history.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(history.locator('.diff-position')).toContainText('2 / 2');
    await history.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(history.locator('.diff-position')).toContainText('1 / 2');
    await history.getByText('Changes by line · 2', { exact: true }).click();
    await history.locator('.diff-change-list button').last().click();
    await expect(comparison.locator('.diff-accessible-blocks')).toContainText('Last revision.');
    await history.getByText('Changes by line · 2', { exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(history).toBeVisible();
    await expect(comparison).toHaveAttribute('data-layout', 'split');
    await expect(
      history.getByRole('button', { name: 'Accessible view', exact: true }),
    ).toBeFocused();
    await history.getByText('View options', { exact: true }).click();
    await history.getByRole('checkbox', { name: 'Show diff minimap', exact: true }).uncheck();
    await expect(comparison.locator('.diff-minimap canvas').first()).not.toBeVisible();
    await history.getByRole('checkbox', { name: 'Show diff minimap', exact: true }).check();
    await expect(comparison.locator('.diff-minimap canvas').first()).toBeVisible();
    await history.getByText('View options', { exact: true }).click();
    await history.getByText('Changes by line · 2', { exact: true }).click();
    await history.locator('.diff-change-list button').last().click();
    await expect(history.locator('.diff-position')).toContainText('2 / 2');
    const download = page.waitForEvent('download');
    await history.getByRole('button', { name: 'Download patch', exact: true }).click();
    const bytes = await fs.readFile((await (await download).path())!);
    expect(bytes.toString()).toContain('-First change.');
    expect(bytes.toString()).toContain('+First revision.');
    await history.getByText('Complete Markdown sources', { exact: true }).click();
    await expect(
      history.getByRole('textbox', { name: 'Current Markdown source', exact: true }),
    ).toHaveValue(current.body);
    await shot(page, 'diff-minimap-controls');
  } finally {
    await remove(request, entry.id);
  }
});
