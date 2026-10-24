import { jobRecord } from '../server/job-history.js';
import type { Job } from '../shared/contracts.js';
import type { CloudJob } from './jobs.js';
import { CloudWorkspace } from './workspace.js';
import type { CloudEnv } from './types.js';

export function cloudJobRecord(job: CloudJob, env: CloudEnv, result?: any): Job {
  const body = result?.body;
  return jobRecord({
    id: job.id,
    action: job.kind === 'publish' ? 'publish' : 'build',
    state:
      job.state === 'running'
        ? ((job.phase || 'building') as Job['state'])
        : (job.state as Job['state']),
    logs: [
      ...(body?.logs || (job.logs ? JSON.parse(job.logs) : ['Cloudflare Workers Build'])),
      ...(job.error ? [job.error] : []),
    ],
    startedAt: job.created,
    completedAt: ['succeeded', 'failed'].includes(job.state) ? job.updated : undefined,
    error: job.error || undefined,
    ...(job.state === 'failed' && job.phase ? { failedAt: job.phase as Job['failedAt'] } : {}),
    target: {
      canonicalUrl: env.SITE_ORIGIN,
      project: 'Workers',
      branch: env.PRODUCTION_BRANCH || 'main',
    },
    ...(body?.build ? { build: body.build, mediaDelivery: body.build.media ? 'r2' : 'pages' } : {}),
    ...(body?.deployment ? { deployment: body.deployment } : {}),
  });
}

export async function history(ws: CloudWorkspace, env: CloudEnv, rows: CloudJob[]) {
  const records: Job[] = [];
  for (const path of ws.paths().filter((path) => /^\.studio\/jobs\/[\w-]+\.json$/.test(path))) {
    const job = JSON.parse(new TextDecoder().decode(await ws.read(path))) as Job;
    if (!job.id || !Array.isArray(job.logs)) continue;
    records.push(jobRecord(job));
  }
  for (const row of rows.filter(
    (row) => row.kind !== 'api' && ['queued', 'running'].includes(row.state),
  )) {
    if (!records.some((job) => job.id === row.id)) records.push(cloudJobRecord(row, env));
  }
  return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function persistHistory(env: CloudEnv, job: CloudJob, result?: any) {
  if (job.kind === 'api') return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ws = await new CloudWorkspace(env).load(true);
    ws.write(
      `.studio/jobs/${job.id}.json`,
      new TextEncoder().encode(JSON.stringify(cloudJobRecord(job, env, result), null, 2)),
    );
    try {
      await ws.commit(job.actor);
      return;
    } catch (error) {
      if ((error as { status?: number }).status !== 409 || attempt === 2) throw error;
    }
  }
}
