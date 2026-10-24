import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { UiParams } from '../shared/i18n.js';

const acaConnectionMessages = {
  dns: 'Studio could not resolve the ACA hostname {hostname}. Check the service hostname and this computer’s DNS or proxy, then retry.',
  timeout:
    'The ACA service at {hostname} did not respond in time. Check the connection, then retry.',
  network:
    'Studio could not reach the ACA service at {hostname}. Check the connection and service deployment, then retry.',
};
export class AcaConnectionError extends Error {
  constructor(
    readonly messageKey: string,
    readonly messageParams: UiParams,
  ) {
    super(messageKey.replace(/\{(\w+)\}/g, (_, key: string) => String(messageParams[key] || '')));
  }
}
function codes(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== 'object' || depth > 4) return [];
  const value = error as { code?: string; name?: string; cause?: unknown; errors?: unknown[] };
  return [
    value.code || '',
    value.name || '',
    ...codes(value.cause, depth + 1),
    ...(value.errors || []).slice(0, 8).flatMap((error) => codes(error, depth + 1)),
  ];
}
function connectionError(url: URL, error: unknown) {
  const values = codes(error);
  const kind = values.some((value) => ['ENOTFOUND', 'EAI_AGAIN'].includes(value))
    ? 'dns'
    : values.some((value) =>
          ['TimeoutError', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(value),
        )
      ? 'timeout'
      : 'network';
  return new AcaConnectionError(acaConnectionMessages[kind], { hostname: url.hostname });
}
const maximumBytes = 4 * 1024 * 1024;

/** Private administrative reads only. Readers retain their normal browser/network privacy controls. */
export function createAcaFetch(
  primary: typeof fetch = fetch,
  direct: typeof httpsRequest = httpsRequest,
): typeof fetch {
  const cache = new Map<string, { addresses: string[]; expires: number }>();
  const pending = new Map<string, Promise<string[]>>();
  async function resolve(hostname: string) {
    const cached = cache.get(hostname);
    if (cached && cached.expires > Date.now()) return cached.addresses;
    let work = pending.get(hostname);
    if (!work) {
      work = (async () => {
        const url = new URL('https://cloudflare-dns.com/dns-query');
        url.searchParams.set('name', hostname);
        url.searchParams.set('type', 'A');
        // The resolver receives only the hostname, never report paths, cookies or credentials.
        const response = await primary(url, {
          headers: { Accept: 'application/dns-json' },
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('DNS resolver unavailable');
        const value = (await response.json()) as {
          Status?: number;
          Answer?: { type?: number; data?: string; TTL?: number }[];
        };
        const answers = (value.Answer || [])
          .slice(0, 20)
          .filter((answer) => answer.type === 1 && isIP(answer.data || '') === 4);
        if (value.Status !== 0 || !answers.length) throw new Error('DNS name unavailable');
        const addresses = answers.map((answer) => answer.data!);
        const ttl = Math.max(
          1,
          Math.min(
            300,
            ...answers.map((answer) => (Number.isFinite(answer.TTL) ? answer.TTL! : 30)),
          ),
        );
        if (cache.size >= 32) cache.delete(cache.keys().next().value!);
        cache.set(hostname, { addresses, expires: Date.now() + ttl * 1000 });
        return addresses;
      })().finally(() => pending.delete(hostname));
      pending.set(hostname, work);
    }
    return work;
  }
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    init = { ...init, redirect: init.redirect === 'manual' ? 'manual' : 'error' };
    try {
      return await primary(input, init);
    } catch (error) {
      const method = (
        init.method || (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      if (
        url.protocol !== 'https:' ||
        !['GET', 'HEAD', 'OPTIONS'].includes(method) ||
        !codes(error).some((code) => ['ENOTFOUND', 'EAI_AGAIN'].includes(code))
      )
        throw connectionError(url, error);
      let addresses: string[];
      try {
        addresses = await resolve(url.hostname);
      } catch {
        throw connectionError(url, error);
      }
      try {
        return await new Promise<Response>((resolve, reject) => {
          const headers = new Headers(
            init.headers || (input instanceof Request ? input.headers : undefined),
          );
          headers.set('Accept-Encoding', 'identity');
          const request = direct(
            url,
            {
              method,
              headers: Object.fromEntries(headers),
              rejectUnauthorized: true,
              signal: init.signal || (input instanceof Request ? input.signal : undefined),
              // Keep the original HTTPS hostname/SNI and ordinary certificate verification.
              lookup: (hostname, options, callback) => {
                if (hostname !== url.hostname) {
                  callback(new Error('Unexpected lookup host'), '', 4);
                  return;
                }
                if (options.all)
                  callback(
                    null,
                    addresses.map((address) => ({ address, family: 4 })),
                  );
                else callback(null, addresses[0], 4);
              },
            },
            (response) => {
              const chunks: Buffer[] = [];
              let bytes = 0;
              response.on('error', reject);
              response.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > maximumBytes)
                  request.destroy(new Error('ACA response exceeds the size limit'));
                else chunks.push(chunk);
              });
              response.on('end', () => {
                try {
                  const status = response.statusCode || 502;
                  if (status >= 300 && status < 400 && init.redirect !== 'manual') {
                    reject(new Error('ACA redirect rejected'));
                    return;
                  }
                  if (
                    response.headers['content-encoding'] &&
                    response.headers['content-encoding'] !== 'identity'
                  ) {
                    reject(new Error('Unexpected response encoding'));
                    return;
                  }
                  const resultHeaders = new Headers();
                  for (const [name, value] of Object.entries(response.headers))
                    if (value !== undefined)
                      resultHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
                  resolve(
                    new Response(
                      method === 'HEAD' || [204, 205, 304].includes(status)
                        ? null
                        : Buffer.concat(chunks),
                      { status, headers: resultHeaders },
                    ),
                  );
                } catch (error) {
                  reject(error);
                }
              });
            },
          );
          request.setTimeout(15000, () =>
            request.destroy(
              Object.assign(new Error('ACA request timed out'), { code: 'ETIMEDOUT' }),
            ),
          );
          request.on('error', reject);
          request.end();
        });
      } catch (failure) {
        throw connectionError(url, failure);
      }
    }
  };
}
export const acaServiceFetch = createAcaFetch();
