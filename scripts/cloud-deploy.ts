import './cloud-settings.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cloudFetch, uploadObject } from './cloud-client.js';
import { progressReporter } from './cloud-progress.js';
import { PagesConnection } from '../src/cloud/pages.js';
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
  try {
    result = await (await cloudFetch('jobs/' + job.id + '/result')).json();
    const build = result.body.build as BuildResult;
    await cloudFetch('jobs/' + job.id + '/deploy-lease', { method: 'POST' });
    await progress.phase('uploading');
    const settings = JSON.parse(await fs.readFile(path.join(directory, 'pages.json'), 'utf8'));
    if (settings.account !== process.env.CLOUDFLARE_ACCOUNT_ID)
      throw new Error('The captured Pages account differs from this pipeline.');
    const pages = new PagesConnection(settings.account, process.env.CLOUDFLARE_API_TOKEN!);
    const project = await pages.get(settings.project);
    if (!project)
      throw new Error('Create the Direct Upload Pages project in Hosting before publishing.');
    if (project.source)
      throw new Error(
        'The selected Pages project is Git-connected. Choose a Direct Upload project.',
      );
    const output = run([
      'pages',
      'deploy',
      path.join(directory, 'public'),
      '--project-name',
      settings.project,
      '--branch',
      settings.branch,
      '--commit-dirty=true',
      ...(job.commit_sha ? ['--commit-hash', job.commit_sha] : []),
    ]);
    progress.log(output);
    const address = output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev\/?/gi)?.at(-1);
    if (!address)
      throw new Error('Cloudflare returned no Pages deployment URL. Check Pages before retrying.');
    const deployment: PublishResult = {
      url: new URL(address).origin,
      project: settings.project,
      buildId: build.id,
      completedAt: new Date().toISOString(),
    };
    result.body.deployment = deployment;
    await progress.phase('verifying-deployment');
    await verifyPublishedDeployment(deployment, build, fetch, {
      onLog: (message) => progress.log(message),
    });
    const domains = await pages.domains(settings.project);
    const canonical = new URL(settings.canonical).origin;
    const live = domains.some(
      (domain: any) => domain.name === new URL(canonical).hostname && domain.status === 'active',
    );
    if (live)
      await verifyPublishedDeployment({ ...deployment, url: canonical }, build, fetch, {
        workerOrigins: [canonical],
        onLog: (message) => progress.log(message),
      });
    await cloudFetch('jobs/' + job.id + '/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: live ? canonical : deployment.url,
        project: settings.project,
        staged: !live,
      }),
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
