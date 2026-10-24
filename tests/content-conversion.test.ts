import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/engine/store.js';
import { Operations } from '../src/engine/operations.js';
import { routeFor } from '../src/shared/collections.js';
import { entryAliasRoutes } from '../src/shared/entry-routes.js';
import { siteRedirects } from '../src/engine/shortlinks.js';

const selected = ({ id, revision }: { id: string; revision: string }) => ({ id, revision });
let root: string, store: Store, operations: Operations;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-conversion-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  operations = new Operations(store);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
it('moves an entry atomically while preserving identity, historical source and discussion term', async () => {
  const draft = await store.create('posts', 'Move this post', 'move-this');
  const entry = await store.saveEntry(draft.id, {
    metadata: { ...draft, status: 'published', math: { packages: ['physics'] } },
    body: '## An equation\n\n$\\dv{x}{t}$',
    revision: draft.revision,
  });
  const original = await fs.readFile(path.join(root, 'content/posts', entry.file), 'utf8');
  const moved = (
    await operations.content({ action: 'convert', items: [selected(entry)], targetKind: 'lab' })
  ).entries[0];
  expect(moved.id).toBe(entry.id);
  expect(moved.shortCode).toBe(entry.shortCode);
  expect(moved.kind).toBe('lab');
  expect(moved.body).toBe(entry.body);
  expect(moved.math).toEqual(entry.math);
  expect(moved.discussion?.articleTerm).toBe(routeFor(entry));
  await expect(fs.access(path.join(root, 'content/posts', entry.file))).rejects.toThrow();
  expect((await store.getRevision(entry.id, entry.revision)).entry.body).toBe(entry.body);
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(root, '.studio/revisions', entry.id, entry.revision + '.json'),
        'utf8',
      ),
    ).raw,
  ).toBe(original);
  const model = await store.read(),
    aliases = entryAliasRoutes(model.entries, model.site.collections);
  expect(aliases.get(routeFor(entry, model.site.collections))).toBe(
    routeFor({ ...entry, kind: 'lab' }, model.site.collections),
  );
  expect(siteRedirects(model.entries, model.site.collections)).toContain(
    `${routeFor(entry, model.site.collections)} ${routeFor({ ...entry, kind: 'lab' }, model.site.collections)} 301`,
  );
});
it('supports round trips and restores older revisions in the current collection without losing redirects', async () => {
  const entry = await store.create('posts', 'Round trip', 'round-trip');
  const first = (
    await operations.content({ action: 'convert', items: [selected(entry)], targetKind: 'lab' })
  ).entries[0];
  const restored = await store.restoreRevision(entry.id, entry.revision, first.revision);
  expect(restored.kind).toBe('lab');
  expect(restored.routeAliases).toContain('/blog/round-trip/');
  const back = (
    await operations.content({
      action: 'convert',
      items: [selected(restored)],
      targetKind: 'posts',
    })
  ).entries[0];
  expect(back.discussion?.articleTerm).toBe('/blog/round-trip/');
  expect(back.routeAliases).toContain('/lab/round-trip/');
  expect(back.routeAliases).not.toContain('/blog/round-trip/');
});
it('rejects stale selections and destination conflicts before changing any file', async () => {
  const a = await store.create('posts', 'First', 'move-a'),
    b = await store.create('posts', 'Second', 'move-b');
  await store.create('lab', 'Occupied', 'move-b');
  const before = await store.snapshot();
  await expect(
    operations.content({ action: 'convert', items: [a, b].map(selected), targetKind: 'lab' }),
  ).rejects.toThrow('already in use');
  expect(await store.snapshot()).toEqual(before);
  expect(await store.listRevisions(a.id)).toEqual([]);
  await expect(
    operations.content({
      action: 'convert',
      items: [{ id: a.id, revision: '0'.repeat(64) }],
      targetKind: 'lab',
    }),
  ).rejects.toThrow('No items were changed');
  const result = await operations.content({
    action: 'convert',
    items: [a, b].map(selected),
    targetKind: 'lab',
    slugs: { [b.id]: 'move-b-new' },
  });
  expect(result.entries.every((entry) => entry.kind === 'lab')).toBe(true);
});
it('retains aliases through collection renames and refuses alias theft or duplicate inheritance', async () => {
  const entry = await store.create('posts', 'An alias owner', 'alias-owner');
  const moved = (
    await operations.content({ action: 'convert', items: [selected(entry)], targetKind: 'lab' })
  ).entries[0];
  await expect(store.create('posts', 'Cannot reuse the former URL', 'alias-owner')).rejects.toThrow(
    'retained',
  );
  const duplicate = (await operations.content({ action: 'duplicate', items: [selected(moved)] }))
    .entries[0];
  expect(duplicate.routeAliases).toEqual([]);
  expect(duplicate.discussion?.articleTerm).toBeUndefined();
  const model = await store.read();
  await store.saveJson(
    'site',
    {
      ...model.site,
      collections: {
        ...model.site.collections,
        lab: { ...model.site.collections.lab, path: 'article' },
      },
    },
    model.siteRevision,
  );
  const renamed = await store.read();
  const published = renamed.entries.map((candidate) =>
    candidate.id === entry.id ? { ...candidate, status: 'published' as const } : candidate,
  );
  expect(entryAliasRoutes(published, renamed.site.collections).get('/blog/alias-owner/')).toBe(
    '/article/alias-owner/',
  );
});
it('rolls back both collections and history after an interrupted file move', async () => {
  const entry = await store.create('posts', 'Rollback', 'move-rollback'),
    before = await store.snapshot();
  const rename = fs.rename.bind(fs);
  let failed = false;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (!failed && String(to).endsWith('/content/lab/move-rollback.md')) {
      failed = true;
      throw new Error('Simulated move failure');
    }
    return rename(from, to);
  });
  await expect(
    operations.content({ action: 'convert', items: [selected(entry)], targetKind: 'lab' }),
  ).rejects.toThrow('Simulated move failure');
  expect(await store.snapshot()).toEqual(before);
  expect(await store.listRevisions(entry.id)).toEqual([]);
});
