import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type FrameLocator,
} from '@playwright/test';
import { promises as fs } from 'node:fs';

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
    .poll(
      async () => (await session(request)).jobs.find((item: any) => item.id === job.id)?.state,
      { timeout: 20000 },
    )
    .toBe('succeeded');
}
async function restore(request: APIRequestContext, model: any, entryId?: string) {
  let now = await session(request);
  if (entryId) {
    const entry = now.entries.find((item: any) => item.id === entryId);
    if (entry) await mutate(request, `content/${entryId}`, 'DELETE', { revision: entry.revision });
  }
  now = await session(request);
  await mutate(request, 'site', 'PUT', { value: model.site, revision: now.siteRevision });
  await mutate(request, 'pages/about', 'PUT', {
    body: model.about.body,
    revision: now.about.revision,
  });
  await build(request);
}
async function shot(page: Page, name: string) {
  await page.waitForFunction(() => !document.documentElement.matches(':active-view-transition'));
  if (await page.locator('.site-main').count())
    await expect
      .poll(() =>
        page.locator('html').evaluate((node) => getComputedStyle(node, '::before').opacity),
      )
      .toBe('0');
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-${name}.png`,
    fullPage: false,
  });
}
const commentsFor = (model: any, extra = {}) => ({
  ...model.site.integrations.comments,
  enabled: true,
  repo: 'example/notebook',
  repoId: 'R_test',
  categoryId: 'DIC_test',
  onDemand: true,
  theme: 'site',
  language: 'auto',
  ...extra,
});
const longStory = () =>
  Array.from(
    { length: 45 },
    (_, index) =>
      `## Passage ${index + 1}\n\nReading marker ${index + 1}. A paragraph about careful observation, patient experiments, and keeping a useful record of what changes. Good writing gives an idea enough room to develop, and leaves the reader a place to return.\n\n${index === 4 ? '![A coastline](/media/coast-dawn.svg)\n\n' : ''}${index === 8 ? '$$\nE=mc^2\n$$\n\n' : ''}`,
  ).join('');
async function placePassage(frame: FrameLocator, name = 'Passage 30') {
  const heading = frame.getByRole('heading', { name, exact: true });
  await heading.evaluate((node) =>
    window.scrollTo({ top: scrollY + node.getBoundingClientRect().top - 125, behavior: 'instant' }),
  );
  await expect
    .poll(() => heading.evaluate((node) => Math.abs(node.getBoundingClientRect().top - 125)))
    .toBeLessThan(2);
}
async function atPassage(frame: FrameLocator, name = 'Passage 30') {
  await expect
    .poll(() =>
      frame
        .getByRole('heading', { name, exact: true })
        .evaluate((node) => Math.abs(node.getBoundingClientRect().top - 125)),
    )
    .toBeLessThan(4);
}
async function addAt(page: Page, side: 'start' | 'end', text: string) {
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await source.focus();
  await source.press('ControlOrMeta+a');
  await source.press(side === 'start' ? 'ArrowLeft' : 'ArrowRight');
  await page.keyboard.insertText(text);
}

