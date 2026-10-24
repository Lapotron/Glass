import { expect, it } from 'vitest';
import { serviceReadiness } from '../src/server/service-readiness.js';
import type { Store } from '../src/engine/store.js';
import type { ConnectionSettings } from '../src/server/configuration.js';
const store = {
  snapshot: async () => ({
    site: { url: 'https://reader.example', cloudflare: { accountId: 'account-id' } },
  }),
} as unknown as Store;
const connections = {
  values: async () => ({ CLOUDFLARE_API_TOKEN: 'private-canary-token' }),
} as unknown as ConnectionSettings;
it('checks fixed read-only scopes and never serializes credentials or provider error text', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push(String(url));
    expect(options?.method).toBeUndefined();
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer private-canary-token');
    return String(url).includes('/d1/')
      ? Response.json(
          { success: false, errors: [{ code: 10000, message: 'private-canary-token' }] },
          { status: 401 },
        )
      : Response.json({ success: true, result: [{}] });
  }) as typeof fetch;
  const result = await serviceReadiness(store, connections, fetcher);
  expect(result.ready).toBe(false);
  expect(result.checks.find((value) => value.id === 'd1')).toEqual({
    id: 'd1',
    status: 'denied',
    codes: [10000],
  });
  expect(calls).toHaveLength(4);
  expect(calls.every((url) => url.startsWith('https://api.cloudflare.com/client/v4/'))).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private-canary-token');
});
it('distinguishes a missing site zone from verified access and a transport failure', async () => {
  const result = await serviceReadiness(store, connections, (async (url) => {
    if (String(url).includes('/access/')) throw new Error('offline');
    return Response.json({ success: true, result: [] });
  }) as typeof fetch);
  expect(result.checks.find((value) => value.id === 'zone')?.status).toBe('missing');
  expect(result.checks.find((value) => value.id === 'access')?.status).toBe('unavailable');
});
