import { afterEach, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { cloudSchemaStatements } from '../scripts/cloud-schema.js';
import { claimBuild, enqueue, trigger, type CloudJob } from '../src/cloud/jobs.js';
import { CloudWorkspace } from '../src/cloud/workspace.js';
import { type CloudEnv, type FileRecord } from '../src/cloud/types.js';

const instances: Miniflare[] = [];
const now = '2026-10-24T00:00:00.000Z';
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(instances.splice(0).map((runtime) => runtime.dispose()));
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
  return {
    DB: db,
    BUCKET: await runtime.getR2Bucket('BUCKET'),
    STUDIO_SECRET: 'fixture-private-'.repeat(4),
    WORKSPACE_ID: 'fixture',
    BUILDS_DEPLOY_HOOK: 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/fixture',
  } as unknown as CloudEnv;
}
function file(path: string, sha: string, encrypted = 0): FileRecord {
  return { path, sha, encrypted, bytes: 10, modified: now, text: null };
}
async function insertJob(env: CloudEnv, id: string, state: string, uuid: string | null) {
  await env.DB.prepare(
    'INSERT INTO cloud_jobs(id,kind,state,actor,version,request,build_uuid,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',
  )
    .bind(id, 'api', state, 'owner', 0, '{}', uuid, now, now)
    .run();
  await env.BUCKET.put('jobs/' + id + '/manifest.json', JSON.stringify({ version: 0, files: [] }));
}
async function approve(env: CloudEnv) {
  const files = [
    file('content/posts/published.md', 'published-content'),
    file('.studio/connections.json', 'old-credentials', 1),
    file('.studio/services/aca.json', 'old-service', 1),
  ];
  await insertJob(env, 'source', 'complete', 'source-build');
  for (const entry of files)
    await env.DB.prepare('INSERT INTO cloud_job_files VALUES(?,?,?,?)')
      .bind('source', entry.path, entry.sha, entry.encrypted)
      .run();
  await env.BUCKET.put('jobs/source/manifest.json', JSON.stringify({ version: 7, files }));
  await env.DB.prepare('INSERT INTO cloud_releases VALUES(?,?,?,?,?,?,?)')
    .bind('approved', 7, 'jobs/source/manifest.json', now, 'approved', null, null)
    .run();
  await env.DB.prepare("UPDATE cloud_control SET approved_release='approved' WHERE id=1").run();
}
function interceptBucket(
  env: CloudEnv,
  method: 'get' | 'put',
  before: (key: string) => Promise<void>,
) {
  env.BUCKET = new Proxy(env.BUCKET, {
    get(target, name) {
      const value = Reflect.get(target, name);
      if (typeof value !== 'function') return value;
      if (name !== method) return value.bind(target);
      return async (...args: unknown[]) => {
        await before(String(args[0]));
        return value.apply(target, args);
      };
    },
  });
}
function barrier(count = 2) {
  let remaining = count;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => (release = resolve));
  return async () => {
    if (--remaining === 0) release();
    await ready;
  };
}
async function active(env: CloudEnv) {
  return (
    await env.DB.prepare(
      "SELECT * FROM cloud_jobs WHERE state IN ('queued','running')",
    ).all<CloudJob>()
  ).results;
}

it.each(['queued', 'running'])(
  'rejects an unmatched retry while another job is %s without creating a job or touching its snapshot',
  async (state) => {
    const env = await setup();
    await approve(env);
    await insertJob(env, 'original', state, 'original-build');
    await expect(claimBuild(env, 'dashboard-retry', 'commit', 'main')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('A Cloudflare Dashboard Retry has a different build ID'),
    });
    expect((await active(env)).map((job) => [job.id, job.build_uuid, job.state])).toEqual([
      ['original', 'original-build', state],
    ]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_jobs').first('n')).toBe(2);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_objects').first('n')).toBe(0);
  },
);

it('waits only for an unregistered queued request and never steals it', async () => {
  const env = await setup();
  await insertJob(env, 'registering', 'queued', null);
  await expect(claimBuild(env, 'not-yet-recorded', 'commit', 'main')).rejects.toMatchObject({
    status: 503,
    message: expect.stringContaining('registration is settling'),
  });
  expect((await active(env))[0].build_uuid).toBeNull();
});

it('never turns a Git push into a public deployment, before or after an approved release', async () => {
  const env = await setup();
  await expect(claimBuild(env, 'git-build', 'commit', 'main')).rejects.toMatchObject({
    status: 404,
  });
  await approve(env);
  await expect(claimBuild(env, 'git-build', 'commit', 'main')).rejects.toMatchObject({
    status: 404,
  });
  expect(await active(env)).toEqual([]);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_jobs').first('n')).toBe(1);
});
it('returns the same captured job for concurrent matching claims without creating another release', async () => {
  const env = await setup();
  await insertJob(env, 'captured', 'queued', 'publish-build');
  const [a, b] = await Promise.all([
    claimBuild(env, 'publish-build', 'commit', 'main'),
    claimBuild(env, 'publish-build', 'commit', 'main'),
  ]);
  expect(a.job.id).toBe('captured');
  expect(b.job.id).toBe('captured');
  expect(await active(env)).toHaveLength(1);
});

