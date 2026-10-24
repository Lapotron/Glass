import { beforeEach, afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pack } from 'tar-stream';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Store, digest } from '../src/engine/store.js';
import { BackupService } from '../src/engine/backup.js';
import { BackupUploads } from '../src/server/backup-uploads.js';
import {
  extractLargeBackup,
  indexBackupFiles,
  backupRevision,
} from '../src/engine/backup-archive.js';
import { commitFiles } from '../src/engine/file-transaction.js';
let root: string, store: Store;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-large-backup-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));
it('round trips a streaming archive with exact Unicode media, a reviewed restore and a complete safety archive', async () => {
  const media = path.join(root, 'content/media/海岸视频.mp4'),
    bytes = Buffer.from([0, 128, 255, 1, 64]);
  await fs.writeFile(media, bytes);
  await fs.writeFile(path.join(root, '.studio-credential-test'), 'Excluded source');
  const service = new BackupService(store),
    before = await store.snapshot(),
    record = await service.create('manual', 'large');
  expect(record.archiveFormat).toBe('tar');
  const { file } = await service.downloadFile(record.id);
  const review = await service.inspectFile(file);
  expect(review.archiveFormat).toBe('tar');
  expect(review.unpackedBytes).toBeGreaterThan(0);
  const entry = before.entries[0];
  await store.saveEntry(entry.id, {
    metadata: entry,
    body: 'Newer words to protect.',
    revision: entry.revision,
  });
  await expect(service.restore(review.id, review.sourceRevision)).rejects.toThrow('changed after');
  const current = await service.inspectFile(file);
  await fs.writeFile(media, 'Changed media');
  await expect(service.restore(current.id, current.sourceRevision)).rejects.toThrow(
    'changed after',
  );
  const accepted = await service.inspectFile(file);
  const restored = await service.restore(accepted.id, accepted.sourceRevision);
  expect(await fs.readFile(media)).toEqual(bytes);
  expect((await store.snapshot()).entries.find((item) => item.id === entry.id)?.body).toBe(
    entry.body,
  );
  const safety = await service.inspectSaved(restored.safetyBackup);
  await service.restore(safety.id, safety.sourceRevision);
  expect(await fs.readFile(media, 'utf8')).toBe('Changed media');
  expect((await store.snapshot()).entries.find((item) => item.id === entry.id)?.body).toBe(
    'Newer words to protect.\n',
  );
});
async function maliciousArchive(
  manifest: unknown,
  members: { name: string; bytes?: Buffer; type?: 'file' | 'symlink'; linkname?: string }[],
) {
  const archive = pack(),
    destination = path.join(root, 'malicious.tar.gz');
  const chunks: Buffer[] = [];
  const saving = pipeline(archive, createGzip(), async (source) => {
    for await (const chunk of source) chunks.push(Buffer.from(chunk));
  });
  await new Promise<void>((resolve, reject) =>
    archive.entry({ name: 'manifest.json' }, JSON.stringify(manifest), (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  for (const member of members)
    await new Promise<void>((resolve, reject) =>
      archive.entry(
        { name: member.name, type: member.type || 'file', linkname: member.linkname },
        member.bytes || Buffer.alloc(0),
        (error) => (error ? reject(error) : resolve()),
      ),
    );
  archive.finalize();
  await saving;
  await fs.writeFile(destination, Buffer.concat(chunks));
  return destination;
}
it('rejects traversal, links, duplicate members and missing payloads before changing the notebook', async () => {
  const original = backupRevision(await indexBackupFiles(root));
  const files = [
    { path: 'content/site.json', sha256: digest('one'), bytes: 3 },
    { path: 'content/library.json', sha256: digest('two'), bytes: 3 },
  ];
  const base = {
    format: 'fieldnotes-notebook',
    version: 3,
    createdAt: new Date().toISOString(),
    files,
  };
  const cases: [unknown, Parameters<typeof maliciousArchive>[1]][] = [
    [
      { ...base, files: [...files, { path: 'content/../outside', bytes: 0, sha256: digest('') }] },
      [],
    ],
    [base, [{ name: 'data/content/site.json', type: 'symlink', linkname: '/tmp/outside' }]],
    [
      base,
      [
        { name: 'data/content/site.json', bytes: Buffer.from('one') },
        { name: 'data/content/site.json', bytes: Buffer.from('one') },
      ],
    ],
    [base, [{ name: 'data/content/site.json', bytes: Buffer.from('bad') }]],
    [base, []],
  ];
  for (const [manifest, members] of cases) {
    const file = await maliciousArchive(manifest, members);
    await expect(
      extractLargeBackup(file, path.join(root, 'staged-' + crypto.randomUUID())),
    ).rejects.toThrow();
  }
  expect(backupRevision(await indexBackupFiles(root))).toBe(original);
});
it('resumes a private upload after server recreation and regenerates reviews after a restart', async () => {
  const backups = new BackupService(store),
    record = await backups.create('manual', 'large'),
    archive = await backups.download(record.id);
  const upload = new BackupUploads(backups),
    session = await upload.start({
      name: 'backup.tar.gz',
      bytes: archive.length,
      fingerprint: digest(archive),
    });
  const request = () =>
    new Request('https://studio.example/upload', {
      method: 'PUT',
      headers: { 'X-Part-SHA256': digest(archive) },
      body: new Uint8Array(archive),
    });
  await upload.part(session.id, 1, request());
  const restartedBackups = new BackupService(store),
    restarted = new BackupUploads(restartedBackups);
  expect((await restarted.status(session.id)).parts).toHaveLength(1);
  const review = await restarted.complete(session.id);
  const finalBackups = new BackupService(store),
    final = new BackupUploads(finalBackups),
    fresh = await final.complete(session.id);
  expect(fresh.id).not.toBe(review.id);
  expect(finalBackups.hasReview(fresh.id)).toBe(true);
  expect((await store.snapshot()).entries.length).toBeGreaterThan(0);
});
it('journals streamed source-file installation and rolls the complete group back on failure', async () => {
  const source = path.join(root, 'staged-source'),
    target = path.join(root, '.studio/backups/123-abc.tar.gz');
  await fs.writeFile(source, 'Exact archive bytes');
  await expect(
    commitFiles(
      root,
      [
        { file: target, source, expected: null },
        { file: path.join(root, 'content/about.md'), value: 'Changed text' },
      ],
      () => {
        throw new Error('Simulated failure');
      },
    ),
  ).rejects.toThrow('Simulated failure');
  await expect(fs.stat(target)).rejects.toThrow();
  expect(await fs.readFile(source, 'utf8')).toBe('Exact archive bytes');
});
