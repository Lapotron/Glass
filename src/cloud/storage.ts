import { CloudError, type CloudEnv } from './types.js';

/** Reserve physical private storage before upload, including staged and failed-job objects. */
export async function putObject(
  env: Pick<CloudEnv, 'DB' | 'BUCKET' | 'STORAGE_BUDGET_BYTES'>,
  key: string,
  value: string | Uint8Array,
) {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.byteLength;
  const budget = Number(env.STORAGE_BUDGET_BYTES || 5 * 1024 ** 3);
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 8 * 1024 ** 3)
    throw new CloudError('Set a private storage budget between 1 byte and 8 GiB.', 503);
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
  // Failed uploads keep their reservation. Conservatism is preferable to silently exceeding a budget.
  await env.BUCKET.put(key, value);
}
