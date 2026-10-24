import { cloudSchemaStatements } from '../scripts/cloud-schema.js';
import { it, expect, afterEach } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { CloudWorkspace, stageFile, commitStaged, seal, unseal } from '../src/cloud/workspace.js';
import type { CloudEnv, Statement } from '../src/cloud/types.js';
import { putObject } from '../src/cloud/storage.js';
import { reconcileJobs } from '../src/cloud/schedule.js';
import { snapshotSelection } from '../src/shared/cloud-snapshot.js';
import {
  deferApprovedBuild,
  runDeferredBuild,
  deferredBuildStatus,
} from '../src/cloud/deferred.js';
let instances: Miniflare[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(instances.map((m) => m.dispose()));
  instances = [];
  for (const folder of folders) await fs.rm(folder, { recursive: true, force: true });
  folders.length = 0;
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
  const db = await runtime.getD1Database('DB');
  for (const sql of await cloudSchemaStatements()) await db.exec(sql);
  const env = {
    DB: db,
    BUCKET: await runtime.getR2Bucket('BUCKET'),
    STUDIO_SECRET: 'a'.repeat(40),
    WORKSPACE_ID: 'test',
    STUDIO_ORIGIN: 'https://studio.test',
    SITE_ORIGIN: 'https://blog.test',
    ACCESS_TEAM: 'team',
    ACCESS_AUD: 'aud',
    ACCESS_ADMINS: 'owner@test.test',
    CI_TOKEN: 'c'.repeat(40),
  } as unknown as CloudEnv;
  return env;
}
it('captures only routine job files and retained transfer metadata, with exact artifact and reset exceptions', async () => {
  const env = await setup();
  const paths = [
    'content/example.md',
    '.studio/jobs/prior.json',
    '.studio/builds/old/source.json',
    '.studio/builds/old/media-transfer.json',
    '.studio/builds/old/public/index.html',
    '.studio/builds/new/public/index.html',
    '.studio/render-cache/unused.bin',
  ];
  for (const name of paths)
    await env.DB.prepare("INSERT INTO cloud_files VALUES(?,'hash',1,'2026-10-24',NULL,0)")
      .bind(name)
      .run();
  for (const [route, expected] of [
    ['/api/media/usage', paths.slice(0, 4)],
    ['/api/jobs/new/artifact', paths.slice(0, 4).concat(paths[5])],
    ['/api/notebook/reset/review', paths],
  ] as [string, string[]][]) {
    const selection = snapshotSelection(route);
    const sql = await env.DB.prepare('SELECT path FROM cloud_files WHERE ' + selection.where)
      .bind(...selection.values)
      .all<{ path: string }>();
    expect(sql.results.map((row) => row.path).sort()).toEqual([...expected].sort());
    expect(paths.filter(selection.includes).sort()).toEqual([...expected].sort());
  }
});
it('triggers one approved release after the quota reset and never retries an uncertain remote trigger', async () => {
  const env = await setup();
  env.BUILDS_DEPLOY_HOOK =
    'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/fixture';
  await env.DB.prepare(
    "UPDATE cloud_control SET approved_release='approved-fixture' WHERE id=1",
  ).run();
  const now = new Date('2026-10-23T19:00:00Z');
  const queued = await deferApprovedBuild(env, now);
  expect(queued.after).toBe('2026-10-24T00:05:00.000Z');
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({ success: true, result: { build_uuid: 'fixture-build' } });
  };
  expect(await runDeferredBuild(env, now, fetcher)).toBe(true);
  expect(calls).toBe(0);
  await Promise.all(
    Array.from({ length: 3 }, () => runDeferredBuild(env, new Date(queued.after), fetcher)),
  );
  expect(calls).toBe(1);
  expect((await deferredBuildStatus(env))?.state).toBe('triggered');
  await runDeferredBuild(env, new Date(queued.after), fetcher);
  expect(calls).toBe(1);
});
it('drops a deferred rebuild when the approved release was superseded', async () => {
  const env = await setup();
  env.BUILDS_DEPLOY_HOOK =
    'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/fixture';
  await env.DB.prepare("UPDATE cloud_control SET approved_release='old-release' WHERE id=1").run();
  const queued = await deferApprovedBuild(env, new Date('2026-10-23T19:00:00Z'));
  await env.DB.prepare("UPDATE cloud_control SET approved_release='new-release' WHERE id=1").run();
  await runDeferredBuild(env, new Date(queued.after), async () => {
    throw new Error('An obsolete release must never trigger.');
  });
  expect((await deferredBuildStatus(env))?.state).toBe('superseded');
});
it('retains an uncertain deferred trigger without automatic retries', async () => {
  const env = await setup();
  env.BUILDS_DEPLOY_HOOK =
    'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/fixture';
  await env.DB.prepare("UPDATE cloud_control SET approved_release='approved' WHERE id=1").run();
  const record = await deferApprovedBuild(env, new Date('2026-10-23T19:00:00Z'));
  let calls = 0;
  const failed: typeof fetch = async () => {
    calls++;
    throw new Error('Network timed out after sending.');
  };
  await runDeferredBuild(env, new Date(record.after), failed);
  await runDeferredBuild(env, new Date(Date.parse(record.after) + 3600_000), failed);
  expect(calls).toBe(1);
  expect((await deferredBuildStatus(env))?.state).toBe('uncertain');
});
it('allows queued builds to wait and expires only jobs whose heartbeat is still stale', async () => {
  const env = await setup();
  const stale = new Date(Date.now() - 40 * 60_000).toISOString();
  for (const [id, state, updated, expected] of [
    ['running', 'running', stale, 'failed'],
    ['waiting', 'queued', stale, 'queued'],
    ['abandoned', 'queued', new Date(Date.now() - 3 * 3600_000).toISOString(), 'failed'],
  ]) {
    await env.DB.prepare(
      'INSERT INTO cloud_jobs(id,kind,state,actor,version,request,created,updated) VALUES(?,?,?,?,?,?,?,?)',
    )
      .bind(id, 'api', state, 'owner', 0, '{}', updated, updated)
      .run();
    await reconcileJobs(env);
    expect(
      await env.DB.prepare('SELECT state FROM cloud_jobs WHERE id=?').bind(id).first('state'),
    ).toBe(expected);
    await env.DB.prepare('DELETE FROM cloud_jobs WHERE id=?').bind(id).run();
  }
  const actual = env.DB;
  await actual
    .prepare(
      "INSERT INTO cloud_jobs(id,kind,state,actor,version,request,created,updated) VALUES('running','api','running','owner',0,'{}',?,?)",
    )
    .bind(stale, stale)
    .run();
  await actual.prepare("UPDATE cloud_control SET deploy_lease='running' WHERE id=1").run();
  env.DB = {
    ...actual,
    prepare(sql) {
      const query = actual.prepare(sql);
      if (!sql.startsWith('SELECT j.*,p.phase')) return query;
      const capture = (statement: Statement): Statement => ({
        bind: (...values) => capture(statement.bind(...values)),
        first: statement.first.bind(statement),
        run: statement.run.bind(statement),
        async all<T>() {
          const selected = await statement.all<T>();
          await actual
            .prepare("UPDATE cloud_jobs SET updated=? WHERE id='running'")
            .bind(new Date().toISOString())
            .run();
          return selected;
        },
      });
      return capture(query);
    },
    batch: actual.batch.bind(actual),
    exec: actual.exec.bind(actual),
  };
  await reconcileJobs(env);
  expect(
    await actual.prepare("SELECT state FROM cloud_jobs WHERE id='running'").first('state'),
  ).toBe('running');
  expect(
    await actual.prepare('SELECT deploy_lease FROM cloud_control WHERE id=1').first('deploy_lease'),
  ).toBe('running');
});
it('commits canonical files atomically, preserves bytes and rejects stale writers', async () => {
  const env = await setup(),
    a = await new CloudWorkspace(env).load(),
    b = await new CloudWorkspace(env).load();
  a.write('content/test.md', new TextEncoder().encode('Original\n'));
  await a.commit('owner');
  b.write('content/test.md', new TextEncoder().encode('Stale\n'));
  await expect(b.commit('owner')).rejects.toThrow('changed');
  const current = await new CloudWorkspace(env).load();
  expect(new TextDecoder().decode(await current.read('content/test.md'))).toBe('Original\n');
});
it('reserves physical staged storage before upload and counts duplicate objects once', async () => {
  const env = await setup();
  const actual = env.DB;
  let writes = 0;
  env.DB = {
    prepare: actual.prepare.bind(actual),
    exec: actual.exec.bind(actual),
    batch: (statements) => {
      writes++;
      return actual.batch(statements);
    },
  };
  env.STORAGE_BUDGET_BYTES = '12';
  await putObject(env, 'fixture-one', '12345678');
  await putObject(env, 'fixture-one', '12345678');
  expect(writes).toBe(1);
  await expect(putObject(env, 'fixture-two', '12345678')).rejects.toThrow('budget');
  expect(await env.BUCKET.get('fixture-two')).toBeNull();
  expect(
    (await env.DB.prepare('SELECT bytes FROM cloud_storage WHERE id=1').first<{ bytes: number }>())
      ?.bytes,
  ).toBe(8);
});
it('uses indexed source ranges without pulling retained public artifact bodies into the working set', async () => {
  const env = await setup();
  await env.DB.exec(
    "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<3000) INSERT INTO cloud_files(path,sha,bytes,modified,text,encrypted) SELECT '.studio/builds/old/public/assets/'||n||'.js','hash',1,'2026-10-24T00:00:00Z',NULL,0 FROM seq",
  );
  const ws = await new CloudWorkspace(env).load();
  ws.write('content/example.md', new TextEncoder().encode('small'));
  await ws.commit('fixture');
  const work = await new CloudWorkspace(env).load(true);
  expect([...work.files.keys()]).toEqual(['content/example.md']);
  expect(work.version).toBe(1);
});
it('encrypts credentials with path binding and does not collide when two files share plaintext', async () => {
  const env = await setup(),
    ws = await new CloudWorkspace(env).load(),
    value = new TextEncoder().encode('{"secret":"canary-token"}');
  ws.write('.studio/connections.json', value);
  ws.write('.studio/services/aca.json', value);
  await ws.commit('owner');
  const current = await new CloudWorkspace(env).load();
  for (const name of ['.studio/connections.json', '.studio/services/aca.json'])
    expect(await current.read(name)).toEqual(value);
  const raw = await env.DB.prepare('SELECT text FROM cloud_files').all();
  expect(raw.results.every((row: any) => row.text === null)).toBe(true);
  await expect(
    unseal(await seal(value, env.STUDIO_SECRET, 'one'), env.STUDIO_SECRET, 'two'),
  ).rejects.toThrow();
});
it('stages large replacements without changing live files and enforces the captured revision', async () => {
  const env = await setup();
  await stageFile(env, 'import', 'content/a.md', new TextEncoder().encode('A'));
  expect((await new CloudWorkspace(env).load()).files.size).toBe(0);
  await commitStaged(env, 'import', 0, 'owner', true);
  expect((await new CloudWorkspace(env).load()).files.size).toBe(1);
  await stageFile(env, 'stale', 'content/b.md', new TextEncoder().encode('B'));
  await expect(commitStaged(env, 'stale', 0, 'owner')).rejects.toThrow('changed');
  expect((await new CloudWorkspace(env).load()).files.has('content/b.md')).toBe(false);
});
it('runs the existing Store save, revisions and Trash contracts through the cloud filesystem', async () => {
  const env = await setup(),
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-cloud-test-'));
  folders.push(folder);
  const moduleFile = path.join(folder, 'store.mjs');
  await build({
    stdin: {
      contents:
        "export {Store} from './src/engine/store.ts';export {withWorkspace} from './src/cloud/filesystem.ts';",
      resolveDir: process.cwd(),
    },
    outfile: moduleFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'bundle',
    external: ['node:*'],
    alias: { 'node:fs': path.resolve('src/cloud/filesystem.ts') },
  });
  const { Store, withWorkspace } = await import(moduleFile);
  let ws = await new CloudWorkspace(env).load();
  for (const name of ['site.json', 'library.json'])
    ws.write('content/' + name, await fs.readFile('tests/fixtures/notebook/' + name));
  await ws.commit('seed');
  ws = await new CloudWorkspace(env).load();
  await withWorkspace(ws, async () => {
    const store = new Store('/workspace'),
      draft = await store.create('posts', 'Cloud entry', 'cloud-entry');
    const saved = await store.saveEntry(draft.id, {
      metadata: { ...draft, title: 'Updated' },
      body: 'An online thought.',
      revision: draft.revision,
    });
    expect(saved.title).toBe('Updated');
    const again = await store.saveEntry(saved.id, {
      metadata: saved,
      body: 'An ONLINE thought.',
      revision: saved.revision,
    });
    expect((await store.snapshot()).entries[0].body).toBe('An ONLINE thought.\n');
    expect((await store.listRevisions(draft.id)).length).toBeGreaterThan(0);
    await store.trash(again.id, again.revision);
    expect((await store.listTrash()).some((item: any) => item.id === saved.id)).toBe(true);
    await store.restore(saved.id);
    expect((await store.snapshot()).entries[0].body).toContain('ONLINE thought');
  });
  await ws.commit('owner');
  expect(
    [...(await new CloudWorkspace(env).load()).files.keys()].some((name) =>
      name.includes('cloud-entry'),
    ),
  ).toBe(true);
});