it('recognizes its own build registered between the initial lookup and the active-queue check', async () => {
  const env = await setup();
  const database = env.DB;
  let registered = false;
  env.DB = {
    prepare(sql) {
      const statement = database.prepare(sql);
      if (!sql.includes("WHERE state IN ('queued','running') LIMIT 1")) return statement;
      return {
        bind: statement.bind.bind(statement),
        all: statement.all.bind(statement),
        run: statement.run.bind(statement),
        async first<T>(column?: string) {
          if (!registered) {
            registered = true;
            await insertJob(env, 'registered', 'queued', 'same-build');
          }
          return statement.first<T>(column);
        },
      };
    },
    batch: database.batch.bind(database),
    exec: database.exec.bind(database),
  };
  const result = await claimBuild(env, 'same-build', 'commit', 'main');
  expect(result.job).toMatchObject({ id: 'registered', state: 'running', commit_sha: 'commit' });
  expect(await active(env)).toHaveLength(1);
});

it('rolls back a captured Publish request when its authorization index cannot be written', async () => {
  const env = await setup(),
    workspace = await new CloudWorkspace(env).load();
  await env.DB.exec(
    "CREATE TRIGGER fixture_index_failure BEFORE INSERT ON cloud_jobs BEGIN SELECT RAISE(ABORT,'fixture capture failure'); END",
  );
  await expect(
    enqueue(
      new Request('https://studio.fixture.test/api/jobs', { method: 'POST' }),
      env,
      workspace,
      { id: 'owner', email: 'owner@test.test' },
      'publish',
    ),
  ).rejects.toThrow('fixture capture failure');
  expect(await active(env)).toEqual([]);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_releases').first('n')).toBe(0);
});

it('does not resurrect a cancelled job or collide with its replacement when cancellation races a claim', async () => {
  const env = await setup();
  await insertJob(env, 'cancelled', 'queued', 'old-build');
  interceptBucket(env, 'get', async (key) => {
    if (key !== 'jobs/cancelled/manifest.json') return;
    await env.DB.prepare("UPDATE cloud_jobs SET state='failed' WHERE id='cancelled'").run();
    await insertJob(env, 'replacement', 'queued', 'new-build');
  });
  await expect(claimBuild(env, 'old-build', 'commit', 'main')).rejects.toMatchObject({
    status: 409,
  });
  expect(
    await env.DB.prepare("SELECT state FROM cloud_jobs WHERE id='cancelled'").first('state'),
  ).toBe('failed');
  expect((await active(env)).map((job) => job.id)).toEqual(['replacement']);
});

it('rejects a different commit claiming an already running build without changing the original commit', async () => {
  const env = await setup();
  await insertJob(env, 'running', 'queued', 'build');
  await claimBuild(env, 'build', 'original-commit', 'main');
  await expect(claimBuild(env, 'build', 'different-commit', 'main')).rejects.toMatchObject({
    status: 409,
  });
  expect((await active(env))[0].commit_sha).toBe('original-commit');
});

it('does not mark a job running when its captured manifest is unavailable', async () => {
  const env = await setup();
  await insertJob(env, 'missing', 'queued', 'build');
  await env.BUCKET.delete('jobs/missing/manifest.json');
  await expect(claimBuild(env, 'build', 'commit', 'main')).rejects.toThrow('snapshot is missing');
  expect((await active(env))[0].state).toBe('queued');
});

it('does not requeue a cancelled request when the trigger finishes registering its build UUID', async () => {
  const env = await setup();
  await insertJob(env, 'cancelled', 'queued', null);
  vi.stubGlobal('fetch', async () => {
    await env.DB.prepare("UPDATE cloud_jobs SET state='failed' WHERE id='cancelled'").run();
    return Response.json({ success: true, result: { build_uuid: 'registered-build' } });
  });
  await trigger(env, (await active(env))[0]);
  expect(await active(env)).toEqual([]);
  expect(
    await env.DB.prepare("SELECT build_uuid FROM cloud_jobs WHERE id='cancelled'").first(
      'build_uuid',
    ),
  ).toBe('registered-build');
  await expect(claimBuild(env, 'registered-build', 'commit', 'main')).rejects.toMatchObject({
    status: 409,
  });
});

it('reports a queue conflict when two owner operations pass the initial empty-queue check together', async () => {
  const env = await setup();
  const workspace = await new CloudWorkspace(env).load();
  const meet = barrier();
  interceptBucket(env, 'put', async (key) => {
    if (key.endsWith('/manifest.json')) await meet();
  });
  const fetcher = vi.fn(async () =>
    Response.json({ success: true, result: { build_uuid: 'owner-build' } }),
  );
  vi.stubGlobal('fetch', fetcher);
  const results = await Promise.allSettled([
    enqueue(new Request('https://studio.fixture.test/api/media/usage'), env, workspace, {
      id: 'owner',
      email: 'owner@fixture.test',
    }),
    enqueue(new Request('https://studio.fixture.test/api/cloudflare/media'), env, workspace, {
      id: 'owner',
      email: 'owner@fixture.test',
    }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ status: 409 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await active(env)).toHaveLength(1);
});