test('About owns profile and guestbook controls, previews drafts, and flushes them before Build', async ({
  page,
  request,
}) => {
  const original = await session(request);
  try {
    await mutate(request, 'site', 'PUT', {
      value: {
        ...original.site,
        profile: {
          ...original.site.profile,
          affiliations: [
            {
              name: 'Institute for Thoughtful Design and Independent Research',
              description: 'Writing, visual experiments, and open learning',
            },
            { name: 'Open notebooks', description: '' },
          ],
        },
        integrations: { ...original.site.integrations, comments: commentsFor(original) },
      },
      revision: original.siteRevision,
    });
    let providerLoads = 0;
    await page.route('https://giscus.app/**', (route) => {
      providerLoads++;
      return route.abort();
    });
    await page.goto('/studio/#about');
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('# A story worth keeping\n\nOne continuous story, in my own words.');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.getByLabel('Short biography', { exact: true })).toHaveCount(0);
    await page.getByLabel('Your name', { exact: true }).fill('About workspace writer');
    await page.getByLabel('Location', { exact: true }).fill('A quiet corner');
    await page.getByLabel('Your name', { exact: true }).press('ControlOrMeta+s');
    await expect
      .poll(async () => (await session(request)).site.profile.name)
      .toBe('About workspace writer');
    await page.getByLabel('Location', { exact: true }).fill('A quiet corner, saved before Build');
    await expect(
      page
        .frameLocator('iframe[title="About preview"]')
        .getByRole('heading', { name: 'About workspace writer', exact: true }),
    ).toBeVisible();
    await shot(page, 'about-profile-studio');
    await page.getByRole('button', { name: 'Guestbook', exact: true }).click();
    const toggle = page.getByRole('switch', { name: 'Show guestbook on About', exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.getByLabel('Guestbook title', { exact: true }).fill('A note before you go');
    const frame = page.frameLocator('iframe[title="About preview"]');
    await expect(
      frame.getByRole('heading', { name: 'A note before you go', exact: true }),
    ).toBeVisible();
    await expect(
      frame.getByRole('button', { name: 'Load discussion', exact: true }),
    ).toBeDisabled();
    expect(providerLoads).toBe(0);
    const beforeJobs = (await session(request)).jobs.map((item: any) => item.id);
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await session(request)).jobs.find((item: any) => !beforeJobs.includes(item.id))?.state,
        { timeout: 20000 },
      )
      .toBe('succeeded');
    const saved = await session(request);
    expect(saved.site.profile.name).toBe('About workspace writer');
    expect(saved.about.body).toContain('One continuous story');
    expect(saved.site.about.guestbook.enabled).toBe(true);
    expect(saved.site.integrations.comments.repoId).toBe('R_test');
    await page.goto('/about/');
    await expect(page.locator('main h1')).toHaveText('About workspace writer');
    await expect(page.locator('.about-introduction > .about-affiliations')).toHaveCount(1);
    await expect(page.locator('.about-affiliations li')).toHaveCount(2);
    await expect(page.locator('.about-page > .about-affiliations')).toHaveCount(0);
    await expect(page.locator('.article-body.reading-surface')).toHaveCount(1);
    await expect(page.locator('[data-comments]')).toHaveAttribute(
      'data-comment-term',
      'page/about/guestbook',
    );
    const links = page.getByRole('navigation', { name: 'Find me elsewhere', exact: true });
    for (const link of await links.locator('a').all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    if (original.site.profile.links.some((link: any) => /github.com/.test(link.href)))
      await expect(links.locator('.lucide-github')).toBeVisible();
    for (const width of [1440, 834, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
      ).toBe(true);
      await shot(page, `about-public-${width}`);
    }
    await page.locator('html').evaluate((node) => (node.dataset.theme = 'dark'));
    await shot(page, 'about-public-mobile-dark');
    await page.goto('/studio/#settings');
    await expect(
      page.locator('.settings-tabs').getByRole('button', { name: 'Profile', exact: true }),
    ).toHaveCount(0);
  } finally {
    await page.close();
    await restore(request, original);
  }
});

