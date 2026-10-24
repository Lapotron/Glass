import { expect, it, vi } from 'vitest';
import { siteSchema } from '../src/shared/contracts.js';
import seed from './fixtures/notebook/site.json';
import { checkCloudflareConnection, checkR2Connection } from '../src/cloud/connection-checks.js';
import { queuedPath } from '../src/cloud/jobs.js';

const accountId = 'a'.repeat(32);
const site = siteSchema.parse({
  ...seed,
  cloudflare: { ...seed.cloudflare, accountId },
  mediaDelivery: {
    mode: 'r2',
    bucket: 'public-media',
    prefix: 'media',
    publicOrigin: 'https://assets.fixture.test',
  },
});
const credentials = {
  R2_ACCESS_KEY_ID: 'fixture-s3-access',
  R2_SECRET_ACCESS_KEY: 'fixture-private-s3-secret',
  CLOUDFLARE_API_TOKEN: 'fixture-private-api-token',
};
it('checks the selected bucket with one signed read and returns no private object metadata', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const request = input as Request;
    expect(request.url).toBe(
      `https://${accountId}.r2.cloudflarestorage.com/public-media?list-type=2&max-keys=1`,
    );
    expect(request.method).toBe('GET');
    expect(request.redirect).toBe('manual');
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=fixture-s3-access\/\d{8}\/auto\/s3\/aws4_request,/,
    );
    return new Response('<ListBucketResult><Key>private-object-canary</Key></ListBucketResult>');
  });
  const result = await checkR2Connection(site, credentials, fetcher);
  expect(result.ok).toBe(true);
  expect(result.message).toContain('Bucket read access verified');
  expect(JSON.stringify(result)).not.toMatch(/canary|fixture-s3-access|fixture-private/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('reports missing configuration immediately without making a network request', async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    checkR2Connection(
      { ...site, cloudflare: { ...site.cloudflare, accountId: '' } },
      credentials,
      fetcher,
    ),
  ).rejects.toThrow('Cloudflare account ID');
  await expect(checkR2Connection(site, {}, fetcher)).rejects.toThrow('R2_ACCESS_KEY_ID');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([301, 302, 403, 404, 500])(
  'does not follow redirects or leak R2 errors (HTTP %s)',
  async (status) => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response('fixture-private-s3-secret', { status }),
    );
    await expect(checkR2Connection(site, credentials, fetcher)).rejects.toThrow(
      'Could not read the R2 bucket',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it('rejects a malformed listing and sanitizes connection timeouts', async () => {
  for (const fetcher of [
    async () => new Response('<html>not an S3 response</html>'),
    async () => {
      throw new Error('fixture-private-s3-secret: timed out');
    },
  ]) {
    await expect(checkR2Connection(site, credentials, fetcher)).rejects.toThrow(
      'The check times out after 15 seconds',
    );
  }
});
it('keeps account-owned Pages tokens usable without account-list permission', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    return String(input).includes('/pages/projects')
      ? Response.json({ success: true, result: [{ name: 'reader', secret: 'canary' }] })
      : Response.json({ success: false, errors: [{ message: 'private-canary' }] }, { status: 403 });
  });
  const result = await checkCloudflareConnection(accountId, credentials, fetcher);
  expect(result).toMatchObject({
    authenticated: true,
    accountId,
    pagesAccess: 'verified',
    projects: [{ name: 'reader' }],
  });
  expect(JSON.stringify(result)).not.toContain('canary');
});
it('distinguishes a Pages permission denial from a transport failure', async () => {
  const denied = await checkCloudflareConnection(accountId, credentials, async () =>
    Response.json({ success: false }, { status: 403 }),
  );
  expect(denied.pagesAccess).toBe('denied');
  const unavailable = await checkCloudflareConnection(accountId, credentials, async () => {
    throw new Error('private-network-canary');
  });
  expect(unavailable.pagesAccess).toBe('unavailable');
  expect(JSON.stringify(unavailable)).not.toContain('canary');
});
it('does not verify Pages permissions from a malformed project list', async () => {
  for (const project of [null, {}, { name: '' }, { name: 42 }]) {
    const result = await checkCloudflareConnection(accountId, credentials, async () =>
      Response.json({ success: true, result: [project] }),
    );
    expect(result.pagesAccess).toBe('unavailable');
  }
});
it('never accepts a credential check or environment import into the build queue', () => {
  expect(queuedPath('/api/connections/test')).toBe(false);
  expect(queuedPath('/api/connections/import-environment')).toBe(false);
});
