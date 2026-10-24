import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { routeFor } from '../src/shared/contracts.js';

const flow =
  'flowchart LR\n  accTitle: A quiet reading diagram\n  A["$$x^2+1$$"] --> B[Warning]\n  classDef warning fill:#ffe4e6,stroke:#b91c1c,color:#7f1d1d;\n  class B warning;';
const sequence =
  'sequenceDiagram\n  accTitle: Reading sequence\n  participant Reader\n  participant Blog\n  Reader->>Blog: Open article\n  Blog-->>Reader: Read';
const tabs =
  '::::tabs\n:::tab[Explanation]\nA quiet paragraph beside the diagram.\n:::\n:::tab[Worked example]\nA worked example with $E=mc^2$.\n:::\n::::';
const body =
  '# Transparent illustrations\n\nA continuous reading surface.\n\n![An ordinary photo](/media/coast-dawn.svg)\n\n' +
  [flow, flow, sequence].map((s) => '```mermaid\n' + s + '\n```').join('\n\n') +
  '\n\n' +
  tabs;
const bootstrap = async (request: APIRequestContext) =>
  (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const session = await bootstrap(request);
  const response = await request.fetch('/api/' + path, {
    method,
    headers: { 'X-Studio-Token': session.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function create(request: APIRequestContext, published = false) {
  const slug = `mermaid-${test.info().project.name}-${test.info().line}`;
  const draft = await mutate(request, 'content', 'POST', { kind: 'posts', title: slug, slug });
  const entry = await mutate(request, 'content/' + draft.id, 'PUT', {
    metadata: { ...draft, status: published ? 'published' : 'draft' },
    body,
    revision: draft.revision,
  });
  if (published) {
    const job = await mutate(request, 'jobs', 'POST', { action: 'build' });
    await expect
      .poll(async () => (await bootstrap(request)).jobs.find((j: any) => j.id === job.id)?.state, {
        timeout: 30000,
      })
      .toBe('succeeded');
  }
  return { ...entry, route: routeFor(entry, (await bootstrap(request)).site.collections) };
}
async function remove(request: APIRequestContext, id: string) {
  const entry = (await bootstrap(request)).entries.find((e: any) => e.id === id);
  if (entry) await mutate(request, 'content/' + id, 'DELETE', { revision: entry.revision });
}
async function shot(page: Page, name: string) {
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-${name}.png`,
    animations: 'disabled',
  });
}
async function assertTransparent(figure: ReturnType<Page['locator']>) {
  expect(
    await figure.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        background: style.backgroundColor,
        image: style.backgroundImage,
        shadow: style.boxShadow,
        border: style.borderTopWidth,
      };
    }),
  ).toEqual({ background: 'rgba(0, 0, 0, 0)', image: 'none', shadow: 'none', border: '0px' });
}

test('transparent Mermaid figures open a separate sharp vector gallery with themed controls and SVG downloads', async ({
  page,
  request,
}) => {
  const entry = await create(request, true);
  try {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(entry.route);
    const figures = page.locator('figure[data-mermaid]');
    await expect(figures).toHaveCount(3);
    await assertTransparent(figures.first());
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    await expect(figures.first().locator('[data-diagram-variant="light"] > svg')).toBeVisible();
    const fill = await figures
      .first()
      .locator('[data-diagram-variant="light"] [data-diagram-surface]')
      .first()
      .evaluate((node) => getComputedStyle(node).fill);
    expect(fill).toMatch(/^rgba\(/);
    const alpha = Number(fill.match(/,\s*([\d.]+)\)$/)?.[1]);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(0.08);
    expect(
      await figures
        .first()
        .locator('[data-diagram-variant="light"] .warning rect')
        .first()
        .evaluate((node) => getComputedStyle(node).fill),
    ).toBe('rgb(255, 228, 230)');
    await figures.first().scrollIntoViewIfNeeded();
    await shot(page, 'mermaid-reading-light');
    const open = figures
      .first()
      .getByRole('button', { name: 'View diagram: A quiet reading diagram', exact: true });
    await open.click();
    const viewer = page.getByRole('dialog', { name: 'Diagram viewer', exact: true });
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await expect(viewer.getByRole('toolbar', { name: 'Diagram controls' })).toHaveCount(1);
    await expect(viewer.locator('.viewer-count')).toHaveText('1 / 3');
    const vector = viewer.locator('.viewer-diagram[data-diagram-index="0"]');
    await expect(vector.locator('math')).toHaveCount(2);
    const initial = (await vector.boundingBox())!;
    await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect
      .poll(async () => (await vector.boundingBox())?.width || 0)
      .toBeGreaterThan(initial.width * 1.3);
    await viewer.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await expect
      .poll(async () => Math.abs(((await vector.boundingBox())?.width || 0) - initial.width))
      .toBeLessThan(2);
    const duplicateIds = await page
      .locator('figure[data-mermaid] [id],.viewer-diagram [id]')
      .evaluateAll((nodes) => {
        const ids = nodes.map((node) => node.id);
        return ids.length - new Set(ids).size;
      });
    expect(duplicateIds).toBe(0);
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await expect(vector.locator('[data-diagram-variant="dark"]')).toBeVisible();
    await expect(vector.locator('[data-diagram-variant="light"]')).toBeHidden();
    await shot(page, 'mermaid-viewer-dark');
    const downloaded = page.waitForEvent('download');
    await viewer.getByRole('button', { name: 'Download SVG', exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('A quiet reading diagram.svg');
    const svg = await fs.readFile((await download.path())!, 'utf8');
    expect(svg).toMatch(/background:\s*(?:transparent|none)/);
    expect(svg).toContain('<math');
    expect(
      await page.evaluate(
        (svg) =>
          !new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror'),
        svg,
      ),
    ).toBe(true);
    await viewer.getByRole('button', { name: 'Diagram information', exact: true }).click();
    await expect(viewer.locator('.viewer-information')).toContainText('SVG');
    await expect(viewer.locator('.viewer-information')).not.toContainText('camera');
    await page.keyboard.press('Escape');
    await viewer.getByRole('button', { name: 'Next diagram', exact: true }).click();
    await expect(viewer.locator('.viewer-count')).toHaveText('2 / 3');
    await page.keyboard.press('ArrowRight');
    await expect(viewer.locator('.viewer-caption')).toHaveText('Reading sequence');
    await page.setViewportSize({ width: 320, height: 850 });
    await expect(
      viewer.getByRole('button', { name: 'Close diagram viewer', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await shot(page, 'mermaid-viewer-narrow');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(open).toBeFocused();
    expect(requests.some((url) => /mermaid(?:\.min)?\.js|katex|mathjax/i.test(url))).toBe(false);
  } finally {
    await remove(request, entry.id);
  }
});

test('Studio previews share transparent Mermaid styling, highlighted editing, and the nested viewer', async ({
  page,
  request,
}) => {
  const entry = await create(request);
  try {
    await page.goto('/studio/#writing');
    await page.locator('.managed-entry-open').filter({ hasText: entry.title }).click();
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    const widget = page.locator('.source-component-widget[data-component-kind="mermaid"]').first();
    await expect(widget.locator('figure[data-mermaid]')).toBeVisible({ timeout: 20000 });
    await assertTransparent(widget.locator('figure[data-mermaid]'));
    expect(
      await page
        .locator('.source-component-widget[data-component-kind="mermaid"] [id]')
        .evaluateAll((nodes) => {
          const ids = nodes.map((node) => node.id);
          return ids.length - new Set(ids).size;
        }),
    ).toBe(0);
    await expect
      .poll(() =>
        source
          .locator('.cm-line')
          .filter({ hasText: /^flowchart/ })
          .first()
          .locator('span')
          .count(),
      )
      .toBeGreaterThan(0);
    await widget.getByRole('button', { name: 'Expand', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: 'Diagram viewer', exact: true });
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await expect(viewer.locator('.viewer-count')).toHaveText('1 / 1');
    await page.keyboard.press('Escape');
    await expect(widget.getByRole('button', { name: 'Expand', exact: true })).toBeFocused();
    await widget.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit mermaid diagram', exact: true });
    const editor = edit.getByRole('textbox', { name: 'Mermaid source', exact: true });
    await expect(
      editor
        .locator('.cm-line')
        .filter({ hasText: /^flowchart/ })
        .locator('span')
        .first(),
    ).toBeVisible();
    await expect(edit.locator('figure[data-mermaid]')).toBeVisible({ timeout: 20000 });
    await assertTransparent(edit.locator('figure[data-mermaid]'));
    await edit
      .getByRole('button', { name: 'View diagram: A quiet reading diagram', exact: true })
      .click();
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await expect(viewer.getByRole('toolbar', { name: 'Diagram controls' })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(edit).toBeVisible();
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const frame = page.frameLocator('.preview-frame-wrap iframe');
    await expect(frame.locator('figure[data-mermaid]')).toHaveCount(3);
    await assertTransparent(frame.locator('figure[data-mermaid]').first());
    await shot(page, 'mermaid-studio-preview');
  } finally {
    await remove(request, entry.id);
  }
});

test('a missing diagram viewer module preserves the inline drawing and restores focus', async ({
  page,
  request,
}) => {
  const entry = await create(request, true);
  try {
    await page.route('**/image-viewer-dialog-*.js', (route) => route.abort());
    await page.goto(entry.route);
    const figure = page.locator('figure[data-mermaid]').first();
    const open = figure.getByRole('button', {
      name: 'View diagram: A quiet reading diagram',
      exact: true,
    });
    await open.click();
    const viewer = page.getByRole('dialog', { name: 'Diagram viewer', exact: true });
    await expect(viewer).toContainText('This diagram could not open.');
    await viewer.getByRole('button', { name: 'Close viewer', exact: true }).click();
    await expect(open).toBeFocused();
    await expect(figure.locator('.mermaid-canvas')).toBeVisible();
    await assertTransparent(figure);
  } finally {
    await remove(request, entry.id);
  }
});

test('Markdown tabs are an unframed reading flow with keyboard navigation and complete static/print fallbacks', async ({
  page,
  request,
  browser,
}) => {
  const entry = await create(request, true);
  try {
    await page.goto(entry.route);
    const host = page.locator('.md-tabs');
    await expect(host).toHaveAttribute('data-tabs-ready', 'true');
    await assertTransparent(host);
    const divider = host.getByRole('tablist');
    expect(await divider.evaluate((node) => getComputedStyle(node).borderBottomWidth)).toBe('1px');
    expect(await divider.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
      'rgba(0, 0, 0, 0)',
    );
    const first = host.getByRole('tab', { name: 'Explanation', exact: true });
    const second = host.getByRole('tab', { name: 'Worked example', exact: true });
    await first.focus();
    await first.press('ArrowRight');
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('aria-selected', 'true');
    expect(await second.evaluate((node) => getComputedStyle(node, '::after').height)).toBe('2px');
    await second.hover();
    expect(await second.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
      'rgba(0, 0, 0, 0)',
    );
    await expect(host.getByRole('tabpanel')).toContainText('A worked example');
    await host.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await shot(page, 'typographic-tabs-light');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await page.setViewportSize({ width: 320, height: 850 });
    await assertTransparent(host);
    await host.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await shot(page, 'typographic-tabs-narrow');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.emulateMedia({ media: 'print' });
    await expect(host.locator('.md-tab')).toHaveCount(2);
    for (const panel of await host.locator('.md-tab').all()) await expect(panel).toBeVisible();
    const plain = await browser.newContext({ javaScriptEnabled: false });
    try {
      const staticPage = await plain.newPage();
      await staticPage.goto('http://127.0.0.1:4387' + entry.route);
      await expect(staticPage.locator('.md-tabs .md-tab')).toHaveCount(2);
      await expect(staticPage.locator('.md-tabs')).toContainText('A quiet paragraph');
      await expect(staticPage.locator('.md-tabs')).toContainText('A worked example');
      await expect(
        staticPage.locator('[data-diagram-variant="light"] > svg[data-diagram-rendered]'),
      ).toHaveCount(3);
      const disclosure = staticPage.locator('.diagram-source').first();
      await disclosure.locator('summary').click();
      await expect(disclosure.locator('.expressive-code')).toBeVisible();
      expect(await disclosure.locator('.ec-line .code span[style]').count()).toBeGreaterThan(0);
    } finally {
      await plain.close();
    }
  } finally {
    await remove(request, entry.id);
  }
});
