import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { Store, contained, ConflictError } from '../src/engine/store.js';
import {
  entrySchema,
  siteSchema,
  chronologicalEntries,
  routeFor,
  type BuildResult,
} from '../src/shared/contracts.js';
import { renderMarkdown } from '../src/engine/markdown.js';
import { buildSite } from '../src/engine/build.js';
import { renderInteractive } from '../src/shared/interactives.js';
import { lensPixels } from '../src/shared/liquid-glass.js';
import { createApp } from '../src/server/app.js';
import {
  deployArtifact,
  JobService,
  parseCommandJson,
  type Runner,
} from '../src/server/publishing.js';

let root: string, store: Store, assets: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-test-'));
  store = new Store(root);
  await fs.cp(path.join(process.cwd(), 'tests/fixtures/notebook'), path.join(root, 'content'), {
    recursive: true,
  });
  assets = path.join(root, 'asset-fixture');
  await fs.mkdir(assets);
  for (const name of ['site.js', 'appearance.js', 'site.css', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, name), '/* isolated fixture */');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('source contracts and persistence', () => {
  it('keeps a lens center neutral, bends opposing edges in opposite directions, and bounds texture size', () => {
    const lens = lensPixels(400, 200, 30);
    const pixel = (x: number, y: number) => [
      ...lens.pixels.slice((y * lens.width + x) * 4, (y * lens.width + x) * 4 + 4),
    ];
    expect(pixel(200, 100)).toEqual([128, 128, 0, 255]);
    expect(pixel(1, 100)[0]).toBeLessThan(128);
    expect(pixel(398, 100)[0]).toBeGreaterThan(128);
    expect(pixel(200, 1)[1]).toBeLessThan(128);
    expect(pixel(200, 198)[1]).toBeGreaterThan(128);
    expect(lensPixels(2400, 1200, 60).width).toBe(640);
  });
  it('normalizes retired News settings to Archive while preserving the current appearance', async () => {
    const model = await store.read();
    const legacy = {
      ...model.site,
      homeSections: ['blog', 'lab', 'life', 'news'],
      navigation: [{ label: 'News', href: '/news/' }],
    };
    const normalized = siteSchema.parse(legacy);
    expect(normalized.theme).toEqual(model.site.theme);
    expect(normalized.homeSections).toEqual(['blog', 'lab', 'life', 'archive']);
    expect(normalized.navigation).toEqual([{ label: 'Archive', href: '/archive/' }]);
  });
  it('orders the archive across years and excludes drafts without mutating the source', async () => {
    const entry = (await store.read()).entries[0];
    const entries = [
      { ...entry, id: 'old', publishedAt: '2024-09-01', status: 'published' as const },
      { ...entry, id: 'draft', publishedAt: '2027-01-01', status: 'draft' as const },
      { ...entry, id: 'new', publishedAt: '2026-10-19', status: 'published' as const },
    ];
    expect(chronologicalEntries(entries).map((item) => item.id)).toEqual(['new', 'old']);
    expect(entries.map((item) => item.id)).toEqual(['old', 'draft', 'new']);
  });
  it('accepts Chinese slugs and rejects invalid dates and path-like slugs', () => {
    const value = { id: 'a', title: 'An idea', slug: '纸上的想法', publishedAt: '2026-10-19' };
    expect(entrySchema.parse(value).status).toBe('draft');
    expect(() => entrySchema.parse({ ...value, publishedAt: '2026-02-30' })).toThrow();
    expect(() => entrySchema.parse({ ...value, slug: '../../private' })).toThrow();
  });
  it('saves canonical Markdown, preserves identity across slug changes, and rejects a stale writer', async () => {
    const model = await store.read(),
      entry = model.entries[0];
    const metadata = { ...entry, slug: 'a-new-url' };
    const saved = await store.saveEntry(entry.id, {
      metadata,
      body: 'A new thought.',
      revision: entry.revision,
    });
    expect(saved.id).toBe(entry.id);
    expect(saved.slug).toBe('a-new-url');
    expect(saved.body.trim()).toBe('A new thought.');
    await expect(
      store.saveEntry(entry.id, { metadata, body: 'An older thought.', revision: entry.revision }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await store.read()).entries.find((e) => e.id === entry.id)?.body.trim()).toBe(
      'A new thought.',
    );
  });
  it('moves content to recoverable Trash and restores the same source', async () => {
    const entry = (await store.read()).entries[0];
    await store.trash(entry.id, entry.revision);
    expect((await store.read()).entries.some((e) => e.id === entry.id)).toBe(false);
    expect((await store.listTrash())[0].title).toBe(entry.title);
    await store.restore(entry.id);
    expect((await store.read()).entries.find((e) => e.id === entry.id)?.body).toBe(entry.body);
  });
  it('round-trips leading Markdown indentation and intentional blank lines', async () => {
    const entry = (await store.read()).entries[0],
      body = '\n\n    an indented code block\n';
    await store.saveEntry(entry.id, { metadata: entry, body, revision: entry.revision });
    expect((await store.read()).entries.find((e) => e.id === entry.id)!.body).toBe(body);
  });
  it('restores a removed collection record through the undo chain', async () => {
    const original = await store.read();
    const changed = { ...original.library, photos: original.library.photos.slice(1) };
    const saved = await store.saveJson('library', changed, original.libraryRevision);
    expect((await store.read()).library.photos).toHaveLength(original.library.photos.length - 1);
    const undo = await store.undoLibrary(saved.revision);
    expect(undo.value).toEqual(original.library);
  });
  it('rejects duplicate content routes when reading source', async () => {
    const entry = (await store.read()).entries.find((e) => e.kind === 'posts')!;
    const raw = await fs.readFile(path.join(root, 'content/posts', entry.file), 'utf8');
    await fs.writeFile(
      path.join(root, 'content/posts/duplicate.md'),
      raw.replace(entry.id, 'different-identity'),
    );
    await expect(store.read()).rejects.toThrow('Duplicate route');
  });
  it('constrains traversal and symbolic links to the chosen collection', async () => {
    const base = path.join(root, 'content/media');
    await expect(contained(base, '../../site.json')).rejects.toThrow('Invalid project path');
    await fs.symlink(path.join(root, 'content/site.json'), path.join(base, 'outside.json'));
    await expect(contained(base, 'outside.json')).rejects.toThrow('Symbolic link');
  });
  it('executes the skill-documented scaffolding command in an isolated notebook', async () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/cli.ts',
        'new',
        'posts',
        'a-skill-example',
        'A skill example',
        '--root',
        root,
      ],
      { cwd: process.cwd(), env: { ...process.env, BLOG_ROOT: root }, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const entry = (await store.read()).entries.find((e) => e.slug === 'a-skill-example');
    expect(entry?.title).toBe('A skill example');
    expect(entry?.status).toBe('draft');
  });
});
describe('Markdown, equations, and registered components', () => {
  it('keeps Markdown in one continuous flow around interactive content', async () => {
    const source =
      '## Start\n\nA readable $x^2$.\n\n```interactive\n{"type":"function-plot","title":"Try a wave"}\n```\n\n## Finish\n\nA quieter paragraph.';
    const article = await renderMarkdown(source);
    expect(article.html).not.toContain('reading-segment');
    expect(article.html).not.toContain('reading-surface');
    expect(article.html.indexOf('id="start"')).toBeLessThan(
      article.html.indexOf('class="interactive-block"'),
    );
    expect(article.html.indexOf('class="interactive-block"')).toBeLessThan(
      article.html.indexOf('id="finish"'),
    );
    expect(article.html).toContain('role="math"');
    expect(article.headings.map((heading) => heading.id)).toEqual(['start', 'finish']);
  });
  it('sanitizes executable HTML while rendering GFM, code, headings and build-time math', async () => {
    const rendered = await renderMarkdown(
      '# Hello\n\n<script>alert(1)</script>\n\n## Same\n\n## Same\n\n$A\\sin(x)$\n\n$$\\frac{1}{3}$$\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```typescript\nconst x = 1;\n```',
    );
    expect(rendered.html).not.toContain('<script');
    expect(rendered.html).toContain('<svg');
    expect(rendered.html).toContain('role="math"');
    expect(rendered.html).toContain('<table>');
    expect(rendered.html).toContain('copy-code');
    expect(rendered.headings.map((h) => h.id)).toEqual(['hello', 'same', 'same-2']);
  });
  it('keeps a diagram source fallback and validates interactive configurations', async () => {
    const result = await renderMarkdown('```mermaid\nflowchart LR\n A --> B\n```');
    expect(result.html).toContain('data-mermaid');
    const fallback = result.html
      .slice(result.html.indexOf('<details class="diagram-source"'))
      .replace(/<[^>]*>/g, '')
      .replace(/&gt;|&#x3e;/gi, '>');
    expect(fallback).toContain('A --> B');
    expect((result.html.match(/data-diagram-rendered="glass-2"/g) || []).length).toBe(2);
    expect(() =>
      renderInteractive({
        type: 'chart',
        labels: ['A', 'B'],
        series: [{ name: 'Data', values: [1] }],
      }),
    ).toThrow();
  });
  it('gives static checklist controls accessible names', async () => {
    const result = await renderMarkdown('- [x] Keep the words readable.\n- [ ] Try the keyboard.');
    expect(result.html).toContain('aria-label="Keep the words readable."');
    expect(result.html).toContain('aria-label="Try the keyboard."');
  });
  it('keeps footnote links and accessible labels connected without adding hidden headings to the outline', async () => {
    const result = await renderMarkdown(
      '## A thought\n\nKeep a note.[^detail]\n\n[^detail]: A supporting detail.',
    );
    expect(result.headings.map((heading) => heading.text)).toEqual(['A thought']);
    const ids = new Set([...result.html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    for (const match of result.html.matchAll(/href="#([^"]+)"/g))
      expect(ids.has(match[1])).toBe(true);
    for (const match of result.html.matchAll(/aria-describedby="([^"]+)"/g))
      expect(ids.has(match[1])).toBe(true);
    expect(result.html).not.toContain('user-content-user-content-');
  });
  it('shares math macros within an article and isolates them between articles and repeated previews', async () => {
    const source =
      '$$\\newcommand{\\scopednotebook}{x^2}\\scopednotebook$$\n\n$$\\scopednotebook+1$$';
    expect((await renderMarkdown(source)).html).toContain('role="math"');
    expect((await renderMarkdown(source)).html).toContain('role="math"');
    await expect(renderMarkdown('$$\\scopednotebook$$')).rejects.toThrow('Invalid equation');
  });
  it('provides meaningful static chart data and both comparison images', () => {
    expect(
      renderInteractive({
        type: 'chart',
        labels: ['A', 'B'],
        series: [{ name: 'Data', values: [1, 2] }],
      }),
    ).toContain('<table>');
    const compare = renderInteractive({
      type: 'image-compare',
      before: '/media/a.webp',
      after: '/media/b.webp',
    });
    expect(compare).toContain('/media/a.webp');
    expect(compare).toContain('/media/b.webp');
  });
});
describe('public build boundaries', () => {
  it('ships a narrowly routed read-only annotation worker with public article IDs only', async () => {
    const model = await store.read();
    model.site.integrations.comments.enabled = true;
    await buildSite(store, { model, assets });
    const config = JSON.parse(
      await fs.readFile(path.join(root, 'dist/assets/annotation-config.json'), 'utf8'),
    );
    expect(config.entries.sort()).toEqual(
      model.entries
        .filter((entry) => entry.status === 'published' && entry.comments)
        .map((entry) => entry.id)
        .sort(),
    );
    expect(await fs.readFile(path.join(root, 'dist/_routes.json'), 'utf8')).toBe(
      JSON.stringify({ version: 1, include: ['/api/annotations/*'], exclude: [] }),
    );
    expect(await fs.stat(path.join(root, 'dist/_worker.js'))).toBeTruthy();
    expect(
      await fs.stat(path.join(root, 'dist/assets/annotations-worker.js')).catch(() => null),
    ).toBeNull();
    model.site.integrations.comments.enabled = false;
    await buildSite(store, { model, assets });
    expect(await fs.stat(path.join(root, 'dist/_worker.js')).catch(() => null)).toBeNull();
    expect(
      await fs.stat(path.join(root, 'dist/assets/annotation-config.json')).catch(() => null),
    ).toBeNull();
  });
  it('validates a selected background picture and copies it even when nothing else references it', async () => {
    const model = await store.read();
    await sharp({ create: { width: 16, height: 16, channels: 3, background: '#203a64' } })
      .png()
      .toFile(path.join(root, 'content/media/background-only.png'));
    const configured = {
      ...model.site,
      theme: { ...model.site.theme, backgroundImage: '/media/background-only.png' },
    };
    await store.saveJson('site', configured, model.siteRevision);
    await buildSite(store, { assets });
    expect(
      await fs
        .stat(path.join(root, 'dist/media/background-only.png'))
        .then((file) => file.isFile()),
    ).toBe(true);
    const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
    expect(html).toContain('data-wallpaper="true"');
    expect(html).toContain('background-only.png');
    expect(() =>
      siteSchema.parse({
        ...configured,
        theme: { ...configured.theme, backgroundImage: '/media/unsafe"){}.png' },
      }),
    ).toThrow();
    expect(() =>
      siteSchema.parse({
        ...configured,
        theme: { ...configured.theme, backgroundImage: '/media/paper.pdf' },
      }),
    ).toThrow();
  });
  it('generates direct HTML routes, feeds, Unicode, math and a real 404 while excluding drafts and Studio', async () => {
    const result = await buildSite(store, { assets });
    expect(result.pages).toBeGreaterThan(15);
    const index = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
    expect(index).toContain('visual-chapters');
    expect(index).not.toContain('home-hero');
    expect(index).toContain('/about/');
    const chinese = await fs.readFile(
      path.join(root, 'dist/blog/把想法留在纸上/index.html'),
      'utf8',
    );
    expect(chinese).toContain('lang="zh"');
    expect(chinese).toContain('<svg');
    const search = await fs.readFile(path.join(root, 'dist/search.json'), 'utf8'),
      feed = await fs.readFile(path.join(root, 'dist/feed.xml'), 'utf8');
    expect(search).not.toContain('A thought in progress');
    expect(feed).not.toContain('A thought in progress');
    expect(index).not.toContain('/studio/');
    const archive = await fs.readFile(path.join(root, 'dist/archive/index.html'), 'utf8');
    expect(archive).not.toContain('A thought in progress');
    for (const entry of chronologicalEntries((await store.read()).entries))
      expect(archive).toContain(routeFor(entry));
    expect(await fs.readFile(path.join(root, 'dist/_redirects'), 'utf8')).toContain(
      '/news/ /archive/ 301',
    );
    expect(await fs.readFile(path.join(root, 'dist/sitemap.xml'), 'utf8')).not.toContain('/news/');
    expect(
      result.manifest.every(
        (file) =>
          !file.startsWith('content/') && !file.includes('site.json') && !file.includes('studio'),
      ),
    ).toBe(true);
    expect(await fs.readFile(path.join(root, 'dist/404.html'), 'utf8')).toContain(
      'A little off the path',
    );
  });
  it('fails missing media without replacing the last accepted output', async () => {
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist/accepted.txt'), 'keep this');
    const model = await store.read();
    model.entries.find((e) => e.status === 'published')!.cover = '/media/absent.webp';
    await expect(buildSite(store, { model, assets })).rejects.toThrow('Missing media');
    expect(await fs.readFile(path.join(root, 'dist/accepted.txt'), 'utf8')).toBe('keep this');
  });
  it('fails broken local links and tag collisions before accepting output', async () => {
    const model = await store.read();
    model.entries.find((e) => e.status === 'published')!.body += '\n[Missing](/does-not-exist/)';
    await expect(buildSite(store, { model, assets })).rejects.toThrow('Broken local link');
    const second = await store.read();
    second.entries.filter((e) => e.status === 'published')[0].tags = ['a b', 'a-b'];
    await expect(buildSite(store, { model: second, assets })).rejects.toThrow('same route');
  });
  it('explains a deleted article link, preserves accepted output, and builds after restoration', async () => {
    const target = (await store.read()).entries.find(
      (entry) => entry.slug === 'a-small-case-for-curiosity',
    )!;
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist/accepted.txt'), 'keep this');
    await store.trash(target.id, target.revision);
    const failure = await buildSite(store, { assets }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain(
      'Broken local link on /blog/component-showcase/: /blog/a-small-case-for-curiosity/',
    );
    expect(message).toContain('posts/component-showcase.md');
    expect(message).toContain('update/remove this link');
    expect(message).toContain('no Pages upload was attempted');
    expect(await fs.readFile(path.join(root, 'dist/accepted.txt'), 'utf8')).toBe('keep this');
    await store.restore(target.id);
    await expect(buildSite(store, { assets })).resolves.toMatchObject({
      pages: expect.any(Number),
    });
    expect(
      await fs.readFile(path.join(root, 'dist/blog/a-small-case-for-curiosity/index.html'), 'utf8'),
    ).toContain(target.title);
  });
  it('identifies a draft destination without generating its private page', async () => {
    const model = await store.read();
    model.entries.find((entry) => entry.slug === 'a-small-case-for-curiosity')!.status = 'draft';
    const failure = await buildSite(store, { model, assets }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      'is draft; only published entries generate public pages',
    );
    expect((failure as Error).message).toContain(
      'Publish it when ready, or update/remove this link',
    );
    expect(
      await fs
        .stat(path.join(root, 'dist/blog/a-small-case-for-curiosity/index.html'))
        .catch(() => null),
    ).toBeNull();
  });
  it('copies only referenced media and creates raster variants without upscaling', async () => {
    await fs.writeFile(path.join(root, 'content/media/private-unused.txt'), 'private');
    await sharp({ create: { width: 200, height: 100, channels: 3, background: '#abcdef' } })
      .png()
      .toFile(path.join(root, 'content/media/small.png'));
    const model = await store.read();
    const entry = model.entries.find((e) => e.status === 'published')!;
    entry.cover = '/media/small.png';
    entry.body += '\n![A small image](/media/small.png)';
    const result = await buildSite(store, { model, assets });
    expect(result.manifest).not.toContain('media/private-unused.txt');
    expect(
      (await sharp(path.join(result.outputDir, 'media/small-200.webp')).metadata()).width,
    ).toBe(200);
    expect(result.manifest).not.toContain('media/small-960.webp');
    const page = await fs.readFile(
      path.join(result.outputDir, routeFor(entry), 'index.html'),
      'utf8',
    );
    expect(page).toContain('small-200.webp 200w');
  });
});
describe('local APIs and publication ordering', () => {
  it('previews the published homepage despite an invalid unrelated draft and can preview an unsaved draft body', async () => {
    const draft = await store.create(
      'posts',
      'An unfinished private draft',
      'unfinished-private-draft',
    );
    await store.saveEntry(draft.id, {
      metadata: draft,
      body: '```interactive\ninvalid json\n```',
      revision: draft.revision,
    });
    const context = await createApp(root, { watchFiles: false });
    try {
      const headers = { 'Content-Type': 'application/json', 'X-Studio-Token': context.token };
      const result = await context.app.request('http://127.0.0.1/api/preview', {
        method: 'POST',
        headers,
        body: JSON.stringify({ route: '/' }),
      });
      expect(result.status).toBe(200);
      const preview = await result.json();
      const html = await (await context.app.request(`http://127.0.0.1${preview.url}`)).text();
      expect(html).not.toContain(draft.title);
      expect(html).toContain('noindex,nofollow');
      expect(html).toContain('data-preview="true"');
      const draftResult = await context.app.request('http://127.0.0.1/api/preview', {
        method: 'POST',
        headers,
        body: JSON.stringify({ entryId: draft.id, body: 'An unsaved, valid thought.' }),
      });
      expect(draftResult.status).toBe(200);
      const draftPreview = await draftResult.json();
      expect(
        await (await context.app.request(`http://127.0.0.1${draftPreview.url}`)).text(),
      ).toContain('An unsaved, valid thought.');
    } finally {
      context.close();
    }
  });
  it('enforces local origins and per-session mutation tokens, including revision conflicts', async () => {
    const context = await createApp(root, { watchFiles: false });
    try {
      const bootstrap = await (await context.app.request('http://127.0.0.1/api/bootstrap')).json();
      const entry = bootstrap.entries[0];
      expect(
        (await context.app.request('http://127.0.0.1/api/content', { method: 'POST', body: '{}' }))
          .status,
      ).toBe(403);
      expect(
        (
          await context.app.request('http://127.0.0.1/api/bootstrap', {
            headers: { Origin: 'https://outside.example' },
          })
        ).status,
      ).toBe(403);
      expect((await context.app.request('http://outside.example/api/bootstrap')).status).toBe(403);
      const headers = {
        'Content-Type': 'application/json',
        'X-Studio-Token': context.token,
        Origin: 'http://127.0.0.1',
      };
      const body = JSON.stringify({
        metadata: entry,
        body: 'A saved API edit.',
        revision: entry.revision,
      });
      expect(
        (
          await context.app.request(`http://127.0.0.1/api/content/${entry.id}`, {
            method: 'PUT',
            headers,
            body,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await context.app.request(`http://127.0.0.1/api/content/${entry.id}`, {
            method: 'PUT',
            headers,
            body,
          })
        ).status,
      ).toBe(409);
    } finally {
      context.close();
    }
  });
  it('stops before upload when a build fails', async () => {
    const model = await store.read();
    model.site.url = 'https://notebook.pages.dev';
    model.site.cloudflare = {
      accountId: 'a'.repeat(32),
      projectName: 'notebook',
      productionBranch: 'main',
    };
    await store.saveJson('site', model.site, model.siteRevision);
    const runner = vi
      .fn<Runner>()
      .mockResolvedValue({ code: 0, stdout: '[{"name":"notebook"}]', stderr: '' });
    const builder = vi.fn<typeof buildSite>().mockRejectedValue(new Error('Broken equation'));
    const service = new JobService(store, runner, builder);
    await service.initialize();
    const job = service.start('publish');
    await service.waitFor(job.id);
    expect(job.state).toBe('failed');
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toEqual(['pages', 'project', 'list', '--json']);
    expect(job.error).toBe('Broken equation');
    expect(
      JSON.parse(await fs.readFile(path.join(store.root, '.studio/jobs', `${job.id}.json`), 'utf8'))
        .state,
    ).toBe('failed');
  });
  it('deploys exactly the accepted artifact and returns the actual command URL', async () => {
    const model = await store.read();
    model.site.url = 'https://notebook.pages.dev';
    model.site.cloudflare = {
      accountId: 'b'.repeat(32),
      projectName: 'notebook',
      productionBranch: 'main',
    };
    const runner = vi.fn<Runner>().mockResolvedValue({
      code: 0,
      stdout: 'Deployment complete! https://abc123.notebook.pages.dev',
      stderr: '',
    });
    const build: BuildResult = {
      id: 'accepted',
      outputDir: '/tmp/immutable-public',
      pages: 12,
      manifest: [],
      diagnostics: [],
      sourceRevision: 'source',
      completedAt: new Date().toISOString(),
    };
    const result = await deployArtifact(runner, model.site, build, () => undefined);
    expect(runner.mock.calls[0][0]).toContain('/tmp/immutable-public');
    expect(runner.mock.calls[0][0]).not.toContain('dist');
    expect(result.url).toBe('https://abc123.notebook.pages.dev');
  });
  it('reports upload failures and uncertain successful responses as failures', async () => {
    const model = await store.read();
    model.site.url = 'https://notebook.pages.dev';
    model.site.cloudflare = {
      accountId: 'c'.repeat(32),
      projectName: 'notebook',
      productionBranch: 'main',
    };
    const build = { id: 'a', outputDir: '/tmp/a' } as BuildResult;
    await expect(
      deployArtifact(
        async () => ({ code: 1, stdout: '', stderr: 'Authentication failed' }),
        model.site,
        build,
        () => undefined,
      ),
    ).rejects.toThrow('Authentication failed');
    await expect(
      deployArtifact(
        async () => ({ code: 0, stdout: 'Done', stderr: '' }),
        model.site,
        build,
        () => undefined,
      ),
    ).rejects.toThrow('without a deployment URL');
    expect(parseCommandJson('Proxy environment detected.\n{"accounts":[]}')).toEqual({
      accounts: [],
    });
    expect(parseCommandJson('[WARNING] Proxy message.\n{"accounts":[]}')).toEqual({ accounts: [] });
  });
});