test('About preserves both drafts through independent conflicts and reports a partial save', async ({
  page,
  request,
}) => {
  const original = await session(request);
  try {
    await page.goto('/studio/#about');
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('# The preserved story\n\nMy text stays here.');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByLabel('Your name', { exact: true }).fill('My unsaved profile');
    let now = await session(request);
    await mutate(request, 'site', 'PUT', {
      value: { ...now.site, profile: { ...now.site.profile, role: 'An external profile change' } },
      revision: now.siteRevision,
    });
    await expect(
      page.getByText(
        'Profile or guestbook settings changed outside Studio. Your changes are preserved.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('My unsaved profile');
    await page
      .getByRole('button', { name: 'Reload latest profile and guestbook', exact: true })
      .click();
    await page.getByRole('button', { name: 'Story', exact: true }).click();
    await expect(source).toContainText('My text stays here.');
    await page.getByRole('button', { name: 'Save About', exact: true }).click();
    await expect
      .poll(async () => (await session(request)).about.body)
      .toContain('My text stays here.');
    await source.fill('# A second unsaved story\n\nLocal draft.');
    now = await session(request);
    await mutate(request, 'pages/about', 'PUT', {
      body: '# Changed outside\n\nExternal story.',
      revision: now.about.revision,
    });
    await expect(
      page.getByText('About changed outside Studio. Your text is preserved.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByLabel('Location', { exact: true }).fill('My retained location');
    await page.getByRole('button', { name: 'Reload latest About', exact: true }).click();
    await expect(page.getByLabel('Location', { exact: true })).toHaveValue('My retained location');
    await page.getByRole('button', { name: 'Story', exact: true }).click();
    await expect(source).toContainText('External story.');
    await source.fill('# Saved before a profile failure\n\nThis part succeeds.');
    await page.route('**/api/site', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Controlled profile conflict' }),
          })
        : route.continue(),
    );
    await page.getByRole('button', { name: 'Save About', exact: true }).click();
    await expect(
      page.getByText(/Profile and guestbook: Controlled profile conflict/),
    ).toBeVisible();
    expect((await session(request)).about.body).toContain('This part succeeds.');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.getByLabel('Location', { exact: true })).toHaveValue('My retained location');
    await page.unroute('**/api/site');
  } finally {
    await page.close();
    await restore(request, original);
  }
});

test('Markdown article preview keeps its passage through edits, modes, resize, failures, and optional following', async ({
  page,
  request,
}) => {
  test.setTimeout(75000);
  const original = await session(request);
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Preview anchor fixture',
    slug: `preview-anchor-${test.info().project.name}`,
  });
  try {
    await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: entry,
      body: longStory(),
      revision: entry.revision,
    });
    await page.goto('/studio/#writing');
    await page
      .getByRole('button', { name: /Preview anchor fixture/ })
      .first()
      .click();
    const iframe = page.locator('iframe[title="Live article preview"]');
    await expect(iframe).toBeVisible();
    const frame = page.frameLocator('iframe[title="Live article preview"]');
    const follow = page.getByRole('button', { name: 'Follow editor', exact: true });
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    await placePassage(frame);
    let previous = await iframe.getAttribute('src');
    await addAt(page, 'start', '## A new introduction\n\nAn inserted opening paragraph.\n\n');
    await expect(iframe).not.toHaveAttribute('src', previous!);
    await atPassage(frame);
    previous = await iframe.getAttribute('src');
    await addAt(page, 'end', '\n\nA newly appended ending.');
    await expect(iframe).not.toHaveAttribute('src', previous!);
    await atPassage(frame);
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(iframe).toBeVisible();
    await atPassage(frame);
    await page.getByRole('button', { name: 'Mobile preview', exact: true }).click();
    await expect(frame.getByRole('heading', { name: 'Passage 30', exact: true })).toBeInViewport();
    expect(await frame.locator('html').evaluate(() => scrollY)).toBeGreaterThan(1000);
    await page.getByRole('button', { name: 'Desktop preview', exact: true }).click();
    await placePassage(frame);
    previous = await iframe.getAttribute('src');
    await page.route('**/api/preview', async (route) => {
      if (route.request().postData()?.includes('Controlled preview failure'))
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Controlled render failure' }),
        });
      else await route.continue();
    });
    await addAt(page, 'end', '\n\nControlled preview failure');
    await expect(page.locator('.preview-pane .error-message')).toContainText(
      'Controlled render failure',
    );
    await expect(iframe).toHaveAttribute('src', previous!);
    await atPassage(frame);
    await page.unroute('**/api/preview');
    await page.getByRole('button', { name: 'Refresh preview', exact: true }).click();
    await expect(iframe).not.toHaveAttribute('src', previous!);
    await atPassage(frame);
    await follow.click();
    await addAt(page, 'end', '\n\nFollowed ending.');
    await expect(frame.getByText('Followed ending.', { exact: true })).toBeInViewport();
    await shot(page, 'article-preview-follow');
    await follow.click();
    await placePassage(frame);
    await shot(page, 'article-preview-reading-anchor');
  } finally {
    await page.close();
    await restore(request, original, entry.id);
  }
});

