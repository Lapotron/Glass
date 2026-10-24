import { afterEach, beforeEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store, ConflictError, serializeEntry, parseEntry } from '../src/engine/store.js';
import { entrySchema, siteSchema, routeFor, type Repository } from '../src/shared/contracts.js';
import { resolveEntrySettings } from '../src/shared/entry-settings.js';
import { createRenderer } from '../src/site/pages.js';
import { buildSite } from '../src/engine/build.js';
import { MediaService } from '../src/engine/media.js';
import { BackupService } from '../src/engine/backup.js';
import { MediaMaintenance } from '../src/engine/media-maintenance.js';
import { createApp } from '../src/server/app.js';

let root: string, store: Store, model: Repository, assets: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-entry-settings-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  model = await store.read();
  // These tests exercise metadata, not diagram compilation.
  model.entries.forEach((entry) => {
    entry.body = '## A quiet section\n\nA short paragraph for readers.\n';
  });
  assets = path.join(root, 'assets');
  await fs.mkdir(assets);
  for (const name of ['site.js', 'appearance.js', 'site.css', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, name), '/* fixture */');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('inherits without materializing overrides, honors false/zero, and bounds customization', () => {
  const entry = model.entries[0];
  expect(entry.reading).toBeUndefined();
  expect(entrySchema.parse({ ...entry, reading: {}, typography: {} }).reading).toEqual({});
  expect(resolveEntrySettings(model.site, entry).reading).toEqual({
    ...model.site.reading,
    modifiedDate: model.site.reading.publishedDate,
  });
  const custom = entrySchema.parse({
    ...entry,
    reading: { progress: false, relatedCount: 0 },
    typography: { lineHeight: 2 },
    coverOptions: { focalX: 0 },
  });
  const resolved = resolveEntrySettings(model.site, custom);
  expect(resolved.reading).toMatchObject({ progress: false, relatedCount: 0, outline: true });
  expect(resolved.theme.lineHeight).toBe(2);
  expect(resolved.theme.accent).toBe(model.site.theme.accent);
  expect(resolved.cover.focalX).toBe(0);
  for (const patch of [
    { typography: { lineHeight: 8 } },
    { reading: { relatedCount: -1 } },
    { coverOptions: { focalX: 101 } },
    { seo: { image: 'javascript:alert(1)' } },
    { seo: { image: 'https://user:password@bad.test/a.jpg' } },
  ])
    expect(entrySchema.safeParse({ ...entry, ...patch }).success).toBe(false);
});

it('round-trips optional settings through canonical files and revision restoration', async () => {
  const entry = model.entries[0];
  const metadata = {
    ...entry,
    updatedAt: '2026-10-20',
    coverOptions: { alt: 'Morning light', caption: 'A quiet morning.', ratio: 'wide', focalX: 20 },
    reading: { outline: false },
    typography: { fontFamily: 'serif', articleWidth: 720 },
    discussion: { article: false, annotations: true },
    seo: {
      title: 'Search title',
      description: 'Search description',
      image: '/media/dunes.svg',
      indexing: 'noindex',
    },
  };
  const saved = await store.saveEntry(entry.id, {
    metadata,
    body: entry.body,
    revision: entry.revision,
  });
  expect((await store.read()).entries.find((e) => e.id === entry.id)).toMatchObject(
    entrySchema.parse(metadata),
  );
  const portable = parseEntry(serializeEntry(saved, saved.body), saved.kind, saved.file);
  expect(portable.typography).toEqual(saved.typography);
  expect(portable.seo).toEqual(saved.seo);
  await expect(
    store.saveEntry(entry.id, { metadata, body: entry.body, revision: entry.revision }),
  ).rejects.toBeInstanceOf(ConflictError);
  const reset = await store.saveEntry(entry.id, {
    metadata: { ...saved, typography: undefined },
    body: entry.body,
    revision: saved.revision,
  });
  expect(reset.typography).toBeUndefined();
  const restored = await store.restoreRevision(entry.id, saved.revision, reset.revision);
  expect(restored.typography).toEqual(saved.typography);
});

it('renders reading, typography, accessible cover framing and sharing overrides without rewriting visible titles', async () => {
  const entry = model.entries.find((e) => e.status === 'published')!;
  entry.coverOptions = {
    alt: 'A quiet coast',
    caption: 'Caption <escaped>',
    ratio: 'landscape',
    focalX: 20,
    focalY: 70,
  };
  entry.reading = {
    progress: false,
    publishedDate: false,
    readingTime: false,
    author: false,
    relatedCount: 0,
    codeLineNumbers: true,
  };
  entry.typography = { fontFamily: 'serif', articleWidth: 720, lineHeight: 2, paragraphSpace: 1.5 };
  entry.seo = {
    title: 'A custom search title',
    description: 'A custom description',
    image: '/media/dunes.svg',
    imageAlt: 'Desert light',
  };
  const renderer = await createRenderer(model),
    html = renderer.render(routeFor(entry));
  expect(html).toContain(`<h1>${entry.title}</h1>`);
  expect(html).toContain('<title>A custom search title');
  expect(html).toContain('name="description" content="A custom description"');
  expect(html).toContain('property="og:image:alt" content="Desert light"');
  expect(html).toContain('data-cover-ratio="landscape"');
  expect(html).toContain('--cover-position:20% 70%');
  expect(html).toContain('alt="A quiet coast"');
  expect(html).toContain('Caption &lt;escaped&gt;');
  expect(html).toContain(`data-view-image="${entry.cover}"`);
  expect(html).toContain('"fontFamily":"serif"');
  expect(html).toContain('--article-width:720px');
  expect(html).toContain('data-code-lines="true"');
  expect(html).toContain('data-outline-link');
  expect(html).not.toContain('data-reading-progress');
  expect(html).not.toContain('class="article-signature');
  expect(html).not.toContain('aria-label="Related articles"');
  const other = renderer.render('/archive/');
  expect(other).not.toContain('"articleWidth":720');
  entry.coverOptions.visible = false;
  expect((await createRenderer(model)).render(routeFor(entry))).not.toContain(
    'class="article-cover-link"',
  );
});

