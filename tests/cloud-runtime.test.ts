import { cloudSchemaStatements } from '../scripts/cloud-schema.js';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { bundleCloudWorker } from '../scripts/cloud-bundle.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { generateKeyPair, SignJWT } from 'jose';
import { authenticate, checkOrigin } from '../src/cloud/auth.js';
import type { CloudEnv } from '../src/cloud/types.js';

let runtime: Miniflare, closed: Miniflare, folder: string;
const origin = 'https://studio.fixture.test';
beforeAll(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-workerd-'));
  await bundleCloudWorker(path.join(folder, 'closed.mjs'));
  await bundleCloudWorker(
    path.join(folder, 'test.mjs'),
    `import {createCloudApp} from './src/cloud/worker.ts';
    const app=createCloudApp({authenticate:async(request)=>({id:request.headers.has('X-Fixture-Read-Only')?'unseen-owner':'fixture-owner',email:'owner@fixture.test'}),connectionFetch:async(input)=>{
      const request=new Request(input);
      if(request.method!=='GET')throw new Error('Fixture disallows external mutations.');
      if(new URL(request.url).hostname.endsWith('.r2.cloudflarestorage.com'))return new Response('<ListBucketResult><Key>private-object-canary</Key></ListBucketResult>');
      return Response.json({success:true,result:[]});
    }});
    export default {fetch:(request,env)=>{
      if(request.headers.has('X-Fixture-Runtime-Token'))env={...env,CLOUDFLARE_API_TOKEN:'fixture-runtime-token'};
      if(request.headers.has('X-Fixture-R2-Token'))env={...env,R2_ACCESS_KEY_ID:'fixture-s3-access',R2_SECRET_ACCESS_KEY:'fixture-private-s3-secret'};
      if(request.headers.has('X-Fixture-Read-Only')){
        const database=env.DB;
        env={...env,DB:{prepare(sql){if(!/^SELECT\\b/i.test(sql.trim()))throw new Error('Fixture disallows database writes.');return database.prepare(sql)},batch(){throw new Error('Fixture disallows database writes.')},exec(){throw new Error('Fixture disallows database writes.')}}};
      }
      return app.fetch(request,env);
    }};`,
  );
  const base = {
    cf: false,
    modules: true,
    modulesRoot: folder,
    compatibilityDate: '2026-10-12',
    compatibilityFlags: ['nodejs_compat'],
    bindings: {
      STUDIO_ORIGIN: origin,
      SITE_ORIGIN: 'https://blog.fixture.test',
      WORKSPACE_ID: 'test',
      ACCESS_TEAM: 'fixture',
      ACCESS_AUD: 'test-aud',
      ACCESS_ADMINS: 'owner@fixture.test',
      STUDIO_SECRET: 'test-secret-'.repeat(5),
      CI_TOKEN: 'test-ci-'.repeat(6),
      CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    },
  };
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      ...base,
      scriptPath: path.join(folder, 'test.mjs'),
      d1Databases: ['DB'],
      r2Buckets: ['BUCKET'],
      serviceBindings: {
        ASSETS: async (request: Request) =>
          new Response(request.method === 'HEAD' ? null : new URL(request.url).pathname, {
            headers: { 'Content-Type': 'text/plain' },
          }),
      },
    }),
  );
  closed = new Miniflare(
    convertV4MiniflareOptions({ ...base, scriptPath: path.join(folder, 'closed.mjs') }),
  );
  const db = await runtime.getD1Database('DB');
  for (const sql of await cloudSchemaStatements()) await db.exec(sql);
}, 30000);
afterAll(async () => {
  await Promise.all([runtime?.dispose(), closed?.dispose()]);
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});
async function get(route: string) {
  return runtime.dispatchFetch(origin + route);
}
it('initializes a new cloud notebook with its deployment account and no missing fixture portrait', async () => {
  const state = (await (await get('/api/bootstrap')).json()) as any;
  expect(state.site.cloudflare.accountId).toBe('a'.repeat(32));
  expect(state.site.profile.portrait).toBe('');
});
it('shows only a verified staging release in Pages setup, excluding legacy and failed deployments', async () => {
  const db = await runtime.getD1Database('DB');
  const seeds = [
    ['fixture-stage', '2998-01-01', 'staged', 'https://checked.fixture.pages.dev'],
    ['fixture-old-worker', '2999-01-01', 'live', 'https://old-reader.workers.dev'],
    ['fixture-failed', '2999-02-01', 'failed', 'https://failed.fixture.pages.dev'],
  ];
  try {
    for (const [id, created, state, url] of seeds)
      await db
        .prepare(
          'INSERT INTO cloud_releases(id,version,manifest_key,created,state,deployment_url) VALUES(?,0,?,?,?,?)',
        )
        .bind(id, 'fixture/' + id, created, state, url)
        .run();
    const response = await get('/api/cloud/pages');
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).staged).toMatchObject({
      id: 'fixture-stage',
      state: 'staged',
      deployment_url: 'https://checked.fixture.pages.dev',
    });
  } finally {
    for (const [id] of seeds)
      await db.prepare('DELETE FROM cloud_releases WHERE id=?').bind(id).run();
  }
});
it('returns a missing R2 configuration error directly without creating a cloud job', async () => {
  const state = (await (await get('/api/bootstrap')).json()) as any;
  const db = await runtime.getD1Database('DB');
  const before = await db.prepare('SELECT COUNT(*) AS count FROM cloud_jobs').first('count');
  const readiness = await runtime.dispatchFetch(origin + '/api/cloudflare/media', {
    headers: { 'X-Fixture-Read-Only': 'true' },
  });
  expect(readiness.status).toBe(200);
  expect(await readiness.json()).toMatchObject({
    configured: false,
    missing: expect.arrayContaining(['R2 bucket', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']),
  });
  expect(readiness.headers.get('cache-control')).toContain('no-store');
  const response = await runtime.dispatchFetch(origin + '/api/connections/test', {
    method: 'POST',
    headers: { Origin: origin, 'X-Studio-Token': state.token },
    body: JSON.stringify({ provider: 'r2' }),
  });
  expect(response.status).toBe(400);
  expect(await response.text()).toContain('R2 needs:');
  expect(await db.prepare('SELECT COUNT(*) AS count FROM cloud_jobs').first('count')).toBe(before);
});
it('checks saved R2 credentials while the build queue is busy without writing D1 or exposing listings', async () => {
  const initial = (await (await get('/api/bootstrap')).json()) as any;
  const configured = {
    ...initial.site,
    mediaDelivery: {
      mode: 'r2',
      bucket: 'fixture-media',
      publicOrigin: 'https://assets.fixture.test',
      prefix: 'media',
    },
  };
  expect(
    (await write('/api/site', { value: configured, revision: initial.siteRevision }, 'PUT')).status,
  ).toBe(200);
  const db = await runtime.getD1Database('DB');
  const now = new Date().toISOString();
  const version = await db
    .prepare('SELECT version FROM cloud_workspace WHERE id=1')
    .first('version');
  await db
    .prepare(
      "INSERT INTO cloud_jobs(id,kind,state,actor,version,request,build_uuid,created,updated) VALUES('connection-test-busy','api','queued','fixture-owner',?,'{}','another-build',?,?)",
    )
    .bind(version, now, now)
    .run();
  try {
    const before = await db
      .prepare('SELECT version FROM cloud_workspace WHERE id=1')
      .first('version');
    const state = (await (
      await runtime.dispatchFetch(origin + '/api/bootstrap', {
        headers: { 'X-Fixture-Read-Only': 'true' },
      })
    ).json()) as any;
    const headers = {
      Origin: origin,
      'X-Studio-Token': state.token,
      'X-Fixture-Read-Only': 'true',
      'X-Fixture-R2-Token': 'true',
    };
    const readiness = await runtime.dispatchFetch(origin + '/api/cloudflare/media', { headers });
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toEqual({
      configured: true,
      missing: [],
      mode: 'r2',
      bucket: 'fixture-media',
      publicOrigin: 'https://assets.fixture.test',
    });
    const result = await runtime.dispatchFetch(origin + '/api/connections/test', {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider: 'r2' }),
    });
    expect(result.status).toBe(200);
    const text = await result.text();
    expect(JSON.parse(text).ok).toBe(true);
    expect(text).not.toMatch(/cloudJob|private-object|fixture-private|fixture-s3/);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(
      await db.prepare('SELECT version FROM cloud_workspace WHERE id=1').first('version'),
    ).toBe(before);
    expect(
      await db
        .prepare("SELECT state FROM cloud_jobs WHERE id='connection-test-busy'")
        .first('state'),
    ).toBe('queued');
    const denied = await runtime.dispatchFetch(origin + '/api/connections/test', {
      method: 'POST',
      body: JSON.stringify({ provider: 'r2' }),
    });
    expect(denied.status).toBe(403);
  } finally {
    await db.prepare("DELETE FROM cloud_jobs WHERE id='connection-test-busy'").run();
    const current = (await (await get('/api/bootstrap')).json()) as any;
    await write('/api/site', { value: initial.site, revision: current.siteRevision }, 'PUT');
  }
});
it('reads saved media protection status without queueing a build or writing D1', async () => {
  await get('/api/bootstrap');
  const db = await runtime.getD1Database('DB');
  const before = await db.prepare('SELECT COUNT(*) AS count FROM cloud_jobs').first('count');
  const result = await runtime.dispatchFetch(origin + '/api/cloud-media/protection', {
    headers: { 'X-Fixture-Read-Only': 'true' },
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ appliedAt: '', current: false, rules: [] });
  expect(await db.prepare('SELECT COUNT(*) AS count FROM cloud_jobs').first('count')).toBe(before);
});
it('uses deployed runtime credentials without a saved notebook file and exposes only their source to the owner', async () => {
  const summary = await runtime.dispatchFetch(origin + '/api/connections', {
    headers: { 'X-Fixture-Runtime-Token': 'true' },
  });
  const text = await summary.text();
  expect(text).not.toContain('fixture-runtime-token');
  expect(JSON.parse(text).fields.cloudflareApiToken).toEqual({
    configured: true,
    source: 'environment',
  });
  const denied = await runtime.dispatchFetch(origin + '/__ci/deployment-credentials', {
    headers: { 'X-Fixture-Runtime-Token': 'true' },
  });
  expect(denied.status).toBe(401);
  const result = await runtime.dispatchFetch(origin + '/__ci/deployment-credentials', {
    headers: { 'X-Fixture-Runtime-Token': 'true', Authorization: 'Bearer ' + 'test-ci-'.repeat(6) },
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ CLOUDFLARE_API_TOKEN: 'fixture-runtime-token' });
});
it('permits the Access top-level return while rejecting cross-site API reads and writes', () => {
  const env = { STUDIO_ORIGIN: origin } as CloudEnv;
  const navigation = {
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
  };
  expect(() =>
    checkOrigin(new Request(origin + '/studio/', { headers: navigation }), env),
  ).not.toThrow();
  expect(() => checkOrigin(new Request(origin + '/', { headers: navigation }), env)).not.toThrow();
  expect(() =>
    checkOrigin(new Request(origin + '/studio', { headers: navigation }), env),
  ).not.toThrow();
  expect(() =>
    checkOrigin(new Request(origin + '/authoring/hosted-studio.md', { headers: navigation }), env),
  ).not.toThrow();
  expect(() =>
    checkOrigin(
      new Request(origin + '/api/backups/backup-id/download', { headers: navigation }),
      env,
    ),
  ).not.toThrow();
  expect(() =>
    checkOrigin(new Request(origin + '/media/a.pdf', { headers: navigation }), env),
  ).not.toThrow();
  expect(() =>
    checkOrigin(new Request(origin + '/api/bootstrap', { headers: navigation }), env),
  ).toThrow('Cross-origin');
  expect(() =>
    checkOrigin(
      new Request(origin + '/api/bootstrap', { headers: { 'Sec-Fetch-Site': 'same-site' } }),
      env,
    ),
  ).toThrow('Cross-origin');
  expect(() =>
    checkOrigin(new Request(origin + '/studio/', { method: 'POST', headers: navigation }), env),
  ).toThrow('Cross-origin');
});
async function write(route: string, data: unknown, method = 'POST') {
  const state = (await (await get('/api/bootstrap')).json()) as { token: string };
  return runtime.dispatchFetch(origin + route, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Studio-Token': state.token },
    body: JSON.stringify(data),
  });
}
it('boots the production bundle in workerd and protects both APIs and private assets', async () => {
  for (const route of [
    '/',
    '/api/bootstrap',
    '/studio/',
    '/index.html',
    '/assets/site.js',
    '/cloud-compiler/index.html',
    '/cloud-reader-assets.json',
    '/authoring/hosted-studio.md',
  ]) {
    const response = await closed.dispatchFetch(origin + route);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('no-store');
  }
});
it('serves authenticated root assets without an index redirect and retains bounded legacy redirects', async () => {
  for (const route of [
    '/',
    '/assets/site.js',
    '/cloud-compiler/index.html',
    '/authoring/hosted-studio.md',
  ]) {
    const response = await get(route);
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.text()).toBe(route);
  }
  const head = await runtime.dispatchFetch(origin + '/', { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  const legacy = await runtime.dispatchFetch(origin + '/studio/?old=1', { redirect: 'manual' });
  expect(legacy.status).toBe(308);
  expect(legacy.headers.get('location')).toBe('/?old=1');
  expect((await get('/missing-page')).status).toBe(404);
});
it('rejects alternate coordinator hostnames and document navigations that would enqueue work', async () => {
  const alternate = await runtime.dispatchFetch('https://alternate.fixture.test/__ci/workspace', {
    headers: { Authorization: 'Bearer ' + 'test-ci-'.repeat(6) },
  });
  expect(alternate.status).toBe(403);
  const heavyRead = await runtime.dispatchFetch(
    origin + '/api/media/details?url=%2Fmedia%2Fmissing.webp',
  );
  expect(heavyRead.status).toBe(404);
});
it('requires a matching Access signature, audience and owner email', async () => {
  const keys = await generateKeyPair('RS256'),
    issuer = 'https://fixture.cloudflareaccess.com';
  const env = {
    ACCESS_TEAM: 'fixture',
    ACCESS_AUD: 'test-aud',
    ACCESS_ADMINS: 'owner@fixture.test',
  } as CloudEnv;
  const token = await new SignJWT({ email: 'owner@fixture.test' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(issuer)
    .setAudience('test-aud')
    .setSubject('owner-id')
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(keys.privateKey);
  expect(
    await authenticate(
      new Request(origin, { headers: { 'Cf-Access-Jwt-Assertion': token } }),
      env,
      async () => keys.publicKey,
    ),
  ).toEqual({ id: 'owner-id', email: 'owner@fixture.test' });
  await expect(
    authenticate(
      new Request(origin, { headers: { 'Cf-Access-Jwt-Assertion': token } }),
      { ...env, ACCESS_ADMINS: 'someone@fixture.test' },
      async () => keys.publicKey,
    ),
  ).rejects.toThrow('authorized');
  await expect(
    authenticate(
      new Request(origin, { headers: { 'Cf-Access-Jwt-Assertion': token } }),
      { ...env, ACCESS_AUD: 'wrong' },
      async () => keys.publicKey,
    ),
  ).rejects.toThrow('authorized');
});
it('preserves CRUD, revisions and CSRF checks through actual Worker bindings', async () => {
  const noToken = await runtime.dispatchFetch(origin + '/api/content', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(noToken.status).toBe(403);
  const cross = await runtime.dispatchFetch(origin + '/api/bootstrap', {
    headers: { Origin: 'https://attacker.fixture.test' },
  });
  expect(cross.status).toBe(403);
  const created = await write('/api/content', {
    kind: 'posts',
    title: 'Worker draft',
    slug: 'worker-draft',
  });
  expect(created.status).toBe(201);
  const entry: any = await created.json();
  const saved = await write(
    '/api/content/' + entry.id,
    { metadata: entry, body: 'A saved **draft**.', revision: entry.revision },
    'PUT',
  );
  expect(saved.status).toBe(200);
  expect(
    ((await (await get('/api/content/' + entry.id + '/revisions')).json()) as unknown[]).length,
  ).toBeGreaterThan(0);
  const stale = await write(
    '/api/content/' + entry.id,
    { metadata: entry, body: 'Stale', revision: entry.revision },
    'PUT',
  );
  expect(stale.status).toBe(409);
});
it('runs MCP without eval and persists a scoped AI draft before reporting success', async () => {
  await get('/api/bootstrap');
  const rpc = async (method: string, params: unknown, id = 1) =>
    runtime.dispatchFetch(origin + '/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'fixture', version: '1' },
  });
  expect(init.status).toBe(200);
  const response = await rpc(
    'tools/call',
    {
      name: 'prepare_draft',
      arguments: {
        kind: 'lab',
        title: 'MCP private draft',
        slug: 'mcp-private-draft',
        body: '# A draft\n\nValid Markdown.',
      },
    },
    2,
  );
  const value: any = await response.json();
  expect(value.error).toBeUndefined();
  expect(value.result?.isError).not.toBe(true);
  const entries: any = await (await get('/api/content')).json();
  expect(
    entries.some((entry: any) => entry.title === 'MCP private draft' && entry.status === 'draft'),
  ).toBe(true);
});
it('loads the notebook for an authenticated owner while database writes are unavailable', async () => {
  await get('/api/bootstrap');
  const response = await runtime.dispatchFetch(origin + '/api/bootstrap', {
    headers: { 'X-Fixture-Read-Only': 'true' },
  });
  expect(response.status).toBe(200);
  expect(Array.isArray(((await response.json()) as { entries: unknown[] }).entries)).toBe(true);
  const health = await runtime.dispatchFetch(origin + '/api/health', {
    headers: { 'X-Fixture-Read-Only': 'true' },
  });
  expect(health.status).toBe(200);
  expect(((await health.json()) as { checks: unknown[] }).checks.length).toBeGreaterThan(0);
});
it('registers the owner atomically when issuing an authoring key after a read-only login', async () => {
  const db = await runtime.getD1Database('DB');
  await db.prepare("DELETE FROM cloud_actors WHERE id='fixture-owner'").run();
  const response = await write('/api/cloud/mcp-keys', {});
  expect(response.status).toBe(200);
  const key = (await response.json()) as { id: string };
  expect(
    await db
      .prepare('SELECT a.email FROM cloud_keys k JOIN cloud_actors a ON a.id=k.actor WHERE k.id=?')
      .bind(key.id)
      .first('email'),
  ).toBe('owner@fixture.test');
});
it('cancels only an unclaimed queued request and reports all retained manifest files', async () => {
  await get('/api/bootstrap');
  const db = await runtime.getD1Database('DB');
  const version = await db
    .prepare('SELECT version FROM cloud_workspace WHERE id=1')
    .first<number>('version');
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO cloud_jobs(id,kind,state,actor,version,request,created,updated) VALUES('queued-fixture','api','queued','fixture-owner',?,'{}',?,?)",
    )
    .bind(version, now, now)
    .run();
  const denied = await runtime.dispatchFetch(origin + '/api/cloud-jobs/queued-fixture/cancel', {
    method: 'POST',
  });
  expect(denied.status).toBe(403);
  expect((await write('/api/cloud-jobs/queued-fixture/cancel', {})).status).toBe(200);
  expect(
    await db.prepare("SELECT state FROM cloud_jobs WHERE id='queued-fixture'").first('state'),
  ).toBe('failed');
  await db.prepare("UPDATE cloud_jobs SET state='running' WHERE id='queued-fixture'").run();
  expect((await write('/api/cloud-jobs/queued-fixture/cancel', {})).status).toBe(409);
  await db.prepare("UPDATE cloud_jobs SET state='failed' WHERE id='queued-fixture'").run();
  const expected = await db
    .prepare('SELECT COUNT(*) AS count FROM cloud_files')
    .first<number>('count');
  expect(((await (await get('/api/cloud/status')).json()) as { files: number }).files).toBe(
    expected,
  );
});
it('imports checked files atomically, preserves omitted credentials and keeps the previous manifest privately', async () => {
  const previous = (await (await get('/api/bootstrap')).json()) as any;
  const summary = (await (await get('/api/connections')).json()) as any;
  expect(
    (
      await write(
        '/api/connections',
        { revision: summary.revision, set: { cloudflareApiToken: 'fixture-explicit-override' } },
        'PUT',
      )
    ).status,
  ).toBe(200);
  const status = (await (await get('/api/cloud/status')).json()) as any;
  const session = (await (
    await write('/api/cloud/migration', { version: status.version })
  ).json()) as { id: string };
  const manifest = [];
  for (const [path, value] of [
    ['content/site.json', JSON.stringify(previous.site)],
    ['content/library.json', JSON.stringify(previous.library)],
    ['content/about.md', '# Imported notebook\n\nExact migration bytes.\n'],
  ]) {
    const result = await runtime.dispatchFetch(
      origin + '/api/cloud/migration/' + session.id + '/file?' + new URLSearchParams({ path }),
      { method: 'PUT', headers: { Origin: origin, 'X-Studio-Token': previous.token }, body: value },
    );
    expect(result.status, await result.clone().text()).toBe(200);
    manifest.push(await result.json());
  }
  const committed = await write('/api/cloud/migration/' + session.id + '/commit', {
    files: manifest,
  });
  expect(committed.status, await committed.clone().text()).toBe(200);
  expect(((await committed.json()) as any).retainedPrivateFiles).toBe(1);
  const connection = await (await get('/api/connections')).text();
  expect(JSON.parse(connection).fields.cloudflareApiToken.source).toBe('studio');
  expect(connection).not.toContain('fixture-explicit-override');
  const state = (await (await get('/api/cloud/migration/' + session.id)).json()) as any;
  expect(state.state).toBe('completed');
  const bucket = (await runtime.getR2Bucket('BUCKET')) as unknown as CloudEnv['BUCKET'];
  const recovery = await bucket.get('migrations/' + session.id + '/before.json');
  expect(JSON.parse(await recovery!.text()).version).toBe(status.version);
  const current = (await (await get('/api/bootstrap')).json()) as any;
  expect(current.about.body).toContain('Exact migration bytes.');
  const stale = await write('/api/cloud/migration', { version: status.version });
  expect(stale.status).toBe(409);
});
it('performs native source checks, snapshots and reviewed imports with no CI job and leaves Git pushes in Studio mode', async () => {
  const db = await runtime.getD1Database('DB');
  const before = await db.prepare('SELECT COUNT(*) AS n FROM cloud_jobs').first('n');
  const checked = await write('/api/jobs', { action: 'build' });
  expect(checked.status, await checked.clone().text()).toBe(200);
  expect(((await checked.json()) as any).logs.join(' ')).toContain('checked directly');
  const backup = await write('/api/backups', {});
  expect(backup.status, await backup.clone().text()).toBe(200);
  const snapshot = (await backup.json()) as any;
  expect(snapshot.snapshot).toBe(true);
  const reviewed = await write('/api/backups/' + snapshot.id + '/review', {});
  expect(reviewed.status, await reviewed.clone().text()).toBe(200);
  const status = (await (await get('/api/cloud/status')).json()) as any;
  const session = (await (
    await write('/api/cloud/migration', { version: status.version })
  ).json()) as any;
  const state = (await (await get('/api/bootstrap')).json()) as any,
    files = [];
  for (const [path, value] of [
    ['content/site.json', JSON.stringify(state.site)],
    ['content/library.json', JSON.stringify(state.library)],
  ]) {
    const result = await runtime.dispatchFetch(
      origin + '/api/cloud/migration/' + session.id + '/file?' + new URLSearchParams({ path }),
      { method: 'PUT', headers: { Origin: origin, 'X-Studio-Token': state.token }, body: value },
    );
    expect(result.status, await result.clone().text()).toBe(200);
    files.push(await result.json());
  }
  const review = await write('/api/backups/import/review', {
    migration: session.id,
    name: 'checked.tar.gz',
    files,
  });
  expect(review.status, await review.clone().text()).toBe(200);
  expect(((await review.json()) as any).id).toBe('migration-' + session.id);
  const pipeline = await runtime.dispatchFetch(
    origin + '/__ci/pipeline?build=git-code-push&branch=main',
    { headers: { Authorization: 'Bearer ' + 'test-ci-'.repeat(6) } },
  );
  expect(pipeline.status).toBe(200);
  expect(await pipeline.json()).toEqual({ mode: 'studio', settling: false });
  expect(await db.prepare('SELECT COUNT(*) AS n FROM cloud_jobs').first('n')).toBe(before);
});
