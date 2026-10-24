import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ChangeSet, Text } from '@codemirror/state';
import { siteSchema } from '../src/shared/contracts.js';
import { builtInDiscussionTheme, readGiscusSnippet } from '../src/shared/discussions.js';
import { renderMarkdown } from '../src/engine/markdown.js';
import { Store } from '../src/engine/store.js';
import { createRenderer } from '../src/site/pages.js';
import { checkDiscussionConfiguration, discussionCheckSchema } from '../src/server/discussions.js';
import { createApp } from '../src/server/app.js';
import { translateSourcePosition } from '../src/console/LivePreview.js';

const source = async () =>
  JSON.parse(await fs.readFile('tests/fixtures/notebook/site.json', 'utf8'));
describe('About and discussion contracts', () => {
  it('loads version 1 notebooks without changing profile, provider identifiers, or opt-in behavior', async () => {
    const old = await source();
    delete old.about;
    old.integrations.comments = {
      enabled: true,
      repo: 'example/notebook',
      repoId: 'R_test',
      categoryId: 'DIC_test',
      onDemand: false,
    };
    const parsed = siteSchema.parse(old);
    expect(parsed.profile).toEqual({ ...old.profile, email: '', protectEmailLinks: true });
    const withoutBio = structuredClone(old);
    delete withoutBio.profile.bio;
    expect(siteSchema.parse(withoutBio).profile.bio).toBe('');
    expect(parsed.about.guestbook.enabled).toBe(false);
    expect(parsed.integrations.comments).toMatchObject({
      repoId: 'R_test',
      onDemand: false,
      language: 'auto',
      theme: 'site',
      inputPosition: 'top',
      showMetadata: true,
    });
    expect(builtInDiscussionTheme(parsed.integrations.comments, false)).toBe('light');
    expect(builtInDiscussionTheme(parsed.integrations.comments, true)).toBe('transparent_dark');
  });
  it('adopts a matching name heading without rewriting the story, retains anchors, and keeps source maps private', async () => {
    const body =
      '# Writer\n\n## My work\n\nA little prose.\n\n```js\nconst x = 1;\n```\n\n$$\nx^2\n$$\n';
    const preview = await renderMarkdown(body, { aboutName: 'Writer', preview: true });
    expect(preview.titleAnchor).toBe('writer');
    expect(preview.titleRange).toEqual([0, 8]);
    expect(preview.html).not.toContain('<h1');
    expect(preview.html).toContain('<h3 id="my-work"');
    expect(preview.html).toContain(`data-source-start="${body.indexOf('## My work')}"`);
    expect(preview.html).toContain(`data-source-start="${body.indexOf('```js')}"`);
    expect(preview.html).toContain(`data-source-start="${body.indexOf('$$')}"`);
    const published = await renderMarkdown(body, { aboutName: 'Writer' });
    expect(published.html).not.toContain('data-source-');
    const authored = await renderMarkdown('# A different title\n\nMy story.', {
      aboutName: 'Writer',
    });
    expect(authored.titleAnchor).toBeUndefined();
    expect(authored.html).toContain('<h2 id="a-different-title"');
    const forged = await renderMarkdown('<p data-source-start="999999">Text</p>', {
      preview: true,
    });
    expect(forged.html).not.toContain('data-source-start="999999"');
  });
  it('imports only supported Giscus attributes and preserves established mappings', () => {
    const patch = readGiscusSnippet(
      '<script src="https://giscus.app/client.js" data-repo="example/notebook" data-repo-id="R_test" data-category-id="DIC_test" data-mapping="title" data-reactions-enabled="0" data-lang="zh-CN" data-input-position="bottom" data-theme="https://elsewhere.test/style.css" onclick="bad()"></script>',
    );
    expect(patch).toEqual({
      enabled: true,
      repo: 'example/notebook',
      repoId: 'R_test',
      categoryId: 'DIC_test',
      reactions: false,
      language: 'zh-CN',
      inputPosition: 'bottom',
    });
    expect(
      readGiscusSnippet(
        '<giscus-widget repo="example/notebook" repoid="R_test" categoryid="DIC_test" theme="dark_dimmed"></giscus-widget>',
      ).theme,
    ).toBe('dark_dimmed');
    expect(() => readGiscusSnippet('<script src="https://other.test/embed.js"></script>')).toThrow(
      /not a Giscus/,
    );
    expect(() => readGiscusSnippet('<script src="https://giscus.app/client.js"></script>')).toThrow(
      /repository/,
    );
  });
  it('keeps About guestbooks optional and previews isolated, with genuine social marks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-about-contract-'));
    try {
      await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
      const model = await new Store(root).read();
      model.site.profile.name = 'Writer';
      model.site.profile.links = [
        { label: 'GitHub', href: 'https://github.com/example' },
        { label: 'Email', href: 'mailto:writer@example.org' },
      ];
      model.about.body = '# Writer\n\nA continuous story.';
      model.site.profile.bio =
        'Retired short biography.\n\n```mermaid\ninvalid retired diagram\n```';
      model.site.integrations.comments = {
        ...model.site.integrations.comments,
        enabled: true,
        repo: 'example/notebook',
        repoId: 'R_test',
        categoryId: 'DIC_test',
      };
      expect((await createRenderer(model)).render('/about/')).not.toContain('id="about-guestbook"');
      model.site.about.guestbook.enabled = true;
      const publicPage = (await createRenderer(model)).render('/about/');
      expect(publicPage).toContain(`<meta name="description" content="${model.site.description}"`);
      expect(publicPage).not.toContain('Retired short biography');
      expect(publicPage).toContain('data-comment-term="page/about/guestbook"');
      expect(publicPage).toContain('lucide-github');
      expect(publicPage).toContain('lucide-mail');
      expect(publicPage.match(/<h1\b/g)).toHaveLength(1);
      expect(publicPage).not.toContain('data-source-');
      const preview = (await createRenderer(model, { preview: true })).render('/about/');
      expect(preview).toContain('data-preview="true"');
      expect(preview).toMatch(/data-load-comments="[^"]*" disabled=""/);
      expect(preview).toContain('data-source-start=');
      model.site.integrations.comments.enabled = false;
      expect((await createRenderer(model)).render('/about/')).not.toContain('data-comments=');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
describe('Giscus configuration checks', () => {
  it('uses a fixed read-only provider endpoint and returns verified categories with identifier mismatches', async () => {
    const request: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://giscus.app/api/discussions/categories');
      expect(url.searchParams.get('repo')).toBe('example/notebook');
      expect(init?.method).toBeUndefined();
      expect(init?.redirect).toBe('error');
      expect(init?.headers).toEqual({ Accept: 'application/json' });
      return Response.json({
        repositoryId: 'R_test',
        categories: [{ id: 'DIC_test', name: 'General', emoji: '💬' }],
      });
    };
    const valid = await checkDiscussionConfiguration(
      { repo: 'example/notebook', repoId: 'R_test', categoryId: 'DIC_test' },
      request,
    );
    expect(valid.status).toBe('ready');
    const invalid = await checkDiscussionConfiguration(
      { repo: 'example/notebook', repoId: 'R_other', categoryId: 'DIC_other' },
      request,
    );
    expect(invalid.status).toBe('invalid');
    expect(invalid.issues).toHaveLength(2);
    expect(invalid.categories).toHaveLength(1);
    expect(() => discussionCheckSchema.parse({ repo: 'https://private.test/' })).toThrow();
    const unavailable = await checkDiscussionConfiguration(
      { repo: 'example/notebook', repoId: '', categoryId: '' },
      async () => {
        throw new Error('Offline');
      },
    );
    expect(unavailable.status).toBe('unreachable');
  });
  it('protects checks with the Studio token and never saves draft configuration', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-giscus-check-'));
    await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
    const context = await createApp(root, {
      watchFiles: false,
      discussionFetch: async () =>
        Response.json({
          repositoryId: 'R_test',
          categories: [{ id: 'DIC_test', name: 'General' }],
        }),
    });
    try {
      const before = await fs.readFile(path.join(root, 'content/site.json'), 'utf8');
      const bootstrap = await (await context.app.request('http://localhost/api/bootstrap')).json();
      const body = JSON.stringify({ repo: 'example/notebook', repoId: '', categoryId: '' });
      const denied = await context.app.request('http://localhost/api/integrations/giscus/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(denied.status).toBe(403);
      const allowed = await context.app.request('http://localhost/api/integrations/giscus/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Studio-Token': bootstrap.token,
          Origin: 'http://localhost',
        },
        body,
      });
      expect(allowed.status).toBe(200);
      expect((await allowed.json()).repositoryId).toBe('R_test');
      const previewBody = JSON.stringify({ theme: bootstrap.site.theme, mode: 'dark' });
      const previewDenied = await context.app.request(
        'http://localhost/api/integrations/giscus/theme-preview',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: previewBody,
        },
      );
      expect(previewDenied.status).toBe(403);
      const preview = await context.app.request(
        'http://localhost/api/integrations/giscus/theme-preview',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Studio-Token': bootstrap.token,
            Origin: 'http://localhost',
          },
          body: previewBody,
        },
      );
      expect(preview.status).toBe(200);
      const { html } = await preview.json();
      expect(html).toContain('color-scheme:dark');
      expect(html).toContain('gsc-comment-box-textarea');
      expect(html).toContain("default-src 'none'");
      expect(html).not.toContain('<script src=');
      expect(await fs.readFile(path.join(root, 'content/site.json'), 'utf8')).toBe(before);
    } finally {
      context.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
it('maps the preview anchor through successive edits and external restores', () => {
  const from = 'First paragraph\n\nReading here\n\nLast paragraph';
  const insert = ChangeSet.of({ from: 0, insert: 'An introduction.\n\n' }, from.length);
  const middle = insert.apply(Text.of(from.split('\n'))).toString();
  const revision = ChangeSet.of(
    [
      {
        from: middle.indexOf('First paragraph'),
        to: middle.indexOf('Reading here'),
        insert: 'A shorter opening.\n\n',
      },
      { from: middle.length, insert: '\n\nA new ending.' },
    ],
    middle.length,
  );
  const target = revision.apply(Text.of(middle.split('\n'))).toString();
  expect(
    translateSourcePosition(from, target, from.indexOf('Reading here'), [
      { before: from, after: middle, changes: insert.desc },
      { before: middle, after: target, changes: revision.desc },
    ]),
  ).toBe(target.indexOf('Reading here'));
  expect(translateSourcePosition(from, middle, from.indexOf('Reading here'), [])).toBe(
    middle.indexOf('Reading here'),
  );
  expect(translateSourcePosition(from, 'Short', from.length, [])).toBe(5);
});
