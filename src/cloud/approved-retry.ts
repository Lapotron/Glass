import { CloudError, type CloudEnv, type WorkspaceManifest, type FileRecord } from './types.js';
import { putObject, pinObjects } from './storage.js';
import { jsonChunks } from './json-chunks.js';
import { requestBuild } from './jobs.js';
import { objectKey } from './native-data.js';
/** An explicit, previously authorized quota recovery still registers an exact Publish job. */
export async function retryApprovedRelease(env: CloudEnv, source: string, fetcher: typeof fetch) {
  const release = await env.DB.prepare('SELECT version,manifest_key FROM cloud_releases WHERE id=?')
    .bind(source)
    .first<{ version: number; manifest_key: string }>();
  if (!release) throw new CloudError('The approved release is unavailable.', 409);
  const object = await env.BUCKET.get(release.manifest_key);
  if (!object) throw new CloudError('The approved snapshot is missing.', 503);
  const captured = JSON.parse(await object.text()) as WorkspaceManifest;
  if (
    !Array.isArray(captured.files) ||
    !captured.files.some((file) => file.path === 'content/site.json')
  )
    throw new CloudError('Approved snapshot is damaged.', 409);
  const operational = (
    await env.DB.prepare(
      "SELECT * FROM cloud_files WHERE path='.studio/connections.json' OR path GLOB '.studio/services/*'",
    ).all<FileRecord>()
  ).results;
  captured.files = [
    ...captured.files.filter(
      (file) =>
        file.path !== '.studio/connections.json' && !file.path.startsWith('.studio/services/'),
    ),
    ...operational,
  ];
  await pinObjects(env, captured.files.map(objectKey));
  const id = crypto.randomUUID(),
    releaseId = crypto.randomUUID(),
    now = new Date().toISOString(),
    manifest = 'jobs/' + id + '/manifest.json';
  await putObject(env, manifest, JSON.stringify(captured));
  const statements = [
    env.DB.prepare(
      'INSERT INTO cloud_releases(id,version,manifest_key,created,state) VALUES(?,?,?,?,?)',
    ).bind(releaseId, release.version, manifest, now, 'approved'),
    env.DB.prepare(
      'UPDATE cloud_control SET approved_release=? WHERE id=1 AND approved_release=?',
    ).bind(releaseId, source),
    env.DB.prepare(
      "INSERT INTO cloud_jobs(id,kind,state,actor,version,request,created,updated,release_id) SELECT ?,'publish','queued','approved-retry',?,'{}',?,?,? WHERE (SELECT approved_release FROM cloud_control WHERE id=1)=?",
    ).bind(id, release.version, now, now, releaseId, releaseId),
  ];
  for (const values of jsonChunks(
    captured.files.map((file) => [file.path, file.sha, file.encrypted]),
  ))
    statements.push(
      env.DB.prepare(
        "INSERT INTO cloud_job_files SELECT ?,json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]') FROM json_each(?)",
      ).bind(id, values),
    );
  await env.DB.batch(statements);
  const buildUuid = await requestBuild(env, { hook: env.BUILDS_DEPLOY_HOOK }, fetcher);
  await env.DB.prepare('UPDATE cloud_jobs SET build_uuid=?,updated=? WHERE id=?')
    .bind(buildUuid, new Date().toISOString(), id)
    .run();
  return buildUuid;
}
