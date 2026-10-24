import { it, expect } from 'vitest';
import { cloudMigrationsPending } from '../scripts/cloud-migrations.js';
it('uses only a read when the deployed D1 migration journal is current', async () => {
  const pending = await cloudMigrationsPending(
    ['0001.sql', '0002.sql'],
    'account',
    'database',
    'fixture',
    async (_url, options) => {
      expect(JSON.parse(String(options?.body))).toEqual({ sql: 'SELECT name FROM d1_migrations' });
      return Response.json({
        success: true,
        result: [{ results: [{ name: '0001.sql' }, { name: '0002.sql' }] }],
      });
    },
  );
  expect(pending).toBe(false);
});
it('distinguishes missing migrations from denied journal access', async () => {
  expect(
    await cloudMigrationsPending(['0002.sql'], 'a', 'b', 'c', async () =>
      Response.json({ success: true, result: [{ results: [] }] }),
    ),
  ).toBe(true);
  await expect(
    cloudMigrationsPending(['0002.sql'], 'a', 'b', 'c', async () =>
      Response.json({ success: false }, { status: 403 }),
    ),
  ).rejects.toThrow('No schema changes were attempted');
});