it('gates discussion locations independently and preserves established thread keys', async () => {
  model.site = siteSchema.parse({
    ...model.site,
    integrations: {
      ...model.site.integrations,
      comments: {
        ...model.site.integrations.comments,
        enabled: true,
        repo: 'example/notebook',
        repoId: 'R_test',
        categoryId: 'DIC_test',
      },
    },
  });
  const entry = model.entries.find((e) => e.status === 'published')!;
  model.entries = [entry];
  entry.body =
    '## A passage\n\nSome precise prose.\n\n:::discussion{#a-thread title="A section thread" comments="true"}\nTalk here.\n:::\n';
  for (const article of [true, false])
    for (const blocks of [true, false])
      for (const annotations of [true, false]) {
        entry.discussion = { article, blocks, annotations };
        const html = (await createRenderer(model)).render(routeFor(entry));
        expect(html.includes('id="article-discussion-tab"')).toBe(article);
        expect(html.includes('id="article-annotations-tab"')).toBe(annotations);
        expect(html.includes('data-line-trigger')).toBe(annotations);
        expect(html.includes('data-comment-term="entry/' + entry.id + '/section/a-thread"')).toBe(
          blocks,
        );
        if (article) expect(html).toContain(`data-comment-term="${routeFor(entry)}"`);
        if (!article && annotations)
          expect(html).toMatch(
            /id="article-annotations"[^>]*aria-labelledby="article-annotations-tab"[^>]*>/,
          );
      }
  entry.comments = false;
  expect(resolveEntrySettings(model.site, entry).discussion).toEqual({
    article: false,
    blocks: false,
    annotations: false,
  });
});

it('builds sharing-only media, excludes noindex routes from sitemap and annotation-disabled IDs from the worker', async () => {
  model.site.integrations.comments = {
    ...model.site.integrations.comments,
    enabled: true,
    repo: 'example/notebook',
    repoId: 'R_test',
    categoryId: 'DIC_test',
  };
  const entry = model.entries.find((e) => e.status === 'published')!;
  model.entries = [entry];
  await fs.copyFile(
    path.join(root, 'content/media/dunes.svg'),
    path.join(root, 'content/media/sharing-only.svg'),
  );
  entry.seo = { image: '/media/sharing-only.svg', indexing: 'noindex' };
  entry.discussion = { annotations: false };
  const result = await buildSite(store, { model, assets });
  expect(result.manifest).toContain('media/sharing-only.svg');
  expect(await fs.readFile(path.join(result.outputDir, 'sitemap.xml'), 'utf8')).not.toContain(
    routeFor(entry),
  );
  expect(await fs.readFile(path.join(result.outputDir, 'search.json'), 'utf8')).toContain(
    routeFor(entry),
  );
  expect(
    JSON.parse(
      await fs.readFile(path.join(result.outputDir, 'assets/annotation-config.json'), 'utf8'),
    ).entries,
  ).not.toContain(entry.id);
  expect(
    await fs.readFile(path.join(result.outputDir, routeFor(entry), 'index.html'), 'utf8'),
  ).toContain('noindex');
  const saved = await store.saveEntry(entry.id, {
    metadata: entry,
    body: entry.body,
    revision: entry.revision,
  });
  const audit = () =>
    new MediaMaintenance(
      store,
      new MediaService(store),
      new BackupService(store),
      () => true,
    ).inspectUnlocked();
  expect((await audit()).items.find((i) => i.url === '/media/sharing-only.svg')?.active).toContain(
    entry.title,
  );
  await store.trash(saved.id, saved.revision);
  expect((await audit()).items.find((i) => i.url === '/media/sharing-only.svg')?.history).toContain(
    'Trash: ' + entry.title,
  );
});

it('clears omitted overrides in unsaved previews and keeps disabled annotations off the local endpoint', async () => {
  const entry = model.entries.find((e) => e.status === 'published')!;
  const saved = await store.saveEntry(entry.id, {
    metadata: { ...entry, typography: { articleWidth: 720 }, discussion: { annotations: false } },
    body: entry.body,
    revision: entry.revision,
  });
  await store.saveJson(
    'site',
    {
      ...model.site,
      integrations: {
        ...model.site.integrations,
        comments: {
          ...model.site.integrations.comments,
          enabled: true,
          repo: 'example/notebook',
          repoId: 'R_test',
          categoryId: 'DIC_test',
        },
      },
    },
    model.siteRevision,
  );
  const app = await createApp(root, { watchFiles: false });
  try {
    const response = await app.app.request('http://127.0.0.1/api/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Studio-Token': app.token,
        Origin: 'http://127.0.0.1',
      },
      body: JSON.stringify({
        entryId: saved.id,
        metadata: { ...saved, typography: undefined },
        body: entry.body,
      }),
    });
    expect(response.status).toBe(200);
    const html = await (
      await app.app.request('http://127.0.0.1' + (await response.json()).url)
    ).text();
    expect(html).toContain(`--article-width:${model.site.theme.articleWidth}px`);
    expect(html).not.toContain('"articleWidth":720');
    expect(html).not.toContain('data-line-trigger');
    expect((await app.app.request('http://127.0.0.1/api/annotations/' + entry.id)).status).toBe(
      404,
    );
    expect(
      (await store.read()).entries.find((e) => e.id === entry.id)?.typography?.articleWidth,
    ).toBe(720);
  } finally {
    app.close();
  }
});
