import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store, ConflictError } from '../src/engine/store.js';
import { BackupService } from '../src/engine/backup.js';

let root: string, store: Store;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-recovery-'));
  await fs.cp(path.join(process.cwd(), 'tests/fixtures/notebook'), path.join(root, 'content'), {
    recursive: true,
  });
  store = new Store(root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
describe('portable notebook backups', () => {
  it('round trips source and media, rejects stale reviews, and keeps a complete safety backup', async () => {
    const service = new BackupService(store),
      original = await store.read();
    const record = await service.create(),
      archive = await service.download(record.id);
    const entry = original.entries[0];
    const revised = await store.saveEntry(entry.id, {
      metadata: entry,
      body: 'Words before importing.',
      revision: entry.revision,
    });
    await fs.writeFile(path.join(root, 'content/media/new-asset.txt'), 'Exact media bytes');
    const draft = await store.create('posts', 'A recoverable draft', 'backup-draft');
    await store.trash(draft.id, draft.revision);
    const stale = await service.inspect(archive);
    const latest = await store.saveEntry(entry.id, {
      metadata: revised,
      body: 'An external edit after review.',
      revision: revised.revision,
    });
    await expect(service.restore(stale.id, stale.sourceRevision)).rejects.toBeInstanceOf(
      ConflictError,
    );
    const accepted = await service.inspect(archive),
      restored = await service.restore(accepted.id, accepted.sourceRevision);
    const model = await store.read();
    expect(model.entries.map((entry) => [entry.id, entry.revision])).toEqual(
      original.entries.map((entry) => [entry.id, entry.revision]),
    );
    await expect(fs.access(path.join(root, 'content/media/new-asset.txt'))).rejects.toThrow();
    const safety = await service.download(restored.safetyBackup),
      reviewSafety = await service.inspect(safety);
    await service.restore(reviewSafety.id, reviewSafety.sourceRevision);
    expect((await store.read()).entries.find((entry) => entry.id === latest.id)?.body).toBe(
      latest.body,
    );
    expect(await fs.readFile(path.join(root, 'content/media/new-asset.txt'), 'utf8')).toBe(
      'Exact media bytes',
    );
    expect((await store.listTrash()).some((item) => item?.id === draft.id)).toBe(true);
    expect((await store.listRevisions(entry.id)).length).toBeGreaterThan(0);
    expect((await service.list()).filter((item) => item.reason === 'before-restore')).toHaveLength(
      2,
    );
    const manifest = JSON.parse(gunzipSync(archive).toString('utf8'));
    expect(
      manifest.files.some((file: { path: string }) =>
        /jobs|builds|console|\.env|wrangler/.test(file.path),
      ),
    ).toBe(false);
  });
  it('rejects traversal, duplicate paths, corrupt payloads, and symlink exports before changing content', async () => {
    const service = new BackupService(store),
      before = await store.read(),
      record = await service.create(),
      archive = await service.download(record.id);
    const manifest = JSON.parse(gunzipSync(archive).toString('utf8'));
    for (const changed of [
      { ...manifest, files: [{ ...manifest.files[0], path: 'content/../outside' }] },
      { ...manifest, files: [...manifest.files, manifest.files[0]] },
      {
        ...manifest,
        files: manifest.files.map((file: { data: string }, index: number) =>
          index === 0 ? { ...file, data: 'aGVsbG8=' } : file,
        ),
      },
    ])
      await expect(service.inspect(gzipSync(JSON.stringify(changed)))).rejects.toThrow();
    await expect(service.inspect(Buffer.from('unreadable'))).rejects.toThrow('not a readable');
    expect((await store.read()).siteRevision).toBe(before.siteRevision);
    await fs.symlink(
      path.join(root, 'content/site.json'),
      path.join(root, 'content/media/outside.json'),
    );
    await expect(service.create()).rejects.toThrow('symbolic links');
  });
  it('rolls back a partially installed restore if a directory move fails', async () => {
    const service = new BackupService(store),
      record = await service.create(),
      archive = await service.download(record.id);
    const original = (await store.read()).entries[0],
      revised = await store.saveEntry(original.id, {
        metadata: original,
        body: 'Keep this work after the failure.',
        revision: original.revision,
      });
    const review = await service.inspect(archive),
      rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (
        String(from).includes('/accepted/') &&
        String(to) === path.join(root, '.studio/revisions')
      )
        throw new Error('Simulated move failure');
      return rename(from, to);
    });
    await expect(service.restore(review.id, review.sourceRevision)).rejects.toThrow(
      'Simulated move failure',
    );
    expect((await store.read()).entries.find((entry) => entry.id === revised.id)?.revision).toBe(
      revised.revision,
    );
    expect(await store.listRevisions(original.id)).toHaveLength(1);
    expect(service.restoring).toBe(false);
  });
});
describe('article recovery', () => {
  it('preserves byte-exact earlier versions and keeps the replaced version after a restore', async () => {
    const original = (await store.read()).entries[0];
    const raw = await fs.readFile(path.join(root, 'content', original.kind, original.file), 'utf8');
    const revised = await store.saveEntry(original.id, {
      metadata: { ...original, title: 'A revised thought' },
      body: 'A different paragraph.\n',
      revision: original.revision,
    });
    const history = await store.listRevisions(original.id);
    expect(history).toHaveLength(1);
    expect(history[0].revision).toBe(original.revision);
    const record = JSON.parse(
      await fs.readFile(
        path.join(root, '.studio/revisions', original.id, `${original.revision}.json`),
        'utf8',
      ),
    );
    expect(record.raw).toBe(raw);
    const restored = await store.restoreRevision(original.id, original.revision, revised.revision);
    expect(restored.title).toBe(original.title);
    expect(restored.body).toBe(original.body);
    expect((await store.getRevision(original.id, revised.revision)).entry.body).toBe(revised.body);
    const recovered = await store.restoreRevision(original.id, revised.revision, restored.revision);
    expect(recovered.title).toBe('A revised thought');
    expect(recovered.body).toBe('A different paragraph.\n');
  });
  it('rejects stale restores, damaged history, and historical route collisions without changing the entry', async () => {
    const original = (await store.read()).entries[0];
    const revised = await store.saveEntry(original.id, {
      metadata: { ...original, slug: 'a-revised-route' },
      body: 'New words.',
      revision: original.revision,
    });
    await expect(
      store.restoreRevision(original.id, original.revision, original.revision),
    ).rejects.toBeInstanceOf(ConflictError);
    await store.create(original.kind, 'Another entry', original.slug);
    await expect(
      store.restoreRevision(original.id, original.revision, revised.revision),
    ).rejects.toThrow('URL is already in use');
    expect((await store.read()).entries.find((entry) => entry.id === original.id)?.revision).toBe(
      revised.revision,
    );
    const file = path.join(root, '.studio/revisions', original.id, `${original.revision}.json`);
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    record.raw += 'tampered';
    await fs.writeFile(file, JSON.stringify(record));
    await expect(store.getRevision(original.id, original.revision)).rejects.toThrow('damaged');
    await expect(store.getRevision('../other', original.revision)).rejects.toThrow();
  });
});
