import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';

async function bootstrap(request: APIRequestContext) {
  return (await request.get('/api/bootstrap')).json();
}
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const current = await bootstrap(request);
  const response = await request.fetch('/api/' + path, {
    method,
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function open(
  page: Page,
  request: APIRequestContext,
  body: string,
  metadata: Record<string, unknown> = {},
) {
  const slug = `ide-${test.info().project.name}-${test.info().line}`;
  const draft = await mutate(request, 'content', 'POST', { kind: 'posts', title: slug, slug });
  const entry = await mutate(request, 'content/' + draft.id, 'PUT', {
    metadata: { ...draft, ...metadata },
    body,
    revision: draft.revision,
  });
  await page.goto('/studio/#writing');
  await page.locator('.managed-entry-open').filter({ hasText: slug }).click();
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toBeVisible();
  return entry;
}
async function remove(request: APIRequestContext, id: string) {
  const entry = (await bootstrap(request)).entries.find((entry: any) => entry.id === id);
  if (entry) await mutate(request, 'content/' + id, 'DELETE', { revision: entry.revision });
}
async function go(page: Page, source: string, position: number) {
  const before = source.slice(0, position),
    line = before.split('\n').length,
    column = before.length - before.lastIndexOf('\n') - 1;
  await page.locator('.source-position').click();
  const field = page.getByRole('textbox', { name: 'Go to line:', exact: true });
  await field.fill(`${line}:${column}`);
  await field.press('Enter');
}
async function shot(page: Page, name: string) {
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-${name}.png`,
    animations: 'disabled',
  });
}

test('pseudocode headers and Quicksort snippets retain source, metadata and one-step undo', async ({
  page,
  request,
}) => {
  const header = '~~~pseudo title="Sorting" style="code"';
  const entry = await open(page, request, header);
  const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  const previewRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/authoring/component-preview'))
      previewRequests.push(request.postData() || '');
  });
  try {
    await go(page, header, header.length);
    await editor.press('Control+Space');
    await page.getByRole('option').filter({ hasText: 'Quicksort scaffold' }).click();
    await expect(editor).toContainText(header);
    await expect(editor).toContainText('FUNCTION PARTITION(A, lo, hi)');
    await expect(editor).toContainText('QUICKSORT(A, 0, length(A) - 1)');
    await expect(
      page.locator('.source-component-widget[data-component-kind="pseudocode"]'),
    ).toHaveCount(0);
    await expect.poll(() => editor.innerText()).toContain('END FUNCTION');
    expect((await editor.innerText()).match(/~{3,}/g)).toHaveLength(2);
    await editor.press('Escape');
    await editor.press('ControlOrMeta+z');
    await expect(editor).toHaveText(header);
    await editor.fill('```pseudo');
    await editor.press('ControlOrMeta+End');
    await editor.press('Control+Space');
    const language = page.getByRole('option').filter({ hasText: /^pseudocode$/ });
    await expect(language).toBeVisible();
    await language.click();
    await expect(editor).toHaveText('```pseudocode');
    await editor.press('Escape');
    await editor.fill('```pseudo\npr\n```');
    await go(page, '```pseudo\npr\n```', 12);
    await editor.press('o');
    await page.getByRole('option').filter({ hasText: 'Procedure with matching END' }).click();
    await expect(editor).toContainText('PROCEDURE name(parameters)');
    await editor.press('Tab');
    const selected = await page.evaluate(() => window.getSelection()?.toString());
    expect(selected).toBe('parameters');
    await editor.press('Shift+Tab');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('name');
    await editor.press('Escape');
    await editor.press('ControlOrMeta+z');
    await expect(editor).toContainText('pro');
    await editor.fill('/algorithm');
    await editor.press('ControlOrMeta+End');
    await editor.press('Control+Space');
    await page
      .getByRole('option')
      .filter({ hasText: /algorithm/ })
      .first()
      .click();
    await expect(editor).toContainText('FUNCTION PARTITION');
    expect((await editor.innerText()).match(/\{#alg-quicksort-[\da-f-]+\}/g)).toHaveLength(1);
    expect(previewRequests).toEqual([]);
  } finally {
    await remove(request, entry.id);
  }
});

test('pseudocode source colors, block matching and folds remain tidy in both themes and narrow panes', async ({
  page,
  request,
}) => {
  const body =
    '```pseudocode title="Sort"\nPROCEDURE Sort(values)\n  FOR j ← 0 TO length(values) - 1 DO\n    IF values[j] ≥ 0 THEN\n      RETURN $x^2$ // keep literal source\n    ELSE\n      RETURN false\n    END IF\n  END FOR\nEND PROCEDURE\n```';
  const entry = await open(page, request, body);
  const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  try {
    await go(page, body, body.indexOf('IF values'));
    await expect(page.locator('.cm-pseudo-match').filter({ hasText: 'END IF' })).toBeVisible();
    await expect
      .poll(() =>
        editor.evaluate((content) => {
          const line = [...content.querySelectorAll('.cm-line')].find((line) =>
            line.textContent?.startsWith('PROCEDURE'),
          )!;
          const keyword = line?.querySelector('span');
          return keyword ? getComputedStyle(line).color !== getComputedStyle(keyword).color : false;
        }),
      )
      .toBe(true);
    await expect(
      page.locator(
        '.source-math-inline,.source-component-widget[data-component-kind="pseudocode"]',
      ),
    ).toHaveCount(0);
    await shot(page, 'pseudocode-light');
    await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
    await shot(page, 'pseudocode-dark');
    await page.getByRole('button', { name: 'Editor commands', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Search editor commands', exact: true })
      .fill('Jump to matching pseudocode');
    await page.getByRole('option').filter({ hasText: 'Jump to matching pseudocode block' }).click();
    await expect(page.locator('.source-position')).toContainText('8');
    await page.setViewportSize({ width: 320, height: 850 });
    await expect(editor).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await shot(page, 'pseudocode-narrow');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go(page, body, body.indexOf('FOR j'));
    await page.getByRole('button', { name: 'Editor commands', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Search editor commands', exact: true })
      .fill('Fold section');
    await page
      .getByRole('option')
      .filter({ hasText: /^Fold section$/ })
      .click();
    await expect(page.locator('.cm-foldPlaceholder')).toBeVisible();
    await page.locator('.cm-foldPlaceholder').click();
    await expect(editor).toContainText('END FOR');
  } finally {
    await remove(request, entry.id);
  }
});

test('pseudocode symbols beautify rendered notation and offer explicit source normalization', async ({
  page,
  request,
}) => {
  const source =
    '```pseudo title="Arrows"\nx -> y\nx <- y\nIF x <= y THEN\n  RETURN "x -> y" // -> keep\nEND IF\n```';
  const entry = await open(page, request, source);
  const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  try {
    await go(page, source, source.indexOf('x ->') + 4);
    await editor.press('Control+Space');
    await page.getByRole('option').filter({ hasText: 'Typographic operator' }).click();
    await expect(editor).toContainText('x → y');
    await editor.press('ControlOrMeta+z');
    await expect(editor).toContainText('x -> y');
    await page.getByRole('button', { name: 'Editor commands', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Search editor commands', exact: true })
      .fill('Beautify pseudocode');
    await page.getByRole('option').filter({ hasText: 'Beautify pseudocode operators' }).click();
    await expect(editor).toContainText('x ← y');
    await expect(editor).toContainText('IF x ≤ y THEN');
    await expect(editor).toContainText('"x -> y" // -> keep');
    await editor.press('ControlOrMeta+z');
    await expect(editor).toContainText('x <- y');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const frame = page.frameLocator('.preview-frame-wrap iframe');
    await expect(frame.locator('.pseudocode-block [data-pseudo-symbol="→"] svg')).toBeVisible();
    await expect(frame.locator('.pseudocode-block [data-pseudo-symbol="←"] svg')).toBeVisible();
    expect(
      await frame
        .locator('.pseudocode-block template[data-code-source]')
        .evaluate((template) => (template as HTMLTemplateElement).content.textContent),
    ).toBe(source.split('\n').slice(1, -1).join('\n'));
    await shot(page, 'pseudocode-rendered-symbols');
  } finally {
    await remove(request, entry.id);
  }
});

test('math completion shows symbol glyphs and rendered examples, including physics packages', async ({
  page,
  request,
}) => {
  const entry = await open(page, request, '# Mathematics\n\n$\\al', {
    math: { packages: ['physics'] },
  });
  const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  try {
    await go(page, entry.body, entry.body.indexOf('\\al') + 3);
    await editor.press('Control+Space');
    const alpha = page
      .getByRole('option')
      .filter({ hasText: /\\alpha/ })
      .first();
    await expect(alpha).toBeVisible();
    await expect(alpha).toContainText('α');
    await expect(page.locator('.cm-completionInfo .math-completion-example svg')).toBeVisible();
    await expect(alpha).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-completionInfo .math-completion-example svg')).toBeInViewport();
    await shot(page, 'math-symbol-completion');
    await alpha.click();
    await expect(editor).toContainText('\\alpha');
    await editor.fill('# Physics\n\n$\\pd');
    await editor.press('ControlOrMeta+End');
    await editor.press('Control+Space');
    const derivative = page.getByRole('option').filter({ hasText: /\\pdv/ }).first();
    await expect(derivative).toBeVisible();
    await expect(page.locator('.cm-completionInfo .math-completion-example svg')).toBeVisible();
    await derivative.click();
    await expect(editor).toContainText('\\pdv{f}{x}');
    await expect(editor).not.toContainText('${');
    await editor.press('Escape');
    await page.getByRole('button', { name: 'Toggle Studio appearance' }).click();
    await shot(page, 'math-completion-dark');
  } finally {
    await remove(request, entry.id);
  }
});

test('JS/TS worker completes browser APIs and navigates and renames grouped virtual files', async ({
  page,
  request,
}) => {
  const body =
    '# A project\n\n```typescript title="geometry.ts" project="demo"\nexport function square(value: number): number { return value * value; }\n```\n\n```typescript title="main.ts" project="demo"\nimport { square } from "./geometry";\nconst answer = square("wrong");\nconsole.lo\n```';
  const entry = await open(page, request, body),
    editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await expect(page.locator('.cm-lintRange-error').first()).toBeVisible({ timeout: 20000 });
    await go(page, body, body.indexOf('console.lo') + 'console.lo'.length);
    await editor.press('Control+Space');
    const log = page
      .getByRole('option')
      .filter({ hasText: /^log(?:\s|$)/ })
      .first();
    await expect(log).toBeVisible({ timeout: 20000 });
    await log.click();
    await expect(editor).toContainText('console.log');
    await go(page, body, body.indexOf('square("wrong') + 2);
    await editor.press('F12');
    await expect(page.locator('.source-position')).toContainText('Ln 4');
    await editor.press('F2');
    const dialog = page.getByRole('dialog', { name: 'Rename symbol' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('New symbol name').fill('squared');
    await dialog.getByRole('button', { name: 'Rename symbol', exact: true }).click();
    await expect(editor).toContainText('function squared');
    await expect(editor).toContainText('import { squared }');
    await editor.press('ControlOrMeta+z');
    await expect(editor).toContainText('function square');
    expect(errors).toEqual([]);
    await shot(page, 'code-intelligence');
  } finally {
    await remove(request, entry.id);
  }
});

test('rich blocks keep gutter baselines aligned and inline highlights appear in the live preview', async ({
  page,
  request,
}) => {
  const body =
    '# Rich blocks\n\n==A **highlighted** result== and :mark[another highlight]. Inline $\\alpha$.\n\n| Name | Value |\n| --- | ---: |\n| A | $2$ |\n\nAfter table.\n\n```pseudocode title="Step"\nINPUT $x$\nRETURN $x^2$\n```\n\nAfter algorithm.\n\n$$\n\\frac{a}{b}\n$$\n\nAfter equation.\n\n:::equation{#energy}\n$$\nE=mc^2\n$$\n:::\n\nAfter nested equation.';
  const entry = await open(page, request, body);
  try {
    await expect(
      page.locator('.source-component-widget[data-component-kind="table"] table'),
    ).toBeVisible();
    await expect(
      page.locator('.source-component-widget[data-component-kind="pseudocode"]'),
    ).toHaveCount(0);
    await expect(
      page
        .locator('.source-math-inline')
        .getByRole('math', { name: '\\alpha', exact: true })
        .locator('svg'),
    ).toBeVisible();
    for (const text of [
      'After table.',
      'After algorithm.',
      'After equation.',
      'After nested equation.',
    ]) {
      const line = page.locator('.cm-content .cm-line').filter({ hasText: text });
      await line.scrollIntoViewIfNeeded();
      const number = body.split('\n').findIndex((value) => value === text) + 1;
      await expect
        .poll(async () => {
          const source = await line.boundingBox(),
            gutter = await page
              .locator('.cm-lineNumbers .cm-gutterElement')
              .filter({ hasText: new RegExp('^' + number + '$') })
              .boundingBox();
          return source && gutter ? Math.abs(source.y - gutter.y) : 999;
        })
        .toBeLessThan(2);
    }
    await expect(page.locator('.source-math-widget [aria-label="E=mc^2"] svg')).toBeVisible();
    await expect(
      page.locator('.source-math-widget[data-error], .source-math-inline[data-error]'),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const frame = page.frameLocator('.preview-frame-wrap iframe');
    await expect(frame.locator('.article-body mark').first()).toContainText('A highlighted result');
    await expect(frame.locator('.article-body mark')).toHaveCount(2);
    await shot(page, 'ide-preview-highlights');
  } finally {
    await remove(request, entry.id);
  }
});

test('large math documents render the current viewport beyond 200 expressions', async ({
  page,
  request,
}) => {
  const body =
    '# Many equations\n\n' +
    Array.from(
      { length: 260 },
      (_, index) => `Section ${index}\n\n$$\ny_{${index}} = x^2\n$$\n`,
    ).join('\n');
  const entry = await open(page, request, body);
  try {
    await expect(page.locator('.source-math-widget svg').first()).toBeVisible();
    await go(page, entry.body, entry.body.length);
    await expect(
      page
        .locator('.source-math-widget [role="math"]')
        .filter({ has: page.locator('svg') })
        .last(),
    ).toHaveAttribute('aria-label', 'y_{259} = x^2', { timeout: 20000 });
    await expect(page.locator('.code-editor')).not.toContainText('200 expressions');
    await shot(page, 'large-math-viewport');
  } finally {
    await remove(request, entry.id);
  }
});

test('language intelligence recovers from a failed worker without replacing source or undo', async ({
  page,
  request,
}) => {
  const workerPath = /code-intelligence\.worker-[^/]+\.js(?:\?.*)?$/;
  await page.route(workerPath, (route) => route.abort());
  const body = '# Worker recovery\n\n```typescript\nconsole.lo\n```';
  const entry = await open(page, request, body);
  const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  try {
    await page.getByRole('tab', { name: 'Problems', exact: true }).click();
    await expect(
      page.locator('.source-problem').filter({ hasText: /language worker stopped/i }),
    ).toBeVisible();
    await expect(editor).toContainText('console.lo');
    await page.unroute(workerPath);
    await page.getByRole('button', { name: 'Editor commands', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Editor commands' })
      .getByRole('option', { name: 'Retry language intelligence', exact: true })
      .click();
    await expect(
      page.locator('.source-problem').filter({ hasText: /language worker stopped/i }),
    ).toHaveCount(0);
    await go(page, body, body.indexOf('console.lo') + 'console.lo'.length);
    await editor.press('Control+Space');
    await page
      .getByRole('option')
      .filter({ hasText: /^log(?:\s|$)/ })
      .first()
      .click();
    await expect(editor).toContainText('console.log');
    await editor.press('ControlOrMeta+z');
    await expect(editor).toContainText('console.lo');
    await expect(editor).not.toContainText('console.log');
  } finally {
    await remove(request, entry.id);
  }
});

test('the editor reviews Post/Article conversion and preserves its stable identity on reload', async ({
  page,
  request,
}) => {
  const entry = await open(page, request, '## A movable draft\n\nKeep this exact paragraph.');
  try {
    await page.getByRole('button', { name: 'Move between collections', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Move between collections' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Keep the same content identity');
    await dialog.getByRole('button', { name: 'Move 1 entries' }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await bootstrap(request)).entries.find((candidate: any) => candidate.id === entry.id)
            ?.kind,
      )
      .toBe('lab');
    const moved = (await bootstrap(request)).entries.find(
      (candidate: any) => candidate.id === entry.id,
    );
    expect(moved.shortCode).toBe(entry.shortCode);
    expect(moved.body).toContain('Keep this exact paragraph.');
    expect(moved.discussion.articleTerm).toBe('/blog/' + entry.slug + '/');
    await page.reload();
    await page
      .getByRole('button', { name: /Lab|Articles/ })
      .first()
      .click();
    await expect(
      page.locator('.managed-entry-open').filter({ hasText: entry.title }),
    ).toBeVisible();
    await shot(page, 'conversion-review-result');
  } finally {
    await remove(request, entry.id);
  }
});
