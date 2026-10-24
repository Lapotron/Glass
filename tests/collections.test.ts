import { afterEach, beforeEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store, ConflictError } from '../src/engine/store.js';
import {
  collectionsSchema,
  collectionAliasRoutes,
  collectionRedirect,
  retainCollectionPaths,
  routeFor,
} from '../src/shared/collections.js';
import { siteSchema, type Repository } from '../src/shared/contracts.js';
import { buildSite } from '../src/engine/build.js';
import { siteRedirects } from '../src/engine/shortlinks.js';
import { createRenderer } from '../src/site/pages.js';
import { createApp } from '../src/server/app.js';
import { verifyPublishedDeployment } from '../src/server/deployment-check.js';
import { albumRoute, albumAliasRoutes, resolveAlbums } from '../src/shared/albums.js';
import { publicNavigationFor } from '../src/shared/contracts.js';
import { resolveSlides } from '../src/shared/home.js';

let root: string, store: Store, model: Repository, assets: string;
const customized = () =>
  collectionsSchema.parse({
    posts: { name: 'Posts', singular: 'Post', path: '/POST/' },
    lab: { name: 'Articles', singular: 'Article', path: '/article/' },
  });
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-collections-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  model = await store.read();
  assets = path.join(root, 'assets-fixture');
  await fs.mkdir(assets);
  for (const file of ['site.js', 'site.css', 'appearance.js', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, file), '/* fixture */');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('defaults legacy collections without rewriting source and validates shared namespaces', async () => {
  const raw = await fs.readFile(path.join(store.content, 'site.json'), 'utf8');
  expect(model.site.collections.posts).toEqual({
    name: 'Writing',
    singular: 'Entry',
    path: 'blog',
    aliases: [],
  });
  expect(model.site.collections.lab.path).toBe('lab');
  expect((await store.snapshot()).site.collections).toEqual(model.site.collections);
  expect(await fs.readFile(path.join(store.content, 'site.json'), 'utf8')).toBe(raw);
  expect(customized().posts.path).toBe('post');
  for (const prefix of [
    '',
    '/',
    'a/b',
    '../post',
    '%70ost',
    'https://bad.test',
    'archive',
    'api',
    'studio',
    'media',
    's',
    'lab',
    '1post',
    'a'.repeat(49),
  ])
    expect(collectionsSchema.safeParse({ posts: { path: prefix } }).success, prefix).toBe(false);
  expect(
    collectionsSchema.safeParse({ posts: { path: 'note' }, lab: { path: 'note' } }).success,
  ).toBe(false);
  expect(
    collectionsSchema.safeParse({
      posts: { path: 'post', aliases: ['old-post'] },
      lab: { path: 'old-post' },
    }).success,
  ).toBe(false);
  expect(collectionsSchema.safeParse({ posts: { name: ' ', singular: '' } }).success).toBe(false);
  expect(
    collectionsSchema.parse({ posts: { name: '随笔', singular: '文章', path: 'notes' } }).posts
      .name,
  ).toBe('随笔');
});

