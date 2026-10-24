import { expect, it } from 'vitest';
import { applyCloudSettings } from '../scripts/cloud-settings-values.js';

it('uses a complete separate machine login ahead of old compact JSON while preserving the deployment token override', () => {
  const environment = {
    CLOUDFLARE_API_TOKEN: 'automatically-injected-worker-only-token',
    GLASS_CI_TOKEN: 'current-ci',
    CF_ACCESS_CLIENT_ID: 'current-id',
    CF_ACCESS_CLIENT_SECRET: 'current-secret',
    GLASS_CI_SECRETS: JSON.stringify({
      CLOUDFLARE_API_TOKEN: 'explicit-token-with-pages-access',
      GLASS_CI_TOKEN: 'old-ci',
      CF_ACCESS_CLIENT_ID: 'old-id',
      CF_ACCESS_CLIENT_SECRET: 'old-secret',
    }),
  };
  applyCloudSettings(environment);
  expect(environment).toMatchObject({
    CLOUDFLARE_API_TOKEN: 'explicit-token-with-pages-access',
    GLASS_CI_TOKEN: 'current-ci',
    CF_ACCESS_CLIENT_ID: 'current-id',
    CF_ACCESS_CLIENT_SECRET: 'current-secret',
  });
});

it('retains compact machine credentials and explicit public defaults for existing installations', () => {
  const environment: NodeJS.ProcessEnv = {
    GLASS_STUDIO_ORIGIN: 'https://console.example.test',
    GLASS_CLOUD_CONFIG: JSON.stringify({ GLASS_STUDIO_ORIGIN: 'https://old.example.test' }),
    GLASS_CI_SECRETS: JSON.stringify({
      GLASS_CI_TOKEN: 'compact-ci',
      CF_ACCESS_CLIENT_ID: 'compact-id',
      CF_ACCESS_CLIENT_SECRET: 'compact-secret',
    }),
  };
  applyCloudSettings(environment);
  expect(environment).toMatchObject({
    GLASS_STUDIO_ORIGIN: 'https://console.example.test',
    GLASS_CI_TOKEN: 'compact-ci',
    CF_ACCESS_CLIENT_ID: 'compact-id',
    CF_ACCESS_CLIENT_SECRET: 'compact-secret',
  });
});

it('refuses to combine one separate Access credential with half of a different compact login', () => {
  const environment = {
    CF_ACCESS_CLIENT_ID: 'new-id',
    GLASS_CI_SECRETS: JSON.stringify({ CF_ACCESS_CLIENT_SECRET: 'old-secret' }),
  };
  expect(() => applyCloudSettings(environment)).toThrow('together');
  expect(() => applyCloudSettings({ CF_ACCESS_CLIENT_SECRET: 'only-half' })).toThrow('both');
});

it('does not accept unknown private keys or credentials inside public metadata', () => {
  expect(() =>
    applyCloudSettings({ GLASS_CI_SECRETS: JSON.stringify({ WRONG_TOKEN: 'private' }) }),
  ).toThrow('Unsupported private build setting');
  expect(() =>
    applyCloudSettings({ GLASS_CLOUD_CONFIG: JSON.stringify({ GLASS_CI_TOKEN: 'private' }) }),
  ).toThrow('Unsupported public deployment setting');
});
