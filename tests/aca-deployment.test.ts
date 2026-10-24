import { beforeEach, afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/engine/store.js';
import { ConnectionSettings } from '../src/server/configuration.js';
import { AcaDeploymentService } from '../src/server/aca-deployment.js';
import { createApp } from '../src/server/app.js';
import { JobService } from '../src/server/publishing.js';
import { AcaCloudflareFixture } from './fixtures/aca-cloudflare.js';
let root: string,
  store: Store,
  connections: ConnectionSettings,
  cloud: AcaCloudflareFixture,
  service: AcaDeploymentService;
const token = 'cloudflare-private-canary-123456789';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-aca-deployment-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  const model = await store.read();
  await store.saveJson(
    'site',
    {
      ...model.site,
      url: 'https://reader.example.org',
      cloudflare: { ...model.site.cloudflare, accountId: 'a'.repeat(32) },
    },
    model.siteRevision,
  );
  connections = new ConnectionSettings(root, {});
  await connections.update({
    revision: (await connections.summary()).revision,
    set: { cloudflareApiToken: token },
  });
  cloud = new AcaCloudflareFixture();
  service = new AcaDeploymentService(store, connections, {
    runner: cloud.runner,
    fetcher: cloud.fetch,
  });
  const initial = await service.summary();
  await service.save(
    { ...initial.options, domain: 'analytics.reader.example.org' },
    initial.revision,
  );
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function run(action: 'setup' | 'deploy' = 'deploy') {
  const started = await service.start(action, (await service.summary()).revision);
  return service.waitFor(started.id);
}
it('provisions, migrates, stores keys privately, deploys and verifies without invoking Pages or Access', async () => {
  const result = await run();
  expect(result.state, result.error).toBe('succeeded');
  expect(result.verified).toBe(true);
  expect(result.deploymentUrl).toBe('https://analytics.reader.example.org');
  expect(cloud.commands.map((args) => args[0])).toEqual(['d1', 'deploy']);
  expect(cloud.config).toMatchObject({
    name: 'reader-aca',
    account_id: 'a'.repeat(32),
    workers_dev: false,
    observability: { enabled: false },
    routes: [{ pattern: 'analytics.reader.example.org', custom_domain: true }],
    vars: {
      ENABLED: 'true',
      SITE_ID: 'reader',
      SITE_ORIGIN: 'https://reader.example.org',
      IDENTITY_MODE: 'anonymous',
      DAILY_READ_BUDGET: '2000000',
      DAILY_WRITE_BUDGET: '60000',
    },
  });
  expect(cloud.config.d1_databases).toEqual([
    expect.objectContaining({ binding: 'DB', database_id: cloud.databaseId }),
  ]);
  const credential = (await connections.values()).ACA_REPORT_TOKEN!;
  expect(credential).toHaveLength(64);
  expect(cloud.remoteSecrets.REPORT_TOKEN).toBe(credential);
  for (const key of ['REPORT_TOKEN', 'NETWORK_SECRET', 'IDENTITY_SECRET']) {
    expect(cloud.remoteSecrets[key]).toHaveLength(64);
    expect(JSON.stringify(await service.summary())).not.toContain(cloud.remoteSecrets[key]);
    expect(result.logs.join('\n')).not.toContain(cloud.remoteSecrets[key]);
    expect(JSON.stringify(cloud.commands)).not.toContain(cloud.remoteSecrets[key]);
  }
  expect(result.logs.join('\n')).toContain('[redacted]');
  expect(cloud.requests.every((item) => !item.url.includes('/access/'))).toBe(true);
  expect(
    cloud.requests.filter((item) => item.url.endsWith('/v1/events')).map((item) => item.method),
  ).toEqual(['OPTIONS', 'OPTIONS']);
  expect((await fs.stat(cloud.privateFiles[0])).mode & 0o777).toBe(0o600);
  await expect(fs.stat(cloud.privateFiles.at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(JSON.stringify((await store.snapshot()).site)).not.toContain(credential);
});
it('separates setup from upload and reuses the database and keys after restart', async () => {
  const prepared = await run('setup');
  expect(prepared.state, prepared.error).toBe('succeeded');
  expect(cloud.workerExists).toBe(false);
  expect(cloud.commands.map((args) => args[0])).toEqual(['d1']);
  const secret = (await connections.values()).ACA_REPORT_TOKEN;
  service = new AcaDeploymentService(store, connections, {
    runner: cloud.runner,
    fetcher: cloud.fetch,
  });
  const result = await run();
  expect(result.state, result.error).toBe('succeeded');
  expect(cloud.requests.filter((item) => item.method === 'POST')).toHaveLength(1);
  expect(cloud.remoteSecrets.REPORT_TOKEN).toBe(secret);
  const firstKeys = { ...cloud.remoteSecrets };
  await run();
  expect(cloud.remoteSecrets).toEqual(firstKeys);
});
it('keeps permission preflight read-only and stops before provisioning on denied D1', async () => {
  cloud.deniedD1 = true;
  const check = await service.check();
  expect(check.readiness.ready).toBe(false);
  expect(cloud.requests.every((item) => item.method === 'GET')).toBe(true);
  const result = await run();
  expect(result.state).toBe('failed');
  expect(result.failedAt).toBe('checking');
  expect(result.error).toContain('D1 Edit');
  expect(cloud.databaseId).toBeUndefined();
  expect(cloud.commands).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('Upstream private details');
});
it('stops a failed migration before upload and resumes without replacing the database', async () => {
  cloud.failMigration = true;
  const failed = await run();
  expect(failed.failedAt).toBe('migrating');
  expect(cloud.commands.some((args) => args[0] === 'deploy')).toBe(false);
  const databaseId = cloud.databaseId;
  cloud.failMigration = false;
  const next = await run();
  expect(next.state, next.error).toBe('succeeded');
  expect(next.databaseId).toBe(databaseId);
  expect(cloud.requests.filter((item) => item.method === 'POST')).toHaveLength(1);
});
it('preserves an uploaded but unverified endpoint and retains keys for a later attempt', async () => {
  cloud.failVerification = true;
  const failed = await run();
  expect(failed.state).toBe('failed');
  expect(failed.failedAt).toBe('verifying');
  expect(failed.deploymentUrl).toBe('https://analytics.reader.example.org');
  expect(failed.verified).not.toBe(true);
  const first = { ...cloud.remoteSecrets };
  cloud.failVerification = false;
  const result = await run();
  expect(result.state, result.error).toBe('succeeded');
  expect(cloud.remoteSecrets).toEqual(first);
});
it('captures credentials and refuses a concurrent change before uploading keys', async () => {
  cloud.migrationHook = async () => {
    await connections.update({
      revision: (await connections.summary()).revision,
      set: { cloudflareApiToken: 'replacement-private-cloudflare-token' },
    });
  };
  const result = await run();
  expect(result.state).toBe('failed');
  expect(result.failedAt).toBe('secrets');
  expect(result.error).toContain('credentials changed');
  expect(cloud.workerExists).toBe(false);
  expect(cloud.requests.every((item) => item.token === 'Bearer ' + token)).toBe(true);
  expect((await connections.values()).CLOUDFLARE_API_TOKEN).toBe(
    'replacement-private-cloudflare-token',
  );
});
it('rejects a stale deployment even when its private token and protocol match', async () => {
  cloud.staleDeployment = true;
  const result = await run();
  expect(result.state).toBe('failed');
  expect(result.failedAt).toBe('verifying');
  expect(result.deploymentUrl).toBe('https://analytics.reader.example.org');
  expect(result.verified).not.toBe(true);
});
it('preserves an existing ACA service’s unknown network and deletion secrets', async () => {
  const report = 'existing-report-key-at-least-32-characters';
  await connections.update({
    revision: (await connections.summary()).revision,
    set: { acaReportToken: report },
  });
  cloud.workerExists = true;
  cloud.config = {
    name: 'reader-aca',
    vars: { SITE_ID: 'reader', SITE_ORIGIN: 'https://reader.example.org' },
  };
  cloud.remoteSecrets = {
    REPORT_TOKEN: report,
    NETWORK_SECRET: 'existing-network-key-not-readable-by-the-API',
    IDENTITY_SECRET: 'existing-deletion-key-not-readable-by-the-API',
  };
  const before = { ...cloud.remoteSecrets };
  const result = await run();
  expect(result.state, result.error).toBe('succeeded');
  expect(cloud.remoteSecrets).toEqual(before);
});
it('reconciles an interrupted job without inventing success or deleting its uploaded URL', async () => {
  const completed = await run();
  await fs.writeFile(
    path.join(root, '.studio/services/aca-job.json'),
    JSON.stringify({
      job: { ...completed, state: 'uploading', verified: false, completedAt: undefined },
    }),
  );
  await fs.writeFile(
    path.join(root, '.studio/services/aca.lock'),
    JSON.stringify({ pid: 2147483646, id: completed.id }),
  );
  const restarted = new AcaDeploymentService(store, connections, {
    runner: cloud.runner,
    fetcher: cloud.fetch,
  });
  const result = await restarted.summary();
  expect(result.job?.state).toBe('failed');
  expect(result.job?.failedAt).toBe('uploading');
  expect(result.job?.deploymentUrl).toBe(completed.deploymentUrl);
  expect(result.job?.verified).toBe(false);
});
it('rejects stale settings and serializes deployments across separate service instances', async () => {
  const initial = await service.summary();
  await service.save({ ...initial.options, dailyBatches: 500 }, initial.revision);
  await expect(service.save(initial.options, initial.revision)).rejects.toThrow(
    'Local settings changed',
  );
  await expect(service.start('deploy', initial.revision)).rejects.toThrow('ACA settings changed');
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve));
  cloud.migrationHook = async () => {
    enter();
    await gate;
  };
  const started = await service.start('deploy');
  await entered;
  const other = new AcaDeploymentService(store, connections, {
    runner: cloud.runner,
    fetcher: cloud.fetch,
  });
  try {
    await expect(other.start('deploy')).rejects.toThrow('Another ACA');
  } finally {
    release();
  }
  expect((await service.waitFor(started.id)).state).toBe('succeeded');
});
it('does not replace an unrelated Worker and can deploy to workers.dev without zone access', async () => {
  cloud.workerExists = true;
  cloud.config = {
    name: 'reader-aca',
    vars: { SITE_ID: 'other', SITE_ORIGIN: 'https://other.example' },
  };
  const denied = await run();
  expect(denied.error).toContain('unrelated service');
  expect(cloud.databaseId).toBeUndefined();
  cloud.workerExists = false;
  const current = await service.summary();
  await service.save({ ...current.options, domain: '' }, current.revision);
  cloud.requests = [];
  const result = await run();
  expect(result.state, result.error).toBe('succeeded');
  expect(result.deploymentUrl).toBe('https://reader-aca.fixture.workers.dev');
  expect(cloud.requests.some((item) => new URL(item.url).pathname.endsWith('/zones'))).toBe(false);
});
it('serves metadata only and requires the Studio write token on setup endpoints', async () => {
  const jobs = new JobService(store);
  const context = await createApp(root, { watchFiles: false, jobs, acaDeployment: service });
  try {
    const initial = await (await context.app.request('http://localhost/api/aca/deployment')).json();
    const forbidden = await context.app.request('http://localhost/api/aca/deployment/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: initial.revision }),
    });
    expect(forbidden.status).toBe(403);
    expect(cloud.requests).toEqual([]);
    const response = await context.app.request('http://localhost/api/aca/deployment/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Studio-Token': context.token },
      body: JSON.stringify({ revision: initial.revision }),
    });
    expect(response.status).toBe(202);
    const job = await response.json();
    expect((await service.waitFor(job.id)).state).toBe('succeeded');
    const result = await (await context.app.request('http://localhost/api/aca/deployment')).text();
    expect(result).not.toContain(token);
    for (const secret of Object.values(cloud.remoteSecrets)) expect(result).not.toContain(secret);
    expect(
      await (await context.app.request('http://localhost/api/connections')).json(),
    ).toMatchObject({ fields: { acaReportToken: { configured: true, source: 'studio' } } });
  } finally {
    context.close();
  }
});

