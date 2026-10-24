import { afterAll, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/engine/store.js';
import { createRenderer } from '../src/site/pages.js';
const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});
it('generates native numbered pages and a private-field-free, fingerprinted published catalog', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-archive-output-'));
  roots.push(root);
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  const model = await new Store(root).read(),
    template = model.entries[0];
  model.entries = Array.from({ length: 50 }, (_, i) => ({
    ...template,
    id: randomUUID(),
    title: `Entry ${String(i).padStart(3, '0')}`,
    summary: i === 49 ? 'Distant needle' : 'Public summary',
    slug: `archive-${i}`,
    file: `archive-${i}.md`,
    publishedAt: i < 25 ? '2026-10-20' : '2025-09-01',
    status: 'published' as const,
    cover: '/media/coast-dawn.svg',
    body: 'Private source never belongs in the archive catalog.',
    revision: 'private-revision',
  }));
  model.entries.push({
    ...model.entries[0],
    id: randomUUID(),
    slug: 'secret-draft',
    title: 'SECRET DRAFT TITLE',
    status: 'draft',
  });
  const renderer = await createRenderer(model),
    first = renderer.render('/archive/'),
    second = renderer.render('/archive/page/2/'),
    last = renderer.render('/archive/page/3/');
  expect(renderer.routes.filter((route) => route.startsWith('/archive/'))).toEqual([
    '/archive/',
    '/archive/page/2/',
    '/archive/page/3/',
  ]);
  expect(first.match(/data-timeline-entry/g)).toHaveLength(24);
  expect(second.match(/data-timeline-entry/g)).toHaveLength(24);
  expect(last.match(/data-timeline-entry/g)).toHaveLength(2);
  expect(second).toContain('Continued');
  expect(second).toContain('id="archive-year-2025"');
  expect(first).toContain('href="/archive/page/2/#archive-year-2025"');
  expect(first).toContain('rel="next"');
  expect(last).toContain('rel="prev"');
  expect(second).toContain(
    `<link rel="canonical" href="${model.site.url.replace(/\/$/, '')}/archive/page/2/"`,
  );
  expect(renderer.archiveCatalog.path).toMatch(/^\/assets\/archive\/catalog-[a-f0-9]{20}\.json$/);
  expect(first).toContain(`data-archive-catalog="${renderer.archiveCatalog.path}"`);
  expect(first).not.toContain('Distant needle');
  const catalog = JSON.parse(renderer.archiveCatalog.data);
  expect(catalog.records).toHaveLength(50);
  expect(catalog.records.some((e: { summary: string }) => e.summary === 'Distant needle')).toBe(
    true,
  );
  expect(renderer.archiveCatalog.data).not.toMatch(
    /SECRET DRAFT|Private source|private-revision|body|revision|rendered|sourceId/,
  );
  const preview = await createRenderer(model, { preview: true, includeDrafts: true });
  const previewHtml = preview.render('/archive/');
  expect(previewHtml).toContain('type="application/json" data-archive-embedded');
  expect(previewHtml).not.toContain('SECRET DRAFT TITLE');
  const previousPath = renderer.archiveCatalog.path;
  model.site.mediaDelivery.publicOrigin = 'https://assets.example.com';
  expect((await createRenderer(model)).archiveCatalog.path).not.toBe(previousPath);
}, 30000);
