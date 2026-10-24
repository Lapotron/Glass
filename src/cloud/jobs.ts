import { putObject } from './storage.js';
import { CloudError, type Actor, type CloudEnv, type WorkspaceManifest } from './types.js';
import { ConnectionSettings } from '../server/configuration.js';
import type { CloudWorkspace } from './workspace.js';
import { persistHistory } from './history.js';
import { snapshotSelection } from '../shared/cloud-snapshot.js';
export type CloudJob = {
  phase?: string;
  logs?: string;
  id: string;
  kind: 'api' | 'publish' | 'build';
  state: string;
  actor: string;
  version: number;
  request: string;
  build_uuid: string | null;
  created: string;
  updated: string;
  result_key: string | null;
  error: string | null;
  release_id: string | null;
  commit_sha: string | null;
};
const allowed =
  /^\/api\/(?:preview$|content(?:\/|$)|trash(?:\/|$)|photos(?:\/|$)|media(?:\/|$)|backups(?:\/|$)|backup-settings(?:\/|$)|maintenance$|notebook\/reset|exports\/|jobs\/|projects\/github|cloud-media(?:\/|$)|search-console(?:\/|$)|aca(?:\/|$)|analytics(?:[-/]|$)|services\/|cloudflare(?:\/|$)|integrations\/|authoring\/|schedule(?:\/|$)|pages\/about|library\/undo|connections\/(?:test|import-environment)$)/;
