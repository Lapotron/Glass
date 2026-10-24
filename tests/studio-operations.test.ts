import { beforeEach, afterEach, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store, digest } from '../src/engine/store.js';
import { Operations } from '../src/engine/operations.js';
import { commitFiles } from '../src/engine/file-transaction.js';
import { BackupService } from '../src/engine/backup.js';
import { MediaService } from '../src/engine/media.js';
import { MediaMaintenance, markdownMedia } from '../src/engine/media-maintenance.js';
import { Exports } from '../src/engine/exports.js';
import { BackupScheduler } from '../src/server/backup-scheduler.js';
import { createApp } from '../src/server/app.js';
import { cameraPicture } from './fixtures/camera.js';

let root: string, store: Store, operations: Operations;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-operations-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  operations = new Operations(store);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const selection = (items: { id: string; revision: string }[]) =>
  items.map(({ id, revision }) => ({ id, revision }));

it('rejects an entire stale batch and records no revisions or partial changes', async () => {
  const before = await store.snapshot(),
    selected = before.entries.slice(0, 2);
  await expect(
    operations.content({
      action: 'status',
      status: 'draft',
      items: [{ id: selected[0].id, revision: '0'.repeat(64) }, selection(selected)[1]],
    }),
  ).rejects.toThrow('No items were changed');
  expect(await store.snapshot()).toEqual(before);
  expect(await store.listRevisions(selected[1].id)).toEqual([]);
});
it('applies metadata to a whole selection and preserves byte-exact history', async () => {
  const selected = (await store.snapshot()).entries.slice(0, 2);
  const original = await fs.readFile(
    path.join(store.content, selected[0].kind, selected[0].file),
    'utf8',
  );
  const result = await operations.content({
    action: 'tags',
    tagMode: 'add',
    tags: ['Daily'],
    items: selection(selected),
  });
  expect(result.entries.every((entry) => entry.tags.includes('Daily'))).toBe(true);
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(root, '.studio/revisions', selected[0].id, selected[0].revision + '.json'),
        'utf8',
      ),
    ).raw,
  ).toBe(original);
  const changed = (await store.snapshot()).entries.filter((entry) =>
    selected.some((old) => old.id === entry.id),
  );
  await expect(
    operations.content({ action: 'status', status: 'scheduled', items: selection(changed) }),
  ).rejects.toThrow('No items were changed');
  expect(
    (await store.snapshot()).entries.filter((entry) => changed.some((old) => old.id === entry.id)),
  ).toEqual(changed);
});
it('duplicates selections as new drafts without copying aliases or schedules', async () => {
  const selected = (await store.snapshot()).entries.slice(0, 2);
  const result = await operations.content({ action: 'duplicate', items: selection(selected) });
  expect(result.entries).toHaveLength(2);
  for (const entry of result.entries) {
    expect(selected.some((old) => old.id === entry.id || old.shortCode === entry.shortCode)).toBe(
      false,
    );
    expect(entry.status).toBe('draft');
    expect(entry.publishAt).toBe('');
    expect(entry.shortAliases).toEqual([]);
    expect(selected.some((old) => old.body === entry.body)).toBe(true);
  }
});
it('moves and restores a group through Trash and refuses colliding group restores', async () => {
  const selected = (await store.snapshot()).entries.slice(0, 2);
  const result = await operations.content({ action: 'trash', items: selection(selected) });
  expect(result.trashed).toHaveLength(2);
  await store.create(selected[0].kind, 'Occupied route', selected[0].slug);
  await expect(
    operations.trash({ action: 'restore', items: selection(result.trashed) }),
  ).rejects.toThrow('conflicts');
  expect(await store.listTrash()).toHaveLength(2);
  const occupied = (await store.snapshot()).entries.find(
    (entry) => entry.title === 'Occupied route',
  )!;
  await operations.content({ action: 'trash', items: selection([occupied]) });
  await operations.trash({ action: 'restore', items: selection(result.trashed) });
  expect(
    (await store.snapshot()).entries.filter((entry) => selected.some((old) => old.id === entry.id)),
  ).toHaveLength(2);
});
it('rolls back installed files after an I/O interruption', async () => {
  const selected = (await store.snapshot()).entries.slice(0, 2),
    files = selected.map((entry) => path.join(store.content, entry.kind, entry.file));
  const originals = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));
  await expect(
    store.exclusive(() =>
      commitFiles(
        root,
        files.map((file, index) => ({
          file,
          value: originals[index] + '\nA change.\n',
          expected: selected[index].revision,
        })),
        (index) => {
          if (index === 0) throw new Error('Simulated disk failure');
        },
      ),
    ),
  ).rejects.toThrow('Simulated disk failure');
  expect(await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).toEqual(originals);
});
it('recovers an applying transaction before returning a queued snapshot', async () => {
  const entry = (await store.snapshot()).entries[0],
    file = path.join(store.content, entry.kind, entry.file),
    original = await fs.readFile(file, 'utf8'),
    modified = original + '\nInterrupted edit.\n';
  const folder = path.join(root, '.studio/operations', randomUUID());
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'before-0'), original);
  await fs.writeFile(path.join(folder, 'after-0'), modified);
  await fs.writeFile(file, modified);
  await fs.writeFile(
    path.join(folder, 'plan.json'),
    JSON.stringify({
      version: 1,
      state: 'applying',
      steps: [
        { file: path.relative(root, file), before: digest(original), after: digest(modified) },
      ],
    }),
  );
  expect(
    (await new Store(root).snapshot()).entries.find((item) => item.id === entry.id)?.revision,
  ).toBe(entry.revision);
});
it('reviews Markdown import without writing and rejects stale reviews', async () => {
  const before = await store.snapshot();
  const review = await operations.reviewImport(
    [{ name: '笔记.md', text: '# 新的笔记\n\nA thought.\n' }],
    'posts',
  );
  expect(await store.snapshot()).toEqual(before);
  const imported = await operations.import(review.id, review.sourceRevision);
  expect(imported.entries[0].slug).toBe('新的笔记');
  expect(imported.entries[0].status).toBe('draft');
  const stale = await operations.reviewImport([{ name: 'next.md', text: '# Next' }], 'lab');
  await store.create('posts', 'A change', 'a-change');
  await expect(operations.import(stale.id, stale.sourceRevision)).rejects.toThrow(
    'notebook changed',
  );
});
it('exports byte-exact Markdown through an ordinary Unicode-safe tar archive', async () => {
  const entry = (await store.snapshot()).entries.find((entry) => entry.lang === 'zh')!;
  const service = new Exports(store, new BackupService(store));
  await service.initialize();
  const result = await service.prepare('content', selection([entry]));
  const download = service.download(result.url.split('/').at(-1)!);
  download.stream.destroy();
  const { stdout } = await promisify(execFile)('tar', [
    '-xOzf',
    download.file,
    entry.kind + '/' + entry.file,
  ]);
  expect(stdout).toBe(await fs.readFile(path.join(store.content, entry.kind, entry.file), 'utf8'));
});
it('validates backup selections before labels/deletion and preserves unselected archives', async () => {
  const backups = new BackupService(store),
    first = await backups.create(),
    second = await backups.create();
  await expect(
    backups.batch({
      action: 'delete',
      items: [{ id: first.id, revision: '0'.repeat(64) }, ...selection([second])],
    }),
  ).rejects.toThrow('No items were changed');
  expect(await backups.list()).toHaveLength(2);
  await backups.batch({ action: 'label', items: selection([first]), label: 'Before a large edit' });
  expect((await backups.list()).find((item) => item.id === first.id)?.label).toBe(
    'Before a large edit',
  );
  await backups.batch({ action: 'delete', items: selection([second]) });
  expect((await backups.list()).map((item) => item.id)).toEqual([first.id]);
});
it('keeps Markdown code examples out of the image usage graph', () => {
  expect(
    markdownMedia(
      '`/media/code.webp`\n\n![Photo][ref]\n\n[ref]: /media/actual.webp\n\n:::image-compare{before="/media/a.webp" after="/media/b.webp"}\n:::',
    ),
  ).toEqual(['/media/actual.webp', '/media/a.webp', '/media/b.webp']);
});
it('collects every raw-HTML source candidate, including entity-encoded attributes', () => {
  expect(
    markdownMedia(
      '<picture><source srcset="/media/small.webp 1x, /media/large.webp 2x"><img src="&#47;media/fallback.webp"></picture><a href="/media/hello world,photo.webp">Image</a><img srcset="/media/a(b);c.webp,/media/next.webp">',
    ),
  ).toEqual([
    '/media/small.webp',
    '/media/large.webp',
    '/media/fallback.webp',
    '/media/hello%20world%2Cphoto.webp',
    '/media/a(b)%3Bc.webp',
    '/media/next.webp',
  ]);
});
it('blocks referenced media and requires a fresh review plus a safety backup for unused cleanup', async () => {
  await fs.writeFile(
    path.join(store.content, 'media/unused.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
  );
  const backups = new BackupService(store),
    media = new MediaService(store),
    maintenance = new MediaMaintenance(store, media, backups, () => true);
  const audit = await maintenance.audit();
  const used = audit.items.find((item) => item.active.length && !item.missing)!;
  await expect(maintenance.review([used.url])).rejects.toThrow('Only unused');
  const review = await maintenance.review(['/media/unused.svg']);
  const result = await maintenance.cleanup(review.id, review.revision);
  expect(result.deleted).toBe(1);
  expect((await backups.list())[0].reason).toBe('before-cleanup');
  await expect(fs.access(path.join(store.content, 'media/unused.svg'))).rejects.toThrow();
});
it('runs local daily backups once due and prunes automatic copies only', async () => {
  const backups = new BackupService(store),
    manual = await backups.create();
  const scheduler = new BackupScheduler(
    backups,
    () => true,
    () => {},
  );
  const initial = await scheduler.summary();
  expect(initial.value.enabled).toBe(false);
  await scheduler.update({ enabled: true, keepAutomatic: 1, revision: initial.revision });
  const now = new Date();
  await scheduler.run(false, now);
  expect(await scheduler.run(false, now)).toEqual({ skipped: true });
  await scheduler.run(false, new Date(now.getTime() + 86400001));
  const records = await backups.list();
  expect(records.filter((item) => item.reason === 'automatic')).toHaveLength(1);
  expect(records.some((item) => item.id === manual.id)).toBe(true);
});
it('protects every new mutation with Studio token and origin checks', async () => {
  const context = await createApp(root, { watchFiles: false });
  try {
    for (const endpoint of [
      'content/batch',
      'trash/batch',
      'backups/batch',
      'photos/batch',
      'media/cleanup/review',
      'backup-settings/run',
    ]) {
      expect(
        (
          await context.app.request('http://localhost/api/' + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(403);
    }
  } finally {
    context.close();
  }
});

it('preserves an unexpected external edit and the journal during interrupted recovery', async () => {
  const entry = (await store.snapshot()).entries[0];
  const file = path.join(store.content, entry.kind, entry.file),
    original = await fs.readFile(file, 'utf8');
  const folder = path.join(root, '.studio/operations', randomUUID());
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'before-0'), original);
  await fs.writeFile(file, original + '\nAn unrelated external edit.\n');
  await fs.writeFile(
    path.join(folder, 'plan.json'),
    JSON.stringify({
      version: 1,
      state: 'applying',
      steps: [
        {
          file: path.relative(root, file),
          before: digest(original),
          after: digest(original + '\nBatch edit.\n'),
        },
      ],
    }),
  );
  await expect(new Store(root).snapshot()).rejects.toThrow('External edits were preserved');
  expect(await fs.readFile(file, 'utf8')).toContain('unrelated external edit');
  await expect(fs.access(path.join(folder, 'plan.json'))).resolves.toBeUndefined();
});

it('rejects unsafe transaction destinations and symlinks without touching their targets', async () => {
  const outside = path.join(root, 'unrelated.txt');
  await fs.writeFile(outside, 'Keep this.');
  await expect(
    store.exclusive(() => commitFiles(root, [{ file: outside, value: 'Changed.' }])),
  ).rejects.toThrow('Invalid operation path');
  const symlink = path.join(store.content, 'media/linked.svg');
  await fs.symlink(outside, symlink);
  await expect(
    store.exclusive(() => commitFiles(root, [{ file: symlink, value: 'Changed.' }])),
  ).rejects.toThrow('regular files');
  expect(await fs.readFile(outside, 'utf8')).toBe('Keep this.');
});

it('purges only selected Trash revisions and leaves other entry history intact', async () => {
  const selected = (await store.snapshot()).entries.slice(0, 2);
  const changed = await operations.content({
    action: 'featured',
    enabled: true,
    items: selection(selected),
  });
  const trashed = await operations.content({ action: 'trash', items: selection(changed.entries) });
  await operations.trash({ action: 'purge', items: selection([trashed.trashed[0]]) });
  expect((await store.listTrash()).map((entry) => entry!.id)).toEqual([selected[1].id]);
  await expect(fs.access(path.join(root, '.studio/revisions', selected[0].id))).rejects.toThrow();
  expect(await fs.readdir(path.join(root, '.studio/revisions', selected[1].id))).toContain(
    selected[1].revision + '.json',
  );
});

it('retains media referenced by Trash, article revisions, photo undo and About history', async () => {
  const media = new MediaService(store),
    backups = new BackupService(store),
    maintenance = new MediaMaintenance(store, media, backups, () => true);
  for (const name of ['retained-entry', 'retained-photo', 'retained-about'])
    await fs.copyFile(
      path.join(store.content, 'media/wave.svg'),
      path.join(store.content, `media/${name}.svg`),
    );
  let entry = (await store.snapshot()).entries[0];
  entry = await store.saveEntry(entry.id, {
    metadata: { ...entry, cover: '/media/retained-entry.svg' },
    body: entry.body,
    revision: entry.revision,
  });
  await operations.content({ action: 'trash', items: selection([entry]) });
  const model = await store.snapshot();
  const changed = await store.saveJson(
    'library',
    {
      ...model.library,
      photos: [
        ...model.library.photos,
        { ...model.library.photos[0], id: 'retained-photo', src: '/media/retained-photo.svg' },
      ],
    },
    model.libraryRevision,
  );
  await store.saveJson('library', model.library, changed.revision);
  const about = await store.saveAbout(
    '![Earlier portrait](/media/retained-about.svg)',
    model.about.revision,
  );
  await store.saveAbout('A current introduction.', about.revision);
  const audit = await maintenance.audit();
  for (const name of ['retained-entry', 'retained-photo', 'retained-about']) {
    const url = `/media/${name}.svg`,
      item = audit.items.find((item) => item.url === url)!;
    expect(item.history.length, name).toBeGreaterThan(0);
    await expect(maintenance.review([url])).rejects.toThrow('Only unused');
  }
  expect(audit.issues).toEqual([]);
});

it('invalidates cleanup when references change and removes an original only with its last variant', async () => {
  const media = new MediaService(store),
    backups = new BackupService(store),
    maintenance = new MediaMaintenance(store, media, backups, () => true);
  const first = await media.upload(
    new File([new Uint8Array(await cameraPicture())], 'original.jpg', { type: 'image/jpeg' }),
  );
  const second = await media.variant(first.sourceId!, { resize: { width: 200, height: 200 } });
  const review = await maintenance.review([first.url]);
  const model = await store.snapshot();
  const site = await store.saveJson(
    'site',
    { ...model.site, profile: { ...model.site.profile, portrait: first.url } },
    model.siteRevision,
  );
  await expect(maintenance.cleanup(review.id, review.revision)).rejects.toThrow('notebook changed');
  expect(await backups.list()).toHaveLength(0);
  await store.saveJson('site', model.site, site.revision);
  const fresh = await maintenance.review([first.url]);
  await maintenance.cleanup(fresh.id, fresh.revision);
  expect(
    (await media.source(first.sourceId!)).record.variants.map((variant) => variant.name),
  ).toEqual([second.name]);
  const last = await maintenance.review([second.url]);
  await maintenance.cleanup(last.id, last.revision);
  await expect(
    fs.access(path.join(root, '.studio/media-originals', first.sourceId!)),
  ).rejects.toThrow();
  expect((await backups.list()).filter((item) => item.reason === 'before-cleanup')).toHaveLength(2);
});

it('holds automatic backup failures until retry and preserves archive integrity checks', async () => {
  const backups = new BackupService(store),
    scheduler = new BackupScheduler(
      backups,
      () => true,
      () => {},
    );
  const initial = await scheduler.summary();
  await scheduler.update({ enabled: true, keepAutomatic: 14, revision: initial.revision });
  await fs.writeFile(path.join(store.content, 'site.json'), '{ invalid');
  await expect(scheduler.run(false)).rejects.toThrow();
  expect((await scheduler.summary()).value.error).not.toBe('');
  expect(await scheduler.run(false)).toEqual({ skipped: true });
  await fs.copyFile('tests/fixtures/notebook/site.json', path.join(store.content, 'site.json'));
  const retried = await scheduler.run();
  expect(retried).toHaveProperty('backup');
  expect((await scheduler.summary()).value.error).toBe('');
  const record = (await backups.list())[0];
  await fs.appendFile(path.join(root, '.studio/backups', record.id + '.json.gz'), 'corrupt');
  await expect(backups.download(record.id)).rejects.toThrow('checksum');
});