it('reviews only compatible Worker versions, invalidates changed controls and verifies the actual recovered version', async () => {
  expect((await run()).state).toBe('succeeded');
  cloud.savedVersion = { ...(cloud.config.vars as Record<string, string>) };
  const versions = await service.versions();
  expect(versions.versions[0].id).toBe(cloud.versionId);
  const review = await service.reviewRollback(cloud.versionId);
  const options = await service.summary();
  await service.save({ ...options.options, optionalHistory: true }, options.revision);
  await expect(service.rollback(review.id)).rejects.toThrow('changed');
  await expect(service.reviewRollback(cloud.versionId)).rejects.toThrow('compatible');
  const next = await service.summary();
  await service.save({ ...next.options, optionalHistory: false }, next.revision);
  const accepted = await service.reviewRollback(cloud.versionId);
  const result = await service.rollback(accepted.id);
  expect(result).toEqual({ verified: true, version: cloud.versionId });
  expect(cloud.rollbackUploads).toBe(1);
  const journal = JSON.parse(
    await fs.readFile(path.join(root, '.studio/services/rollback', accepted.id + '.json'), 'utf8'),
  );
  expect(journal.state).toBe('verified');
  expect(JSON.stringify(journal)).not.toContain(token);
});
it('preserves an uploaded recovery journal when the live version cannot be verified', async () => {
  expect((await run()).state).toBe('succeeded');
  const review = await service.reviewRollback(cloud.versionId);
  cloud.staleDeployment = true;
  await expect(service.rollback(review.id)).rejects.toThrow(
    'uploaded but live verification failed',
  );
  expect(cloud.rollbackUploads).toBe(1);
  const journal = JSON.parse(
    await fs.readFile(path.join(root, '.studio/services/rollback', review.id + '.json'), 'utf8'),
  );
  expect(journal.state).toBe('uploaded');
  expect(service.isBusy).toBe(false);
});
