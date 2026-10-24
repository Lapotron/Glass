/** Resolve public defaults and private build settings without logging credential values. */
export function applyCloudSettings(environment: NodeJS.ProcessEnv) {
  const allowed = new Set([
    'GLASS_STUDIO_ORIGIN',
    'GLASS_PRODUCTION_BRANCH',
    'GLASS_SITE_ORIGIN',
    'GLASS_SITE_STAGING_ORIGIN',
    'GLASS_WORKSPACE_ID',
    'GLASS_STUDIO_WORKER',
    'GLASS_SITE_WORKER',
    'GLASS_D1_ID',
    'GLASS_D1_NAME',
    'GLASS_PRIVATE_BUCKET',
    'GLASS_ENABLE_CUSTOM_DOMAIN',
    'GLASS_ENABLE_SITE_DOMAIN',
    'GLASS_SITE_ZONE_ID',
    'GLASS_PAGES_PROJECT',
    'GLASS_PIPELINE_BOOTSTRAP',
    'ACCESS_TEAM',
    'ACCESS_AUD',
    'ACCESS_ADMINS',
    'CLOUDFLARE_ACCOUNT_ID',
    'STORAGE_BUDGET_BYTES',
  ]);
  if (environment.GLASS_CLOUD_CONFIG) {
    const values = JSON.parse(environment.GLASS_CLOUD_CONFIG);
    if (!values || Array.isArray(values) || typeof values !== 'object')
      throw new Error('GLASS_CLOUD_CONFIG must be a JSON object.');
    for (const [name, value] of Object.entries(values)) {
      if (!allowed.has(name) || typeof value !== 'string')
        throw new Error('Unsupported public deployment setting: ' + name);
      environment[name] ??= value;
    }
  }
  if (environment.GLASS_CI_SECRETS) {
    const values = JSON.parse(environment.GLASS_CI_SECRETS);
    const names = new Set([
      'GLASS_CI_TOKEN',
      'CF_ACCESS_CLIENT_ID',
      'CF_ACCESS_CLIENT_SECRET',
      'CLOUDFLARE_API_TOKEN',
      'BUILDS_API_TOKEN',
      'BUILDS_DEPLOY_HOOK',
      'ACA_REPORT_TOKEN',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
    ]);
    if (!values || Array.isArray(values) || typeof values !== 'object')
      throw new Error('GLASS_CI_SECRETS must be a private JSON object.');
    const directAccess = Boolean(
      environment.CF_ACCESS_CLIENT_ID || environment.CF_ACCESS_CLIENT_SECRET,
    );
    if (directAccess && !(environment.CF_ACCESS_CLIENT_ID && environment.CF_ACCESS_CLIENT_SECRET))
      throw new Error(
        'Supply CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET together as separate build secrets, or keep both in GLASS_CI_SECRETS.',
      );
    const directMachine = new Set([
      'GLASS_CI_TOKEN',
      ...(directAccess ? ['CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET'] : []),
    ]);
    for (const [name, value] of Object.entries(values)) {
      if (!names.has(name) || typeof value !== 'string' || !value)
        throw new Error('Unsupported private build setting.');
      // Individual machine credentials override a stale compact JSON value. Keep the
      // explicit JSON deployment token ahead of Cloudflare's injected Worker-only token.
      if (!directMachine.has(name) || !environment[name]) environment[name] = value;
    }
  }

  if (Boolean(environment.CF_ACCESS_CLIENT_ID) !== Boolean(environment.CF_ACCESS_CLIENT_SECRET))
    throw new Error(
      'Configure both CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET for the Access service token.',
    );
}
