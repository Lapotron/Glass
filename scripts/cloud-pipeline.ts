import './cloud-settings.js';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cloudFetch } from './cloud-client.js';
import type { PipelineMode } from '../src/shared/cloud-pipeline.js';
const phase = process.argv[2];
if (!['build', 'deploy'].includes(phase)) throw new Error('Choose build or deploy.');
const marker = '.studio/cloud/pipeline.json';
const run = (script: string, args: string[]) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/' + script, ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
};
if (phase === 'build') {
  await fs.rm(marker, { force: true });
  let mode: PipelineMode = 'studio';
  const branch = process.env.WORKERS_CI_BRANCH || process.env.GLASS_PRODUCTION_BRANCH || 'main',
    preview = branch !== (process.env.GLASS_PRODUCTION_BRANCH || 'main');
  console.log(
    'Glass pipeline setup: ' +
      (preview ? 'preview branch' : 'production branch') +
      '; CI token ' +
      (process.env.GLASS_CI_TOKEN ? 'configured' : 'missing') +
      '; bootstrap ' +
      (process.env.GLASS_PIPELINE_BOOTSTRAP === 'true' ? 'enabled' : 'disabled') +
      '; Access service token ' +
      (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
        ? 'configured'
        : process.env.CF_ACCESS_CLIENT_ID || process.env.CF_ACCESS_CLIENT_SECRET
          ? 'incomplete'
          : 'missing') +
      '.',
  );
  if (!preview && !process.env.GLASS_CI_TOKEN)
    console.log(
      'Publish requests cannot be claimed until GLASS_CI_TOKEN is configured in Workers Builds GLASS_CI_SECRETS. This run can update Studio only.',
    );
  if (!preview && process.env.GLASS_PIPELINE_BOOTSTRAP === 'true')
    console.log(
      'Explicit bootstrap skips Publish. Remove GLASS_PIPELINE_BOOTSTRAP after the first successful Studio deployment.',
    );
  if (!preview && process.env.GLASS_CI_TOKEN && process.env.GLASS_PIPELINE_BOOTSTRAP !== 'true') {
    if (!process.env.WORKERS_CI_BUILD_UUID)
      throw new Error(
        'The single pipeline requires Workers Builds metadata. Use cloud-build.ts for local artifact checks.',
      );
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await (
        await cloudFetch(
          'pipeline?' + new URLSearchParams({ build: process.env.WORKERS_CI_BUILD_UUID, branch }),
        )
      ).json();
      if (result.settling && attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (result.settling)
        throw new Error(
          'Publish registration is still settling. Check Hosting; no deployment was attempted.',
        );
      mode = result.mode;
      break;
    }
  }
  if (!['studio', 'publish', 'service'].includes(mode))
    throw new Error('Invalid pipeline response.');
  console.log('Glass pipeline: ' + mode + (mode === 'studio' ? ' (public site unchanged)' : ''));
  run(mode !== 'studio' ? 'cloud-ci.ts' : 'cloud-build.ts', mode !== 'studio' ? [] : ['studio']);
  await fs.mkdir('.studio/cloud', { recursive: true });
  await fs.writeFile(
    marker,
    JSON.stringify({
      version: 1,
      mode,
      preview,
      build: process.env.WORKERS_CI_BUILD_UUID || '',
      commit: process.env.WORKERS_CI_COMMIT_SHA || '',
    }),
  );
} else {
  const value = JSON.parse(await fs.readFile(marker, 'utf8'));
  if (
    value.version !== 1 ||
    value.build !== (process.env.WORKERS_CI_BUILD_UUID || '') ||
    value.commit !== (process.env.WORKERS_CI_COMMIT_SHA || '') ||
    !['studio', 'publish', 'service'].includes(value.mode)
  )
    throw new Error('Pipeline artifact does not match this build.');
  if (value.preview) run('cloud-preview.ts', ['studio']);
  else run('cloud-deploy.ts', [value.mode !== 'studio' ? 'site' : 'studio']);
}
