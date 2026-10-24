import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';

const firstQuote = 'A first line with careful emphasis and code.';
const secondQuote = 'A second line, kept independent from the first.';
const body = `## Line review

A first line with **careful emphasis** and \`code\`.${'  '}
A second line, kept independent from the first.${'  '}
第三行支持中文和数学 $x^2$。

## More to explore

An independently addressable paragraph.

\`\`\`js
const answer = 42;
console.log(answer);
\`\`\`

${Array.from({ length: 12 }, (_, i) => `A later paragraph ${i + 1}, giving the document room to scroll.`).join('\n\n')}`;
const session = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const model = await session(request);
  const response = await request.fetch(`/api/${path}`, {
    method,
    headers: { 'X-Studio-Token': model.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function build(request: APIRequestContext) {
  const job = await mutate(request, 'jobs', 'POST', { action: 'build' });
  await expect
    .poll(async () => (await session(request)).jobs.find((j: any) => j.id === job.id)?.state, {
      timeout: 20000,
    })
    .toBe('succeeded');
}
async function fixture(request: APIRequestContext) {
  const original = await session(request);
  let entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Reading between the lines',
    slug: `line-review-${test.info().project.name}`,
  });
  entry = await mutate(request, `content/${entry.id}`, 'PUT', {
    metadata: { ...entry, status: 'published' },
    body,
    revision: entry.revision,
  });
  const now = await session(request);
  await mutate(request, 'site', 'PUT', {
    value: {
      ...now.site,
      theme: { ...now.site.theme, appearance: 'light' },
      integrations: {
        ...now.site.integrations,
        comments: {
          ...now.site.integrations.comments,
          enabled: true,
          onDemand: true,
          repo: 'example/notebook',
          repoId: 'R_test',
          categoryId: 'DIC_test',
        },
      },
    },
    revision: now.siteRevision,
  });
  await build(request);
  return {
    entry,
    url: `/blog/${entry.slug}/`,
    async restore() {
      let current = await session(request);
      const saved = current.entries.find((e: any) => e.id === entry.id);
      if (saved)
        await mutate(request, `content/${entry.id}`, 'DELETE', { revision: saved.revision });
      current = await session(request);
      await mutate(request, 'site', 'PUT', {
        value: original.site,
        revision: current.siteRevision,
      });
      await build(request);
    },
  };
}
async function provider(page: Page) {
  const requests: URL[] = [];
  await page.route('https://giscus.app/**', (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><style>body{font:14px system-ui;margin:12px;color:#4b617c}textarea{box-sizing:border-box;width:100%;height:100px;border:1px solid #a5bacf;border-radius:12px;padding:12px;background:transparent}button{border:0;border-radius:10px;background:#d7eafa;color:#284d6c;padding:10px;margin-top:10px}</style></head><body><p>Sign in with GitHub to join this line.</p><textarea aria-label="Comment" placeholder="Leave a thoughtful note"></textarea><button id="send">Submit fixture comment</button><script>parent.postMessage({giscus:{error:'Discussion not found'}},'*');parent.postMessage({giscus:{resizeHeight:260}},'*');document.querySelector('#send').onclick=()=>parent.postMessage({giscus:{discussion:{url:'https://github.com/example/notebook/discussions/52',totalCommentCount:1,totalReplyCount:0,reactionCount:0}}},'*');</script></body></html>`,
    });
  });
  return requests;
}
async function hoverText(page: Page, text: string) {
  const paragraph = page
    .locator('.article-body p,.article-body [data-code-line]')
    .filter({ hasText: text })
    .first();
  await paragraph.evaluate((node) =>
    scrollTo({ top: scrollY + node.getBoundingClientRect().top - 200, behavior: 'instant' }),
  );
  const point = await paragraph.evaluate((node, text) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const start = walker.currentNode.textContent!.indexOf(text);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(walker.currentNode, start);
      range.setEnd(walker.currentNode, start + 1);
      const rect = range.getBoundingClientRect();
      const block = node.getBoundingClientRect();
      return { x: rect.left - block.left + 2, y: rect.top - block.top + rect.height / 2 };
    }
    throw new Error(`Text not found: ${text}`);
  }, text);
  await paragraph.hover({ position: point });
  const trigger = page.getByRole('button', { name: 'Annotate this line', exact: true });
  await expect(trigger).toBeVisible();
  await expect
    .poll(async () => {
      const rect = await trigger.boundingBox();
      const block = await paragraph.boundingBox();
      return rect && block ? Math.abs(rect.y + rect.height / 2 - block.y - point.y) : Infinity;
    })
    .toBeLessThan(3);
  return trigger;
}
async function shot(page: Page, name: string) {
  await page.waitForFunction(() => !document.documentElement.matches(':active-view-transition'));
  await expect
    .poll(() => page.locator('html').evaluate((node) => getComputedStyle(node, '::before').opacity))
    .toBe('0');
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({ path: `test-results/visuals/${test.info().project.name}-${name}.png` });
}

