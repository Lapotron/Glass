import { CloudWorkspace } from './workspace.js';
import { withWorkspace } from './filesystem.js';
import { Store } from '../engine/store.js';
import { enqueue, type CloudJob } from './jobs.js';
import { persistHistory } from './history.js';
import type { CloudEnv } from './types.js';

export async function reconcileJobs(env: CloudEnv) {
  const cutoff = new Date(Date.now() - 25 * 60_000).toISOString();
  const queuedCutoff = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const expired = (
    await env.DB.prepare(
      "SELECT j.*,p.phase,p.logs FROM cloud_jobs j LEFT JOIN cloud_progress p ON p.job_id=j.id WHERE (j.state='running' AND j.updated<?) OR (j.state='queued' AND j.updated<?)",
    )
      .bind(cutoff, queuedCutoff)
      .all<CloudJob>()
  ).results;
  for (const job of expired) {
    const error =
      job.state === 'queued'
        ? 'The build remained queued for two hours. Check Cloudflare before starting another job.'
        : 'No build heartbeat arrived for 25 minutes. Check the Cloudflare build log before starting another job.';
    const changed = await env.DB.prepare(
      "UPDATE cloud_jobs SET state='failed',error=?,updated=? WHERE id=? AND state=? AND updated=? RETURNING id",
    )
      .bind(error, new Date().toISOString(), job.id, job.state, job.updated)
      .first();
    if (!changed) continue;
    await env.DB.prepare(
      'UPDATE cloud_control SET deploy_lease=NULL,lease_expires=NULL WHERE deploy_lease=?',
    )
      .bind(job.id)
      .run();
    await persistHistory(env, {
      ...job,
      state: 'failed',
      error,
      updated: new Date().toISOString(),
    });
  }
}

export async function cloudSchedule(env: CloudEnv, manual = false) {
  if (env.PREVIEW === 'true') return { running: false, pendingIds: [], disabled: true };
  await reconcileJobs(env);
  const active = await env.DB.prepare(
    "SELECT id FROM cloud_jobs WHERE state IN ('queued','running') LIMIT 1",
  ).first();
  if (active) return { running: true, pendingIds: [] };
  const version =
    (
      await env.DB.prepare('SELECT version FROM cloud_workspace WHERE id=1').first<{
        version: number;
      }>()
    )?.version || 0;
  const cached = await env.DB.prepare(
    'SELECT version,next_due,error FROM cloud_schedule_cache WHERE id=1',
  ).first<{ version: number; next_due: string | null; error: string | null }>();
  if (
    !manual &&
    cached?.version === version &&
    (cached.error || !cached.next_due || Date.parse(cached.next_due) > Date.now())
  )
    return { running: false, pendingIds: [], error: cached.error || undefined };
  // Settings are inline rows. Idle crons never enumerate retained artifacts or download R2 blobs.
  const settings = (
    await env.DB.prepare(
      "SELECT path,text FROM cloud_files WHERE path IN ('content/site.json','.studio/backup-settings.json')",
    ).all<{ path: string; text: string | null }>()
  ).results;
  const site = JSON.parse(
    settings.find((file) => file.path === 'content/site.json')?.text || 'null',
  );
  const backup = JSON.parse(
    settings.find((file) => file.path === '.studio/backup-settings.json')?.text || '{}',
  );
  if (!site) return { running: false, pendingIds: [] };
  const backupDue =
    backup.enabled && !backup.error
      ? Date.parse(backup.lastSuccess || '1970-01-01') + 86400000
      : Infinity;
  if (!manual && !site.publishing?.scheduleEnabled && backupDue > Date.now()) {
    await cache(Number.isFinite(backupDue) ? new Date(backupDue).toISOString() : null);
    return { running: false, pendingIds: [] };
  }
  const ws = await new CloudWorkspace(env).load(true);
  return withWorkspace(ws, async () => {
    try {
      const model = await new Store('/workspace').snapshot();
      const scheduled = model.entries.filter((entry) => entry.status === 'scheduled');
      const due = scheduled.filter((entry) => Date.parse(entry.publishAt) <= Date.now());
      if ((manual || model.site.publishing.scheduleEnabled) && due.length) {
        const job = await enqueue(
          new Request(env.STUDIO_ORIGIN + '/api/schedule/prepare', { method: 'POST' }),
          env,
          ws,
          { id: 'scheduler', email: 'scheduler' },
        );
        return { running: true, pendingIds: due.map((entry) => entry.id), lastJob: job.id };
      }
      if (!manual && backupDue <= Date.now()) {
        const job = await enqueue(
          new Request(env.STUDIO_ORIGIN + '/api/backup-settings/run', { method: 'POST' }),
          env,
          ws,
          { id: 'scheduler', email: 'scheduler' },
        );
        return { running: true, pendingIds: [], lastJob: job.id };
      }
      const next = Math.min(
        backupDue,
        ...(model.site.publishing.scheduleEnabled
          ? scheduled.map((entry) => Date.parse(entry.publishAt))
          : []),
      );
      await cache(Number.isFinite(next) ? new Date(next).toISOString() : null);
      return { running: false, pendingIds: [], lastRun: new Date().toISOString() };
    } catch (error) {
      await cache(null, (error as Error).message);
      throw error;
    }
  });
  async function cache(next: string | null, error: string | null = null) {
    await env.DB.prepare(
      'INSERT INTO cloud_schedule_cache(id,version,next_due,error) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,next_due=excluded.next_due,error=excluded.error',
    )
      .bind(version, next, error)
      .run();
  }
}