test('About preview retains the story passage while profile layout changes', async ({
  page,
  request,
}) => {
  const original = await session(request);
  try {
    await page.goto('/studio/#about');
    await page.getByRole('textbox', { name: 'Markdown source', exact: true }).fill(longStory());
    const iframe = page.locator('iframe[title="About preview"]');
    await expect(iframe).toBeVisible();
    const frame = page.frameLocator('iframe[title="About preview"]');
    await placePassage(frame);
    const previous = await iframe.getAttribute('src');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page
      .getByLabel(/^Profile headline/)
      .fill('A longer introduction\nWith another line\nAnd a third line for the new header.');
    await expect(iframe).not.toHaveAttribute('src', previous!);
    await atPassage(frame);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(iframe).toBeVisible();
    await expect(frame.getByRole('heading', { name: 'Passage 30', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    await shot(page, 'about-preview-mobile-anchor');
  } finally {
    await page.close();
    await restore(request, original);
  }
});

test('Giscus setup checks categories and imports supported settings without executing snippets', async ({
  page,
  request,
}) => {
  const original = await session(request);
  try {
    await page.goto('/studio/#settings');
    await page.locator('.settings-section-rail a[href="#settings/discussions"]').click();
    await page.getByLabel('GitHub repository', { exact: true }).fill('example/notebook');
    await page.getByLabel('Repository ID', { exact: true }).fill('R_wrong');
    await page.getByLabel('Category ID', { exact: true }).fill('DIC_wrong');
    await page.getByRole('button', { name: 'Check configuration', exact: true }).click();
    await expect(
      page.getByText('Repository is available to Giscus', { exact: true }),
    ).toBeVisible();
    await page.getByLabel(/^Verified discussion categories/).selectOption('DIC_notes');
    await expect(page.getByLabel('Repository ID', { exact: true })).toHaveValue('R_test');
    await expect(page.getByLabel('Category ID', { exact: true })).toHaveValue('DIC_notes');
    await page.locator('.giscus-import > summary').click();
    await page
      .getByLabel(/^Giscus configuration snippet/)
      .fill(
        '<script src="https://giscus.app/client.js" data-repo="example/notebook" data-repo-id="R_test" data-category-id="DIC_test" data-category="General" data-lang="zh-CN" data-input-position="bottom" data-reactions-enabled="0">window.__unsafeSnippet = true</script>',
      );
    await page.getByRole('button', { name: 'Apply embed settings', exact: true }).click();
    await expect(page.getByRole('combobox', { name: /^Discussion language/ })).toHaveValue('zh-CN');
    await expect(page.getByRole('combobox', { name: /^Comment box position/ })).toHaveValue(
      'bottom',
    );
    expect(await page.evaluate(() => '__unsafeSnippet' in window)).toBe(false);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect
      .poll(async () => (await session(request)).site.integrations.comments.language)
      .toBe('zh-CN');
    await shot(page, 'discussion-setup-controls');
  } finally {
    await page.close();
    await restore(request, original);
  }
});

test('article and section conversations have isolated messages, counts, links, resizing, and locked states', async ({
  page,
  request,
}) => {
  const original = await session(request);
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'Conversation states fixture',
    slug: `conversation-states-${test.info().project.name}`,
  });
  try {
    await mutate(request, `content/${entry.id}`, 'PUT', {
      metadata: { ...entry, status: 'published' },
      body: ':::discussion[First]{#first comments="true"}\nA first question.\n:::\n\n:::discussion[Second]{#second comments="true"}\nA second question.\n:::',
      revision: entry.revision,
    });
    const now = await session(request);
    await mutate(request, 'site', 'PUT', {
      value: {
        ...now.site,
        integrations: {
          ...now.site.integrations,
          comments: commentsFor(original, { inputPosition: 'bottom', language: 'zh-CN' }),
        },
      },
      revision: now.siteRevision,
    });
    await build(request);
    await page.route('https://giscus.app/**', (route) => {
      const term = new URL(route.request().url()).searchParams.get('term')!;
      const first = term.endsWith('/first'),
        second = term.endsWith('/second');
      const payload =
        first || second
          ? {
              discussion: {
                url: `https://github.com/example/notebook/discussions/${first ? 42 : 43}`,
                totalCommentCount: first ? 2 : 7,
                totalReplyCount: 3,
                reactionCount: 4,
                locked: second,
              },
            }
          : { error: 'Discussion not found' };
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body>Conversation fixture<script>parent.postMessage({giscus:{resizeHeight:${first ? 620 : second ? 260 : 380}}},'*');parent.postMessage({giscus:${JSON.stringify(payload)}},'*')</script></body></html>`,
      });
    });
    await page.goto(`/blog/${entry.slug}/`);
    await expect(page.locator('giscus-widget')).toHaveCount(0);
    await page.locator('.article-discussion-jump').click();
    const article = page.locator('#discussion');
    await expect(article).toHaveAttribute('data-discussion-state', 'empty');
    await expect(article.locator('[data-discussion-meta]')).toHaveText(
      '0 comments · 0 replies · 0 reactions',
    );
    const first = page.locator('[data-section-thread="first"]'),
      second = page.locator('[data-section-thread="second"]');
    await first.locator('summary').click();
    await expect(first).toHaveAttribute('data-discussion-state', 'ready');
    await expect(first.locator('[data-comment-link]')).toHaveAttribute(
      'href',
      'https://github.com/example/notebook/discussions/42',
    );
    await second.locator('summary').click();
    await expect(second).toHaveAttribute('data-discussion-state', 'locked');
    await expect(first.locator('iframe')).toHaveCSS('height', '620px');
    await expect(second.locator('iframe')).toHaveCSS('height', '260px');
    await expect(article.locator('iframe')).toHaveCSS('height', '380px');
    for (const mode of ['dark', 'light']) {
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), mode);
      const scheme = await page.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme,
      );
      await expect(article.locator('giscus-widget')).toHaveCSS('color-scheme', scheme);
      await expect(article.locator('iframe')).toHaveCSS('color-scheme', scheme);
      await expect(article.locator('iframe')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    await expect(first.locator('giscus-widget')).toHaveAttribute('inputposition', 'bottom');
    await expect(first.locator('giscus-widget')).toHaveAttribute('lang', 'zh-CN');
    await first
      .frameLocator('iframe')
      .locator('body')
      .evaluate(() =>
        parent.postMessage(
          {
            giscus: { discussion: { totalCommentCount: 11, totalReplyCount: 1, reactionCount: 2 } },
          },
          '*',
        ),
      );
    await expect(first.locator('[data-discussion-meta]')).toHaveText(
      '11 comments · 1 reply · 2 reactions',
    );
    await expect(article.locator('[data-discussion-meta]')).toContainText('0 comments');
    await expect(second.locator('[data-discussion-meta]')).toContainText('7 comments');
    await page.evaluate(() =>
      window.postMessage({ giscus: { discussion: { totalCommentCount: 999 } } }, '*'),
    );
    await expect(first.locator('[data-discussion-meta]')).not.toContainText('999');
    await shot(page, 'section-discussion-states');
  } finally {
    await page.close();
    await restore(request, original, entry.id);
  }
});

test('blocked discussions time out visibly and recover with retry', async ({ page, request }) => {
  const original = await session(request);
  try {
    await mutate(request, 'site', 'PUT', {
      value: {
        ...original.site,
        integrations: { ...original.site.integrations, comments: commentsFor(original) },
      },
      revision: original.siteRevision,
    });
    await build(request);
    let blocked = true;
    await page.route('https://giscus.app/**', (route) =>
      blocked
        ? route.abort()
        : route.fulfill({
            contentType: 'text/html',
            body: '<html><body>Recovered conversation<script>parent.postMessage({giscus:{error:"Discussion not found"}},"*")</script></body></html>',
          }),
    );
    await page.clock.install();
    await page.goto('/blog/good-tools-get-out-of-the-way/');
    await page.locator('.article-discussion-jump').click();
    await expect(page.locator('giscus-widget')).toHaveCount(1);
    await page.clock.fastForward(16000);
    const host = page.locator('#discussion');
    await expect(host).toHaveAttribute('data-discussion-state', 'unavailable');
    await expect(host.locator('[data-comments-status]')).toContainText(
      'taking longer than expected',
    );
    blocked = false;
    await host.getByRole('button', { name: 'Retry discussion', exact: true }).click();
    await expect(host).toHaveAttribute('data-discussion-state', 'empty');
    await expect(host.locator('giscus-widget')).toHaveCount(1);
  } finally {
    await page.close();
    await restore(request, original);
  }
});

test('Giscus custom themes use the active HTTPS origin with a safe fallback for missing CSS', async ({
  page,
  request,
}) => {
  const original = await session(request);
  try {
    await mutate(request, 'site', 'PUT', {
      value: {
        ...original.site,
        url: 'https://example.com',
        theme: { ...original.site.theme, appearance: 'light' },
        integrations: { ...original.site.integrations, comments: commentsFor(original) },
      },
      revision: original.siteRevision,
    });
    await build(request);
    let failStyles = false;
    await page.route('https://active-notebook.test/**', async (route) => {
      const url = new URL(route.request().url());
      if (failStyles && url.pathname.includes('/discussion-'))
        return route.fulfill({ status: 404, body: 'Missing CSS' });
      await route.fulfill({ response: await request.get(url.pathname + url.search) });
    });
    await page.route('https://giscus.app/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html><body>Styled conversation<script>parent.postMessage({giscus:{error:"Discussion not found"}},"*")</script></body></html>',
      }),
    );
    await page.goto('https://active-notebook.test/blog/good-tools-get-out-of-the-way/');
    await page.locator('.article-discussion-jump').click();
    await expect(page.locator('giscus-widget')).toHaveAttribute(
      'theme',
      /^https:\/\/active-notebook\.test\/assets\/themes\/[a-f0-9]{20}\/discussion-light\.css$/,
    );
    await page.locator('html').evaluate((node) => (node.dataset.theme = 'dark'));
    await expect(page.locator('giscus-widget')).toHaveAttribute(
      'theme',
      /^https:\/\/active-notebook\.test\/assets\/themes\/[a-f0-9]{20}\/discussion-dark\.css$/,
    );
    failStyles = true;
    await page.goto('https://active-notebook.test/blog/good-tools-get-out-of-the-way/');
    await page.locator('.article-discussion-jump').click();
    await expect(page.locator('giscus-widget')).toHaveAttribute('theme', 'light');
  } finally {
    await page.close();
    await restore(request, original);
  }
});
