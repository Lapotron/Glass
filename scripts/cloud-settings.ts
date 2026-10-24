/** Public deployment metadata, convenient as one Workers Builds variable. Secrets stay separate. */
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
  'ACCESS_TEAM',
  'ACCESS_AUD',
  'ACCESS_ADMINS',
  'CLOUDFLARE_ACCOUNT_ID',
  'STORAGE_BUDGET_BYTES',
]);
if (process.env.GLASS_CLOUD_CONFIG) {
  const values = JSON.parse(process.env.GLASS_CLOUD_CONFIG);
  if (!values || Array.isArray(values) || typeof values !== 'object')
    throw new Error('GLASS_CLOUD_CONFIG must be a JSON object.');
  for (const [name, value] of Object.entries(values)) {
    if (!allowed.has(name) || typeof value !== 'string')
      throw new Error('Unsupported public deployment setting: ' + name);
    process.env[name] ??= value;
  }
}
if (process.env.GLASS_CI_SECRETS) {
  const values = JSON.parse(process.env.GLASS_CI_SECRETS);
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
  for (const [name, value] of Object.entries(values)) {
    if (!names.has(name) || typeof value !== 'string' || !value)
      throw new Error('Unsupported private build setting.');
    process.env[name] = value;
  }
}
