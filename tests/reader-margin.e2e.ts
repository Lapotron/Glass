import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const model = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, data: unknown, method = 'POST') {
  const state = await model(request);
  const result = await request.fetch('/api/' + path, {
    method,
    headers: { 'X-Studio-Token': state.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(result.ok(), await result.text()).toBe(true);
  return result.json();
}
async function capture(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(name + '.png'), animations: 'disabled' });
}
async function preview(request: APIRequestContext, body: string) {
  const state = await model(request);
  const entry = state.entries[0];
  return (
    await mutate(request, 'preview', {
      entryId: entry.id,
      metadata: { ...entry, comments: false },
      body,
      site: { ...state.site, theme: { ...state.site.theme, appearance: 'light' } },
    })
  ).url as string;
}
const notes = `## Reading with notes

A small supporting detail has its own footnote.[^one]

Two references share this line: repeated[^one] and another[^two].

${Array.from({ length: 12 }, (_, i) => `A later paragraph ${i + 1}, leaving enough space to keep the margin anchored while reading.`).join('\n\n')}

[^one]: A **careful explanation** with $x^2$ and a [reference](https://example.com/reference). <span id="note-detail">An anchored detail.</span>

[^two]: A second note with a different explanation.
`;

test('reader Settings heading and actions span the same width as the settings layout', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4174/settings/');
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const heading = (await page.locator('.reader-page-heading').boundingBox())!;
    const layout = (await page.locator('.reader-settings-layout').boundingBox())!;
    expect(Math.abs(heading.x - layout.x)).toBeLessThan(1);
    expect(Math.abs(heading.width - layout.width)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
});

test('footnotes preview locally, group coincident references and retain native links and mobile access', async ({
  page,
  request,
}) => {
  const providers: string[] = [];
  page.on('request', (request) => {
    if (/giscus\.app|\/api\/annotations\//.test(request.url())) providers.push(request.url());
  });
  await page.goto(await preview(request, notes));
  const refs = page.locator('.article-body [data-footnote-ref]');
  await expect(refs).toHaveCount(3);
  const sidebar = page.locator('.article-margin-rail');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Footnotes: 2', exact: true })).toBeEnabled();
  const fold = sidebar.locator('.article-margin-fold');
  const foldBox = (await fold.boundingBox())!;
  expect(foldBox.width).toBe(44);
  expect(foldBox.height).toBe(44);
  await fold.click();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  expect((await sidebar.boundingBox())!.height).toBe(44);
  await fold.hover();
  await capture(page, 'fold-control-light');
  await page.locator('html').evaluate((node) => (node.dataset.theme = 'dark'));
  await capture(page, 'fold-control-dark');
  await page.locator('html').evaluate((node) => (node.dataset.theme = 'light'));
  await fold.press('Enter');
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
  await refs
    .first()
    .evaluate((node) =>
      scrollTo({ top: scrollY + node.getBoundingClientRect().top - 220, behavior: 'instant' }),
    );
  await page.mouse.move(2, 2);
  const marker = page.locator('.article-footnote-marker:visible').filter({ hasText: /^1$/ });
  await expect(marker).toHaveCount(1);
  const a = (await marker.boundingBox())!,
    b = (await refs.first().boundingBox())!;
  expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThan(2);
  await marker.focus();
  const popup = page.getByRole('dialog', { name: 'Footnote preview', exact: true });
  await expect(popup).toBeVisible();
  await marker.press('Enter');
  await expect(popup.locator('strong').filter({ hasText: 'careful explanation' })).toBeVisible();
  await expect(popup.locator('[role=math] svg')).toBeVisible();
  await expect(popup.getByRole('link', { name: 'reference', exact: true })).toHaveAttribute(
    'href',
    'https://example.com/reference',
  );
  expect(
    await page.locator('[id]').evaluateAll((nodes) => {
      const ids = nodes.map((node) => node.id);
      return ids.length === new Set(ids).size;
    }),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).include('.article-footnote-popover').analyze()).violations,
  ).toEqual([]);
  await capture(page, 'footnote-light');
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await capture(page, 'footnote-dark');
  await page.keyboard.press('Escape');
  await expect(popup).not.toBeVisible();
  await expect(marker).toBeFocused();
  // Move focus away so the group can replace the individual note without reopening it.
  await page.locator('.article-header h1').click();
  const group = page.getByRole('button', { name: '2 notes on this line', exact: true });
  await group.click();
  const chooser = page.getByRole('dialog', { name: 'Notes on this line', exact: true });
  await chooser.getByRole('button', { name: /^Footnote 2:/ }).click();
  await expect(popup).toContainText('A second note with a different explanation.');
  await page.keyboard.press('Escape');
  await expect(group).toBeFocused();
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.locator('.post-outline [data-article-focus-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute('data-article-focus', 'true');
  await refs
    .first()
    .evaluate((node) =>
      scrollTo({ top: scrollY + node.getBoundingClientRect().top - 45, behavior: 'instant' }),
    );
  await expect(marker).toHaveCount(1);
  await marker.click();
  await expect(popup).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--reader-text-scale', '1.2');
    document.documentElement.dataset.reduceTransparency = 'true';
  });
  await expect(page.locator('html')).toHaveAttribute('data-glass-renderer', 'solid');
  await expect
    .poll(async () => {
      const markerBox = (await marker.boundingBox())!,
        refBox = (await refs.first().boundingBox())!;
      return Math.abs(markerBox.y + markerBox.height / 2 - refBox.y - refBox.height / 2);
    })
    .toBeLessThan(2);
  await capture(page, 'footnote-focus-solid');
  await page.keyboard.press('Escape');
  await page.locator('.post-outline [data-article-focus-toggle]').click();
  await page.setViewportSize({ width: 320, height: 844 });
  await refs
    .first()
    .evaluate((node) =>
      scrollTo({ top: scrollY + node.getBoundingClientRect().top - 200, behavior: 'instant' }),
    );
  await refs.first().click();
  await expect(popup).toBeVisible();
  const box = (await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  expect((await fold.boundingBox())!.width).toBe(44);
  expect((await fold.boundingBox())!.height).toBe(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await capture(page, 'footnote-phone');
  const hash = await refs.first().getAttribute('href');
  await popup.getByRole('link', { name: 'Read endnote', exact: true }).click();
  await expect(popup).not.toBeVisible();
  expect(new URL(page.url()).hash).toBe(hash);
  expect(providers).toEqual([]);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-footnotes]')).toBeVisible();
  await expect(page.locator('.article-margin-rail')).not.toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.goto(await preview(request, '## A quiet article\n\nNo footnotes here.'));
  await expect(page.locator('.article-margin-rail')).toBeVisible();
  await page.getByRole('button', { name: 'Expand article notes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Footnotes: 0', exact: true })).toBeDisabled();
});