it('customizes Life names and paths, retains album/prefix aliases and rejects cross-collection collisions', async () => {
  expect(model.site.collections.life).toEqual({
    name: 'Life',
    singular: 'Moment',
    path: 'life',
    aliases: [],
  });
  const configured = collectionsSchema.parse({
    ...model.site.collections,
    life: { name: 'Gallery', singular: 'Photograph', path: '/GALLERY/' },
  });
  await store.saveJson('site', { ...model.site, collections: configured }, model.siteRevision);
  let current = await store.read();
  const firstAlbum = resolveAlbums(current.library).find((a) => a.photos.length)!;
  current.library.albums = [
    {
      id: 'renamed-album',
      name: firstAlbum.name,
      slug: 'coastlines',
      description: '',
      cover: '',
      aliases: [firstAlbum.slug],
    },
  ];
  current.entries.forEach((e) => {
    e.body = `## A quiet entry\n\n[Original album](/life/${firstAlbum.slug}/)`;
  });
  const canonical = albumRoute(current.library.albums[0], current.site.collections);
  expect(canonical).toBe('/gallery/coastlines/');
  expect(
    albumAliasRoutes(current.library, current.site.collections).get(`/life/${firstAlbum.slug}/`),
  ).toBe(canonical);
  expect(publicNavigationFor(current.site.collections).map((item) => item.label)).toEqual([
    'Home',
    'Archive',
    'Projects',
    'Gallery',
    'About',
  ]);
  expect(
    resolveSlides(current)
      .filter((slide) => slide.source === 'photo')
      .every((slide) => slide.href === '/gallery/'),
  ).toBe(true);
  const result = await buildSite(store, { model: current, assets });
  const html = await fs.readFile(path.join(result.outputDir, 'gallery/index.html'), 'utf8');
  expect(html).toContain('href="/gallery/"');
  expect(html).toMatch(/<h1[^>]*>(?:<[^>]*>)*Gallery/);
  expect(html).toContain('href="/gallery/coastlines/"');
  expect(result.manifest).not.toContain('life/index.html');
  const redirects = await fs.readFile(path.join(result.outputDir, '_redirects'), 'utf8');
  expect(redirects).toContain('/life/* /gallery/:splat 301');
  expect(redirects).toContain(`/life/${firstAlbum.slug}/ ${canonical} 301`);
  expect(await fs.readFile(path.join(result.outputDir, 'sitemap.xml'), 'utf8')).toContain(
    '/gallery/coastlines/',
  );
  expect(collectionsSchema.safeParse({ life: { path: 'blog' } }).success).toBe(false);
  expect(collectionsSchema.safeParse({ posts: { path: 'life' } }).success).toBe(false);
  expect(collectionsSchema.safeParse({ ...configured, posts: { path: 'gallery' } }).success).toBe(
    false,
  );
  expect(collectionsSchema.safeParse({ life: { path: 'api' } }).success).toBe(false);
  await store.saveJson(
    'site',
    {
      ...current.site,
      collections: {
        ...current.site.collections,
        life: { ...current.site.collections.life, path: 'moments' },
      },
    },
    current.siteRevision,
  );
  current = await store.read();
  expect(current.site.collections.life.aliases).toEqual(['gallery']);
  expect(collectionRedirect('/gallery/coastlines/', current.site.collections)).toBe(
    '/moments/coastlines/',
  );
  expect(collectionRedirect('/life/', current.site.collections)).toBe('/moments/');
});

it('retains all earlier paths across saves, restores a former canonical path, and rejects stale saves', async () => {
  const before = model.entries.map((entry) => ({
    id: entry.id,
    file: entry.file,
    revision: entry.revision,
    kind: entry.kind,
  }));
  await store.saveJson('site', { ...model.site, collections: customized() }, model.siteRevision);
  let current = await store.read();
  await expect(store.saveJson('site', model.site, model.siteRevision)).rejects.toBeInstanceOf(
    ConflictError,
  );
  await store.saveJson(
    'site',
    {
      ...current.site,
      collections: {
        ...current.site.collections,
        posts: { ...current.site.collections.posts, path: 'notes', aliases: [] },
      },
    },
    current.siteRevision,
  );
  current = await store.read();
  expect(current.site.collections.posts.aliases).toEqual(['post']);
  expect(collectionRedirect('/blog/a-note/?', current.site.collections)).toBe('/notes/a-note/?');
  await store.saveJson(
    'site',
    {
      ...current.site,
      collections: {
        ...current.site.collections,
        posts: { ...current.site.collections.posts, path: 'post', aliases: [] },
      },
    },
    current.siteRevision,
  );
  current = await store.read();
  expect(current.site.collections.posts.aliases).toEqual(['notes']);
  expect(collectionRedirect('/notes/a-note/', current.site.collections)).toBe('/post/a-note/');
  expect(collectionRedirect('/blog', current.site.collections)).toBe('/post/');
  expect(collectionRedirect('/post/a-note/', current.site.collections)).toBeUndefined();
  expect(
    current.entries.map((entry) => ({
      id: entry.id,
      file: entry.file,
      revision: entry.revision,
      kind: entry.kind,
    })),
  ).toEqual(before);
  const collision = {
    ...current.site.collections,
    posts: { ...current.site.collections.posts, path: 'essays', aliases: [] },
    lab: { ...current.site.collections.lab, path: 'post' },
  };
  expect(() =>
    retainCollectionPaths(collectionsSchema.parse(collision), current.site.collections),
  ).toThrow('earlier URLs');
});

