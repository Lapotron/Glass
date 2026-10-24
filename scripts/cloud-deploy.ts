import './cloud-settings.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cloudFetch, uploadObject } from './cloud-client.js';
import { progressReporter } from './cloud-progress.js';
import { prepareSiteRoute } from './cloud-routing.js';
import { cloudMigrationsPending } from './cloud-migrations.js';
import { hostedConnectionSecrets, withHostedSecrets } from './cloud-secrets.js';
import { redactSecrets } from '../src/server/configuration.js';
import { verifyPublishedDeployment } from '../src/server/deployment-check.js';
import type { CloudJob } from '../src/cloud/jobs.js';
import type { BuildResult, PublishResult } from '../src/shared/contracts.js';
const target = process.argv[2];
if (!['studio', 'site'].includes(target)) throw new Error('Unknown deployment target.');
const directory = path.resolve('.studio/cloud', target),
  config = path.join(directory, 'wrangler.jsonc');
const run = (args: string[]) => {
  const result = spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 ** 2,
  });
  if (result.stdout) process.stdout.write(redactSecrets(result.stdout, process.env));
  if (result.stderr) process.stderr.write(redactSecrets(result.stderr, process.env));
  if (result.status !== 0)
    throw new Error('Cloudflare deployment failed. Inspect the retained build log.');
  return (result.stdout || '') + '\n' + (result.stderr || '');
};
if (target === 'studio') {
  hostedConnectionSecrets(process.env); // Reject preview credentials before any migration or deployment.
  // A supplied Builds token already authorizes deployment, including bootstrap.
  // Consult the coordinator only when no deployment credential was provided.
  if (!process.env.CLOUDFLARE_API_TOKEN && process.env.GLASS_CI_TOKEN)
    Object.assign(process.env, await (await cloudFetch('deployment-credentials')).json());
  const settings = JSON.parse(await fs.readFile(config, 'utf8'));
  const existing = !!settings.d1_databases?.[0]?.database_id;
  const deploy = () =>
    withHostedSecrets(process.env, async (file) => {
      run(['deploy', '--config', config, ...(file ? ['--secrets-file', file] : [])]);
    });
  if (!existing) await deploy();
  const names = (await fs.readdir('infrastructure/cloud/migrations')).filter((name) =>
    name.endsWith('.sql'),
  );
  if (
    !existing ||
    (await cloudMigrationsPending(
      names,
      process.env.CLOUDFLARE_ACCOUNT_ID!,
      settings.d1_databases[0].database_id,
      process.env.CLOUDFLARE_API_TOKEN!,
    ))
  )
    run(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', config]);
  else console.log('D1 migration journal is current; no database writes needed.');
  if (existing) await deploy();
  console.log(
    'Hosted connection defaults synchronized as runtime secrets. Explicit Studio credentials retain priority.',
  );
} else {
  const job = JSON.parse(await fs.readFile(path.join(directory, 'job.json'), 'utf8')) as CloudJob;
  const credentialFile = path.join(directory, 'deployment-credentials.json');
  Object.assign(process.env, JSON.parse(await fs.readFile(credentialFile, 'utf8')));
  await fs.rm(credentialFile, { force: true });
  if (job.kind !== 'publish') {
    console.log('Maintenance/build-only job completed; no public deployment.');
    process.exit(0);
  }
  const progress = progressReporter(job.id);
  let result: any;
  let undoFirstRoute = async () => {};
  let verified = false;
  try {
    result = await (await cloudFetch('jobs/' + job.id + '/result')).json();
    const build = result.body.build as BuildResult;
    await cloudFetch('jobs/' + job.id + '/deploy-lease', { method: 'POST' });
    await progress.phase('uploading');
    const settings = JSON.parse(await fs.readFile(config, 'utf8'));
    undoFirstRoute = await prepareSiteRoute(settings.name);
    const output = run(['deploy', '--config', config]);
    progress.log(output);
    const address =
      process.env.GLASS_ENABLE_SITE_DOMAIN === 'true'
        ? process.env.GLASS_SITE_ORIGIN
        : process.env.GLASS_SITE_STAGING_ORIGIN;
    if (!address)
      throw new Error('Configure the exact staging hostname before deploying the reader Worker.');
    const deployment: PublishResult = {
      url: new URL(address).origin,
      project: settings.name,
      buildId: build.id,
      completedAt: new Date().toISOString(),
    };
    result.body.deployment = deployment;
    await progress.phase('verifying-deployment');
    await verifyPublishedDeployment(deployment, build, fetch, {
      workerOrigins: [deployment.url],
      onLog: (message) => progress.log(message),
    });
    verified = true;
    await cloudFetch('jobs/' + job.id + '/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: deployment.url }),
    });
    result.body.logs = [...(result.body.logs || []), ...progress.logs];
    await uploadObject(job.id, 'result.json', Buffer.from(JSON.stringify(result)));
    await progress.close();
    await cloudFetch('jobs/' + job.id + '/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 200, resultKey: 'result.json' }),
    });
  } catch (error) {
    progress.log((error as Error).message);
    if (!verified)
      await undoFirstRoute().catch(() =>
        progress.log(
          'Automatic route recovery could not be confirmed. Inspect the exact site route before retrying.',
        ),
      );
    await progress.close().catch(() => {});
    if (result)
      await uploadObject(job.id, 'result.json', Buffer.from(JSON.stringify(result))).catch(
        () => {},
      );
    await cloudFetch('jobs/' + job.id + '/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 500,
        error: (error as Error).message,
        ...(result ? { resultKey: 'result.json' } : {}),
      }),
    }).catch(() => {});
    throw error;
  }
}
