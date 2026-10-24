import { it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { request as HttpsRequest } from 'node:https';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAcaFetch, AcaConnectionError } from '../src/server/aca-fetch.js';
import { createApp } from '../src/server/app.js';

const dnsError = () =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND' }),
  });
const dns = () => Response.json({ Status: 0, Answer: [{ type: 1, data: '203.0.113.7', TTL: 60 }] });
function directResponse(status = 200, body = '{"ok":true}') {
  const calls: { url: URL; options: any }[] = [];
  const direct = ((url: URL, options: unknown, callback: (response: Readable) => void) => {
    calls.push({ url, options });
    const request = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      end: () => void;
      destroy: (error: Error) => void;
    };
    request.setTimeout = vi.fn();
    request.destroy = (error) => {
      request.emit('error', error);
    };
    request.end = () => {
      const response = Readable.from([Buffer.from(body)]);
      Object.assign(response, {
        statusCode: status,
        headers: {
          'content-type': 'application/json',
          ...(status === 302 ? { location: 'https://unrelated.example/' } : {}),
        },
      });
      callback(response);
    };
    return request;
  }) as unknown as typeof HttpsRequest;
  return { direct, calls };
}

it('recovers private reads after local DNS failure, caches resolution and retains TLS host/credentials', async () => {
  const resolverCalls: RequestInit[] = [];
  const primary: typeof fetch = vi.fn(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === 'cloudflare-dns.com') {
      resolverCalls.push(init!);
      return dns();
    }
    throw dnsError();
  });
  const { direct, calls } = directResponse();
  const fetch = createAcaFetch(primary, direct);
  const headers = { Authorization: 'Bearer private-report-canary' };
  const results = await Promise.all(
    ['/v1/status', '/v1/reports/overview'].map((path) =>
      fetch('https://metrics.example' + path, { headers, redirect: 'error' }),
    ),
  );
  expect(await results[0].json()).toEqual({ ok: true });
  expect(resolverCalls).toHaveLength(1);
  expect(JSON.stringify(resolverCalls)).not.toContain('private-report-canary');
  expect(calls).toHaveLength(2);
  expect(calls[0].url.origin).toBe('https://metrics.example');
  expect(calls[0].options.rejectUnauthorized).toBe(true);
  expect(calls[0].options.headers.authorization).toBe(headers.Authorization);
  const callback = vi.fn();
  calls[0].options.lookup('metrics.example', { all: true }, callback);
  expect(callback).toHaveBeenCalledWith(null, [{ address: '203.0.113.7', family: 4 }]);
  await fetch('https://metrics.example/v1/status');
  expect(resolverCalls).toHaveLength(1);
});

it('does not recover mutations or connection refusals and reports actionable DNS failures without secrets', async () => {
  const primary = vi.fn<typeof fetch>(async () => {
    throw dnsError();
  });
  const { direct, calls } = directResponse();
  const fetch = createAcaFetch(primary, direct);
  await expect(
    fetch('https://metrics.example/v1/admin', {
      method: 'POST',
      headers: { Authorization: 'secret-canary' },
    }),
  ).rejects.toBeInstanceOf(AcaConnectionError);
  expect(primary).toHaveBeenCalledTimes(1);
  expect(calls).toEqual([]);
  await expect(fetch('https://metrics.example/v1/status')).rejects.toThrow('DNS or proxy');
  const refused = createAcaFetch(async () => {
    throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
  }, direct);
  await expect(refused('https://metrics.example/v1/status')).rejects.toThrow('could not reach');
  expect(calls).toEqual([]);
});

it('rejects redirects and oversized fallback responses instead of forwarding report credentials', async () => {
  const primary: typeof fetch = async (input) =>
    new URL(input instanceof Request ? input.url : input).hostname === 'cloudflare-dns.com'
      ? dns()
      : Promise.reject(dnsError());
  const redirect = directResponse(302);
  await expect(
    createAcaFetch(primary, redirect.direct)('https://metrics.example/v1/status', {
      redirect: 'error',
      headers: { Authorization: 'private-canary' },
    }),
  ).rejects.toBeInstanceOf(AcaConnectionError);
  expect(redirect.calls).toHaveLength(1);
  const large = directResponse(200, 'x'.repeat(4 * 1024 * 1024 + 1));
  await expect(
    createAcaFetch(primary, large.direct)('https://metrics.example/v1/status'),
  ).rejects.toBeInstanceOf(AcaConnectionError);
});

it('returns a translatable 503 from Studio when ACA is unreachable, preserving saved settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-aca-network-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  const context = await createApp(root, {
    watchFiles: false,
    analyticsFetch: async () => {
      throw new AcaConnectionError(
        'Studio could not resolve the ACA hostname {hostname}. Check the service hostname and this computer’s DNS or proxy, then retry.',
        { hostname: 'metrics.example' },
      );
    },
  });
  try {
    const state = await context.store.read();
    await context.store.saveJson(
      'site',
      {
        ...state.site,
        integrations: {
          ...state.site.integrations,
          aca: {
            ...state.site.integrations.aca,
            endpoint: 'https://metrics.example',
            siteId: 'test',
          },
        },
      },
      state.siteRevision,
    );
    await context.jobs.connections.update({
      revision: (await context.jobs.connections.summary()).revision,
      set: { acaReportToken: 'private-report-canary-1234567890' },
    });
    for (const route of [
      '/api/analytics-status',
      '/api/analytics/overview?from=2026-10-01&to=2026-10-23',
    ]) {
      const response = await context.app.request('http://localhost' + route);
      expect(response.status).toBe(503);
      const value = await response.json();
      expect(value.messageParams.hostname).toBe('metrics.example');
      expect(value.error).toContain('DNS or proxy');
      expect(JSON.stringify(value)).not.toContain('private-report-canary');
    }
    expect((await context.store.read()).site.integrations.aca.siteId).toBe('test');
  } finally {
    context.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