it('builds canonical custom routes, all feeds and redirects without rewriting Markdown or exposing drafts', async () => {
  const raw = await fs.readFile(
    path.join(store.content, model.entries[0].kind, model.entries[0].file),
    'utf8',
  );
  model.site.collections = customized();
  model.site.feeds.atom = model.site.feeds.json = true;
  for (const entry of model.entries) entry.body = '## Reading\n\nA quiet paragraph.';
  const post = model.entries.find(
    (entry) => entry.kind === 'posts' && entry.status === 'published',
  )!;
  const lab = model.entries.find((entry) => entry.kind === 'lab' && entry.status === 'published')!;
  const chinese = model.entries.find((entry) => /\p{Script=Han}/u.test(entry.slug))!;
  post.body += `\n\n[Earlier post](/blog/${post.slug}/) [Earlier article](/lab/${lab.slug}/) [中文](/blog/${chinese.slug}/)`;
  const result = await buildSite(store, { model, assets });
  const html = await fs.readFile(
    path.join(result.outputDir, routeFor(post, customized()), 'index.html'),
    'utf8',
  );
  expect(html).toContain(
    `<link rel="canonical" href="${model.site.url}${routeFor(post, customized())}"`,
  );
  expect(html).toContain('href="/post/"');
  expect(html).toContain(`href="/blog/${post.slug}/"`);
  expect(result.entryRoutes).toContain(routeFor(lab, customized()));
  expect(result.collectionNames).toEqual({ posts: 'Posts', lab: 'Articles' });
  expect(result.manifest.some((file) => /^(blog|lab)\//.test(file))).toBe(false);
  for (const file of ['feed.xml', 'atom.xml', 'feed.json', 'sitemap.xml', 'search.json']) {
    const output = await fs.readFile(path.join(result.outputDir, file), 'utf8');
    expect(output, file).toContain('/post/');
    expect(output, file).toContain('/article/');
    expect(output, file).not.toContain('/blog/');
  }
  const search = JSON.parse(await fs.readFile(path.join(result.outputDir, 'search.json'), 'utf8'));
  expect(
    search.find((entry: { url: string }) => entry.url === routeFor(post, customized())).kindLabel,
  ).toBe('Post');
  expect(await fs.readFile(path.join(result.outputDir, '_redirects'), 'utf8')).toContain(
    '/blog/* /post/:splat 301',
  );
  expect(await fs.readFile(path.join(result.outputDir, '_redirects'), 'utf8')).toContain(
    '/lab/* /article/:splat 301',
  );
  expect(await fs.readFile(path.join(result.outputDir, '_redirects'), 'utf8')).toContain(
    `/s/${post.shortCode} ${routeFor(post, customized())} 302`,
  );
  const home = await fs.readFile(path.join(result.outputDir, 'index.html'), 'utf8');
  expect(home).toContain('/post/');
  const aliases = collectionAliasRoutes(model.entries, customized());
  const draft = model.entries.find((entry) => entry.status === 'draft')!;
  expect(aliases.has(`/blog/${draft.slug}/`)).toBe(false);
  expect(
    await fs.readFile(
      path.join(store.content, model.entries[0].kind, model.entries[0].file),
      'utf8',
    ),
  ).toBe(raw);
  post.body += '\n\n[Missing](/blog/never-published/)';
  await expect(buildSite(store, { model, assets })).rejects.toThrow('Broken local link on /post/');
  expect(
    await fs.readFile(path.join(root, 'dist', routeFor(post, customized()), 'index.html'), 'utf8'),
  ).toBe(html);
  post.body = `[Draft](/blog/${draft.slug}/)`;
  await expect(buildSite(store, { model, assets })).rejects.toThrow('is draft');
});

it('previews unsaved custom routes, retains Giscus identities and redirects local aliases with queries', async () => {
  const entry = model.entries.find(
    (entry) => entry.kind === 'posts' && entry.status === 'published',
  )!;
  const configured = { ...model.site, collections: customized() };
  const app = await createApp(root, { watchFiles: false });
  try {
    const headers = {
      'Content-Type': 'application/json',
      'X-Studio-Token': app.token,
      Origin: 'http://127.0.0.1',
    };
    const response = await app.app.request('http://127.0.0.1/api/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({ site: configured, entryId: entry.id }),
    });
    expect(response.status).toBe(200);
    const preview = await (
      await app.app.request('http://127.0.0.1' + (await response.json()).url)
    ).text();
    expect(preview).toContain('href="/post/"');
    expect(preview).toContain('noindex,nofollow');
    expect((await store.read()).site.collections.posts.path).toBe('blog');
    await store.saveJson('site', configured, model.siteRevision);
    await buildSite(store, {
      assets,
      model: {
        ...model,
        site: configured,
        entries: model.entries.map((entry) => ({ ...entry, body: 'A saved article.' })),
      },
    });
    const redirect = await app.app.request(`http://127.0.0.1/blog/${entry.slug}/?source=old`);
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe(`/post/${entry.slug}/?source=old`);
    const short = await app.app.request(`http://127.0.0.1/s/${entry.shortCode}`);
    expect(short.headers.get('location')).toBe(routeFor(entry, customized()));
    const current = await store.read();
    await store.saveJson(
      'site',
      {
        ...current.site,
        collections: {
          ...current.site.collections,
          posts: { ...current.site.collections.posts, path: 'notes' },
        },
      },
      current.siteRevision,
    );
    expect(
      (await app.app.request(`http://127.0.0.1/blog/${entry.slug}/`)).headers.get('location'),
    ).toBe(`/post/${entry.slug}/`);
    expect((await app.app.request(`http://127.0.0.1/post/${entry.slug}/`)).status).toBe(200);
  } finally {
    app.close();
  }
  model.site = siteSchema.parse({
    ...configured,
    integrations: {
      ...configured.integrations,
      comments: {
        ...configured.integrations.comments,
        enabled: true,
        repo: 'example/notebook',
        repoId: 'R_test',
        categoryId: 'DIC_test',
      },
    },
  });
  model.entries = [{ ...entry, body: '## A paragraph\n\nKeep the discussion.' }];
  const renderer = await createRenderer(model);
  const html = renderer.render(routeFor(entry, customized()));
  expect(html).toContain(`data-comment-term="${routeFor(entry)}"`);
  expect(html).toContain(`data-entry-id="${entry.id}"`);
});

it('keeps redirect order and limits valid and verifies the captured custom article URL', async () => {
  const redirects = siteRedirects(model.entries, customized()).trim().split('\n');
  const firstDynamic = redirects.findIndex((rule) => rule.includes('*') || rule.includes(':code'));
  expect(
    redirects.slice(firstDynamic).every((rule) => rule.includes('*') || rule.includes(':code')),
  ).toBe(true);
  const entry = model.entries[0];
  const tooMany = Array.from({ length: 1997 }, (_, index) => ({
    ...entry,
    id: `entry-${index}`,
    shortCode: `code-${index}`,
    shortAliases: [],
    status: 'published' as const,
  }));
  expect(() => siteRedirects(tooMany, customized())).toThrow('2,000');
  const visited: string[] = [];
  const request: typeof fetch = async (input) => {
    const pathname = new URL(String(input)).pathname;
    visited.push(pathname);
    return new Response(
      pathname === '/' ? '<header class="site-header"></header>' : '<h1>Page</h1>',
      {
        status: pathname === '/' || pathname.startsWith('/article/') ? 200 : 404,
        headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'" },
      },
    );
  };
  await verifyPublishedDeployment(
    { url: 'https://fixture.pages.dev', project: 'fixture', buildId: 'test', completedAt: '' },
    {
      id: 'test',
      outputDir: root,
      pages: 3,
      manifest: ['index.html', 'article/sample/index.html'],
      entryRoutes: ['/article/sample/'],
      diagnostics: [],
      sourceRevision: '',
      completedAt: '',
    },
    request,
  );
  expect(visited).toContain('/article/sample/');
});
