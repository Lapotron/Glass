import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { cloudFetch } from '../scripts/cloud-client.js';

function environment() {
  vi.stubEnv('GLASS_STUDIO_ORIGIN', 'https://console.example.com');
  vi.stubEnv('GLASS_CI_TOKEN', 'fixture-ci-token');
  vi.stubEnv('CF_ACCESS_CLIENT_ID', 'fixture-access-id');
  vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'fixture-access-secret');
}
afterEach(() => vi.unstubAllEnvs());

it('sends both authentication layers and preserves caller headers and binary responses', async () => {
  environment();
  const result = await cloudFetch(
    'jobs/job/blob/hash?path=content%2Fmedia%2Fimage.png',
    { headers: new Headers({ 'X-Fixture': 'custom' }) },
    async (input, options) => {
      expect(String(input)).toBe(
        'https://console.example.com/__ci/jobs/job/blob/hash?path=content%2Fmedia%2Fimage.png',
      );
      const headers = new Headers(options?.headers);
      expect(headers.get('Authorization')).toBe('Bearer fixture-ci-token');
      expect(headers.get('CF-Access-Client-Id')).toBe('fixture-access-id');
      expect(headers.get('CF-Access-Client-Secret')).toBe('fixture-access-secret');
      expect(headers.get('X-Fixture')).toBe('custom');
      expect(options?.redirect).toBe('manual');
      return new Response(new Uint8Array([0, 128, 255]));
    },
  );
  expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255]));
});

it.each([301, 302, 303, 307, 308])(
  'explains Access redirect %i without exposing login metadata or credentials',
  async (status) => {
    environment();
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status,
          headers: {
            Location:
              'https://team.cloudflareaccess.com/cdn-cgi/access/login/console.example.com?meta=private-login-metadata',
          },
        }),
    );
    let message = '';
    try {
      await cloudFetch('deployment-credentials', {}, request);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('Cloudflare Access requires a machine login');
    expect(message).toContain('CF_ACCESS_CLIENT_ID');
    expect(message).toContain('Service Auth');
    expect(message).toContain('For a first Studio deployment, supply CLOUDFLARE_API_TOKEN');
    expect(message).not.toMatch(/private-login-metadata|fixture-ci-token|fixture-access-secret/);
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it('rejects unrelated redirects with origin guidance instead of diagnosing them as Access', async () => {
  environment();
  await expect(
    cloudFetch(
      'workspace',
      {},
      async () =>
        new Response(null, {
          status: 308,
          headers: {
            Location:
              'https://team.cloudflareaccess.com.attacker.example/cdn-cgi/access/login/console.example.com?token=private',
          },
        }),
    ),
  ).rejects.toThrow('Check GLASS_STUDIO_ORIGIN and remove redirects');
});

it('does not follow a real HTTP redirect or forward build credentials to its destination', async () => {
  environment();
  let received = 0;
  const destination = createServer((_request, response) => {
    received++;
    response.end('Unexpected destination');
  });
  destination.listen(0, '127.0.0.1');
  await once(destination, 'listening');
  const redirected = createServer((request, response) => {
    expect(request.headers.authorization).toBe('Bearer fixture-ci-token');
    expect(request.headers['cf-access-client-secret']).toBe('fixture-access-secret');
    response.writeHead(302, {
      Location: 'http://127.0.0.1:' + (destination.address() as AddressInfo).port + '/login',
    });
    response.end();
  });
  try {
    redirected.listen(0, '127.0.0.1');
    await once(redirected, 'listening');
    vi.stubEnv(
      'GLASS_STUDIO_ORIGIN',
      'http://127.0.0.1:' + (redirected.address() as AddressInfo).port,
    );
    await expect(cloudFetch('deployment-credentials')).rejects.toThrow('returned a redirect');
    expect(received).toBe(0);
  } finally {
    await Promise.all(
      [redirected, destination].map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  }
});

it('distinguishes a rejected Studio CI token from a rejected Access service token', async () => {
  environment();
  await expect(
    cloudFetch('workspace', {}, async () =>
      Response.json({ error: 'Build authentication required.' }, { status: 401 }),
    ),
  ).rejects.toThrow('GLASS_CI_TOKEN matches the Studio runtime CI_TOKEN');
  await expect(
    cloudFetch('workspace', {}, async () => new Response('Forbidden', { status: 403 })),
  ).rejects.toThrow('Service Auth policy');
  await expect(
    cloudFetch('workspace', {}, async () =>
      Response.json(
        { error: 'This build coordinator hostname is not configured.' },
        { status: 403 },
      ),
    ),
  ).rejects.toThrow('This build coordinator hostname is not configured.');
});

it('rejects a successful HTML login or wrong application response before JSON parsing', async () => {
  environment();
  await expect(
    cloudFetch(
      'workspace',
      {},
      async () =>
        new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
    ),
  ).rejects.toThrow('HTML instead of an API response');
});

it.each(['CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET'])(
  'stops before making a request when %s is missing from an incomplete service-token pair',
  async (name) => {
    environment();
    vi.stubEnv(name, '');
    const request = vi.fn<typeof fetch>();
    await expect(cloudFetch('workspace', {}, request)).rejects.toThrow('Configure ' + name);
    expect(request).not.toHaveBeenCalled();
  },
);

it.each([
  'http://console.example.com',
  'https://console.example.com/studio/',
  'https://user:password@console.example.com',
  'https://console.example.com?token=private',
  'https://console.example.com#homepage',
  'ftp://127.0.0.1',
])(
  'rejects a non-origin or insecure Studio address before sending credentials: %s',
  async (origin) => {
    environment();
    vi.stubEnv('GLASS_STUDIO_ORIGIN', origin);
    const request = vi.fn<typeof fetch>();
    await expect(cloudFetch('workspace', {}, request)).rejects.toThrow('exact HTTPS Studio origin');
    expect(request).not.toHaveBeenCalled();
  },
);
