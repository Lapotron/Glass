import { it, expect } from 'vitest';
import { prepareSiteRoute } from '../scripts/cloud-routing.js';
const environment = {
  GLASS_ENABLE_SITE_DOMAIN: 'true',
  GLASS_SITE_ZONE_ID: 'a'.repeat(32),
  GLASS_SITE_ORIGIN: 'https://reader.example',
  CLOUDFLARE_API_TOKEN: 'fixture-credential',
};
it('refuses conflicting hostname routes before changing a deployment', async () => {
  const calls: string[] = [];
  await expect(
    prepareSiteRoute('glass-site', environment, async (_url, init) => {
      calls.push(init?.method || 'GET');
      return Response.json({
        success: true,
        result: [{ id: 'existing', pattern: 'reader.example/*', script: 'another-worker' }],
      });
    }),
  ).rejects.toThrow('existing route');
  expect(calls).toEqual(['GET']);
});
it('recovers only the newly created exact route after failed initial cutover', async () => {
  const calls: string[] = [];
  let reads = 0;
  const recover = await prepareSiteRoute('glass-site', environment, async (url, init) => {
    calls.push((init?.method || 'GET') + ' ' + new URL(String(url)).pathname.split('/').at(-1));
    return Response.json({
      success: true,
      result:
        reads++ === 0
          ? []
          : [
              { id: 'new-route', pattern: 'reader.example/*', script: 'glass-site' },
              { id: 'unrelated', pattern: 'assets.example/*', script: 'assets' },
            ],
    });
  });
  await recover();
  expect(calls).toEqual(['GET routes', 'GET routes', 'DELETE new-route']);
});
it('preserves an already owned live route when later verification fails', async () => {
  let calls = 0;
  const recover = await prepareSiteRoute('glass-site', environment, async () => {
    calls++;
    return Response.json({
      success: true,
      result: [{ id: 'previous', pattern: 'reader.example/*', script: 'glass-site' }],
    });
  });
  await recover();
  expect(calls).toBe(1);
});
