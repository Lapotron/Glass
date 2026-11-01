/** Verify one explicitly selected archive in a disposable notebook, never the author's notebook. */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BackupService } from '../src/engine/backup.js';
import { hashBackupFile } from '../src/engine/backup-archive.js';
import { Store } from '../src/engine/store.js';

const at = process.argv.indexOf('--source');
if (at < 0 || !process.argv[at + 1])
  throw new Error('Pass --source with the backup archive to verify.');
const archive = path.resolve(process.argv[at + 1]);
const before = await hashBackupFile(archive);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-backup-verify-'));
try {
  await fs.cp('tests/fixtures/notebook', path.join(temporary, 'content'), { recursive: true });
  const store = new Store(temporary);
  const service = new BackupService(store);
  const review = await service.inspectFile(archive);
  const result = await service.restore(review.id, review.sourceRevision);
  await store.read();
  await service.inspectSaved(result.safetyBackup);
  assert.equal(
    await hashBackupFile(archive),
    before,
    'Source archive changed during verification.',
  );
  console.log(
    JSON.stringify({
      verified: 'isolated review, restore and safety-backup review',
      format: review.archiveFormat,
      files: review.files,
      entries: review.entries,
      media: review.media,
      revisions: review.revisions,
      sourceUnchanged: true,
    }),
  );
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
