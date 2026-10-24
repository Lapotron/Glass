import type { Store } from '../engine/store.js';
import type { ConnectionSettings } from './configuration.js';
import type { ServiceReadiness } from '../shared/local-settings.js';
/** Only fixed, read-only Cloudflare routes. Upstream text and credentials never enter the result. */
export async function serviceReadiness(
  store: Store,
  connections: ConnectionSettings,
  fetcher: typeof fetch = fetch,
  scopes: ServiceReadiness['checks'][number]['id'][] = ['workers', 'd1', 'access', 'zone'],
  captured?: { accountId: string; token: string; siteUrl: string },
): Promise<ServiceReadiness> {
  const { site } = await store.snapshot(),
    account = captured?.accountId || site.cloudflare.accountId;
  const token = captured?.token || (await connections.values()).CLOUDFLARE_API_TOKEN;
  if (!account || !token)
    throw new Error('Save the Cloudflare account and API token in Studio Connections first.');
  const origin = new URL(captured?.siteUrl || site.url);
  const paths = {
    workers: '/accounts/' + account + '/workers/scripts',
    d1: '/accounts/' + account + '/d1/database',
    access: '/accounts/' + account + '/access/organizations',
    zone:
      '/zones?name=' +
      encodeURIComponent(origin.hostname) +
      '&account.id=' +
      encodeURIComponent(account),
  } as const;
  const checks = await Promise.all(
    Object.entries(paths)
      .filter(([id]) => scopes.includes(id as ServiceReadiness['checks'][number]['id']))
      .map(async ([id, route]) => {
        const key = id as ServiceReadiness['checks'][number]['id'];
        try {
          const response = await fetcher('https://api.cloudflare.com/client/v4' + route, {
            headers: { Authorization: 'Bearer ' + token },
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          });
          const data = (await response.json()) as {
            success?: boolean;
            result?: unknown;
            errors?: { code?: unknown }[];
          };
          const codes = (data.errors || []).flatMap((error) =>
            typeof error.code === 'number' ? [error.code] : [],
          );
          const status =
            response.status === 401 || response.status === 403
              ? 'denied'
              : response.ok && data.success
                ? key === 'zone' && Array.isArray(data.result) && !data.result.length
                  ? 'missing'
                  : 'ready'
                : 'unavailable';
          return { id: key, status, codes } as ServiceReadiness['checks'][number];
        } catch {
          return { id: key, status: 'unavailable' as const, codes: [] };
        }
      }),
  );
  return {
    checkedAt: new Date().toISOString(),
    accountId: account,
    checks,
    ready: checks.every((item) => item.status === 'ready'),
  };
}
