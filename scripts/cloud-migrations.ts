/** Read the migration journal before invoking Wrangler, so unchanged deploys need no D1 writes. */
export async function cloudMigrationsPending(
  names: string[],
  account: string,
  database: string,
  token: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT name FROM d1_migrations' }),
      signal: AbortSignal.timeout(30000),
    },
  );
  const data = await response.json();
  if (!response.ok || !data.success) {
    if (
      response.status === 400 &&
      data.errors?.some((error: { message?: string }) =>
        /no such table: d1_migrations/.test(error.message || ''),
      )
    )
      return true;
    throw new Error(
      'Could not read the D1 migration journal (' +
        response.status +
        '). No schema changes were attempted.',
    );
  }
  const applied = new Set(
    (data.result?.[0]?.results || []).map((row: { name: string }) => row.name),
  );
  return names.some((name) => !applied.has(name));
}
