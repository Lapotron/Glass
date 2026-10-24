import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Store, digest } from '../src/engine/store.js';
import { Operations } from '../src/engine/operations.js';
import { BackupService } from '../src/engine/backup.js';
import { MediaService } from '../src/engine/media.js';
import { MediaMaintenance } from '../src/engine/media-maintenance.js';
import { createApp } from '../src/server/app.js';

let root: string, store: Store, operations: Operations;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-photo-trash-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  operations = new Operations(store);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
const selection = (items: { id: string; revision: string }[]) =>
  items.map(({ id, revision }) => ({ id, revision }));
async function remove(count = 2) {
  const model = await store.snapshot();
  await operations.photos({
    action: 'remove',
    ids: model.library.photos.slice(0, count).map((photo) => photo.id),
    revision: model.libraryRevision,
  });
  return model;
}
it('retains whole photo records across a restart and restores them without replacing later journal edits', async () => {
  const original = await remove(),
    restarted = new Store(root);
  const trash = await restarted.listPhotoTrash();
  expect(trash).toHaveLength(2);
  expect(trash.map((item) => item.photo)).toEqual(
    expect.arrayContaining(original.library.photos.slice(0, 2)),
  );
  const current = await restarted.snapshot();
  const changed = await restarted.saveJson(
    'library',
    {
      ...current.library,
      photos: current.library.photos.map((photo) => ({
        ...photo,
        caption: photo.caption + ' — edited later',
      })),
    },
    current.libraryRevision,
  );
  await new Operations(restarted).trash({
    action: 'restore',
    items: selection(trash),
    libraryRevision: changed.revision,
  });
  const restored = (await restarted.snapshot()).library.photos;
  expect(restored.slice(0, 2)).toEqual(original.library.photos.slice(0, 2));
  expect(restored.slice(2).every((photo) => photo.caption.endsWith('edited later'))).toBe(true);
  expect(await restarted.listPhotoTrash()).toEqual([]);
  for (const photo of original.library.photos)
    await expect(fs.access(path.join(root, 'content', photo.src))).resolves.toBeUndefined();
});
it('captures photos removed through ordinary library saves and reconciles grouped Undo with Trash', async () => {
  const original = await store.snapshot();
  const saved = await store.saveJson(
    'library',
    { ...original.library, photos: original.library.photos.slice(2) },
    original.libraryRevision,
  );
  expect(await store.listPhotoTrash()).toHaveLength(2);
  const undone = await store.undoLibrary(saved.revision);
  expect(undone.value.photos).toEqual(original.library.photos);
  expect(await store.listPhotoTrash()).toEqual([]);
  await operations.photos({
    action: 'remove',
    ids: [original.library.photos[0].id],
    revision: undone.revision,
  });
  expect(await store.listPhotoTrash()).toHaveLength(1);
});
it('rejects stale or duplicate photo removals before changing the collection or creating receipts', async () => {
  const model = await store.snapshot(),
    id = model.library.photos[0].id;
  for (const input of [
    { ids: [id], revision: '0'.repeat(64) },
    { ids: [id, id], revision: model.libraryRevision },
    { ids: [id, 'missing-photo'], revision: model.libraryRevision },
  ])
    await expect(operations.photos({ action: 'remove', ...input })).rejects.toThrow(
      'photo journal changed',
    );
  expect(await store.snapshot()).toEqual(model);
  expect(await store.listPhotoTrash()).toEqual([]);
});
it('validates a mixed entry/photo restore as one group and rejects reused photo identities', async () => {
  const original = await remove(),
    entry = original.entries[0];
  const removedEntry = await operations.content({ action: 'trash', items: selection([entry]) });
  const photos = await store.listPhotoTrash(),
    current = await store.snapshot();
  const items = selection([...removedEntry.trashed, ...photos]);
  await expect(
    operations.trash({ action: 'restore', items, libraryRevision: original.libraryRevision }),
  ).rejects.toThrow('photo journal changed');
  expect((await store.snapshot()).entries.some((item) => item.id === entry.id)).toBe(false);
  await expect(
    operations.trash({
      action: 'restore',
      items: [{ ...items[0], revision: '0'.repeat(64) }, ...items.slice(1)],
      libraryRevision: current.libraryRevision,
    }),
  ).rejects.toThrow('No items were changed');
  const duplicate = await store.saveJson(
    'library',
    {
      ...current.library,
      photos: [
        ...current.library.photos,
        { ...photos[0].photo, caption: 'A newer photo with this identity' },
      ],
    },
    current.libraryRevision,
  );
  await expect(
    operations.trash({ action: 'restore', items, libraryRevision: duplicate.revision }),
  ).rejects.toThrow('already in the photo journal');
  expect(await store.listPhotoTrash()).toHaveLength(2);
  expect((await store.listTrash()).some((item) => item.id === entry.id)).toBe(true);
});
it('purges only selected photo records and keeps images and unselected receipts', async () => {
  const original = await remove(),
    photos = await store.listPhotoTrash();
  await operations.trash({ action: 'purge', items: selection([photos[0]]) });
  expect((await store.listPhotoTrash()).map((item) => item.id)).toEqual([photos[1].id]);
  for (const photo of original.library.photos)
    await expect(fs.access(path.join(root, 'content', photo.src))).resolves.toBeUndefined();
  expect((await store.snapshot()).library.photos).toEqual(original.library.photos.slice(2));
});
it('protects photo Trash references independently of collection Undo and blocks cleanup of damaged records', async () => {
  await remove();
  await fs.rm(path.join(root, '.studio/history'), { recursive: true });
  const maintenance = new MediaMaintenance(
    store,
    new MediaService(store),
    new BackupService(store),
    () => true,
  );
  const photo = (await store.listPhotoTrash())[0],
    audit = await maintenance.audit();
  expect(audit.items.find((item) => item.url === photo.photo.src)?.history).toContain(
    'Photo Trash: ' + photo.title,
  );
  await expect(maintenance.review([photo.photo.src])).rejects.toThrow('Only unused');
  await fs.writeFile(path.join(root, '.studio/trash/photos', photo.id + '.json'), '{}');
  expect((await maintenance.audit()).issues.join(' ')).toContain('Cleanup is blocked');
});
it('round trips photo Trash in portable backups and rejects a malformed receipt before restoration', async () => {
  await remove();
  const photos = await store.listPhotoTrash(),
    backups = new BackupService(store),
    record = await backups.create(),
    archive = await backups.download(record.id);
  const manifest = JSON.parse(gunzipSync(archive).toString('utf8'));
  expect(
    manifest.files.filter((file: { path: string }) =>
      file.path.startsWith('history/trash/photos/'),
    ),
  ).toHaveLength(2);
  await operations.trash({ action: 'purge', items: selection(photos) });
  const review = await backups.inspect(archive);
  await backups.restore(review.id, review.sourceRevision);
  expect(await store.listPhotoTrash()).toEqual(photos);
  const receipt = manifest.files.find((file: { path: string }) =>
    file.path.startsWith('history/trash/photos/'),
  );
  const raw = JSON.stringify({
    ...JSON.parse(Buffer.from(receipt.data, 'base64').toString('utf8')),
    photo: { src: '/media/only-a-path.svg' },
  });
  receipt.data = Buffer.from(raw).toString('base64');
  receipt.sha256 = digest(raw);
  await expect(backups.inspect(gzipSync(JSON.stringify(manifest)))).rejects.toThrow(
    'photo Trash record',
  );
  expect(await store.listPhotoTrash()).toEqual(photos);
});
it('rolls back photo receipts, history and source together if the library installation fails', async () => {
  const original = await store.snapshot(),
    rename = fs.rename.bind(fs);
  let failed = false;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (!failed && String(to) === path.join(root, 'content/library.json')) {
      failed = true;
      throw new Error('Simulated photo save failure');
    }
    return rename(from, to);
  });
  await expect(remove()).rejects.toThrow('Simulated photo save failure');
  expect(await store.snapshot()).toEqual(original);
  expect(await store.listPhotoTrash()).toEqual([]);
  expect(await fs.readdir(path.join(root, '.studio/history'))).toEqual([]);
});
it('exposes photo Trash through protected Studio APIs and rejects a stale restore review', async () => {
  const context = await createApp(root, { watchFiles: false });
  try {
    const bootstrap = await (await context.app.request('http://localhost/api/bootstrap')).json();
    const headers = {
      'Content-Type': 'application/json',
      'X-Studio-Token': bootstrap.token,
      Origin: 'http://localhost',
    };
    const response = await context.app.request('http://localhost/api/photos/batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'remove',
        ids: [bootstrap.library.photos[0].id],
        revision: bootstrap.libraryRevision,
      }),
    });
    expect(response.status).toBe(200);
    const current = await response.json();
    const trash = await (await context.app.request('http://localhost/api/trash')).json();
    expect(trash[0].kind).toBe('photos');
    const stale = await context.app.request('http://localhost/api/trash/batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'restore',
        items: selection(trash),
        libraryRevision: bootstrap.libraryRevision,
      }),
    });
    expect(stale.status).toBe(409);
    const restored = await context.app.request('http://localhost/api/trash/batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'restore',
        items: selection(trash),
        libraryRevision: current.revision,
      }),
    });
    expect(restored.status).toBe(200);
    expect((await store.snapshot()).library.photos).toEqual(bootstrap.library.photos);
  } finally {
    context.close();
  }
});
