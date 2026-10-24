for (const key of [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'GLASS_ACCESS_TEAM',
  'GLASS_ACCESS_AUD',
  'GLASS_ACCESS_ADMINS',
]) {
  if (!process.env[key])
    throw new Error(
      'Private staging setup is incomplete. Use the root dynamic:deploy command and docs/dynamic-prototype.md; no deployment was started.',
    );
}
if (!/^[a-z0-9-]+$/i.test(process.env.GLASS_ACCESS_TEAM))
  throw new Error('Use the Zero Trust team name without a URL.');
if (process.env.GLASS_STAGING_ACCESS_VERIFIED !== 'true')
  throw new Error(
    'Verify the Access application before deploying staging. No deployment was started.',
  );
