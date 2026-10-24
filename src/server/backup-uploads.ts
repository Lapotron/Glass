import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { atomicWrite } from '../engine/store.js';
import { hashBackupFile } from '../engine/backup-archive.js';
import { BackupService, type RestoreReview } from '../engine/backup.js';
import { boundedUploadBody } from '../cloud/transfers.js';
import {
  BACKUP_CHUNK_BYTES,
  BACKUP_UPLOAD_TTL_MS,
  backupPartBytes,
  backupUploadSchema,
  type BackupUpload,
} from '../shared/backup-transfer.js';

type Session = BackupUpload & { review?: RestoreReview };
export class BackupUploads {
  private operations = new Map<string, Promise<unknown>>();
  constructor(readonly backups: BackupService) {}
  private folder(id: string) {
    z.uuid().parse(id);
    return path.join(this.backups.store.root, '.studio/backup-uploads', id);
  }
  private async exclusive<T>(id: string, work: () => Promise<T>) {
    const previous = this.operations.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.operations.set(id, next);
    try {
      return await next;
    } finally {
      if (this.operations.get(id) === next) this.operations.delete(id);
    }
  }
  async status(id: string): Promise<Session> {
    await this.safeFolder(this.folder(id));
    if ((await fs.lstat(path.join(this.folder(id), 'session.json'))).isSymbolicLink())
      throw new Error('Backup uploads cannot use symbolic links.');
    const value = JSON.parse(
      await fs.readFile(path.join(this.folder(id), 'session.json'), 'utf8'),
    ) as Session;
    if (value.id !== id || Date.parse(value.expiresAt) < Date.now())
      throw new Error('This transfer expired. Choose the archive again.');
    return value;
  }
  private async safeFolder(folder: string) {
    for (const directory of [
      path.join(this.backups.store.root, '.studio'),
      path.join(this.backups.store.root, '.studio/backup-uploads'),
      folder,
    ]) {
      const stat = await fs.lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error('Backup uploads cannot use symbolic links.');
    }
  }
  private save(value: Session) {
    return atomicWrite(path.join(this.folder(value.id), 'session.json'), JSON.stringify(value));
  }
  async start(input: unknown) {
    const data = backupUploadSchema.parse(input);
    const base = path.join(this.backups.store.root, '.studio/backup-uploads');
    await fs.mkdir(base, { recursive: true, mode: 0o700 });
    await this.safeFolder(base);
    let active = 0;
    for (const name of await fs.readdir(base)) {
      if (!z.uuid().safeParse(name).success) continue;
      await this.safeFolder(this.folder(name));
      let record: Session;
      try {
        record = await this.status(name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        if (!/transfer expired/.test((error as Error).message)) throw error;
        if (!this.operations.has(name))
          await fs.rm(this.folder(name), { recursive: true, force: true });
        continue;
      }
      if (Date.parse(record.expiresAt) <= Date.now()) {
        await fs.rm(this.folder(name), { recursive: true, force: true });
        continue;
      }
      if (
        record.state === 'uploading' &&
        record.fingerprint === data.fingerprint &&
        record.bytes === data.bytes &&
        record.name === data.name
      )
        return record;
      if (record.state === 'uploading') active++;
    }
    if (active >= 3) throw new Error('Resume or discard an unfinished backup upload first.');
    const disk = await fs.statfs(base);
    if (disk.bavail * disk.bsize < data.bytes * 2 + 64 * 1024 ** 2)
      throw new Error(
        'Not enough disk space to stage this archive and its review. Free space before importing.',
      );
    const value: Session = {
      ...data,
      id: randomUUID(),
      chunkBytes: BACKUP_CHUNK_BYTES,
      parts: [],
      state: 'uploading',
      expiresAt: new Date(Date.now() + BACKUP_UPLOAD_TTL_MS).toISOString(),
    };
    await this.save(value);
    return value;
  }
  async part(id: string, part: number, request: Request) {
    const initial = await this.status(id);
    const bytes = await boundedUploadBody(request, backupPartBytes(initial.bytes, part));
    const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    if (
      bytes.byteLength !== backupPartBytes(initial.bytes, part) ||
      request.headers.get('X-Part-SHA256') !== sha256
    )
      throw new Error('Upload part size or checksum does not match.');
    return this.exclusive(id, async () => {
      const value = await this.status(id);
      if (value.state !== 'uploading') throw new Error('This transfer is already complete.');
      const existing = value.parts.find((item) => item.part === part);
      if (existing && existing.sha256 !== sha256)
        throw new Error('This upload part belongs to a different file.');
      await atomicWrite(path.join(this.folder(id), 'part-' + part), Buffer.from(bytes));
      if (!existing) value.parts.push({ part, bytes: bytes.byteLength, sha256 });
      value.parts.sort((a, b) => a.part - b.part);
      await this.save(value);
      return { part, bytes: bytes.byteLength, sha256 };
    });
  }
  async complete(id: string, renew = false) {
    return this.exclusive(id, async () => {
      const value = await this.status(id),
        folder = this.folder(id);
      if (renew) value.review = undefined;
      if (
        value.review &&
        Date.parse(value.review.expiresAt || '') > Date.now() &&
        this.backups.hasReview(value.review.id)
      )
        return value.review;
      if (
        value.parts.length !== Math.ceil(value.bytes / BACKUP_CHUNK_BYTES) ||
        value.parts.some(
          (part, index) =>
            part.part !== index + 1 || part.bytes !== backupPartBytes(value.bytes, part.part),
        )
      )
        throw new Error('Upload is incomplete. Resume the remaining parts.');
      const archive = path.join(folder, 'archive');
      if (value.state !== 'ready') {
        const chunks = async function* () {
          for (const part of value.parts) {
            const file = path.join(folder, 'part-' + part.part);
            if ((await hashBackupFile(file)) !== part.sha256)
              throw new Error('An uploaded part changed. Upload it again.');
            yield* createReadStream(file);
          }
        };
        const temporary = path.join(folder, 'assembling-' + randomUUID());
        try {
          await pipeline(
            Readable.from(chunks()),
            createWriteStream(temporary, { mode: 0o600, flags: 'wx' }),
          );
          if ((await fs.stat(temporary)).size !== value.bytes)
            throw new Error('The assembled upload has an unexpected size.');
          await fs.rename(temporary, archive);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      }
      if ((await fs.lstat(archive)).isSymbolicLink())
        throw new Error('Backup uploads cannot use symbolic links.');
      value.review = await this.backups.inspectFile(archive);
      value.state = 'ready';
      await this.save(value);
      // The assembled archive is retained for a repeat review; individual chunks are disposable.
      for (const part of value.parts)
        await fs.rm(path.join(folder, 'part-' + part.part), { force: true });
      return value.review;
    });
  }
  async discard(id: string) {
    return this.exclusive(id, async () => {
      await this.safeFolder(path.dirname(this.folder(id)));
      await fs.rm(this.folder(id), { recursive: true, force: true });
      return { ok: true };
    });
  }
}
