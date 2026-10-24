import { z } from 'zod';
import { CloudError, type CloudEnv, type FileRecord } from './types.js';
import { CloudTransfers } from './transfers.js';
import { CloudWorkspace } from './workspace.js';
import { imageTransformSchema, validMediaHeader } from '../shared/media-upload.js';
import { attachmentExtension, attachmentFile } from '../shared/attachments.js';
import { pinObjects } from './storage.js';
const blob = z.object({
  bytes: z
    .number()
    .int()
    .min(1)
    .max(20 * 1024 ** 2),
  sha: z.string().regex(/^[a-f0-9]{64}$/),
});
const inputSchema = z.object({
  filename: z.string().min(1).max(300),
  sourceId: z.uuid().optional(),
  original: blob.optional(),
  output: blob.extend({
    bytes: z
      .number()
      .int()
      .min(1)
      .max(4 * 1024 ** 3),
  }),
  format: z.enum(['webp', 'png']).default('webp'),
  width: z.number().int().min(1).max(2400).optional(),
  height: z.number().int().min(1).max(2400).optional(),
  transform: imageTransformSchema.default({}),
});
export class NativeMedia {
  constructor(readonly env: CloudEnv) {}
  async start(actor: string, input: unknown) {
    const data = inputSchema.parse(input),
      attachment = attachmentFile(data.filename);
    if (!attachment && (!data.width || !data.height || (!data.sourceId && !data.original)))
      throw new CloudError('Prepared image and private original are required.');
    if (!attachment && data.output.bytes > 20 * 1024 ** 2)
      throw new CloudError('Prepared images must be smaller than 20 MiB.', 413);
    if (attachment && (data.sourceId || data.original))
      throw new CloudError('Invalid attachment preparation.');
    const existing = await this.env.DB.prepare(
      "SELECT id,source_id,name FROM cloud_media_uploads WHERE actor=? AND state='uploading' AND COALESCE(updated,created)>? AND json_extract(metadata,'$.filename')=? AND json_extract(metadata,'$.output.sha')=? AND COALESCE(json_extract(metadata,'$.original.sha'),'')=? AND COALESCE(json_extract(metadata,'$.sourceId'),'')=? AND json_extract(metadata,'$.transform')=? ORDER BY created DESC LIMIT 1",
    )
      .bind(
        actor,
        new Date(Date.now() - 7 * 86400000).toISOString(),
        data.filename,
        data.output.sha,
        data.original?.sha || '',
        data.sourceId || '',
        JSON.stringify(data.transform),
      )
      .first<{ id: string; source_id: string; name: string }>();
    if (existing) return { id: existing.id, sourceId: existing.source_id, name: existing.name };
    const hashes = [
        ...new Map(
          [data.original, data.output]
            .filter((value): value is typeof data.output => !!value)
            .map((value) => [value.sha, value]),
        ).values(),
      ],
      fresh: number[] = [];
    for (const blob of hashes)
      if (
        !(await this.env.DB.prepare(
          'SELECT sha FROM cloud_files WHERE sha=? AND encrypted=0 UNION SELECT sha FROM cloud_patches WHERE sha=? AND encrypted=0 LIMIT 1',
        )
          .bind(blob.sha, blob.sha)
          .first())
      )
        fresh.push(blob.bytes);
    const storage = await this.env.DB.prepare(
      'SELECT bytes,budget FROM cloud_storage WHERE id=1',
    ).first<{ bytes: number; budget: number }>();
    const required = fresh.reduce(
      (sum, bytes, index) =>
        Math.max(sum, fresh.slice(0, index).reduce((a, b) => a + b, 0) + 2 * bytes),
      0,
    );
    if (
      storage &&
      storage.bytes + required >
        Math.min(storage.budget, Number(this.env.STORAGE_BUDGET_BYTES || 5 * 1024 ** 3))
    )
      throw new CloudError(
        'This upload needs temporary transfer space as well as its final blob. Free storage or review the private storage budget before uploading; no data was changed.',
        413,
      );
    const id = crypto.randomUUID(),
      sourceId = attachment ? '' : data.sourceId || crypto.randomUUID();
    if (
      data.sourceId &&
      !(await this.env.DB.prepare('SELECT path FROM cloud_files WHERE path=?')
        .bind('.studio/media-originals/' + data.sourceId + '/record.json')
        .first())
    )
      throw new CloudError('Original not found.', 404);
    const basename = data.filename.replace(/\.[^.]*$/, '').normalize('NFKC');
    const stem =
      (attachment
        ? basename.replace(/[^\p{L}\p{N}_-]/gu, '-')
        : basename.replace(/[^a-z0-9-]/gi, '-')
      ).slice(0, 50) || 'media';
    const name =
      stem +
      '-' +
      crypto.randomUUID() +
      (attachment ? attachmentExtension(data.filename) : '.' + data.format);
    const metadata = {
      ...data,
      attachment,
      targets: [
        ...(data.original
          ? [
              {
                ...data.original,
                path: '.studio/media-originals/' + sourceId + '/original',
                role: 'original',
              },
            ]
          : []),
        { ...data.output, path: 'content/media/' + name, role: 'output' },
      ],
    };
    await this.env.DB.prepare(
      'INSERT INTO cloud_media_uploads(id,actor,source_id,name,metadata,created) VALUES(?,?,?,?,?,?)',
    )
      .bind(id, actor, sourceId, name, JSON.stringify(metadata), new Date().toISOString())
      .run();
    return { id, sourceId, name };
  }
  async row(id: string, actor: string) {
    const row = await this.env.DB.prepare(
      'SELECT * FROM cloud_media_uploads WHERE id=? AND actor=?',
    )
      .bind(z.uuid().parse(id), actor)
      .first<{
        id: string;
        source_id: string;
        name: string;
        metadata: string;
        state: string;
        created: string;
        updated: string | null;
      }>();
    if (!row) throw new CloudError('Upload session not found.', 404);
    if (Date.parse(row.updated || row.created) + 7 * 86400000 < Date.now())
      throw new CloudError('Upload session expired.', 410);
    return { ...row, data: JSON.parse(row.metadata) };
  }
  async transfer(id: string, actor: string, role: string) {
    const row = await this.row(id, actor),
      target = row.data.targets.find((item: any) => item.role === role);
    if (!target || row.state !== 'uploading')
      throw new CloudError('Upload target is unavailable.', 409);
    if (
      await this.env.DB.prepare(
        'SELECT sha FROM cloud_files WHERE sha=? AND bytes=? AND encrypted=0 UNION SELECT sha FROM cloud_patches WHERE sha=? AND bytes=? AND encrypted=0 LIMIT 1',
      )
        .bind(target.sha, target.bytes, target.sha, target.bytes)
        .first()
    ) {
      await pinObjects(this.env, ['workspace/blobs/' + target.sha]);
      await this.env.DB.prepare(
        'INSERT INTO cloud_patches(id,path,sha,bytes,modified,text,encrypted) VALUES(?,?,?,?,?,NULL,0) ON CONFLICT(id,path) DO UPDATE SET sha=excluded.sha,bytes=excluded.bytes,modified=excluded.modified,text=NULL,encrypted=0',
      )
        .bind('job-' + id, target.path, target.sha, target.bytes, new Date().toISOString())
        .run();
      return { reused: true };
    }
    return new CloudTransfers(this.env).start(
      actor,
      { name: row.name, bytes: target.bytes, fingerprint: target.sha },
      { purpose: 'file', target: target.path, sha: target.sha, job: id, retentionDays: 7 },
    );
  }
  async commit(id: string, actor: string, ws: CloudWorkspace) {
    const row = await this.row(id, actor),
      data = row.data;
    const result = {
      name: row.name,
      url: '/media/' + encodeURIComponent(row.name),
      bytes: data.output.bytes,
      modifiedAt: row.created,
      ...(!data.attachment
        ? { width: data.width, height: data.height, sourceId: row.source_id, canEdit: true }
        : { canEdit: false }),
    };
    if (row.state === 'ready') return result;
    const patches = (
      await this.env.DB.prepare(
        'SELECT path,sha,bytes,modified,text,encrypted FROM cloud_patches WHERE id=?',
      )
        .bind('job-' + id)
        .all<FileRecord>()
    ).results;
    if (
      patches.length !== data.targets.length ||
      patches.some(
        (file) =>
          !data.targets.some(
            (target: any) =>
              target.path === file.path && target.sha === file.sha && target.bytes === file.bytes,
          ),
      )
    )
      throw new CloudError('Upload is incomplete. Resume the remaining files.', 409);
    const output = patches.find((file) => file.path === 'content/media/' + row.name)!;
    const sample = await this.env.BUCKET.get('workspace/blobs/' + output.sha, {
      range: { offset: 0, length: Math.min(output.bytes, 65536) },
    });
    if (!sample || !validMediaHeader(row.name, new Uint8Array(await sample.arrayBuffer())))
      throw new CloudError(
        'The file contents do not match its extension. Choose the original file.',
      );
    if (!data.attachment) {
      const path = '.studio/media-originals/' + row.source_id + '/record.json';
      const record = ws.has(path)
        ? JSON.parse(new TextDecoder().decode(await ws.read(path)))
        : { sourceId: row.source_id, name: data.filename, sha256: data.original.sha, variants: [] };
      if (!record.variants.some((variant: any) => variant.name === row.name))
        record.variants.push({
          name: row.name,
          width: data.width,
          height: data.height,
          transform: data.transform,
        });
      ws.write(path, new TextEncoder().encode(JSON.stringify(record)));
    }
    patches.forEach((file) => ws.reference(file));
    ws.complete("UPDATE cloud_media_uploads SET state='ready' WHERE id=?", id);
    ws.complete('DELETE FROM cloud_patches WHERE id=?', 'job-' + id);
    return result;
  }
}
