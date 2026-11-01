import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { promises as fs } from 'node:fs';
import { runServiceAlerts } from '../src/cloud/service-alerts.js';
import { validAlertWebhook } from '../src/shared/service-alerts.js';
import type { CloudEnv } from '../src/cloud/types.js';

let mf: Miniflare, env: CloudEnv;
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-10-12',
      d1Databases: { DB: 'alerts' },
    }),
  );
  const db = await mf.getD1Database('DB');
  const sql = (
    await fs.readFile('infrastructure/cloud/migrations/0005_service_alerts.sql', 'utf8')
  ).replace(/--[^\n]*/g, '');
  for (const statement of sql.split(';').filter((value) => value.trim()))
    await db.prepare(statement).run();
  env = { DB: db } as unknown as CloudEnv;
});
afterAll(async () => {
  await mf?.dispose();
});

it('only accepts a public HTTPS webhook destination without embedded credentials or a nonstandard port', () => {
  expect(validAlertWebhook('https://hooks.example.org/a?private=token')).toBe(true);
  for (const value of [
    'http://example.org/',
    'https://localhost/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://user:pass@example.org/',
    'https://example.org:8443/',
  ])
    expect(validAlertWebhook(value)).toBe(false);
});
it('is disabled by default and deduplicates issues, retries and recovery without exposing credentials', async () => {
  const start = Date.now(),
    calls: { id: string | null; body: string; authorization: string | null }[] = [];
  let issues = ['aca-unavailable'],
    response = 503;
  const source = async () => ({
    url: 'https://hooks.example.org/private?secret=do-not-log',
    token: 'private-bearer-token',
    issues,
  });
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      id: headers.get('Idempotency-Key'),
      body: String(init?.body),
      authorization: headers.get('Authorization'),
    });
    return new Response(null, { status: response });
  }) as typeof fetch;
  await runServiceAlerts(env, { now: start, source, fetcher });
  expect(calls).toHaveLength(0);
  await env.DB.prepare('UPDATE cloud_service_alerts SET enabled=1 WHERE id=1').run();
  await Promise.all([
    runServiceAlerts(env, { now: start, source, fetcher }),
    runServiceAlerts(env, { now: start, source, fetcher }),
  ]);
  expect(calls).toHaveLength(1);
  expect(calls[0].authorization).toBe('Bearer private-bearer-token');
  expect(calls[0].body).not.toContain('private-bearer-token');
  expect(calls[0].body).not.toContain('do-not-log');
  response = 204;
  await runServiceAlerts(env, { now: start + 60001, source, fetcher });
  expect(calls).toHaveLength(2);
  expect(calls[1].id).toBe(calls[0].id);
  await runServiceAlerts(env, { now: start + 6 * 60000, source, fetcher });
  expect(calls).toHaveLength(2);
  issues = [];
  await runServiceAlerts(env, { now: start + 12 * 60000, source, fetcher });
  expect(calls).toHaveLength(3);
  expect(JSON.parse(calls[2].body)).toMatchObject({ kind: 'recovery', issues: [] });
  const state = await env.DB.prepare('SELECT * FROM cloud_service_alerts').first();
  expect(JSON.stringify(state)).not.toContain('private-bearer-token');
  expect(JSON.stringify(state)).not.toContain('do-not-log');
});
