import { afterEach, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { promises as fs } from 'node:fs';
import { cloudSchemaStatements } from '../scripts/cloud-schema.js';
import { CloudWorkspace } from '../src/cloud/workspace.js';
import { NativeData, objectKey } from '../src/cloud/native-data.js';
import { NativeStore } from '../src/cloud/native-store.js';
import { NativeOperation } from '../src/cloud/native-operation.js';
import { NativeMedia } from '../src/cloud/native-media.js';
import { CloudTransfers } from '../src/cloud/transfers.js';
import { pipelineMode } from '../src/shared/cloud-pipeline.js';
import { putObject } from '../src/cloud/storage.js';
import { hash, type CloudEnv } from '../src/cloud/types.js';
const instances: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});
async function setup() {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: '2026-10-12',
      d1Databases: ['DB'],
      r2Buckets: ['BUCKET'],
    }),
  );
  instances.push(runtime);
  const env = {
    DB: await runtime.getD1Database('DB'),
    BUCKET: await runtime.getR2Bucket('BUCKET'),
    STUDIO_SECRET: 'native-test-'.repeat(5),
    WORKSPACE_ID: 'native',
    STUDIO_ORIGIN: 'https://studio.test',
    SITE_ORIGIN: 'https://site.test',
  } as unknown as CloudEnv;
  for (const sql of await cloudSchemaStatements()) await env.DB.exec(sql);
  const ws = await new CloudWorkspace(env).load();
  for (const name of ['site.json', 'library.json'])
    ws.write('content/' + name, await fs.readFile('tests/fixtures/notebook/' + name));
  await ws.commit('owner');
  return env;
}
const bytes = (value: string) => new TextEncoder().encode(value);
async function aged(env: CloudEnv) {
  await env.DB.exec(
    "UPDATE cloud_objects SET created='2020-01-01T00:00:00.000Z';DELETE FROM cloud_object_pins",
  );
}
it('stores snapshot references instead of duplicate media and restores the reviewed notebook atomically', async () => {
  const env = await setup(),
    service = new NativeData(env);
  let ws = await new CloudWorkspace(env).load();
  const draft = await new NativeStore(ws).create('posts', 'Native draft', 'native-draft');
  ws.write('content/media/one.bin', bytes('private bytes'));
  ws.write('content/media/two.bin', bytes('private bytes'));
  ws.write(
    '.studio/media-originals/11111111-1111-4111-8111-111111111111/original',
    bytes('private bytes'),
  );
  ws.write(
    '.studio/media-originals/11111111-1111-4111-8111-111111111111/record.json',
    bytes(
      JSON.stringify({
        sourceId: '11111111-1111-4111-8111-111111111111',
        name: 'private.png',
        sha256: await hash(bytes('private bytes')),
        variants: [],
      }),
    ),
  );
  ws.write('.studio/builds/generated/public/app.js', bytes('generated cache'));
  await ws.commit('owner');
  const before = await env.DB.prepare('SELECT bytes FROM cloud_storage WHERE id=1').first<number>(
    'bytes',
  );
  ws = await new CloudWorkspace(env).load();
  const saved = await service.snapshot(ws);
  const manifest = await service.manifest(saved.id);
  expect(manifest.files.map((file) => file.path)).not.toContain(
    '.studio/builds/generated/public/app.js',
  );
  const mediaHash = await hash(bytes('private bytes'));
  expect(manifest.files.filter((file) => file.sha === mediaHash)).toHaveLength(3);
  expect(
    (await env.DB.prepare('SELECT bytes FROM cloud_storage WHERE id=1').first<number>('bytes'))! -
      before!,
  ).toBeLessThan(20000);
  expect(
    new Set(
      manifest.files
        .filter((file) => file.path.includes('one.bin') || file.path.includes('two.bin'))
        .map(objectKey),
    ).size,
  ).toBe(1);
  await new NativeStore(ws).trash(draft.id, draft.revision);
  await ws.commit('owner');
  const current = await new CloudWorkspace(env).load();
  const review = await service.review(saved.id, current);
  expect(review.added).toBeGreaterThan(0);
  await service.restore(saved.id, current, Number(review.sourceRevision), 'owner');
  expect(
    (await new NativeStore(await new CloudWorkspace(env).load()).snapshot()).entries.map(
      (entry) => entry.id,
    ),
  ).toContain(draft.id);
  expect((await service.snapshots()).length).toBe(2);
});
it('makes history tombstones and file deletion one CAS transaction and recovers without copying bytes', async () => {
  const env = await setup(),
    service = new NativeData(env);
  let ws = await new CloudWorkspace(env).load();
  const path = '.studio/revisions/fixture/' + 'a'.repeat(64) + '.json';
  ws.write(path, bytes('history'));
  await ws.commit('owner');
  const stale = await new CloudWorkspace(env).load(),
    file = stale.files.get(path)!;
  const selected = await service.deleteHistory(stale, { items: [{ path, revision: file.sha }] });
  ws = await new CloudWorkspace(env).load();
  ws.write('content/about.md', bytes('newer'));
  await ws.commit('other');
  await expect(stale.commit('owner')).rejects.toMatchObject({ status: 409 });
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_history_deleted').first('n')).toBe(
    0,
  );
  ws = await new CloudWorkspace(env).load();
  const deleted = await service.deleteHistory(ws, { items: [{ path, revision: file.sha }] });
  await ws.commit('owner');
  expect(selected.undoId).not.toBe(deleted.undoId);
  expect((await new CloudWorkspace(env).load()).has(path)).toBe(false);
  const physical = await env.DB.prepare('SELECT bytes FROM cloud_storage WHERE id=1').first(
    'bytes',
  );
  ws = await new CloudWorkspace(env).load();
  await service.restoreGroup(ws, deleted.undoId);
  await ws.commit('owner');
  expect(await env.DB.prepare('SELECT bytes FROM cloud_storage WHERE id=1').first('bytes')).toBe(
    physical,
  );
  expect(new TextDecoder().decode(await (await new CloudWorkspace(env).load()).read(path))).toBe(
    'history',
  );
});
it('collects orphaned generated bytes while snapshots, tombstones and in-flight writer pins protect source', async () => {
  const env = await setup(),
    service = new NativeData(env);
  let ws = await new CloudWorkspace(env).load();
  ws.write('content/media/protected.bin', bytes('keep me'));
  ws.write('.studio/render-cache/old/output.bin', bytes('discard me'));
  await ws.commit('owner');
  await env.DB.prepare(
    "UPDATE cloud_files SET modified='2020-01-01T00:00:00.000Z' WHERE path LIKE '.studio/render-cache/%'",
  ).run();
  ws = await new CloudWorkspace(env).load();
  const record = ws.files.get('content/media/protected.bin')!;
  const snapshot = await service.snapshot(ws);
  ws.write(record.path, null);
  await ws.commit('owner');
  await aged(env);
  const result = await service.cleanup(await new CloudWorkspace(env).load(), 'owner');
  expect(result.removed).toBeGreaterThan(0);
  expect(await env.BUCKET.get(objectKey(record))).not.toBeNull();
  await service.deleteSnapshot(snapshot.id, snapshot.revision);
  await service.purgeSnapshot(snapshot.id);
  await aged(env);
  await service.cleanup(await new CloudWorkspace(env).load(), 'owner');
  expect(await env.BUCKET.get(objectKey(record))).toBeNull();
});
it('blocks collection during metadata races and refuses to delete data after a corrupt retained manifest', async () => {
  const env = await setup(),
    service = new NativeData(env),
    ws = await new CloudWorkspace(env).load();
  const saved = await service.snapshot(ws);
  const key = await env.DB.prepare('SELECT manifest_key FROM cloud_snapshots WHERE id=?')
    .bind(saved.id)
    .first<string>('manifest_key');
  await env.DB.prepare('UPDATE cloud_manifest_roots SET objects=? WHERE key=?')
    .bind('broken', key)
    .run();
  await expect(service.cleanup(ws, 'owner')).rejects.toThrow();
  await env.DB.prepare('INSERT INTO cloud_storage_lock VALUES(1,?,?)')
    .bind('collector', new Date(Date.now() + 60000).toISOString())
    .run();
  ws.write('content/about.md', bytes('during cleanup'));
  await expect(ws.commit('owner')).rejects.toThrow('maintenance');
  expect(
    await env.BUCKET.get('workspace/blobs/' + (await hash(bytes('during cleanup')))),
  ).toBeNull();
});
it('stages a large native operation and preserves the old notebook until one final version-checked commit', async () => {
  const env = await setup(),
    ws = await new CloudWorkspace(env).load(),
    service = new NativeOperation(env);
  for (let index = 0; index < 15; index++)
    ws.write('content/media/file-' + index + '.txt', bytes('file ' + index));
  const operation = await service.capture(ws, 'owner', { ok: true });
  expect(ws.changed.size).toBe(0);
  const plan = await service.describe(operation.nativeOperation, 'owner');
  for (const file of plan.files)
    await service.upload(
      plan.id,
      'owner',
      file.path,
      Uint8Array.from(atob(file.data!), (char) => char.charCodeAt(0)),
    );
  expect((await new CloudWorkspace(env).load()).has(plan.files[0].path)).toBe(false);
  expect(await service.commit(plan.id, 'owner')).toEqual({ ok: true });
  expect(await service.commit(plan.id, 'owner')).toEqual({ ok: true });
  expect((await new CloudWorkspace(env).load()).has(plan.files[0].path)).toBe(true);
});
it('uploads prepared images and attachments through private transfers with no cloud jobs', async () => {
  const env = await setup(),
    service = new NativeMedia(env),
    transfers = new CloudTransfers(env),
    original = bytes('private original'),
    output = bytes('RIFFxxxxWEBPprepared');
  const session = await service.start('owner', {
    filename: 'image.png',
    original: { bytes: original.length, sha: await hash(original) },
    output: { bytes: output.length, sha: await hash(output) },
    width: 10,
    height: 10,
  });
  for (const [role, value] of [
    ['original', original],
    ['output', output],
  ] as const) {
    const transfer = await service.transfer(session.id, 'owner', role);
    if ('reused' in transfer) continue;
    await transfers.part(
      transfer.id,
      'owner',
      1,
      new Request('https://studio.test', {
        method: 'PUT',
        body: value,
        headers: { 'X-Part-SHA256': await hash(value) },
      }),
    );
    await transfers.finish(transfer.id, 'owner');
  }
  const ws = await new CloudWorkspace(env).load();
  const asset = await service.commit(session.id, 'owner', ws);
  await ws.commit('owner');
  expect(asset.canEdit).toBe(true);
  expect(
    (await new CloudWorkspace(env).load()).has(
      '.studio/media-originals/' + session.sourceId + '/original',
    ),
  ).toBe(true);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_jobs').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_patches').first('n')).toBe(0);
});
it('dispatches only an exact captured Publish UUID to SSG', () => {
  expect(pipelineMode('git', null)).toBe('studio');
  expect(pipelineMode('git', { build_uuid: 'publish', kind: 'publish', state: 'queued' })).toBe(
    'studio',
  );
  expect(pipelineMode('publish', { build_uuid: 'publish', kind: 'publish', state: 'queued' })).toBe(
    'publish',
  );
  expect(
    pipelineMode('publish', { build_uuid: 'publish', kind: 'publish', state: 'succeeded' }),
  ).toBe('studio');
  expect(
    pipelineMode('maintenance', {
      build_uuid: 'maintenance',
      kind: 'api',
      state: 'queued',
      request: JSON.stringify({ path: '/api/cloud-media/cleanup' }),
    }),
  ).toBe('service');
  expect(
    pipelineMode('upload', {
      build_uuid: 'upload',
      kind: 'api',
      state: 'queued',
      request: JSON.stringify({ path: '/api/media' }),
    }),
  ).toBe('studio');
});
it('aborts abandoned multipart uploads before releasing their physical reservations', async () => {
  const env = await setup(),
    transfers = new CloudTransfers(env),
    value = bytes('unfinished upload');
  const transfer = await transfers.start('owner', {
    name: 'paused.tar.gz',
    bytes: value.length,
    fingerprint: await hash(value),
  });
  await transfers.part(
    transfer.id,
    'owner',
    1,
    new Request('https://studio.test', {
      method: 'PUT',
      body: value,
      headers: { 'X-Part-SHA256': await hash(value) },
    }),
  );
  const key = 'transfers/' + transfer.id + '/data';
  expect(
    await env.DB.prepare('SELECT bytes FROM cloud_objects WHERE key=?').bind(key).first('bytes'),
  ).toBe(value.length);
  await env.DB.prepare("UPDATE cloud_transfers SET expires='2020-01-01T00:00:00.000Z' WHERE id=?")
    .bind(transfer.id)
    .run();
  const result = await new NativeData(env).cleanup(await new CloudWorkspace(env).load(), 'owner');
  expect(result.abortedTransfers).toBe(1);
  expect(
    await env.DB.prepare('SELECT bytes FROM cloud_objects WHERE key=?').bind(key).first(),
  ).toBeNull();
  expect(
    await env.DB.prepare('SELECT state FROM cloud_transfers WHERE id=?')
      .bind(transfer.id)
      .first('state'),
  ).toBe('cancelled');
  expect(
    await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_transfer_parts WHERE id=?')
      .bind(transfer.id)
      .first('n'),
  ).toBe(0);
});
it('retains three newest successful artifacts plus live and approved releases', async () => {
  const env = await setup(),
    service = new NativeData(env),
    version = await env.DB.prepare('SELECT version FROM cloud_workspace WHERE id=1').first(
      'version',
    );
  const ids = Array.from({ length: 7 }, () => crypto.randomUUID());
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index],
      created = new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
      key = 'jobs/' + id + '/manifest.json';
    await putObject(env, key, JSON.stringify({ version: 1, files: [] }));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO cloud_jobs(id,kind,state,actor,version,request,created,updated) VALUES(?,'publish','succeeded','owner',?,'{}',?,?)",
      ).bind(id, version, created, created),
      env.DB.prepare(
        "INSERT INTO cloud_releases(id,version,manifest_key,created,state,deployment_url) VALUES(?,?,?,?,'live',?)",
      ).bind(id, version, key, created, 'https://' + index + '.fixture.pages.dev'),
      env.DB.prepare(
        'INSERT INTO cloud_artifacts(job_id,manifest_key,created,files,bytes) VALUES(?,?,?,0,0)',
      ).bind(id, key, created),
      env.DB.prepare('INSERT INTO cloud_manifest_roots VALUES(?,?)').bind(key, '[]'),
    ]);
  }
  await env.DB.prepare('UPDATE cloud_control SET live_release=?,approved_release=? WHERE id=1')
    .bind(ids[0], ids[1])
    .run();
  await service.expireGenerated(await new CloudWorkspace(env).load(), 'owner');
  const rows = (
    await env.DB.prepare('SELECT job_id,expired FROM cloud_artifacts').all<{
      job_id: string;
      expired: string | null;
    }>()
  ).results;
  expect(
    rows
      .filter((row) => !row.expired)
      .map((row) => row.job_id)
      .sort(),
  ).toEqual([ids[0], ids[1], ...ids.slice(4)].sort());
  expect((await service.roots()).has('jobs/' + ids[0] + '/manifest.json')).toBe(true);
});
it('exposes hidden legacy migration recoveries and releases their obsolete generated graph', async () => {
  const env = await setup(),
    service = new NativeData(env),
    id = crypto.randomUUID(),
    key = 'migrations/' + id + '/before.json';
  const ws = await new CloudWorkspace(env).load();
  ws.write('content/media/retained.bin', bytes('authored original media'));
  ws.write('.studio/builds/old/public/unused.js', bytes('obsolete generated bundle'));
  await ws.commit('owner');
  const captured = ws.manifest(),
    media = ws.files.get('content/media/retained.bin')!,
    generated = ws.files.get('.studio/builds/old/public/unused.js')!;
  await putObject(env, key, JSON.stringify(captured));
  await env.DB.prepare(
    "INSERT INTO cloud_migrations(id,actor,version,created,state,recovery_key) VALUES(?,'owner',?,'2025-01-01T00:00:00.000Z','completed',?)",
  )
    .bind(id, ws.version, key)
    .run();
  ws.write(media.path, null);
  ws.write(generated.path, null);
  await ws.commit('owner');
  const first = await service.cleanup(await new CloudWorkspace(env).load('catalog'), 'owner');
  expect(first.more).toBe(true);
  const saved = (await service.snapshots())[0],
    manifest = await service.manifest(saved.id);
  expect(manifest.files.map((file) => file.path)).toContain(media.path);
  expect(manifest.files.map((file) => file.path)).not.toContain(generated.path);
  await aged(env);
  await service.cleanup(await new CloudWorkspace(env).load('catalog'), 'owner');
  expect(await env.BUCKET.get(objectKey(media))).not.toBeNull();
  expect(await env.BUCKET.get(objectKey(generated))).toBeNull();
  expect(await env.BUCKET.get(key)).toBeNull();
  await service.deleteSnapshot(saved.id, saved.revision);
  await service.purgeSnapshot(saved.id);
  await aged(env);
  await service.cleanup(await new CloudWorkspace(env).load('catalog'), 'owner');
  expect(await env.BUCKET.get(objectKey(media))).toBeNull();
});
it('loads history catalogues and snapshots without copying inline revision bodies', async () => {
  const env = await setup(),
    path = '.studio/revisions/fixture/' + 'a'.repeat(64) + '.json',
    text = 'retained history '.repeat(3000);
  let ws = await new CloudWorkspace(env).load();
  ws.write(path, bytes(text));
  await ws.commit('owner');
  ws = await new CloudWorkspace(env).load('catalog');
  expect(ws.files.get(path)!.text).toBeNull();
  expect(new TextDecoder().decode(await ws.read(path))).toBe(text);
  const service = new NativeData(env),
    saved = await service.snapshot(ws);
  expect(
    (await service.manifest(saved.id)).files.find((file) => file.path === path)!.text,
  ).toBeNull();
});
it('counts shared file bytes once against the physical quota while preserving distinct canonical names', async () => {
  const env = await setup();
  env.STORAGE_BUDGET_BYTES = '100000';
  const ws = await new CloudWorkspace(env).load(),
    value = bytes('x'.repeat(65536));
  for (const name of ['one', 'two', 'three']) ws.write('content/media/' + name + '.bin', value);
  await ws.commit('owner');
  const stored = await env.DB.prepare('SELECT bytes,budget FROM cloud_storage WHERE id=1').first<{
    bytes: number;
    budget: number;
  }>();
  expect(stored!.bytes).toBeLessThan(stored!.budget);
  expect(
    (await new CloudWorkspace(env).load()).paths().filter((path) => path.endsWith('.bin')),
  ).toHaveLength(3);
});