test('the categorized picker retains component drafts and the table grid applies one undoable edit', async ({
  page,
  request,
}) => {
  let entry = await mutate(request, 'content', {
    kind: 'posts',
    title: `Margin editor ${test.info().project.name}`,
    slug: `margin-editor-${test.info().project.name}`,
  });
  const body = '| Name | Value |\n| :--- | ---: |\n| **A** | $x^2$ |\n';
  entry = await mutate(
    request,
    'content/' + entry.id,
    { metadata: entry, body, revision: entry.revision },
    'PUT',
  );
  try {
    await page.goto('/studio/#writing');
    await page.locator('.managed-entry-open').filter({ hasText: entry.title }).click();
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    await page.getByRole('button', { name: 'Insert component', exact: true }).click();
    const browser = page.getByRole('dialog', { name: 'Bring an idea to life', exact: true });
    await expect(
      browser.getByRole('searchbox', { name: 'Find a Markdown component' }),
    ).toBeFocused();
    const choice = (name: string) =>
      browser
        .locator('.component-browser-choice')
        .filter({ has: page.locator('strong').filter({ hasText: new RegExp('^' + name + '$') }) });
    await choice('Function plot').click();
    await browser.getByRole('textbox', { name: 'Title', exact: true }).fill('Retained curve title');
    await choice('Data chart').click();
    await choice('Function plot').click();
    await expect(browser.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      'Retained curve title',
    );
    await browser.getByRole('button', { name: 'Academic', exact: true }).click();
    await browser.getByRole('searchbox').fill('equation');
    await expect(browser.locator('.component-browser-choice')).toHaveCount(1);
    await expect(choice('Numbered equation')).toBeVisible();
    await browser.getByRole('searchbox').fill('not-a-component');
    await expect(browser.getByRole('status')).toHaveText('No components match this search.');
    await browser.getByRole('searchbox').fill('');
    await capture(page, 'component-picker');
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await browser.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await capture(page, 'component-picker-phone');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await capture(page, 'component-picker-phone-dark');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await browser.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page
      .locator('[data-component-kind=table]')
      .getByRole('button', { name: 'Edit table', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Edit table', exact: true });
    await dialog.getByRole('textbox', { name: 'Row 1 column 2', exact: true }).focus();
    await expect(dialog.locator('.source-table-context')).toContainText('Selected cell: B2');
    await expect(dialog.getByRole('button', { name: 'Align right', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByRole('button', { name: 'Add column', exact: true }).click();
    await expect(
      dialog.getByRole('textbox', { name: 'Header column 3', exact: true }),
    ).toBeVisible();
    await dialog.locator('.source-table-data > summary').click();
    await dialog.getByRole('button', { name: 'Import CSV / TSV', exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'CSV / TSV data', exact: true })
      .fill('Name,Value\nB,2\nC,3');
    await dialog.getByRole('button', { name: 'Use imported data', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Row 1 column 2', exact: true }).focus();
    await dialog.getByRole('button', { name: 'Align right', exact: true }).click();
    await capture(page, 'table-editor');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await capture(page, 'table-editor-dark');
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await capture(page, 'table-editor-phone');
    await dialog.getByRole('button', { name: 'Apply table', exact: true }).click();
    await expect
      .poll(
        async () => (await model(request)).entries.find((value: any) => value.id === entry.id).body,
      )
      .toContain('---:');
    await page
      .getByRole('textbox', { name: 'Markdown source', exact: true })
      .press('ControlOrMeta+z');
    await expect
      .poll(
        async () => (await model(request)).entries.find((value: any) => value.id === entry.id).body,
      )
      .toBe(body);
  } finally {
    const current = (await model(request)).entries.find((value: any) => value.id === entry.id);
    if (current)
      await mutate(request, 'content/' + entry.id, { revision: current.revision }, 'DELETE');
  }
});

test('public footnote tools follow both Chinese interfaces and endnotes remain useful without JavaScript', async ({
  page,
  browser,
}) => {
  for (const [locale, dialog, link] of [
    ['zh-Hans', '脚注预览', '阅读文末脚注'],
    ['zh-Hant', '註腳預覽', '閱讀文末註腳'],
  ]) {
    await page.goto('http://127.0.0.1:4174/settings/');
    await page.locator('select[data-ui-language]').selectOption(locale);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.goto('http://127.0.0.1:4174/blog/good-tools-get-out-of-the-way/');
    const ref = page.locator('[data-footnote-ref]').first();
    await ref.scrollIntoViewIfNeeded();
    await ref.focus();
    const popup = page.getByRole('dialog', { name: dialog, exact: true });
    await expect(popup).toBeVisible();
    await expect(popup.getByRole('link', { name: link, exact: true })).toBeVisible();
    await expect(popup).toContainText('This is a demonstration essay.');
    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible();
  }
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const reader = await context.newPage();
    await reader.goto('http://127.0.0.1:4174/blog/good-tools-get-out-of-the-way/');
    const ref = reader.locator('[data-footnote-ref]').first();
    const href = await ref.getAttribute('href');
    await ref.click();
    expect(new URL(reader.url()).hash).toBe(href);
    await expect(reader.locator('[data-footnotes]')).toBeVisible();
    await expect(reader.locator('.article-margin-rail')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
