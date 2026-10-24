import { z } from 'zod';
import {
  backupUploadSchema,
  BACKUP_CHUNK_BYTES,
  BACKUP_UPLOAD_TTL_MS,
  backupPartBytes,
  type BackupUpload,
} from '../shared/backup-transfer.js';
import { CloudError, hash, type CloudEnv } from './types.js';
import { reserveObject, discardTransferObject } from './storage.js';
import { filePath, privatePath } from './workspace.js';
type Transfer = {
  id: string;
  actor: string;
  purpose: 'backup' | 'file' | 'object' | 'migration';
  key: string;
  upload_id: string;
  bytes: number;
  fingerprint: string;
  name: string;
  target: string | null;
  sha: string | null;
  modified: string | null;
  job_id: string | null;
  state: 'uploading' | 'assembling' | 'ready' | 'cancelled';
  expires: string;
  unindexed: number;
};
export async function boundedUploadBody(request: Request, maximum: number) {
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new CloudError('Upload part exceeds its size limit.', 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new CloudError('Upload part exceeds its size limit.', 413);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
export class CloudTransfers {
  constructor(readonly env: CloudEnv) {}
  async row(id: string, actor: string) {
    z.uuid().parse(id);
    const row = await this.env.DB.prepare('SELECT * FROM cloud_transfers WHERE id=? AND actor=?')
      .bind(id, actor)
      .first<Transfer>();
    if (!row || row.state === 'cancelled')
      throw new CloudError('Backup transfer was not found.', 404);
    if (Date.parse(row.expires) < Date.now())
      throw new CloudError(
        'This transfer expired. Choose the archive again to start a new upload.',
        410,
      );
    return row;
  }
  async status(id: string, actor: string): Promise<BackupUpload> {
    const row = await this.row(id, actor);
    const parts = await this.env.DB.prepare(
      'SELECT part,bytes,sha256,etag FROM cloud_transfer_parts WHERE id=? ORDER BY part',
    )
      .bind(id)
      .all<BackupUpload['parts'][number]>();
    const job =
      row.purpose === 'backup' && row.job_id
        ? await this.env.DB.prepare('SELECT state,error FROM cloud_jobs WHERE id=?')
            .bind(row.job_id)
            .first<{ state: string; error: string | null }>()
        : null;
    return {
      id: row.id,
      name: row.name,
      bytes: row.bytes,
      fingerprint: row.fingerprint,
      chunkBytes: BACKUP_CHUNK_BYTES,
      parts: parts.results,
      expiresAt: row.expires,
      state: row.state === 'ready' ? 'ready' : 'uploading',
      ...(row.job_id ? { jobId: row.job_id } : {}),
      ...(job ? { jobState: job.state, ...(job.error ? { error: job.error } : {}) } : {}),
    };
  }
  async start(
    actor: string,
    input: unknown,
    destination?: {
      purpose: 'file' | 'object' | 'migration';
      target: string;
      sha: string;
      job: string;
      modified?: string;
      unindexed?: boolean;
      retentionDays?: 7;
    },
  ) {
    if (this.env.PREVIEW === 'true')
      throw new CloudError('Large transfers are disabled in branch previews.', 403);
    const data = backupUploadSchema.parse(input);
    const purpose = destination?.purpose || 'backup';
    if (purpose === 'backup' || purpose === 'migration') {
      const expired = (
        await this.env.DB.prepare(
          "SELECT id FROM cloud_transfers WHERE actor=? AND purpose=? AND expires<=? AND state!='cancelled' LIMIT 3",
        )
          .bind(actor, purpose, new Date().toISOString())
          .all<{ id: string }>()
      ).results;
      for (const item of expired) await this.discard(item.id, actor).catch(() => {});
    }
    if (destination) {
      z.string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(destination.sha);
      if (purpose === 'file' || purpose === 'migration') {
        filePath(destination.target);
        if (privatePath(destination.target))
          throw new CloudError('Encrypted settings must use the bounded settings API.');
      } else if (!/^[\w.-]{1,150}$/.test(destination.target))
        throw new CloudError('Invalid result object.');
    }
    const existing = await this.env.DB.prepare(
      "SELECT id FROM cloud_transfers WHERE actor=? AND purpose=? AND fingerprint=? AND bytes=? AND COALESCE(target,'')=? AND COALESCE(job_id,'')=? AND expires>? AND state!='cancelled' ORDER BY created DESC LIMIT 1",
    )
      .bind(
        actor,
        purpose,
        data.fingerprint,
        data.bytes,
        destination?.target || '',
        destination?.job || '',
        new Date().toISOString(),
      )
      .first<{ id: string }>();
    if (existing) return this.status(existing.id, actor);
    const active = await this.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM cloud_transfers WHERE actor=? AND purpose=? AND state IN ('uploading','assembling') AND expires>?",
    )
      .bind(actor, purpose, new Date().toISOString())
      .first<{ count: number }>();
    if ((active?.count || 0) >= (purpose === 'backup' ? 3 : 16))
      throw new CloudError(
        'Too many unfinished transfers. Resume or discard an existing upload first.',
        429,
      );
    const id = crypto.randomUUID(),
      key = 'transfers/' + id + '/data';
    await reserveObject(this.env, key, data.bytes);
    let upload;
    try {
      upload = await this.env.BUCKET.createMultipartUpload(key);
    } catch (error) {
      await discardTransferObject(this.env, key);
      throw error;
    }
    const now = new Date().toISOString();
    try {
      await this.env.DB.prepare(
        'INSERT INTO cloud_transfers(id,actor,purpose,key,upload_id,bytes,fingerprint,name,target,sha,modified,job_id,created,expires) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
        .bind(
          id,
          actor,
          purpose,
          key,
          upload.uploadId,
          data.bytes,
          data.fingerprint,
          data.name,
          destination?.target || null,
          destination?.sha || null,
          destination?.modified || null,
          destination?.job || null,
          now,
          new Date(
            Date.now() +
              (purpose === 'migration' || destination?.retentionDays === 7
                ? 7 * 86400000
                : BACKUP_UPLOAD_TTL_MS),
          ).toISOString(),
        )
        .run();
      if (destination?.unindexed)
        await this.env.DB.prepare('UPDATE cloud_transfers SET unindexed=1 WHERE id=?')
          .bind(id)
          .run();
    } catch (error) {
      await upload.abort();
      await discardTransferObject(this.env, key);
      throw error;
    }
    return this.status(id, actor);
  }
  async part(id: string, actor: string, part: number, request: Request) {
    const row = await this.row(id, actor);
    if (row.state !== 'uploading')
      throw new CloudError('This transfer is already being finalized.', 409);
    const bytes = await boundedUploadBody(request, backupPartBytes(row.bytes, part));
    const sha256 = await hash(bytes);
    if (
      bytes.byteLength !== backupPartBytes(row.bytes, part) ||
      request.headers.get('X-Part-SHA256') !== sha256
    )
      throw new CloudError('Upload part size or checksum does not match.');
    const existing = await this.env.DB.prepare(
      'SELECT sha256,etag FROM cloud_transfer_parts WHERE id=? AND part=?',
    )
      .bind(id, part)
      .first<{ sha256: string; etag: string }>();
    if (existing) {
      if (existing.sha256 !== sha256)
        throw new CloudError('This upload part belongs to a different file.', 409);
      return { part, bytes: bytes.byteLength, sha256 };
    }
    const uploaded = await this.env.BUCKET.resumeMultipartUpload(row.key, row.upload_id).uploadPart(
      part,
      bytes,
    );
    await this.env.DB.prepare(
      "INSERT INTO cloud_transfer_parts(id,part,bytes,sha256,etag) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cloud_transfers WHERE id=? AND state='uploading') ON CONFLICT(id,part) DO NOTHING",
    )
      .bind(id, part, bytes.byteLength, sha256, uploaded.etag, id)
      .run();
    if (row.purpose === 'migration')
      await this.env.DB.batch([
        this.env.DB.prepare('UPDATE cloud_transfers SET expires=? WHERE id=?').bind(
          new Date(Date.now() + 7 * 86400000).toISOString(),
          id,
        ),
        this.env.DB.prepare('UPDATE cloud_migrations SET touched=? WHERE id=?').bind(
          new Date().toISOString(),
          row.job_id,
        ),
      ]);
    if (
      row.purpose === 'file' &&
      (await this.env.DB.prepare('SELECT id FROM cloud_media_uploads WHERE id=? AND actor=?')
        .bind(row.job_id, actor)
        .first())
    )
      await this.env.DB.batch([
        this.env.DB.prepare('UPDATE cloud_transfers SET expires=? WHERE id=?').bind(
          new Date(Date.now() + 7 * 86400000).toISOString(),
          id,
        ),
        this.env.DB.prepare('UPDATE cloud_media_uploads SET updated=? WHERE id=?').bind(
          new Date().toISOString(),
          row.job_id,
        ),
      ]);
    return { part, bytes: bytes.byteLength, sha256 };
  }
  async finish(id: string, actor: string) {
    const row = await this.row(id, actor);
    if (row.state === 'ready') return row;
    const parts = (
      await this.env.DB.prepare(
        'SELECT part,bytes,etag FROM cloud_transfer_parts WHERE id=? ORDER BY part',
      )
        .bind(id)
        .all<{ part: number; bytes: number; etag: string }>()
    ).results;
    if (
      parts.length !== Math.ceil(row.bytes / BACKUP_CHUNK_BYTES) ||
      parts.some(
        (part, index) =>
          part.part !== index + 1 || part.bytes !== backupPartBytes(row.bytes, part.part),
      )
    )
      throw new CloudError('Upload is incomplete. Resume the remaining parts.', 409);
    if (row.state === 'uploading') {
      const claimed = await this.env.DB.prepare(
        "UPDATE cloud_transfers SET state='assembling' WHERE id=? AND state='uploading' RETURNING id",
      )
        .bind(id)
        .first();
      if (!claimed) {
        const latest = await this.row(id, actor);
        if (latest.state === 'ready') return latest;
      }
    }
    let object = await this.env.BUCKET.head(row.key);
    if (!object) {
      try {
        object = await this.env.BUCKET.resumeMultipartUpload(row.key, row.upload_id).complete(
          parts.map((part) => ({ partNumber: part.part, etag: part.etag })),
        );
      } catch (error) {
        object = await this.env.BUCKET.head(row.key);
        if (!object) throw error;
      }
    }
    if (object.size !== row.bytes)
      throw new CloudError('The assembled upload has an unexpected length.');
    if (row.purpose !== 'backup') {
      const key =
        row.purpose === 'file' || row.purpose === 'migration'
          ? 'workspace/blobs/' + row.sha
          : 'jobs/' + row.job_id + '/objects/' + row.target;
      await reserveObject(this.env, key, row.bytes);
      const existing = await this.env.BUCKET.head(key);
      if (!existing || existing.size !== row.bytes || existing.customMetadata?.sha256 !== row.sha) {
        const source = await this.env.BUCKET.get(row.key);
        if (!source) throw new CloudError('The transfer object is missing.');
        // R2 verifies SHA-256 while consuming the stream; the Worker never buffers the object.
        await this.env.BUCKET.put(key, source.body, {
          sha256: row.sha,
          customMetadata: { sha256: row.sha! },
        });
      }
      if (!row.unindexed && (row.purpose === 'file' || row.purpose === 'migration'))
        await this.env.DB.prepare(
          'INSERT INTO cloud_patches(id,path,sha,bytes,modified,text,encrypted) VALUES(?,?,?,?,?,NULL,0) ON CONFLICT(id,path) DO UPDATE SET sha=excluded.sha,bytes=excluded.bytes,modified=excluded.modified,text=NULL,encrypted=0',
        )
          .bind(
            (row.purpose === 'migration' ? 'migration-' : 'job-') + row.job_id,
            row.target,
            row.sha,
            row.bytes,
            row.modified || new Date().toISOString(),
          )
          .run();
    }
    const accepted = await this.env.DB.prepare(
      "UPDATE cloud_transfers SET state='ready' WHERE id=? AND state='assembling' RETURNING id",
    )
      .bind(id)
      .first();
    if (!accepted) throw new CloudError('This transfer was cancelled before finalization.', 409);
    if (row.purpose !== 'backup') await discardTransferObject(this.env, row.key);
    return { ...row, state: 'ready' as const };
  }
  async discard(id: string, actor: string, expiredOnly = false) {
    z.uuid().parse(id);
    const row = await this.env.DB.prepare('SELECT * FROM cloud_transfers WHERE id=? AND actor=?')
      .bind(id, actor)
      .first<Transfer>();
    if (!row || (!expiredOnly && !['backup', 'migration'].includes(row.purpose)))
      throw new CloudError('Backup transfer was not found.', 404);
    const expired = Date.parse(row.expires) <= Date.now();
    if (expiredOnly && !expired) throw new CloudError('An active transfer cannot be expired.', 409);
    const active = await this.env.DB.prepare(
      "SELECT id FROM cloud_jobs WHERE actor=? AND state IN ('queued','running') LIMIT 1",
    )
      .bind(actor)
      .first();
    if ((row.state === 'assembling' && !expired) || (active && !expiredOnly))
      throw new CloudError(
        'A cloud operation is active. Wait for it to finish before discarding the transfer.',
        409,
      );
    const claimed = await this.env.DB.prepare(
      "UPDATE cloud_transfers SET state='cancelled' WHERE id=? AND (state IN ('uploading','ready','cancelled') OR expires<=?) RETURNING id",
    )
      .bind(id, new Date().toISOString())
      .first();
    if (!claimed)
      throw new CloudError('The transfer changed. Check its status before discarding.', 409);
    try {
      await this.env.BUCKET.resumeMultipartUpload(row.key, row.upload_id).abort();
    } catch (error) {
      if (!/NoSuchUpload|does not exist|not found|already.*complet/i.test((error as Error).message))
        throw error;
    }
    await discardTransferObject(this.env, row.key);
    await this.env.DB.prepare('DELETE FROM cloud_transfer_parts WHERE id=?').bind(id).run();
    return { ok: true };
  }
}
