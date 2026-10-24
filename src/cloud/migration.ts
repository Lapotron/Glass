import { z } from 'zod';
import { NativeStore } from './native-store.js';
import { CloudWorkspace, stageFile, commitStaged, privatePath } from './workspace.js';
import { putObject } from './storage.js';
import { BACKUP_CHUNK_BYTES } from '../shared/backup-transfer.js';
import { withWorkspace } from './filesystem.js';
import { CloudError, type CloudEnv } from './types.js';
import { ConnectionSettings } from '../server/configuration.js';
import { NativeData, objectKey } from './native-data.js';
import { validateNotebookFile } from './validate-file.js';

export async function startMigration(env: CloudEnv, actor: string, version: number) {
  if (env.PREVIEW === 'true')
    throw new CloudError('Notebook import is disabled in branch previews.', 403);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO cloud_migrations(id,actor,version,created) VALUES(?,?,?,?)')
    .bind(id, actor, version, new Date().toISOString())
    .run();
  return { id, version };
}
export async function migrationSession(env: CloudEnv, id: string, actor: string) {
  z.uuid().parse(id);
  const row = await env.DB.prepare(
    'SELECT version,COALESCE(touched,created) AS created FROM cloud_migrations WHERE id=? AND actor=? AND state=?',
  )
    .bind(id, actor, 'uploading')
    .first<{ version: number; created: string }>();
  if (!row) throw new CloudError('Import session not found.', 404);
  if (Date.parse(row.created) + 7 * 86400000 < Date.now())
    throw new CloudError(
      'This import session expired. Review the folder and start a new import.',
      410,
    );
  return row;
}
export async function uploadMigration(
  env: CloudEnv,
  id: string,
  actor: string,
  path: string,
  bytes: Uint8Array,
  modified?: string,
) {
  await migrationSession(env, id, actor);
  await env.DB.prepare('UPDATE cloud_migrations SET touched=? WHERE id=?')
    .bind(new Date().toISOString(), id)
    .run();
  if (bytes.byteLength > BACKUP_CHUNK_BYTES)
    throw new CloudError('Use a multipart transfer for files larger than 8 MiB.', 413);
  validateNotebookFile(path, bytes);
  return stageFile(env, 'migration-' + id, path, bytes, modified);
}
/** Reuse an already verified blob; never trust a reservation for an unfinished upload. */
export async function linkMigration(env: CloudEnv, id: string, actor: string, input: unknown) {
  await migrationSession(env, id, actor);
  const data = z
    .object({
      path: z.string(),
      sha: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().nonnegative(),
      modified: z.string().optional(),
    })
    .parse(input);
  const { filePath } = await import('./workspace.js');
  filePath(data.path);
  if (privatePath(data.path)) return { linked: false };
  const existing = await env.DB.prepare(
    'SELECT sha,bytes,text FROM cloud_files WHERE sha=? AND bytes=? AND encrypted=0 UNION SELECT sha,bytes,text FROM cloud_patches WHERE id=? AND sha=? AND bytes=? AND encrypted=0 LIMIT 1',
  )
    .bind(data.sha, data.bytes, 'migration-' + id, data.sha, data.bytes)
    .first<{ text: string | null }>();
  if (!existing) return { linked: false };
  if (existing.text !== null)
    validateNotebookFile(data.path, new TextEncoder().encode(existing.text));
  else if (/\.(?:md|json)$/.test(data.path) && !data.path.startsWith('content/media/')) {
    if (data.bytes > BACKUP_CHUNK_BYTES)
      throw new CloudError('Author metadata must use the bounded import API.', 413);
    const source = await env.BUCKET.get('workspace/blobs/' + data.sha);
    if (!source) throw new CloudError('The reusable source object is missing.', 503);
    validateNotebookFile(data.path, new Uint8Array(await source.arrayBuffer()));
  }
  await env.DB.prepare(
    'INSERT INTO cloud_patches(id,path,sha,bytes,modified,text,encrypted) VALUES(?,?,?,?,?,?,0) ON CONFLICT(id,path) DO UPDATE SET sha=excluded.sha,bytes=excluded.bytes,modified=excluded.modified,text=excluded.text,encrypted=0',
  )
    .bind(
      'migration-' + id,
      data.path,
      data.sha,
      data.bytes,
      data.modified || new Date().toISOString(),
      !data.path.startsWith('content/media/') ? existing.text : null,
    )
    .run();
  await env.DB.prepare('UPDATE cloud_migrations SET touched=? WHERE id=?')
    .bind(new Date().toISOString(), id)
    .run();
  return { linked: true };
}
export async function finishMigration(env: CloudEnv, id: string, actor: string, input: unknown) {
  const row = await migrationSession(env, id, actor),
    data = z
      .object({
        files: z
          .array(
            z.object({
              path: z.string().max(2048),
              sha: z.string().regex(/^[a-f0-9]{64}$/),
              bytes: z.number().int().nonnegative(),
            }),
          )
          .min(2)
          .max(30000),
      })
      .parse(input);
  const staged = await env.DB.prepare(
    "SELECT path,sha,bytes,modified,CASE WHEN (path GLOB 'content/*' AND path NOT GLOB 'content/media/*') OR path GLOB '.studio/media-originals/*/record.json' THEN text ELSE NULL END AS text,encrypted FROM cloud_patches WHERE id=? ORDER BY path",
  )
    .bind('migration-' + id)
    .all<import('./types.js').FileRecord>();
  const expected = new Map(data.files.map((file) => [file.path, file]));
  if (
    expected.size !== data.files.length ||
    expected.size !== staged.results.length ||
    staged.results.some((file) => {
      const reviewed = expected.get(file.path);
      return !reviewed || reviewed.sha !== file.sha || reviewed.bytes !== file.bytes;
    })
  )
    throw new CloudError('Uploaded files do not match the reviewed migration manifest.', 409);
  if (!expected.has('content/site.json') || !expected.has('content/library.json'))
    throw new CloudError('Import needs site and library settings.');
  const before = await new CloudWorkspace(env).load('catalog');
  if (before.version !== row.version)
    throw new CloudError(
      'The notebook changed. The staged import is retained; review the current notebook before replacing it.',
      409,
    );
  // An ordinary export excludes credentials. Omitted private services must survive import.
  const retained = [...before.files.values()].filter(
    (file) =>
      (privatePath(file.path) ||
        ['.studio/backup-settings.json', '.studio/scheduler.json'].includes(file.path)) &&
      !expected.has(file.path),
  );
  const validation = new CloudWorkspace(env);
  // Validate canonical content and credentials without loading old artifacts/revisions into the request.
  for (const record of [...staged.results, ...retained])
    if (
      record.path.startsWith('content/') ||
      record.path.startsWith('.studio/media-originals/') ||
      record.path === '.studio/connections.json'
    )
      validation.files.set(record.path, record);
  await withWorkspace(validation, async () => {
    const store = new NativeStore(validation);
    await store.snapshot();
    await store.validateRecoveryReferences();
    await new ConnectionSettings('/workspace').values();
  });
  // Keep a private immutable object index for recovery without duplicating media bytes.
  const recoveryKey = 'migrations/' + id + '/before.json';
  await putObject(
    env,
    recoveryKey,
    JSON.stringify({
      ...before.manifest(),
      files: [...before.files.values()].filter((file) => privatePath(file.path)),
    }),
  );
  await env.DB.prepare('INSERT INTO cloud_manifest_roots VALUES(?,?)')
    .bind(
      recoveryKey,
      JSON.stringify([
        ...new Set(
          [...before.files.values()].filter((file) => privatePath(file.path)).map(objectKey),
        ),
      ]),
    )
    .run();
  const safety = await new NativeData(env).snapshot(before, 'before-restore');
  await commitStaged(
    env,
    'migration-' + id,
    row.version,
    actor,
    true,
    [
      env.DB.prepare('UPDATE cloud_migrations SET state=?,recovery_key=? WHERE id=?').bind(
        'completed',
        recoveryKey,
        id,
      ),
    ],
    retained,
  );
  return {
    ok: true,
    files: expected.size,
    retainedPrivateFiles: retained.length,
    safetyBackup: safety.id,
  };
}
