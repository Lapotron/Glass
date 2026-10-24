import { CloudError, type CloudEnv } from './types.js';
import { requestBuild } from './jobs.js';

const key = 'runtime/deferred-approved-build.json';
type Deferred = {
  state: 'waiting' | 'claimed' | 'triggered' | 'uncertain' | 'superseded';
  release: string;
  after: string;
  updated: string;
  buildUuid?: string;
};
async function read(env: CloudEnv) {
  const object = await env.BUCKET.get(key);
  if (!object) return null;
  const value = JSON.parse(await object.text()) as Deferred;
  if (
    !['waiting', 'claimed', 'triggered', 'uncertain', 'superseded'].includes(value.state) ||
    !Number.isFinite(Date.parse(value.after)) ||
    !Number.isFinite(Date.parse(value.updated)) ||
    !/^[\w-]+$/.test(value.release)
  )
    throw new CloudError('The deferred build record needs operator review.', 503);
  return { object, value };
}
export async function deferredBuildStatus(env: CloudEnv) {
  return (await read(env))?.value || null;
}
/** One bounded operational R2 record remains writable during a D1 daily-write hold. */
export async function deferApprovedBuild(env: CloudEnv, now = new Date()) {
  if (env.PREVIEW === 'true') throw new CloudError('Previews cannot queue production builds.', 403);
  if (!env.BUILDS_DEPLOY_HOOK)
    throw new CloudError('Configure the private Deploy Hook first.', 503);
  const current = await env.DB.prepare(
    'SELECT approved_release FROM cloud_control WHERE id=1',
  ).first<{ approved_release: string | null }>();
  if (!current?.approved_release) throw new CloudError('No approved release is available.', 409);
  const existing = await read(env);
  if (existing && existing.value.state !== 'superseded') return existing.value;
  const after = new Date(now);
  after.setUTCHours(24, 5, 0, 0);
  const value: Deferred = {
    state: 'waiting',
    release: current.approved_release,
    after: after.toISOString(),
    updated: now.toISOString(),
  };
  await env.BUCKET.put(key, JSON.stringify(value));
  return value;
}
/** Returns true while this one-time trigger needs priority over ordinary scheduled jobs. */
export async function runDeferredBuild(
  env: CloudEnv,
  now = new Date(),
  fetcher: typeof fetch = fetch,
) {
  if (env.PREVIEW === 'true') return false;
  const saved = await read(env);
  if (!saved) return false;
  const { object, value } = saved;
  if (value.state !== 'waiting') {
    if (value.state === 'superseded') return false;
    const registered =
      value.buildUuid &&
      (await env.DB.prepare('SELECT id FROM cloud_jobs WHERE build_uuid=?')
        .bind(value.buildUuid)
        .first());
    return !registered && now.getTime() - Date.parse(value.updated) < 25 * 60_000;
  }
  if (now.getTime() < Date.parse(value.after)) return true;
  const current = await env.DB.prepare(
    'SELECT approved_release FROM cloud_control WHERE id=1',
  ).first<{ approved_release: string | null }>();
  if (current?.approved_release !== value.release) {
    await env.BUCKET.put(
      key,
      JSON.stringify({ ...value, state: 'superseded', updated: now.toISOString() }),
    );
    return false;
  }
  if (!object.etag) throw new CloudError('The deferred build cannot acquire its R2 lease.', 503);
  const claim = await env.BUCKET.put(
    key,
    JSON.stringify({ ...value, state: 'claimed', updated: now.toISOString() }),
    { onlyIf: { etagMatches: object.etag } },
  );
  if (!claim) return true;
  try {
    const buildUuid = await requestBuild(env, { hook: env.BUILDS_DEPLOY_HOOK }, fetcher);
    await env.BUCKET.put(
      key,
      JSON.stringify({ ...value, state: 'triggered', buildUuid, updated: now.toISOString() }),
    );
  } catch {
    // A timed-out trigger may have succeeded remotely. Never repeat it automatically.
    await env.BUCKET.put(
      key,
      JSON.stringify({ ...value, state: 'uncertain', updated: now.toISOString() }),
    );
  }
  return true;
}
