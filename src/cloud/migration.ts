import { z } from 'zod';
import { Store } from '../engine/store.js';
import { CloudWorkspace, stageFile, commitStaged, privatePath } from './workspace.js';
import { putObject } from './storage.js';
import { BACKUP_UPLOAD_TTL_MS, BACKUP_CHUNK_BYTES } from '../shared/backup-transfer.js';
import { withWorkspace } from './filesystem.js';
import { CloudError, type CloudEnv } from './types.js';
import { ConnectionSettings } from '../server/configuration.js';

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
    'SELECT version,created FROM cloud_migrations WHERE id=? AND actor=? AND state=?',
  )
    .bind(id, actor, 'uploading')
    .first<{ version: number; created: string }>();
  if (!row) throw new CloudError('Import session not found.', 404);
  if (Date.parse(row.created) + BACKUP_UPLOAD_TTL_MS < Date.now())
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
  if (bytes.byteLength > BACKUP_CHUNK_BYTES)
    throw new CloudError('Use a multipart transfer for files larger than 8 MiB.', 413);
  return stageFile(env, 'migration-' + id, path, bytes, modified);
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
    'SELECT path,sha,bytes,modified,text,encrypted FROM cloud_patches WHERE id=? ORDER BY path',
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
  const before = await new CloudWorkspace(env).load();
  if (before.version !== row.version)
    throw new CloudError(
      'The notebook changed. The staged import is retained; review the current notebook before replacing it.',
      409,
    );
  // An ordinary export excludes credentials. Omitted private services must survive import.
  const retained = [...before.files.values()].filter(
    (file) => privatePath(file.path) && !expected.has(file.path),
  );
  const validation = new CloudWorkspace(env);
  // Validate canonical content and credentials without loading old artifacts/revisions into the request.
  for (const record of [...staged.results, ...retained])
    if (record.path.startsWith('content/') || record.path === '.studio/connections.json')
      validation.files.set(record.path, record);
  await withWorkspace(validation, async () => {
    await new Store('/workspace').snapshot();
    await new ConnectionSettings('/workspace').values();
  });
  // Keep a private immutable object index for recovery without duplicating media bytes.
  const recoveryKey = 'migrations/' + id + '/before.json';
  await putObject(env, recoveryKey, JSON.stringify(before.manifest()));
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
  return { ok: true, files: expected.size, retainedPrivateFiles: retained.length };
}
