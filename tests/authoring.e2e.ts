import { test, expect, type APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';
const pages = 'http://127.0.0.1:4174';
const model = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const s = await model(request);
  const response = await request.fetch('/api/' + path, {
    method,
    headers: { 'X-Studio-Token': s.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function shot(page: import('@playwright/test').Page, name: string) {
  await page.waitForFunction(() => !document.documentElement.matches(':active-view-transition'));
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-${name}.png`,
    animations: 'disabled',
  });
}

test('advanced charts and academic components remain complete without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto(pages + '/blog/authoring-showcase/');
    await expect(page.locator('[data-interactive="chart"]')).toHaveCount(13);
    await expect(page.locator('.chart-static svg')).toHaveCount(26);
    await expect(page.locator('.md-mindmap .mindmap-drawing')).toHaveCount(2);
    const staticMap = page.locator('.md-mindmap .mindmap-canvas');
    const mapBox = (await staticMap.boundingBox())!,
      svgBox = (await staticMap.locator('[data-diagram-variant="light"] svg').boundingBox())!;
    expect(svgBox.width).toBeLessThanOrEqual(mapBox.width);
    expect(svgBox.height).toBeLessThanOrEqual(mapBox.height);
    expect(await page.locator('.prose .md-reference[href^="#"]').count()).toBeGreaterThan(2);
    await page.locator('.md-table').scrollIntoViewIfNeeded();
    await shot(page, 'booktabs-mobile');
    expect(
      await page
        .locator('.md-table th')
        .nth(1)
        .evaluate((el) => getComputedStyle(el).textAlign),
    ).toBe('right');
    expect(
      await page
        .locator('.md-table th')
        .nth(1)
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe('rgba(0, 0, 0, 0)');
    await page.locator('.md-mindmap').getByText('Read text outline', { exact: true }).click();
    await expect(page.locator('.mindmap-outline > ul')).toBeVisible();
    await expect(page.locator('.chart-tools button').first()).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});

test('charts load on intent, show values, toggle legends, zoom and export actual data/images', async ({
  page,
}) => {
  const scripts: string[] = [],
    errors: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pages + '/blog/authoring-showcase/');
  const chart = page.locator('[data-interactive="chart"]').first();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toHaveAttribute('data-enhanced', 'true');
  expect(scripts.some((url) => /echarts-runtime/.test(url))).toBe(false);
  await chart.locator('.chart-viewport').focus();
  await expect(chart).toHaveAttribute('data-chart-ready', 'true');
  await chart.locator('.chart-viewport').scrollIntoViewIfNeeded();
  await chart.locator('.chart-viewport').press('Home');
  await expect(chart.locator('.chart-tooltip-body')).toBeVisible();
  await expect(chart.locator('.chart-status')).toContainText('Reading');
  await expect(chart.locator('.chart-status')).toContainText('12');
  await shot(page, 'chart-tooltip-light');
  await chart.getByRole('button', { name: 'Reading', exact: true }).click();
  await expect(chart.getByRole('button', { name: 'Reading', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await chart.getByRole('button', { name: 'Making', exact: true }).click();
  await expect(chart.locator('.chart-status')).toContainText('All series are hidden');
  await chart.getByRole('button', { name: 'Reset', exact: true }).click();
  await chart.getByRole('button', { name: 'Zoom in', exact: true }).click();
  for (const type of ['CSV', 'SVG', 'PNG']) {
    const download = page.waitForEvent('download');
    await chart.getByRole('button', { name: type, exact: true }).click();
    const result = await download;
    expect(result.suggestedFilename().toLowerCase()).toMatch(
      new RegExp('\\.' + type.toLowerCase() + '$'),
    );
    const bytes = await fs.readFile((await result.path())!);
    expect(bytes.length).toBeGreaterThan(30);
    if (type === 'CSV') expect(bytes.toString()).toContain('Reading');
    if (type === 'SVG') expect(bytes.toString()).toContain('<svg');
    if (type === 'PNG') expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  }
  await page.getByRole('button', { name: 'Change appearance' }).click();
  await chart.locator('.chart-viewport').focus();
  await chart.locator('.chart-viewport').scrollIntoViewIfNeeded();
  await chart.locator('.chart-viewport').press('Home');
  await shot(page, 'chart-tooltip-dark');
  expect(errors).toEqual([]);
});

test('every chart family activates and supports keyboard exploration without browser errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pages + '/blog/authoring-showcase/');
  for (const chart of await page.locator('[data-interactive="chart"]').all()) {
    await chart.locator('.chart-viewport').focus();
    await expect(chart).toHaveAttribute('data-chart-ready', 'true');
    await chart.locator('.chart-viewport').press('Home');
    await expect(chart.locator('.chart-status')).not.toBeEmpty();
    await chart.getByRole('button', { name: 'Reset', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const last = page.locator('[data-interactive="chart"]').last();
  await last.scrollIntoViewIfNeeded();
  await shot(page, 'sankey-mobile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('failed chart imports preserve SVG and data and offer a working retry', async ({ page }) => {
  await page.route('**/echarts-runtime-*.js', (route) => route.abort());
  await page.goto(pages + '/blog/authoring-showcase/');
  const chart = page.locator('[data-interactive="chart"]').first();
  await chart.locator('.chart-viewport').focus();
  await expect(chart.locator('.chart-status')).toContainText('could not load');
  await expect(chart.locator('.chart-static')).toBeVisible();
  await chart.locator('.chart-data summary').click();
  await expect(chart.getByRole('table')).toBeVisible();
  await page.unroute('**/echarts-runtime-*.js');
  await chart.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(chart).toHaveAttribute('data-chart-ready', 'true');
});

test('source completion inserts valid math/snippets, reports ranges and offers table commands in About', async ({
  page,
  request,
}) => {
  const initial = await model(request);
  try {
    const capabilities = await request.get('/api/authoring/capabilities');
    expect(capabilities.headers()['cache-control']).toBe('no-store');
    expect((await capabilities.json()).version).toBe('fieldnotes-markdown/1');
    expect(
      (
        await request.post('/api/authoring/validate', { data: { source: ':ref[missing]' } })
      ).status(),
    ).toBe(403);
    const report = await mutate(request, 'authoring/validate', 'POST', {
      source: ':ref[missing]',
      full: false,
    });
    expect(report.ok).toBe(false);
    expect(report.diagnostics[0].code).toBe('unresolved-reference');
    await page.goto('/studio/#about');
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await expect(source).toBeVisible();
    await source.fill(':::theo');
    await source.press('Control+Space');
    const suggestion = page
      .locator('.cm-tooltip-autocomplete .cm-completionLabel')
      .filter({ hasText: /^theorem$/ });
    await expect(suggestion).toBeVisible();
    await suggestion.click();
    await expect(source).toContainText(':::theorem');
    expect(await source.innerText()).toContain('$x>0$');
    expect(await source.innerText()).not.toContain('\\$');
    await source.fill(':ref[missing]');
    await expect(page.getByRole('button', { name: '1 issue', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '1 issue', exact: true }).click();
    await expect(page.locator('.source-navigator')).toContainText('Unknown document reference');
    await page.getByRole('button', { name: 'Close navigator', exact: true }).click();
    await source.fill('');
    await page.getByRole('button', { name: 'Editor commands', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search editor commands' }).fill('Insert table');
    await page.getByRole('option', { name: 'Insert table', exact: true }).click();
    await expect(source).toContainText('| Column | Value |');
    await source.press('Control+z');
    await expect(page.getByRole('button', { name: 'Syntax checked', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Settings', exact: true }).hover();
    await shot(page, 'editor-assistance');
    await page.getByRole('button', { name: 'Toggle Studio appearance' }).click();
    await page.getByRole('button', { name: 'Syntax checked', exact: true }).focus();
    await shot(page, 'editor-assistance-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page
        .locator('.editor-assistance')
        .evaluate((toolbar) => toolbar.scrollWidth <= toolbar.clientWidth + 1),
    ).toBe(true);
    await shot(page, 'editor-assistance-mobile');
    const sample = await page.context().newPage();
    await sample.goto('/__components/#material-controls');
    await sample.getByRole('button', { name: 'Text action', exact: true }).focus();
    await expect(
      sample.getByRole('button', { name: 'Unavailable text action', exact: true }),
    ).toBeDisabled();
    await shot(sample, 'text-actions');
    await sample.close();
  } finally {
    const current = await model(request);
    await mutate(request, 'pages/about', 'PUT', {
      body: initial.about.body,
      revision: current.about.revision,
    });
  }
});

test('chart Composer keeps invalid data drafts and does not silently insert the previous dataset', async ({
  page,
  request,
}) => {
  const initial = await model(request);
  try {
    await page.goto('/studio/#about');
    await page.getByRole('button', { name: 'Insert component', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Bring an idea to life' });
    await dialog.getByRole('button', { name: 'Data chart', exact: true }).click();
    const data = dialog.getByRole('textbox', { name: 'Chart data', exact: true });
    const valid = await data.inputValue();
    await data.fill('{"series":7}');
    await expect(dialog.getByRole('button', { name: 'Insert into Markdown' })).toBeDisabled();
    await dialog.getByText('Axes, references and synchronization', { exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Reference marks (JSON)', exact: true }).fill('[]');
    await expect(data).toHaveValue('{"series":7}');
    await expect(dialog.getByRole('button', { name: 'Insert into Markdown' })).toBeDisabled();
    await data.fill(valid);
    await expect(dialog.getByRole('button', { name: 'Insert into Markdown' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    const current = await model(request);
    await mutate(request, 'pages/about', 'PUT', {
      body: initial.about.body,
      revision: current.about.revision,
    });
  }
});

test('journal descriptions recover cleanly and albums save, rename and retain photos on deletion', async ({
  page,
  request,
}) => {
  const initial = await model(request);
  try {
    await page.goto('/studio/#photos');
    await page.getByRole('button', { name: 'New album', exact: true }).click();
    await page.getByRole('textbox', { name: 'Album name', exact: true }).fill('Notebook views');
    await page
      .getByRole('textbox', { name: 'Album description', exact: true })
      .fill('Small observations in changing light.');
    await page.getByRole('button', { name: 'Save album', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'View album Notebook views', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Edit album Notebook views', exact: true }).click();
    await page.getByRole('textbox', { name: 'Album name', exact: true }).fill('Unsaved rename');
    const external = await model(request);
    await mutate(request, 'library', 'PUT', {
      value: {
        ...external.library,
        albums: external.library.albums.map((a: any) =>
          a.name === 'Notebook views'
            ? { ...a, description: a.description + ' An external note.' }
            : a,
        ),
      },
      revision: external.libraryRevision,
    });
    await page.getByRole('button', { name: 'Save album', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit album' })).toContainText(/changed/i);
    await expect(page.getByRole('textbox', { name: 'Album name', exact: true })).toHaveValue(
      'Unsaved rename',
    );
    expect(
      (await model(request)).library.albums.some((a: any) => a.name === 'Notebook views'),
    ).toBe(true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Add a moment', exact: true }).click();
    await page.getByRole('button', { name: 'Choose a photo', exact: true }).click();
    await page.locator('.media-picker-grid button').filter({ hasText: 'coast-dawn.svg' }).click();
    await page.getByRole('button', { name: 'Save to collection', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'A moment in your journal' })).toContainText(
      'Add an image description or caption',
    );
    await expect(
      page.getByRole('textbox', { name: 'Image description', exact: true }),
    ).toBeFocused();
    await page.getByRole('textbox', { name: 'Caption', exact: true }).fill('A quiet morning');
    await page.getByRole('combobox', { name: 'Album', exact: true }).fill('Notebook views');
    await page.getByRole('button', { name: 'Save to collection', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'A moment in your journal' })).toHaveCount(0);
    expect(
      (await model(request)).library.photos.find((p: any) => p.caption === 'A quiet morning').alt,
    ).toBe('A quiet morning');
    const gap = await page.locator('.studio-photo-grid').evaluate((grid) => {
      const pagination = grid.nextElementSibling!;
      return pagination.getBoundingClientRect().top - grid.getBoundingClientRect().bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(28);
    await page.getByRole('button', { name: 'Edit album Notebook views', exact: true }).click();
    await page.getByRole('textbox', { name: 'Album name', exact: true }).fill('Quiet mornings');
    await page.getByRole('textbox', { name: 'Album path', exact: true }).fill('quiet-mornings');
    await page.getByRole('button', { name: 'Save album', exact: true }).click();
    const saved = await model(request);
    expect(saved.library.albums.find((a: any) => a.name === 'Quiet mornings').aliases).toContain(
      'notebook-views',
    );
    expect(saved.library.photos.find((p: any) => p.caption === 'A quiet morning').album).toBe(
      'Quiet mornings',
    );
    const preview = await mutate(request, 'preview', 'POST', { route: '/life/quiet-mornings/' });
    const tab = await page.context().newPage();
    await tab.goto(preview.url);
    await expect(tab.getByRole('heading', { name: 'Quiet mornings', exact: true })).toBeVisible();
    await expect(tab.locator('.life-header')).toContainText(
      'Small observations in changing light.',
    );
    expect(
      await tab
        .locator('.life-album-cover')
        .evaluate((image) => image.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(360);
    expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await shot(tab, 'life-album');
    await tab.setViewportSize({ width: 390, height: 844 });
    expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await shot(tab, 'life-album-mobile');
    await tab.close();
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, 'studio-albums-mobile');
    await page.getByRole('button', { name: 'Delete album Quiet mornings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Move moments to', exact: true }).fill('');
    await page.getByRole('button', { name: 'Delete album', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Choose another album');
    await expect(page.getByRole('button', { name: 'Delete album', exact: true })).toBeEnabled();
    await page
      .getByRole('combobox', { name: 'Move moments to', exact: true })
      .fill('Saved moments');
    await page.getByRole('button', { name: 'Delete album', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      (await model(request)).library.photos.find((p: any) => p.caption === 'A quiet morning').album,
    ).toBe('Saved moments');
  } finally {
    const current = await model(request);
    await mutate(request, 'library', 'PUT', {
      value: initial.library,
      revision: current.libraryRevision,
    });
  }
});
