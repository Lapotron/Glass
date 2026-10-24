import { afterEach, beforeEach, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { cloudSchemaStatements } from '../scripts/cloud-schema.js';
import { CloudTransfers } from '../src/cloud/transfers.js';
import { BACKUP_CHUNK_BYTES } from '../src/shared/backup-transfer.js';
import { hash, type CloudEnv } from '../src/cloud/types.js';

let runtime: Miniflare, env: CloudEnv;
beforeEach(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: '2026-10-12',
      d1Databases: ['DB'],
      r2Buckets: ['BUCKET'],
    }),
  );
  const DB = await runtime.getD1Database('DB');
  for (const sql of await cloudSchemaStatements()) await DB.exec(sql);
  env = {
    DB,
    BUCKET: await runtime.getR2Bucket('BUCKET'),
    STUDIO_SECRET: 'x'.repeat(40),
  } as unknown as CloudEnv;
});
afterEach(async () => runtime?.dispose());
const data = () => new Uint8Array(BACKUP_CHUNK_BYTES + 17).fill(37);
async function part(
  service: CloudTransfers,
  id: string,
  number: number,
  bytes: Uint8Array,
  actor = 'owner',
) {
  return service.part(
    id,
    actor,
    number,
    new Request('https://console.example/upload', {
      method: 'PUT',
      headers: { 'X-Part-SHA256': await hash(bytes) },
      body: new Uint8Array(bytes),
    }),
  );
}
it('resumes checked parts across instances, rejects a different owner or changed part, and finalizes privately', async () => {
  const bytes = data(),
    service = new CloudTransfers(env);
  const transfer = await service.start('owner', {
    name: 'notebook.tar.gz',
    bytes: bytes.length,
    fingerprint: await hash(bytes),
  });
  await part(service, transfer.id, 1, bytes.slice(0, BACKUP_CHUNK_BYTES));
  const resumed = new CloudTransfers(env);
  expect((await resumed.status(transfer.id, 'owner')).parts).toHaveLength(1);
  await expect(resumed.status(transfer.id, 'other')).rejects.toThrow('not found');
  await expect(resumed.finish(transfer.id, 'owner')).rejects.toThrow('incomplete');
  await part(resumed, transfer.id, 1, bytes.slice(0, BACKUP_CHUNK_BYTES));
  await expect(part(resumed, transfer.id, 1, new Uint8Array(BACKUP_CHUNK_BYTES))).rejects.toThrow(
    'different file',
  );
  await part(resumed, transfer.id, 2, bytes.slice(BACKUP_CHUNK_BYTES));
  const finished = await resumed.finish(transfer.id, 'owner');
  expect(finished.state).toBe('ready');
  expect(
    await hash(new Uint8Array(await (await env.BUCKET.get(finished.key))!.arrayBuffer())),
  ).toBe(await hash(bytes));
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM cloud_files').first('count')).toBe(0);
});
it('streams a large CI file into its content-addressed object and stages only verified metadata', async () => {
  const bytes = data(),
    sha = await hash(bytes),
    service = new CloudTransfers(env),
    job = crypto.randomUUID();
  const transfer = await service.start(
    'owner',
    { name: 'backup.tar.gz', bytes: bytes.length, fingerprint: sha },
    { purpose: 'file', target: '.studio/backups/123-abc.tar.gz', sha, job },
  );
  await part(service, transfer.id, 1, bytes.slice(0, BACKUP_CHUNK_BYTES));
  await part(service, transfer.id, 2, bytes.slice(BACKUP_CHUNK_BYTES));
  await service.finish(transfer.id, 'owner');
  const staged = await env.DB.prepare('SELECT path,sha,bytes,text FROM cloud_patches WHERE id=?')
    .bind('job-' + job)
    .first();
  expect(staged).toEqual({
    path: '.studio/backups/123-abc.tar.gz',
    sha,
    bytes: bytes.length,
    text: null,
  });
  expect((await env.BUCKET.head('workspace/blobs/' + sha))?.size).toBe(bytes.length);
  expect(await env.DB.prepare('SELECT bytes FROM cloud_storage WHERE id=1').first('bytes')).toBe(
    bytes.length,
  );
  expect(await env.BUCKET.head('transfers/' + transfer.id + '/data')).toBeNull();
});
it('rejects an assembled file with a wrong whole-file checksum before staging canonical changes', async () => {
  const bytes = data(),
    service = new CloudTransfers(env);
  const transfer = await service.start(
    'owner',
    { name: 'backup.tar.gz', bytes: bytes.length, fingerprint: await hash(bytes) },
    {
      purpose: 'file',
      target: 'content/media/video.mp4',
      sha: '0'.repeat(64),
      job: crypto.randomUUID(),
    },
  );
  await part(service, transfer.id, 1, bytes.slice(0, BACKUP_CHUNK_BYTES));
  await part(service, transfer.id, 2, bytes.slice(BACKUP_CHUNK_BYTES));
  await expect(service.finish(transfer.id, 'owner')).rejects.toThrow();
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM cloud_patches').first('count')).toBe(
    0,
  );
  expect(await env.BUCKET.head('workspace/blobs/' + '0'.repeat(64))).toBeNull();
});
it('aborts only the selected private transfer and releases its storage reservation', async () => {
  const bytes = data(),
    service = new CloudTransfers(env);
  await env.BUCKET.put('workspace/keep', 'Retain notebook data');
  const transfer = await service.start('owner', {
    name: 'backup.tar.gz',
    bytes: bytes.length,
    fingerprint: await hash(bytes),
  });
  await part(service, transfer.id, 1, bytes.slice(0, BACKUP_CHUNK_BYTES));
  await service.discard(transfer.id, 'owner');
  expect(await env.DB.prepare('SELECT bytes FROM cloud_storage WHERE id=1').first('bytes')).toBe(0);
  expect(await env.BUCKET.head('workspace/keep')).not.toBeNull();
  await service.discard(transfer.id, 'owner');
});
it('rejects oversized parts before buffering and enforces the configured private storage budget', async () => {
  env.STORAGE_BUDGET_BYTES = String(BACKUP_CHUNK_BYTES);
  const service = new CloudTransfers(env);
  await expect(
    service.start('owner', {
      name: 'too-large.tar.gz',
      bytes: BACKUP_CHUNK_BYTES + 1,
      fingerprint: 'a'.repeat(64),
    }),
  ).rejects.toThrow('storage budget');
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM cloud_transfers').first('count')).toBe(
    0,
  );
  const transfer = await service.start('owner', {
    name: 'small.tar.gz',
    bytes: 4,
    fingerprint: 'b'.repeat(64),
  });
  await expect(
    service.part(
      transfer.id,
      'owner',
      1,
      new Request('https://console.example/upload', {
        method: 'PUT',
        headers: { 'Content-Length': '1000000000' },
        body: 'bad',
      }),
    ),
  ).rejects.toThrow('size limit');
});
