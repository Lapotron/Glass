import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { hostedConnectionSecrets, withHostedSecrets } from '../scripts/cloud-secrets.js';

afterEach(() => vi.unstubAllEnvs());
it('passes connection defaults privately, keeps Access and encryption keys out, and cleans up after failure', async () => {
  const environment = {
    CLOUDFLARE_API_TOKEN: 'fixture-deploy-token',
    GLASS_CI_TOKEN: 'fixture-ci-'.repeat(5),
    CF_ACCESS_CLIENT_SECRET: 'must-stay-build-only',
    STUDIO_SECRET: 'must-not-replace-encryption',
    UNRELATED: 'not-a-binding',
  };
  expect(hostedConnectionSecrets(environment)).toEqual({
    CLOUDFLARE_API_TOKEN: environment.CLOUDFLARE_API_TOKEN,
    CI_TOKEN: environment.GLASS_CI_TOKEN,
  });
  let filename = '';
  await expect(
    withHostedSecrets(environment, async (file) => {
      filename = file!;
      expect((await fs.stat(filename)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await fs.readFile(filename, 'utf8'))).toEqual(
        hostedConnectionSecrets(environment),
      );
      expect(filename).not.toContain('.studio/cloud');
      throw new Error('Simulated deploy failure');
    }),
  ).rejects.toThrow('Simulated deploy failure');
  await expect(fs.stat(filename)).rejects.toThrow();
});
it('rejects production credential forwarding into previews and incomplete R2 pairs', () => {
  expect(() =>
    hostedConnectionSecrets({ PREVIEW: 'true', CLOUDFLARE_API_TOKEN: 'fixture' }),
  ).toThrow('previews');
  expect(() =>
    hostedConnectionSecrets({
      WORKERS_CI_BRANCH: 'branch-preview',
      CLOUDFLARE_API_TOKEN: 'fixture',
    }),
  ).toThrow('previews');
  expect(() => hostedConnectionSecrets({ R2_ACCESS_KEY_ID: 'one-half' })).toThrow('both R2');
  expect(() => hostedConnectionSecrets({ GLASS_CI_TOKEN: 'short' })).toThrow('32 characters');
});
