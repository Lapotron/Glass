/** Opt-in, real multi-GiB fixture. Never reads or changes the author's notebook. */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Store } from '../src/engine/store.js';
import { BackupService } from '../src/engine/backup.js';
import { hashBackupFile } from '../src/engine/backup-archive.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-backup-benchmark-'));
const bytes = Number(process.env.GLASS_BACKUP_BENCH_BYTES || 2 * 1024 ** 3 + 17);
if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 3 * 1024 ** 3)
  throw new Error('Choose a fixture size between 1 byte and 3 GiB.');
const started = Date.now();
let peak = process.memoryUsage().rss;
const timer = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().rss);
}, 25);
try {
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  const media = path.join(root, 'content/media/large-migration-fixture.mp4');
  const handle = await fs.open(media, 'wx', 0o600),
    chunk = randomBytes(1024 ** 2);
  try {
    for (let offset = 0; offset < bytes; offset += chunk.length)
      await handle.write(chunk.subarray(0, Math.min(chunk.length, bytes - offset)));
  } finally {
    await handle.close();
  }
  console.log('Created isolated fixture: ' + bytes + ' bytes.');
  const expected = await hashBackupFile(media),
    service = new BackupService(new Store(root));
  const record = await service.create('manual', 'large');
  console.log('Streaming archive created: ' + record.bytes + ' bytes.');
  assert.equal(record.archiveFormat, 'tar');
  if (bytes > 2 * 1024 ** 3)
    assert.ok(record.bytes > 2 * 1024 ** 3, 'Expected an actual multi-GiB compressed archive.');
  const review = await service.inspectSaved(record.id);
  await fs.writeFile(media, 'A newer file that the safety archive must retain.');
  const refreshed = await service.inspectSaved(record.id);
  await assert.rejects(service.restore(review.id, review.sourceRevision), /changed after/);
  const result = await service.restore(refreshed.id, refreshed.sourceRevision);
  assert.equal(await hashBackupFile(media), expected);
  const safety = await service.inspectSaved(result.safetyBackup);
  await service.restore(safety.id, safety.sourceRevision);
  assert.equal(
    await fs.readFile(media, 'utf8'),
    'A newer file that the safety archive must retain.',
  );
  peak = Math.max(peak, process.memoryUsage().rss);
  assert.ok(peak < 768 * 1024 ** 2, 'Peak RSS exceeded the bounded-memory benchmark allowance.');
  console.log(
    JSON.stringify({
      fixtureBytes: bytes,
      archiveBytes: record.bytes,
      peakRssMiB: Math.round(peak / 1024 ** 2),
      seconds: Math.round((Date.now() - started) / 1000),
      verified: 'exact media hash, stale review refusal, restore and safety restore',
    }),
  );
} finally {
  clearInterval(timer);
  await fs.rm(root, { recursive: true, force: true });
}