export function queuedPath(path: string) {
  return allowed.test(path) && !path.includes('..') && !/[\\\0]/.test(path);
}
export async function requestBuild(
  env: CloudEnv,
  credentials: { hook?: string; token?: string },
  fetcher: typeof fetch = fetch,
) {
  const { token, hook } = credentials;
  if (env.PREVIEW === 'true')
    throw new CloudError('Production jobs are disabled in branch previews.', 403);
  if (
    hook &&
    !/^https:\/\/api\.cloudflare\.com\/client\/v4\/workers\/builds\/deploy_hooks\/[\w-]+$/.test(
      hook,
    )
  )
    throw new CloudError('Invalid Workers Builds Deploy Hook URL.', 503);
  if (
    !hook &&
    (!/^[\w-]+$/.test(env.BUILDS_TRIGGER_ID || '') ||
      !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || '') ||
      !token)
  )
    throw new CloudError(
      'Connect Workers Builds and configure a private Deploy Hook or a user-scoped Builds API token first.',
      503,
    );
  const response = await fetcher(
    hook ||
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/builds/triggers/${env.BUILDS_TRIGGER_ID}/builds`,
    {
      method: 'POST',
      headers: {
        ...(hook ? {} : { Authorization: 'Bearer ' + token }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ branch: env.PRODUCTION_BRANCH || 'main' }),
    },
  );
  const data = (await response.json()) as {
    success?: boolean;
    result?: { build_uuid?: string };
    errors?: { code: number }[];
  };
  if (!response.ok || !data.success || !data.result?.build_uuid)
    throw new CloudError(
      'Cloudflare could not start the build. Verify the private Deploy Hook or a user-scoped token with Workers Builds Configuration Edit. Account-scoped Pages tokens cannot call the Builds API.',
      503,
    );
  return data.result.build_uuid;
}
export async function trigger(env: CloudEnv, job: CloudJob) {
  const credentials = await new ConnectionSettings('/workspace', {
    BUILDS_API_TOKEN: env.BUILDS_API_TOKEN,
    BUILDS_DEPLOY_HOOK: env.BUILDS_DEPLOY_HOOK,
  }).values();
  const uuid = await requestBuild(env, {
    hook: credentials.BUILDS_DEPLOY_HOOK,
    token: credentials.BUILDS_API_TOKEN || credentials.CLOUDFLARE_API_TOKEN,
  });
  await env.DB.prepare('UPDATE cloud_jobs SET build_uuid=?, state=?, updated=? WHERE id=?')
    .bind(uuid, 'queued', new Date().toISOString(), job.id)
    .run();
  return uuid;
}
export async function enqueue(
  request: Request,
  env: CloudEnv,
  workspace: CloudWorkspace,
  actor: Actor,
  kind: CloudJob['kind'] = 'api',
) {
  if (kind === 'api' && !queuedPath(new URL(request.url).pathname))
    throw new CloudError('This operation is not available as a cloud job.', 404);
  const active = await env.DB.prepare(
    "SELECT id FROM cloud_jobs WHERE state IN ('queued','running') LIMIT 1",
  ).first();
  if (active)
    throw new CloudError(
      'A cloud job is already active. Wait for it to finish before starting another heavy operation.',
      409,
    );
  const usage = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM cloud_jobs WHERE build_uuid IS NOT NULL AND created>=?',
  )
    .bind(new Date().toISOString().slice(0, 7) + '-01')
    .first<{ count: number }>();
  if ((usage?.count || 0) >= 100)
    throw new CloudError(
      'The private monthly safety limit of 100 build jobs is reached. Review exact usage in Cloudflare before increasing the budget.',
      429,
    );
  const id = crypto.randomUUID(),
    now = new Date().toISOString(),
    manifest = workspace.manifest();
  const selection = snapshotSelection(new URL(request.url).pathname);
  if (kind === 'api')
    manifest.files = manifest.files.filter((file) => selection.includes(file.path));
  if (kind !== 'api')
    manifest.files = manifest.files.filter((file) =>
      /^(?:content\/|\.studio\/(?:media-originals\/|connections\.json$|services\/|cloud-media\/|render-cache\/mermaid\/))/.test(
        file.path,
      ),
    );
  await putObject(env, 'jobs/' + id + '/manifest.json', JSON.stringify(manifest));
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > 130 * 1024 ** 2)
    throw new CloudError('This upload exceeds the recovery limit.', 413);
  if (body.byteLength) await putObject(env, 'jobs/' + id + '/request', body);
  const descriptor = {
    path: new URL(request.url).pathname + new URL(request.url).search,
    method: request.method,
    contentType: request.headers.get('Content-Type'),
    hasBody: !!body.byteLength,
  };
  const releaseId = kind === 'api' ? null : crypto.randomUUID();
  const job: CloudJob = {
    id,
    kind,
    state: 'queued',
    actor: actor.id,
    version: workspace.version,
    request: JSON.stringify(descriptor),
    build_uuid: null,
    created: now,
    updated: now,
    result_key: null,
    error: null,
    release_id: releaseId,
    commit_sha: null,
  };
  const statements = [
    env.DB.prepare(
      'INSERT INTO cloud_jobs(id,kind,state,actor,version,request,created,updated,release_id) VALUES(?,?,?,?,?,?,?,?,?)',
    ).bind(id, kind, 'queued', actor.id, workspace.version, job.request, now, now, releaseId),
  ];
  statements.push(
    env.DB.prepare(
      'INSERT INTO cloud_job_files(job_id,path,sha,encrypted) SELECT ?,path,sha,encrypted FROM cloud_files' +
        (kind === 'api'
          ? ' WHERE ' + selection.where
          : " WHERE path GLOB 'content/*' OR path GLOB '.studio/media-originals/*' OR path='.studio/connections.json' OR path GLOB '.studio/services/*' OR path GLOB '.studio/cloud-media/*' OR path GLOB '.studio/render-cache/mermaid/*'"),
    ).bind(id, ...(kind === 'api' ? selection.values : [])),
  );
  if (releaseId) {
    statements.push(
      env.DB.prepare(
        'INSERT INTO cloud_releases(id,version,manifest_key,created,state) VALUES(?,?,?,?,?)',
      ).bind(releaseId, workspace.version, 'jobs/' + id + '/manifest.json', now, 'approved'),
    );
    if (kind === 'publish')
      statements.push(
        env.DB.prepare('UPDATE cloud_control SET approved_release=? WHERE id=1').bind(releaseId),
      );
  }
  await env.DB.batch(statements);
  try {
    job.build_uuid = await trigger(env, job);
  } catch (error) {
    await env.DB.prepare('UPDATE cloud_jobs SET state=?,error=? WHERE id=?')
      .bind('failed', (error as Error).message, id)
      .run();
    await persistHistory(env, {
      ...job,
      state: 'failed',
      error: (error as Error).message,
      updated: new Date().toISOString(),
    });
    throw error;
  }
  return job;
}
export async function claimBuild(env: CloudEnv, uuid: string, commit: string, branch: string) {
  if (branch !== (env.PRODUCTION_BRANCH || 'main') || env.PREVIEW === 'true')
    throw new CloudError('Production build credentials cannot be used by previews.', 403);
  let job = await env.DB.prepare('SELECT * FROM cloud_jobs WHERE build_uuid=?')
    .bind(uuid)
    .first<CloudJob>();
  if (!job) {
    // API-trigger startup can precede the coordinator's UUID write. Never select an arbitrary queued job.
    const waiting = await env.DB.prepare(
      "SELECT id FROM cloud_jobs WHERE build_uuid IS NULL AND state='queued' LIMIT 1",
    ).first();
    if (waiting) throw new CloudError('Build registration is settling. Retry this claim.', 503);
    const current = await env.DB.prepare(
      'SELECT approved_release FROM cloud_control WHERE id=1',
    ).first<{ approved_release: string | null }>();
    if (!current?.approved_release)
      throw new CloudError(
        'Import the notebook and approve its first release in Studio before deploying the public site.',
        409,
      );
    const release = await env.DB.prepare('SELECT * FROM cloud_releases WHERE id=?')
      .bind(current.approved_release)
      .first<{ version: number; manifest_key: string }>();
    if (!release) throw new CloudError('The approved release is unavailable.', 503);
    const now = new Date().toISOString(),
      id = crypto.randomUUID();
    job = {
      id,
      kind: 'publish',
      actor: 'github',
      version: release.version,
      request: '{}',
      build_uuid: uuid,
      state: 'queued',
      created: now,
      updated: now,
      result_key: null,
      error: null,
      release_id: current.approved_release,
      commit_sha: commit,
    };
    const source = await env.BUCKET.get(release.manifest_key);
    if (!source) throw new CloudError('Release snapshot is missing.', 503);
    const captured = JSON.parse(await source.text()) as WorkspaceManifest;
    // Credentials are operational state. Refresh them when code rebuilds a previously approved release.
    const operational = (
      await env.DB.prepare(
        "SELECT * FROM cloud_files WHERE path='.studio/connections.json' OR path GLOB '.studio/services/*'",
      ).all<import('./types.js').FileRecord>()
    ).results;
    captured.files = [
      ...captured.files.filter(
        (file) =>
          file.path !== '.studio/connections.json' && !file.path.startsWith('.studio/services/'),
      ),
      ...operational,
    ];
    await putObject(env, 'jobs/' + id + '/manifest.json', JSON.stringify(captured));
    await env.DB.prepare(
      'INSERT INTO cloud_jobs(id,kind,state,actor,version,request,build_uuid,created,updated,release_id,commit_sha) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        id,
        job.kind,
        'queued',
        'github',
        job.version,
        '{}',
        uuid,
        now,
        now,
        job.release_id,
        commit,
      )
      .run();
    const sourceJob = release.manifest_key.match(/^jobs\/([^/]+)\/manifest\.json$/)?.[1];
    if (!sourceJob) throw new CloudError('Approved release has no captured object index.', 503);
    await env.DB.prepare(
      'INSERT INTO cloud_job_files(job_id,path,sha,encrypted) SELECT ?,path,sha,encrypted FROM cloud_job_files WHERE job_id=?',
    )
      .bind(id, sourceJob)
      .run();
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM cloud_job_files WHERE job_id=? AND (path='.studio/connections.json' OR path GLOB '.studio/services/*')",
      ).bind(id),
      env.DB.prepare(
        "INSERT INTO cloud_job_files SELECT ?,path,sha,encrypted FROM cloud_files WHERE path='.studio/connections.json' OR path GLOB '.studio/services/*'",
      ).bind(id),
    ]);
  }
  if (!['queued', 'running'].includes(job.state))
    throw new CloudError('This build has already finished.', 409);
  await env.DB.prepare('UPDATE cloud_jobs SET state=?,commit_sha=?,updated=? WHERE id=?')
    .bind('running', commit, new Date().toISOString(), job.id)
    .run();
  const manifest = await env.BUCKET.get('jobs/' + job.id + '/manifest.json');
  if (!manifest) throw new CloudError('Captured notebook snapshot is missing.', 503);
  return { job, manifest: JSON.parse(await manifest.text()) as WorkspaceManifest };
}
