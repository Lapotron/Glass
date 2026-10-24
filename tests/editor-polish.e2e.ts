import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { promises as fs } from 'node:fs';
const state = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const model = await state(request),
    response = await request.fetch('/api/' + path, {
      method,
      headers: { 'X-Studio-Token': model.token, Origin: 'http://127.0.0.1:4387' },
      data,
    });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function openEntry(page: Page, request: APIRequestContext, body: string) {
  const title = `Polish ${test.info().project.name} ${test.info().line}`,
    draft = await mutate(request, 'content', 'POST', {
      kind: 'posts',
      title,
      slug: `polish-${test.info().project.name}-${test.info().line}`,
    });
  const entry = await mutate(request, `content/${draft.id}`, 'PUT', {
    metadata: draft,
    body,
    revision: draft.revision,
  });
  await page.goto('/studio/#writing');
  await page.locator('.managed-entry-open').filter({ hasText: title }).click();
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  return entry;
}
async function remove(request: APIRequestContext, id: string) {
  const entry = (await state(request)).entries.find((e: any) => e.id === id);
  if (entry) await mutate(request, 'content/' + id, 'DELETE', { revision: entry.revision });
}
const source = (page: Page) => page.getByRole('textbox', { name: 'Markdown source', exact: true });
async function saved(request: APIRequestContext, id: string) {
  return (await state(request)).entries.find((e: any) => e.id === id).body as string;
}
async function shot(page: Page, name: string) {
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-${name}.png`,
    animations: 'disabled',
  });
}

test('format preview is undoable and explicit-save formatting never changes ordinary autosave', async ({
  page,
  request,
}) => {
  const body = '## A quiet heading\n\n-   one\n-   two\n\nA hard break  \nnext.\n',
    entry = await openEntry(page, request, body),
    editor = source(page),
    format = page.getByRole('button', { name: 'Preview formatting', exact: true });
  try {
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await format.click();
    const preview = page.getByRole('dialog', { name: 'Preview formatting', exact: true });
    await expect(preview.locator('.markdown-diff-editor')).toHaveAttribute('data-ready', 'true');
    await preview.getByRole('button', { name: 'Apply formatting' }).click();
    await expect(editor).toContainText('- one');
    await editor.press('ControlOrMeta+z');
    await expect.poll(() => saved(request, entry.id)).toBe(body);
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('switch', { name: 'Format on explicit save' }).check();
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    const raw = '## More\n\n-   raw spacing\n';
    await editor.fill(raw);
    await expect.poll(() => saved(request, entry.id)).toBe(raw);
    await editor.press('ControlOrMeta+s');
    await expect.poll(() => saved(request, entry.id)).toBe('## More\n\n- raw spacing\n');
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('switch', { name: 'Format on explicit save' }).uncheck();
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await shot(page, 'editor-format-tools');
  } finally {
    await remove(request, entry.id);
  }
});

test('late formatter results preserve newer text and show a recoverable explanation', async ({
  page,
  request,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/source-format.worker-*.js', async (route) => {
    requested = true;
    await gate;
    await route.continue();
  });
  const entry = await openEntry(page, request, '-   earlier\n');
  try {
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Format document', exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await source(page).fill('A newer draft that must stay.');
    release();
    await expect(page.locator('.editor-tool-error')).toContainText('latest text was kept');
    await expect.poll(() => saved(request, entry.id)).toBe('A newer draft that must stay.\n');
  } finally {
    release();
    await remove(request, entry.id);
  }
});

test('image decorations retain source and gutters, share the viewer, and keep external images opt in', async ({
  page,
  request,
}) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://remote-image.invalid/**', (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  const body =
      '## Images\n\n![Alpine mountains](/media/alpine.svg)\n\nInline ![Quiet workspace](/media/workspace.svg) next.\n\n![Remote view](https://remote-image.invalid/photo.webp)\n\n```md\n![Not an image](/media/wave.svg)\n```\n' +
      Array.from({ length: 60 }, (_, i) => `Line ${i}.`).join('\n'),
    entry = await openEntry(page, request, body);
  try {
    await expect(page.locator('.source-image-widget')).toHaveCount(2);
    await expect(page.locator('.source-image-inline')).toHaveCount(1);
    await expect(source(page)).toContainText('![Alpine mountains](/media/alpine.svg)');
    expect(external).toEqual([]);
    await page.getByRole('button', { name: 'Image tools: Alpine mountains', exact: true }).click();
    const tools = page.getByRole('dialog', { name: 'Image tools', exact: true });
    await tools.getByRole('button', { name: 'View image', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: 'Image viewer', exact: true });
    await expect(viewer.getByRole('toolbar', { name: 'Image controls', exact: true })).toHaveCount(
      1,
    );
    await page.keyboard.press('Escape');
    await expect(viewer).not.toBeVisible();
    await expect(tools).toBeVisible();
    await tools
      .getByRole('textbox', { name: 'Image description', exact: true })
      .fill('Mountains at dawn');
    await tools.getByRole('button', { name: /Save (?:description|changes)/ }).click();
    await expect
      .poll(() => saved(request, entry.id))
      .toContain('![Mountains at dawn](/media/alpine.svg)');
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Image previews', exact: true }).selectOption('hover');
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await expect(page.locator('.source-image-widget')).toHaveCount(0);
    await expect(page.locator('.source-image-inline')).toHaveCount(3);
    await page.getByRole('button', { name: 'Image tools: Remote view', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Load external image', exact: true }),
    ).toBeVisible();
    expect(external).toEqual([]);
    await page.getByRole('button', { name: 'Load external image', exact: true }).click();
    await expect.poll(() => external.length).toBe(1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Image previews', exact: true })
      .selectOption('thumbnails');
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await expect(page.locator('.source-image-widget')).toHaveCount(2);
    await expect(page.locator('.source-image-inline')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Image previews', exact: true }).selectOption('both');
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await source(page).press('ControlOrMeta+End');
    await source(page).press('ControlOrMeta+Home');
    const alignment = await page.locator('.source-pane .cm-editor').evaluate((el) => {
      const line = [...el.querySelectorAll<HTMLElement>('.cm-line')].find(
        (l) => l.textContent === '## Images',
      );
      const number = [
        ...el.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement'),
      ].find((n) => n.textContent === '1');
      return line && number
        ? Math.abs(line.getBoundingClientRect().top - number.getBoundingClientRect().top)
        : null;
    });
    expect(alignment).not.toBeNull();
    expect(alignment!).toBeLessThan(3);
    expect(errors).toEqual([]);
    await shot(page, 'editor-image-previews');
  } finally {
    await remove(request, entry.id);
  }
});

test('link composer cites local content once, edits a heading link and acknowledges draft destinations', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request, '## Start\n\nRead more.\n');
  try {
    await source(page).press('ControlOrMeta+End');
    await page.getByRole('button', { name: 'Insert link', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Insert link', exact: true });
    await dialog.getByRole('searchbox', { name: 'Search link destinations' }).fill('curiosity');
    await dialog.locator('.link-target-list > button').first().click();
    await dialog.getByRole('combobox', { name: 'Insert as', exact: true }).selectOption('citation');
    await dialog.getByRole('button', { name: 'Insert citation', exact: true }).click();
    const first = await saved(request, entry.id);
    await expect.poll(() => saved(request, entry.id)).toContain('::::references[References]');
    await source(page).press('ControlOrMeta+Home');
    await source(page).press('ControlOrMeta+k');
    dialog = page.getByRole('dialog', { name: 'Insert link', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Search link destinations' }).fill('curiosity');
    await dialog.locator('.link-target-list > button').first().click();
    await dialog.getByRole('combobox', { name: 'Insert as', exact: true }).selectOption('citation');
    await dialog.getByRole('button', { name: 'Insert citation', exact: true }).click();
    await expect
      .poll(async () => ((await saved(request, entry.id)).match(/:::reference\[/g) || []).length)
      .toBe(1);
    await source(page).press('ControlOrMeta+End');
    await page.getByRole('button', { name: 'Insert link', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Insert link', exact: true });
    await dialog.getByRole('searchbox', { name: 'Search link destinations' }).fill(entry.title);
    await dialog.locator('.link-target-list > button').click();
    await expect(dialog.getByRole('button', { name: 'Insert link', exact: true })).toBeDisabled();
    await dialog
      .getByRole('switch', { name: 'Insert this unpublished destination anyway' })
      .check();
    await expect(dialog.getByRole('button', { name: 'Insert link', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 844 });
    await page.getByRole('button', { name: 'Insert link', exact: true }).click();
    await shot(page, 'link-composer-phone');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    expect(first).not.toContain('https://127.0.0.1');
  } finally {
    await remove(request, entry.id);
  }
});

test('History filters and compares saved versions but restore review uses current saved source', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request, 'First saved article.');
  try {
    const second = await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: entry,
      body: 'Second saved article.',
      revision: entry.revision,
    });
    await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: second,
      body: 'Current third article.',
      revision: second.revision,
    });
    await page.reload();
    await page.locator('.managed-entry-open').filter({ hasText: entry.title }).click();
    await page.getByRole('button', { name: 'Revision history', exact: true }).click();
    const history = page.getByRole('region', { name: 'Revision history', exact: true });
    await expect(history.locator('.markdown-diff-editor')).toHaveAttribute('data-ready', 'true');
    await history.getByRole('searchbox', { name: 'Search revisions' }).fill('no matching title');
    await expect(history).toContainText('No revisions match');
    await history.getByRole('searchbox', { name: 'Search revisions' }).fill('');
    await history
      .getByRole('combobox', { name: 'Compare selected version with' })
      .selectOption(entry.revision);
    await expect(history.locator('.markdown-diff-editor')).toHaveAttribute('data-ready', 'true');
    await history.getByRole('button', { name: 'Review restore' }).click();
    const review = page.getByRole('dialog', { name: 'Restore this revision?', exact: true });
    await expect(review.locator('.markdown-diff-editor')).toHaveAttribute('data-ready', 'true');
    await review.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(review.locator('.cm-merge-a .cm-content')).toContainText('Current third article.');
    const latest = (await state(request)).entries.find((e: any) => e.id === entry.id);
    await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: latest,
      body: 'A newer external fourth article.',
      revision: latest.revision,
    });
    await expect(review.getByRole('alert')).toContainText('saved article changed');
    await expect(
      review.getByRole('button', { name: 'Restore this revision', exact: true }),
    ).toBeDisabled();
    await review.getByRole('button', { name: 'Review latest version', exact: true }).click();
    await expect(review.locator('.cm-merge-a .cm-content')).toContainText(
      'A newer external fourth article.',
    );
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await history.getByRole('button', { name: 'Return to editor' }).click();
    await expect(source(page)).toContainText('A newer external fourth article.');
    await page.getByRole('button', { name: 'Revision history', exact: true }).click();
    await expect(
      history.getByRole('combobox', { name: 'Compare selected version with' }),
    ).toHaveValue(entry.revision);
    const audit = await new AxeBuilder({ page })
      .include('.revision-workspace')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      audit.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')),
    ).toEqual([]);
    await shot(page, 'history-workspace');
  } finally {
    await remove(request, entry.id);
  }
});

test('Source edit and Settings remain inside source-main with a clean assistance row and persistent undo', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request, '## A source heading\n\nText.\n');
  try {
    const editor = source(page);
    await editor.press('ControlOrMeta+End');
    await editor.pressSequentially(' A new thought.');
    const before = await editor.innerText();
    const main = page.locator('.source-main');
    await expect(
      main.getByRole('tablist', { name: 'Source workspace' }).getByRole('tab'),
    ).toHaveCount(2);
    await expect(main.locator('.editor-assistance + .editor-source-tools')).toBeVisible();
    const assistance = (await main.locator('.editor-assistance').boundingBox())!,
      toolbar = (await main.locator('.editor-source-tools').boundingBox())!;
    expect(assistance.y + assistance.height).toBeLessThanOrEqual(toolbar.y + 1);
    expect(toolbar.height).toBe(assistance.height);
    expect(toolbar.height).toBe(40);
    await expect(
      main.locator(
        '.editor-assistance select[aria-label="Formatting actions"], .editor-assistance .source-complete, .editor-assistance select[aria-label="Table operations"]',
      ),
    ).toHaveCount(0);
    const sourceNode = await editor.evaluate((el) => {
      (window as any).preservedSource = el;
      return true;
    });
    expect(sourceNode).toBe(true);
    await main.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(main.getByRole('tabpanel', { name: 'Settings', exact: true })).toBeVisible();
    await main.getByRole('switch', { name: 'Suggest while typing', exact: true }).uncheck();
    await main
      .getByRole('combobox', { name: 'Image previews', exact: true })
      .selectOption('thumbnails');
    await page.setViewportSize({ width: 320, height: 844 });
    await shot(page, 'source-settings-phone');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    await main.getByRole('tab', { name: 'Source edit', exact: true }).click();
    expect((await main.locator('.editor-assistance').boundingBox())!.height).toBe(40);
    expect((await main.locator('.editor-source-tools').boundingBox())!.height).toBe(40);
    await shot(page, 'source-toolbar-phone');
    await expect.poll(() => editor.innerText()).toBe(before);
    expect(await editor.evaluate((el) => (window as any).preservedSource === el)).toBe(true);
    await editor.press('ControlOrMeta+z');
    await expect(editor).not.toContainText('A new thought.');
  } finally {
    await remove(request, entry.id);
  }
});

test('display math previews share MathJax macros, retain editable TeX and can be disabled per notebook', async ({
  page,
  request,
}) => {
  const body =
      '## Equations\n\n$\\newcommand{\\sourceslope}{3}$\n\n$$\ny=\\sourceslope x\n$$\n\n$$\n\\unknownsourcecommand\n$$\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n',
    entry = await openEntry(page, request, body),
    editor = source(page),
    widgets = page.locator('.source-math-widget');
  const errors: string[] = [],
    scripts: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  try {
    await expect(widgets).toHaveCount(3);
    await expect(widgets.nth(0).locator('svg')).toBeVisible();
    await expect(widgets.nth(1)).toContainText('Invalid equation');
    await expect(widgets.nth(2).locator('svg')).toBeVisible();
    const equationLine = editor.locator('.cm-line').filter({ hasText: /^\\int_0\^1/ });
    await equationLine.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const line = await equationLine.boundingBox(),
          number = await page
            .locator('.cm-lineNumbers .cm-gutterElement')
            .filter({ hasText: /^14$/ })
            .boundingBox();
        return line && number ? Math.abs(line.y - number.y) : 999;
      })
      .toBeLessThan(2);
    await expect.poll(() => saved(request, entry.id)).toBe(body);
    await expect(editor).toContainText('y=\\sourceslope x');
    expect(scripts.some((url) => /mathjax|tex-svg|math-preview.*\.js/i.test(url))).toBe(false);
    await widgets.first().scrollIntoViewIfNeeded();
    await shot(page, 'source-math-previews-light');
    await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
    await shot(page, 'source-math-previews-dark');
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('switch', { name: 'Display math previews', exact: true }).uncheck();
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await expect(widgets).toHaveCount(0);
    await editor.press('ControlOrMeta+End');
    await page.keyboard.insertText('\nA retained edit.');
    await editor.press('ControlOrMeta+z');
    await expect.poll(() => saved(request, entry.id)).toBe(body);
    await page.reload();
    await page.locator('.managed-entry-open').filter({ hasText: entry.title }).click();
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    const toggle = page.getByRole('switch', { name: 'Display math previews', exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await expect(widgets.first().locator('svg')).toBeVisible();
    await page.setViewportSize({ width: 320, height: 844 });
    await widgets.first().scrollIntoViewIfNeeded();
    await shot(page, 'source-math-previews-phone');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  } finally {
    await remove(request, entry.id);
  }
});

test('late math previews cannot replace a newer equation', async ({ page, request }) => {
  const entry = await openEntry(page, request, '## Math\n\nStart.\n'),
    editor = source(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/authoring/math-preview', async (route) => {
    const response = await route.fetch();
    if (route.request().postData()?.includes('staleEquation')) await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    const pending = page.waitForRequest(
      (request) =>
        request.url().endsWith('/authoring/math-preview') &&
        !!request.postData()?.includes('staleEquation'),
    );
    await editor.fill('$$\nstaleEquation=1\n$$\n');
    await pending;
    await editor.fill('$$\ncurrentEquation=2\n$$\n');
    await expect(page.locator('.source-math-widget [role="math"]')).toHaveAttribute(
      'aria-label',
      'currentEquation=2',
    );
    release();
    await expect(page.locator('.source-math-widget')).toHaveCount(1);
    await expect(page.locator('.source-math-widget [role="math"]')).toHaveAttribute(
      'aria-label',
      'currentEquation=2',
    );
    await expect.poll(() => saved(request, entry.id)).toBe('$$\ncurrentEquation=2\n$$\n');
  } finally {
    release();
    await remove(request, entry.id);
  }
});

test('completion shortcut recording rejects conflicts, rebinds immediately and persists without losing undo', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request, '## A keyboard workspace\n\n'),
    editor = source(page),
    main = page.locator('.source-main');
  try {
    await main.getByRole('tab', { name: 'Settings', exact: true }).click();
    await main.getByRole('switch', { name: 'Suggest while typing', exact: true }).uncheck();
    const recorder = main.getByRole('button', { name: 'Change completion shortcut', exact: true });
    await recorder.click();
    await main.getByRole('button', { name: 'Record completion shortcut' }).press('ControlOrMeta+s');
    await expect(
      main.getByText(
        'That shortcut is already used by the editor or browser. Choose another combination.',
        { exact: true },
      ),
    ).toBeVisible();
    await main.getByRole('button', { name: 'Record completion shortcut' }).press('Escape');
    await expect(recorder).toContainText('Ctrl + Space');
    await recorder.click();
    await main
      .getByRole('button', { name: 'Record completion shortcut' })
      .press('ControlOrMeta+Shift+Space');
    await expect(recorder).toContainText('Ctrl/Cmd + Shift + Space');
    await shot(page, 'source-shortcut-settings');
    await main.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await editor.fill(':::');
    await editor.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeHidden();
    await editor.press('ControlOrMeta+Shift+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
    const initiallySelected = await editor.getAttribute('aria-activedescendant');
    await expect
      .poll(async () => {
        await editor.press('ArrowDown');
        return editor.getAttribute('aria-activedescendant');
      })
      .not.toBe(initiallySelected);
    await editor.press('Enter');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeHidden();
    await expect(editor).not.toHaveText(':::');
    await editor.press('ControlOrMeta+z');
    await expect.poll(() => saved(request, entry.id)).toBe(':::\n');
    await page.reload();
    await page.locator('.managed-entry-open').filter({ hasText: entry.title }).click();
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    await main.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(recorder).toContainText('Ctrl/Cmd + Shift + Space');
    await main.getByRole('button', { name: 'Disable completion shortcut' }).click();
    await expect(recorder).toContainText('Unassigned');
    await main.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await editor.press('ControlOrMeta+End');
    await editor.press('ControlOrMeta+Shift+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeHidden();
    await main.getByRole('tab', { name: 'Settings', exact: true }).click();
    await main.getByRole('button', { name: 'Reset completion shortcut' }).click();
    await main.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await editor.press('ControlOrMeta+Home');
    await editor.press('End');
    await editor.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
    await editor.press('Escape');
    await page.setViewportSize({ width: 320, height: 844 });
    await main.getByRole('tab', { name: 'Settings', exact: true }).click();
    await recorder.scrollIntoViewIfNeeded();
    await shot(page, 'source-shortcut-phone');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    const audit = await new AxeBuilder({ page })
      .include('.source-main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      audit.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')),
    ).toEqual([]);
  } finally {
    await remove(request, entry.id);
  }
});

test('inline math draws right after editable TeX with an independent preview preference', async ({
  page,
  request,
}) => {
  const body =
      '## Inline mathematics\n\nA value $x^2$ and a fraction $\\frac{1}{2}$ in the same line.\n\n`$code$` stays code.\n\n$$\ny=x^2\n$$\n',
    entry = await openEntry(page, request, body),
    editor = source(page),
    inline = page.locator('.source-math-inline');
  try {
    await expect(inline.locator('svg')).toHaveCount(2);
    await expect(page.locator('.source-math-widget svg')).toHaveCount(1);
    await expect(inline.first().locator('[role="math"]')).toHaveAttribute('aria-label', 'x^2');
    expect(
      await inline.evaluateAll((nodes) =>
        nodes.every((node) => {
          let previous = node.previousSibling;
          while (previous && !previous.textContent?.replace(/[\u200b\ufeff]/g, ''))
            previous = previous.previousSibling;
          return previous?.textContent?.endsWith('$');
        }),
      ),
    ).toBe(true);
    await expect(editor).toContainText('$x^2$');
    await expect.poll(() => saved(request, entry.id)).toBe(body);
    await shot(page, 'source-inline-math');
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('switch', { name: 'Display math previews', exact: true }).uncheck();
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await expect(page.locator('.source-math-widget')).toHaveCount(0);
    await expect(inline.locator('svg')).toHaveCount(2);
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('switch', { name: 'Inline math previews', exact: true }).uncheck();
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await expect(inline).toHaveCount(0);
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('switch', { name: 'Inline math previews', exact: true }).check();
    await page.getByRole('switch', { name: 'Display math previews', exact: true }).check();
    await page.getByRole('tab', { name: 'Source edit', exact: true }).click();
    await expect(inline.locator('svg')).toHaveCount(2);
    await page.setViewportSize({ width: 320, height: 844 });
    await shot(page, 'source-inline-math-phone');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    await editor.press('ControlOrMeta+End');
    await page.keyboard.insertText(' A retained change.');
    await editor.press('ControlOrMeta+z');
    await expect.poll(() => saved(request, entry.id)).toBe(body);
  } finally {
    await remove(request, entry.id);
  }
});

test('math updates on each edit without waiting for the lint debounce', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request, '$$\nx=1\n$$\n'),
    editor = source(page);
  try {
    await expect(page.locator('.source-math-widget svg')).toBeVisible();
    for (const number of [2, 3]) {
      const next = page.waitForRequest(
        (request) =>
          request.url().endsWith('/authoring/math-preview') &&
          !!request.postData()?.includes(`x=${number}`),
      );
      const started = Date.now();
      await editor.fill(`$$\nx=${number}\n$$\n`);
      await next;
      const elapsed = Date.now() - started;
      console.log(`Source math request after edit (${test.info().project.name}): ${elapsed} ms`);
      expect(elapsed).toBeLessThan(700);
      await expect(page.locator('.source-math-widget [role="math"]')).toHaveAttribute(
        'aria-label',
        `x=${number}`,
      );
    }
    await expect.poll(() => saved(request, entry.id)).toBe('$$\nx=3\n$$\n');
  } finally {
    await remove(request, entry.id);
  }
});
