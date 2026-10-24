import { CloudError, type CloudEnv } from './types.js';
import { jsonChunks } from './json-chunks.js';

/** Protect existing blobs before adding a new snapshot/reference, including expired recoveries. */
export async function pinObjects(env: Pick<CloudEnv, 'DB'>, keys: string[]) {
  const expires = new Date(Date.now() + 2 * 3600000).toISOString();
  for (const chunk of jsonChunks([...new Set(keys)])) {
    await env.DB.prepare(
      'INSERT INTO cloud_object_pins(key,expires) SELECT value,? FROM json_each(?) WHERE true ON CONFLICT(key) DO UPDATE SET expires=excluded.expires',
    )
      .bind(expires, chunk)
      .run();
    if (
      await env.DB.prepare(
        'SELECT value FROM json_each(?) WHERE value NOT IN (SELECT key FROM cloud_objects) LIMIT 1',
      )
        .bind(chunk)
        .first()
    )
      throw new CloudError(
        'A protected object is missing from private storage. Restore an independent recovery copy before continuing.',
        503,
      );
  }
}

/** Reserve physical private storage before upload, including staged and failed-job objects. */
export async function putObject(
  env: Pick<CloudEnv, 'DB' | 'BUCKET' | 'STORAGE_BUDGET_BYTES'>,
  key: string,
  value: string | Uint8Array,
) {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.byteLength;
  await reserveObject(env, key, bytes);
  // Failed uploads keep their reservation. Conservatism is preferable to silently exceeding a budget.
  await env.BUCKET.put(key, value);
}
export async function reserveObject(
  env: Pick<CloudEnv, 'DB' | 'BUCKET' | 'STORAGE_BUDGET_BYTES'>,
  key: string,
  bytes: number,
) {
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new CloudError('Invalid private object size.');
  const budget = Number(env.STORAGE_BUDGET_BYTES || 5 * 1024 ** 3);
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 8 * 1024 ** 3)
    throw new CloudError('Set a private storage budget between 1 byte and 8 GiB.', 503);
  // A writer pins before touching R2. The pin guard and GC lock serialize this with collection.
  // Even deduplicated objects need a fresh pin before a new reference can be committed.
  const pin = await env.DB.prepare('SELECT expires FROM cloud_object_pins WHERE key=?')
    .bind(key)
    .first<{ expires: string }>();
  if (!pin || Date.parse(pin.expires) < Date.now() + 3600000)
    await env.DB.prepare(
      'INSERT INTO cloud_object_pins VALUES(?,?) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires',
    )
      .bind(key, new Date(Date.now() + 2 * 3600000).toISOString())
      .run();
  const reserved = await env.DB.prepare('SELECT bytes FROM cloud_objects WHERE key=?')
    .bind(key)
    .first<{ bytes: number }>();
  if (!reserved || reserved.bytes < bytes)
    try {
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE cloud_storage SET budget=?, bytes=bytes+MAX(?-COALESCE((SELECT bytes FROM cloud_objects WHERE key=?),0),0) WHERE id=1',
        ).bind(budget, bytes, key),
        env.DB.prepare(
          'INSERT INTO cloud_objects(key,bytes,created) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET bytes=MAX(cloud_objects.bytes,excluded.bytes)',
        ).bind(key, bytes, new Date().toISOString()),
      ]);
    } catch (error) {
      if (/CHECK constraint/i.test(String(error)))
        throw new CloudError(
          'Private storage budget reached. Review retained artifacts and staged uploads before adding files.',
          413,
        );
      throw error;
    }
}
/** Release only an exact, application-owned temporary key after its physical deletion succeeds. */
export async function discardTransferObject(env: Pick<CloudEnv, 'DB' | 'BUCKET'>, key: string) {
  if (!/^transfers\/[a-f0-9-]{36}\/data$/.test(key))
    throw new CloudError('Invalid temporary transfer object.');
  await env.BUCKET.delete(key);
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE cloud_storage SET bytes=bytes-COALESCE((SELECT bytes FROM cloud_objects WHERE key=?),0) WHERE id=1',
    ).bind(key),
    env.DB.prepare('DELETE FROM cloud_objects WHERE key=?').bind(key),
  ]);
}