test('hovered visual lines open independent quoted conversations and preserve the reader draft', async ({
  page,
  request,
}) => {
  const model = await fixture(request);
  const loads = await provider(page);
  try {
    await page.goto(model.url);
    await expect(page.getByRole('button', { name: 'Annotate a line', exact: true })).toBeEnabled();
    const trigger = await hoverText(page, 'A first line');
    await expect(page.locator('.line-discussion-highlight,.line-discussion-markers')).toHaveCount(
      0,
    );
    expect(loads).toHaveLength(0);
    const tooltip = page.locator('#line-discussion-tooltip');
    await expect(tooltip).toBeVisible();
    await page.getByRole('button', { name: 'Collapse article notes', exact: true }).click();
    await expect(tooltip).not.toBeVisible();
    await page
      .locator('.article-body p')
      .filter({ hasText: 'A first line' })
      .first()
      .hover({ position: { x: 10, y: 12 } });
    await expect(tooltip).not.toBeVisible();
    await expect(trigger).not.toBeVisible();
    await page.getByRole('button', { name: 'Expand article notes', exact: true }).click();
    await hoverText(page, 'A first line');
    await expect(tooltip).toBeVisible();
    const boundary = await page.locator('.article-body').boundingBox();
    const bubble = (await trigger.boundingBox())!;
    const rail = (await page.locator('.article-margin-rail').boundingBox())!;
    expect(bubble.x).toBeGreaterThan(boundary!.x + boundary!.width);
    expect(Math.abs(bubble.x + bubble.width / 2 - rail.x - rail.width / 2)).toBeLessThan(2);
    await trigger.click();
    const popup = page.getByRole('dialog', { name: 'Line annotation', exact: true });
    await expect(popup).toBeVisible();
    if (test.info().project.name === 'webkit') {
      await expect(popup).toHaveAttribute('data-liquid', 'surface');
      await expect(popup).toHaveCSS('backdrop-filter', /blur\(/);
    } else {
      await expect(popup).toHaveAttribute('data-liquid', 'optic');
      await expect
        .poll(() => popup.evaluate((node) => getComputedStyle(node, '::before').backdropFilter))
        .toMatch(/url\(/);
    }
    await expect(popup.locator('[data-line-quote]')).toHaveText(firstQuote);
    await expect(popup.locator('.line-conversation')).toHaveAttribute(
      'data-discussion-state',
      'empty',
    );
    await expect(page.locator('[data-line-annotation-badge]')).toHaveCount(0);
    expect(loads).toHaveLength(1);
    const context = loads[0];
    expect(context.searchParams.get('term')).toMatch(
      new RegExp(`^entry/${model.entry.id}/line/[a-f\\d]{20}-1/0-${firstQuote.length}$`),
    );
    expect(context.searchParams.get('description')).toBe(`> ${firstQuote}`);
    expect(new URL(context.searchParams.get('backLink')!).hash).toBe(new URL(page.url()).hash);
    const fragment = new URL(page.url()).hash;
    const frame = popup.frameLocator('iframe');
    await frame
      .getByRole('textbox', { name: 'Comment', exact: true })
      .fill('An unsent local fixture draft');
    await popup.getByRole('button', { name: 'Close annotation', exact: true }).click();
    await expect(popup).not.toBeVisible();
    await trigger.click();
    await expect(frame.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue(
      'An unsent local fixture draft',
    );
    expect(new URL(page.url()).hash).toBe(fragment);
    await frame.getByRole('button', { name: 'Submit fixture comment', exact: true }).click();
    await expect(popup.locator('[data-discussion-meta]')).toHaveText(
      '1 comment · 0 replies · 0 reactions',
    );
    await expect(page.locator('[data-line-annotation-count]')).toHaveText('1');
    await expect(page.locator('[data-discussion-jump-label]')).toHaveText('Join the discussion');
    await shot(page, 'line-discussion-desktop-light');
    await popup.getByRole('button', { name: 'Close annotation', exact: true }).click();
    const article = page.locator('#discussion');
    await article.getByRole('button', { name: 'Load discussion', exact: true }).click();
    await expect(article).toHaveAttribute('data-discussion-state', 'empty');
    await expect(article.locator('[data-discussion-meta]')).toContainText('0 comments');
    const next = await hoverText(page, 'A second line');
    await next.click();
    await expect(popup.locator('[data-line-quote]')).toHaveText(secondQuote);
    await expect(page.locator('giscus-widget')).toHaveCount(2);
    expect(new URL(page.url()).hash).not.toBe(fragment);
    await expect(article.locator('iframe')).toHaveCSS('height', '260px');
    await popup
      .frameLocator('iframe')
      .locator('body')
      .evaluate(() => parent.postMessage({ giscus: { resizeHeight: 490 } }, '*'));
    await expect(popup.locator('iframe')).toHaveCSS('height', '490px');
    await expect(article.locator('iframe')).toHaveCSS('height', '260px');
    await page.locator('html').evaluate((node) => (node.dataset.theme = 'dark'));
    await expect(popup.locator('[data-comment-link]')).toHaveCSS(
      'color',
      await popup
        .locator('[data-discussion-meta]')
        .evaluate((node) => getComputedStyle(node).color),
    );
    await shot(page, 'line-discussion-desktop-dark');
    const audit = await new AxeBuilder({ page })
      .include('.line-discussion-popover')
      .exclude('giscus-widget')
      .analyze();
    expect(
      audit.violations.filter((violation) =>
        ['serious', 'critical'].includes(violation.impact || ''),
      ),
    ).toEqual([]);
    await popup.getByRole('button', { name: 'Close annotation', exact: true }).click();
    await (await hoverText(page, 'answer')).click();
    await expect(popup).toBeVisible();
    await expect(popup.locator('[data-line-quote]')).toHaveText('const answer = 42;');
    await popup.getByRole('button', { name: 'Close annotation', exact: true }).click();
    await (await hoverText(page, '第三行')).click();
    await expect(popup.locator('[data-line-quote]')).toHaveText('第三行支持中文和数学 x^2。');
  } finally {
    await page.close();
    await model.restore();
  }
});

test('line permalinks survive responsive wrapping, unrelated edits, and the Giscus sign-in callback', async ({
  page,
  request,
}) => {
  const model = await fixture(request);
  await provider(page);
  try {
    await page.goto(model.url);
    await expect(page.getByRole('button', { name: 'Annotate a line', exact: true })).toBeEnabled();
    await (await hoverText(page, 'A first line')).click();
    const fragment = new URL(page.url()).hash;
    const now = await session(request);
    const entry = now.entries.find((e: any) => e.id === model.entry.id);
    await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: entry,
      body: `A new introduction, added later.\n\n${body}`,
      revision: entry.revision,
    });
    await build(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${model.url}?giscus=fake-test-session${fragment}`);
    const popup = page.getByRole('dialog', { name: 'Line annotation', exact: true });
    await expect(popup).toBeVisible();
    await expect(popup.locator('[data-line-quote]')).toHaveText(firstQuote);
    await expect(popup.locator('.line-conversation')).toHaveAttribute(
      'data-discussion-state',
      'empty',
    );
    expect(new URL(page.url()).searchParams.has('giscus')).toBe(false);
    expect(new URL(page.url()).hash).toBe(fragment);
    await expect(page.locator('.line-discussion-highlight,.line-discussion-markers')).toHaveCount(
      0,
    );
    expect(await page.locator('[data-source-start]').count()).toBe(0);
    await shot(page, 'line-discussion-mobile-permalink');
    const before = await session(request);
    const changed = before.entries.find((e: any) => e.id === model.entry.id);
    await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: changed,
      body: body.replace('careful emphasis', 'a changed sentence'),
      revision: changed.revision,
    });
    await build(request);
    await page.reload();
    await expect(popup.locator('[data-line-outdated]')).toBeVisible();
    await expect(popup.locator('[data-line-outdated]')).toContainText('This line has changed');
    await expect(popup.locator('giscus-widget')).toHaveCount(0);
    await expect(popup.getByRole('link', { name: 'Browse annotations' })).toHaveAttribute(
      'href',
      /type=discussions/,
    );
  } finally {
    await page.close();
    await model.restore();
  }
});

test('line review supports keyboard and touch, and stays disabled in private previews', async ({
  page,
  request,
  browser,
}) => {
  const model = await fixture(request);
  await provider(page);
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  try {
    await page.goto(model.url);
    const entry = page.getByRole('button', { name: 'Annotate a line', exact: true });
    await expect(entry).toBeEnabled();
    await page.getByRole('button', { name: 'Add a line annotation', exact: true }).click();
    const trigger = page.getByRole('button', { name: 'Annotate this line', exact: true });
    await expect(trigger).toBeFocused();
    const initial = await trigger.getAttribute('data-line-reference');
    await trigger.press('ArrowDown');
    expect(await trigger.getAttribute('data-line-reference')).not.toBe(initial);
    await trigger.press('Enter');
    const popup = page.getByRole('dialog', { name: 'Line annotation', exact: true });
    await expect(popup).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();
    await expect(trigger).not.toBeVisible();
    const touch = await mobile.newPage();
    await provider(touch);
    await touch.goto(`http://127.0.0.1:4387${model.url}`);
    await expect(touch.getByRole('button', { name: 'Annotate a line', exact: true })).toBeEnabled();
    await touch.locator('.article-header').evaluate((node) => (node.style.minHeight = '1100px'));
    await touch.getByRole('button', { name: 'Annotate a line', exact: true }).click();
    await expect(
      touch.getByRole('button', { name: 'Annotate this line', exact: true }),
    ).toBeVisible();
    await touch.getByRole('button', { name: 'Annotate this line', exact: true }).press('Enter');
    await touch.getByRole('button', { name: 'Close annotation', exact: true }).click();
    const paragraph = touch
      .locator('.article-body p')
      .filter({ hasText: 'An independently addressable paragraph.' });
    await paragraph.evaluate((node) =>
      scrollTo({ top: scrollY + node.getBoundingClientRect().top - 180, behavior: 'instant' }),
    );
    const rect = (await paragraph.boundingBox())!;
    await touch.touchscreen.tap(rect.x + 8, rect.y + 12);
    await touch.getByRole('button', { name: 'Annotate this line', exact: true }).tap();
    await expect(touch.getByRole('dialog', { name: 'Line annotation', exact: true })).toBeVisible();
    expect(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await shot(touch, 'line-discussion-mobile-touch');
    await touch.locator('html').evaluate((node) => (node.dataset.reduceTransparency = 'true'));
    await expect(touch.locator('.line-discussion-popover')).toHaveCSS('backdrop-filter', 'none');
    await expect
      .poll(() =>
        touch
          .locator('.line-discussion-popover')
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .toMatch(/^rgb\(/);
    const current = await session(request);
    const saved = current.entries.find((e: any) => e.id === model.entry.id);
    const preview = await mutate(request, 'preview', 'POST', {
      entryId: saved.id,
      metadata: saved,
      body,
    });
    await page.goto(preview.url);
    await expect(page.getByRole('button', { name: 'Annotate a line', exact: true })).toBeDisabled();
    await expect(page.locator('[data-line-discussion-template]')).toHaveCount(0);
    for (const tab of await page.getByRole('tab', { name: /^Annotations/ }).all())
      await expect(tab).toBeDisabled();
    await expect(page.locator('giscus-widget')).toHaveCount(0);
    await mutate(request, `content/${saved.id}`, 'PUT', {
      metadata: { ...saved, comments: false },
      body,
      revision: saved.revision,
    });
    await build(request);
    await page.goto(model.url);
    await expect(
      page.locator('[data-discuss-line],[data-line-trigger],[data-comments]'),
    ).toHaveCount(0);
  } finally {
    await mobile.close();
    await page.close();
    await model.restore();
  }
});

test('annotation tabs share ordered passage links, pagination, real provider updates, and responsive keyboard access', async ({
  page,
  request,
}) => {
  const model = await fixture(request);
  await provider(page);
  try {
    await page.goto(model.url);
    await expect(page.getByRole('button', { name: 'Annotate a line', exact: true })).toBeEnabled();
    const first = await (await hoverText(page, 'A first line')).getAttribute('data-line-reference');
    const second = await (
      await hoverText(page, 'A second line')
    ).getAttribute('data-line-reference');
    let calls = 0,
      fail = false;
    await page.route('**/api/annotations/*', (route) => {
      calls++;
      if (fail) return route.fulfill({ status: 503, json: { error: 'Unavailable fixture' } });
      const more = new URL(route.request().url()).searchParams.get('page') === '2';
      return route.fulfill({
        json: {
          checkedAt: '2026-10-19T00:00:00Z',
          nextPage: more ? null : 2,
          items: more
            ? [
                {
                  fragment: `line-${'f'.repeat(20)}-1-0-12`,
                  quote: 'An earlier version of a passage',
                  url: 'https://github.com/example/notebook/discussions/53',
                  updatedAt: '',
                },
              ]
            : [
                {
                  fragment: second,
                  quote: secondQuote,
                  url: 'https://github.com/example/notebook/discussions/52',
                  updatedAt: '',
                  comments: 2,
                },
                {
                  fragment: first,
                  quote: firstQuote,
                  url: 'https://github.com/example/notebook/discussions/51',
                  updatedAt: '',
                  comments: 3,
                  replies: 1,
                },
              ],
        },
      });
    });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Annotate a line', exact: true })).toBeEnabled();
    const sidebar = page.getByRole('complementary', { name: 'Article outline' });
    await sidebar.getByRole('tab', { name: /^Annotations/ }).click();
    const sideRows = sidebar.locator('[data-annotation-reference]');
    await expect(sideRows).toHaveCount(3);
    await expect(sideRows.nth(0)).toContainText(firstQuote);
    await expect(sideRows.nth(1)).toContainText(secondQuote);
    await expect(sideRows.nth(0).locator('.annotation-position')).toHaveText(
      'Line 2 · Line review',
    );
    await expect(sideRows.nth(2)).toContainText('Changed passage');
    await expect(sideRows.nth(2)).toHaveAttribute('target', '_blank');
    await expect(sideRows.nth(2)).toHaveAttribute(
      'href',
      'https://github.com/example/notebook/discussions/53',
    );
    const footer = page.locator('.article-conversations');
    await footer.getByRole('tab', { name: /^Annotations/ }).click();
    await expect(footer.locator('[data-annotation-reference]')).toHaveCount(3);
    expect(calls).toBe(2);
    await shot(page, 'annotation-footer-tab');
    await footer.locator('[data-annotation-reference]').first().click();
    const popup = page.getByRole('dialog', { name: 'Line annotation', exact: true });
    await expect(popup.locator('[data-line-quote]')).toHaveText(firstQuote);
    await expect(popup.locator('giscus-widget')).toHaveAttribute('mapping', 'number');
    await expect(popup.locator('giscus-widget')).toHaveAttribute('term', '51');
    await expect(page.locator('.line-discussion-highlight')).toHaveCount(0);
    await popup
      .frameLocator('iframe')
      .getByRole('button', { name: 'Submit fixture comment', exact: true })
      .click();
    await expect(sideRows.first().locator('.annotation-replies')).toHaveText('1 comment');
    await expect(
      footer.locator('[data-annotation-reference]').first().locator('.annotation-replies'),
    ).toHaveText('1 comment');
    await shot(page, 'annotation-sidebar-and-note');
    await popup.getByRole('button', { name: 'Close annotation', exact: true }).click();
    fail = true;
    await sidebar.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(sidebar.locator('[data-annotation-status]')).toContainText('could not load');
    await expect(sideRows).toHaveCount(3);
    fail = false;
    for (const width of [834, 390]) {
      await page.setViewportSize({ width, height: 844 });
      if (width <= 700)
        await page.getByRole('button', { name: 'Expand article notes', exact: true }).click();
      await page.goto(model.url);
      await expect(
        page.getByRole('button', { name: 'Annotate a line', exact: true }),
      ).toBeEnabled();
      await sidebar.locator('summary').click();
      const outlineTab = sidebar.getByRole('tab', { name: 'Outline', exact: true });
      await outlineTab.focus();
      await outlineTab.press('ArrowRight');
      await expect(sidebar.getByRole('tab', { name: /^Annotations/ })).toBeFocused();
      await expect(sideRows).toHaveCount(3);
      await expect(sideRows.first().locator('.annotation-position')).toContainText(
        width === 390 ? 'Lines' : 'Line',
      );
      await shot(page, `annotation-sidebar-${width}`);
      await sideRows.first().click();
      await expect(sidebar.locator('details')).not.toHaveAttribute('open');
      await expect(popup.locator('[data-line-quote]')).toHaveText(firstQuote);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await popup.getByRole('button', { name: 'Close annotation', exact: true }).click();
    }
  } finally {
    await page.close();
    await model.restore();
  }
});

test('existing annotations keep counted edge badges without hover, group shared lines, and retain accessible focus', async ({
  page,
  request,
}) => {
  const model = await fixture(request);
  const loads = await provider(page);
  try {
    await page.goto(model.url);
    await expect(page.getByRole('button', { name: 'Annotate a line', exact: true })).toBeEnabled();
    const first = (await (
      await hoverText(page, 'A first line')
    ).getAttribute('data-line-reference'))!;
    const second = (await (
      await hoverText(page, 'A second line')
    ).getAttribute('data-line-reference'))!;
    const third = (await (
      await hoverText(page, 'An independently')
    ).getAttribute('data-line-reference'))!;
    const overlapStart = firstQuote.indexOf('code');
    const overlapping = first.replace(/-\d+-\d+$/, `-${overlapStart}-${overlapStart + 4}`);
    let calls = 0;
    await page.route('**/api/annotations/*', (route) => {
      calls++;
      return route.fulfill({
        json: {
          checkedAt: '2026-10-19T00:00:00Z',
          nextPage: null,
          items: [
            {
              fragment: first,
              quote: firstQuote,
              url: 'https://github.com/example/notebook/discussions/51',
              comments: 3,
              replies: 2,
            },
            {
              fragment: overlapping,
              quote: 'code',
              url: 'https://github.com/example/notebook/discussions/54',
              comments: 1,
              replies: 1,
            },
            {
              fragment: second,
              quote: secondQuote,
              url: 'https://github.com/example/notebook/discussions/52',
            },
            {
              fragment: third,
              quote: 'An independently addressable paragraph.',
              url: 'https://github.com/example/notebook/discussions/55',
              comments: 0,
              replies: 0,
            },
          ],
        },
      });
    });
    await page.reload();
    const paragraph = page.locator('.article-body p').filter({ hasText: 'A first line' }).first();
    const scrollToFirst = async () => {
      await paragraph.evaluate((node) =>
        scrollTo({ top: scrollY + node.getBoundingClientRect().top - 210, behavior: 'instant' }),
      );
      await page.mouse.move(2, 2);
    };
    await scrollToFirst();
    const badge = page.locator(`[data-line-annotation-badge="${first}"]`);
    const unknown = page.locator(`[data-line-annotation-badge="${second}"]`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('data-annotation-threads', '2');
    await expect(badge.locator('[data-line-annotation-count]')).toHaveText('7');
    await expect(badge).toHaveAccessibleName(/4 comments and 3 replies/);
    await expect(unknown.locator('[data-line-annotation-count]')).toHaveText('…');
    expect(calls).toBe(1);
    expect(loads).toHaveLength(0);
    await expect(page.locator('[data-line-trigger]')).not.toBeVisible();
    await expect
      .poll(async () => {
        const center = await paragraph.evaluate((node) => {
          const range = document.createRange();
          range.setStart(node.firstChild!, 0);
          range.setEnd(node.firstChild!, 1);
          const rect = range.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
        const box = await badge.boundingBox();
        return box ? Math.abs(box.y + box.height / 2 - center) : Infinity;
      })
      .toBeLessThan(3);
    await shot(page, 'annotation-counted-badges-desktop');
    await badge.focus();
    await badge.press('Enter');
    const popup = page.getByRole('dialog', { name: 'Line annotation', exact: true });
    await expect(popup.locator('[data-line-quote]')).toHaveText(firstQuote);
    await expect(popup.locator('giscus-widget')).toHaveAttribute('mapping', 'number');
    await expect(popup.locator('giscus-widget')).toHaveAttribute('term', '51');
    await popup
      .getByRole('combobox', { name: 'Annotations on this line', exact: true })
      .selectOption(overlapping);
    await expect(popup.locator('[data-line-quote]')).toHaveText('code');
    await expect(popup.locator('giscus-widget')).toHaveAttribute('term', '54');
    await popup
      .getByRole('combobox', { name: 'Annotations on this line', exact: true })
      .selectOption(first);
    await popup
      .frameLocator('iframe')
      .locator('body')
      .evaluate(() =>
        parent.postMessage(
          {
            giscus: {
              discussion: {
                url: 'https://github.com/example/notebook/discussions/51',
                totalCommentCount: 4,
                totalReplyCount: 3,
                reactionCount: 0,
              },
            },
          },
          '*',
        ),
      );
    await expect(badge.locator('[data-line-annotation-count]')).toHaveText('9');
    await expect(badge).toHaveAccessibleName(/5 comments and 4 replies/);
    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible();
    await expect(badge).toBeFocused();
    await page.mouse.move(2, 2);
    await expect(badge).toBeVisible();
    const zeroParagraph = page
      .locator('.article-body p')
      .filter({ hasText: 'An independently addressable paragraph.' });
    await zeroParagraph.evaluate((node) =>
      scrollTo({ top: scrollY + node.getBoundingClientRect().top - 220, behavior: 'instant' }),
    );
    const zero = page.locator(`[data-line-annotation-badge="${third}"]`);
    await expect(zero).toBeVisible();
    await expect(zero.locator('[data-line-annotation-count]')).toHaveText('0');
    for (const width of [834, 390]) {
      await page.setViewportSize({ width, height: 844 });
      if (width <= 700)
        await page.getByRole('button', { name: 'Expand article notes', exact: true }).click();
      await scrollToFirst();
      await expect(badge).toBeVisible();
      const rect = (await badge.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await badge.click();
      await expect(popup.locator('[data-line-quote]')).toHaveText(firstQuote);
      await popup.getByRole('button', { name: 'Close annotation', exact: true }).click();
      await expect(badge).toBeFocused();
    }
    await page.locator('html').evaluate((node) => {
      node.dataset.theme = 'dark';
      node.dataset.reduceMotion = 'true';
      node.dataset.reduceTransparency = 'true';
    });
    await expect(badge).toHaveCSS('backdrop-filter', 'none');
    await shot(page, 'annotation-counted-badges-mobile-dark');
    const audit = await new AxeBuilder({ page }).include('.line-annotation-rail').analyze();
    expect(
      audit.violations.filter((violation) =>
        ['serious', 'critical'].includes(violation.impact || ''),
      ),
    ).toEqual([]);
    await expect(page.locator('.line-discussion-highlight')).toHaveCount(0);
  } finally {
    await page.close();
    await model.restore();
  }
});
