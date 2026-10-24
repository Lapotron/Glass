/** One-time hosted Studio provisioning. Subsequent authoring and deployments need no local server. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { ConnectionSettings, redactSecrets } from '../src/server/configuration.js';
import { siteSchema } from '../src/shared/contracts.js';

const arg = (name: string) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const owner = z.email().parse(arg('owner')).toLowerCase();
const hostname = arg('hostname') || 'console.example.com';
if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(hostname))
  throw new Error('Choose a valid Studio hostname.');
const root = await fs.realpath(arg('root') || process.cwd()),
  site = siteSchema.parse(
    JSON.parse(await fs.readFile(path.join(root, 'content/site.json'), 'utf8')),
  );
const account = site.cloudflare.accountId;
if (!/^[a-f0-9]{32}$/.test(account))
  throw new Error('Save a Cloudflare account in Site settings first.');
const credentials = await new ConnectionSettings(root).values(),
  token = credentials.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('Save the existing Cloudflare API token in Studio first.');
const stateFile = path.join(root, '.studio/cloud/setup.json');
let state: any;
try {
  state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
if (state && (state.owner !== owner || state.hostname !== hostname || state.account !== account))
  throw new Error(
    'This notebook already has a different hosted setup. Preserve it and review the new target explicitly.',
  );
state ||= {
  version: 2,
  owner,
  hostname,
  account,
  worker: 'glass-studio',
  databaseName: 'glass-studio',
  bucket: 'glass-private',
  studioSecret: randomBytes(32).toString('hex'),
  ciToken: randomBytes(32).toString('hex'),
};
async function save() {
  await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.chmod(stateFile, 0o600);
}
async function call(route: string, method = 'GET', body?: unknown) {
  const response = await fetch('https://api.cloudflare.com/client/v4' + route, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || !data.success)
    throw new Error(
      'Cloudflare ' +
        method +
        ' ' +
        route +
        ' failed (' +
        response.status +
        '; ' +
        (data.errors || []).map((e: any) => e.code).join(',') +
        '). Existing data and deployments were kept.',
    );
  return data.result;
}
const api = '/accounts/' + account;
const [organization, zones, databases, buckets, apps, idps] = await Promise.all([
  call(api + '/access/organizations'),
  call(
    '/zones?name=' + new URL(site.url).hostname.replace(/^www\./, '') + '&account.id=' + account,
  ),
  call(api + '/d1/database?per_page=100'),
  call(api + '/r2/buckets'),
  call(api + '/access/apps'),
  call(api + '/access/identity_providers'),
]);
if (zones.length !== 1 || !(hostname === zones[0].name || hostname.endsWith('.' + zones[0].name)))
  throw new Error(
    'Add the Studio hostname under the existing site zone. This setup never creates a zone.',
  );
state.team = String(organization.auth_domain).replace(/\.cloudflareaccess\.com$/, '');
state.zoneId = zones[0].id;
// Older installations retain their reader Worker rollback address; new setups use Pages.
if (state.siteWorker) {
  const subdomain = await call(api + '/workers/subdomain');
  state.stagingOrigin = 'https://' + state.siteWorker + '.' + subdomain.subdomain + '.workers.dev';
}
const otp = idps.find((provider: any) => provider.type === 'onetimepin');
if (!otp)
  throw new Error('Enable email one-time PIN in the existing Access organization before setup.');
if (!process.argv.includes('--provision')) {
  console.log(
    JSON.stringify(
      {
        owner,
        hostname,
        account,
        zone: zones[0].name,
        worker: state.worker,
        database: state.databaseName,
        privateBucket: state.bucket,
        accessTeam: state.team,
        githubSignInConfigured: idps.some((p: any) => p.type === 'github'),
        hasPrivateSetup: !!state.databaseId,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
await save();
if (!state.databaseId) {
  if (databases.some((db: any) => db.name === state.databaseName))
    throw new Error(
      'A database with the requested name already exists without this setup record. It was not adopted or modified.',
    );
  if (databases.length >= 8)
    throw new Error('Keep two free D1 slots available for isolated previews before provisioning.');
  const db = await call(api + '/d1/database', 'POST', { name: state.databaseName });
  state.databaseId = db.uuid;
  await save();
}
if (!state.bucketCreated) {
  if (buckets.buckets?.some((bucket: any) => bucket.name === state.bucket))
    throw new Error(
      'A private bucket with this name already exists without an ownership record. It was not adopted or modified.',
    );
  await call(api + '/r2/buckets', 'POST', { name: state.bucket });
  state.bucketCreated = true;
  await save();
}
if (!state.serviceToken) {
  const service = await call(api + '/access/service_tokens', 'POST', {
    name: 'Glass Studio build coordinator',
    duration: '8760h',
  });
  state.serviceToken = {
    id: service.id,
    clientId: service.client_id,
    clientSecret: service.client_secret,
  };
  await save();
}
if (!state.accessId) {
  if (apps.some((app: any) => app.domain === hostname))
    throw new Error('This hostname already has an Access application. It was not replaced.');
  const app = await call(api + '/access/apps', 'POST', {
    name: 'Glass Studio',
    type: 'self_hosted',
    domain: hostname,
    session_duration: '24h',
    allow_iframe: true,
    allowed_idps: idps
      .filter((p: any) => ['onetimepin', 'github'].includes(p.type))
      .map((p: any) => p.id),
    auto_redirect_to_identity: false,
    app_launcher_visible: true,
  });
  state.accessId = app.id;
  state.audience = app.aud;
  await save();
}
if (!state.policiesCreated) {
  const policies = await call(api + '/access/apps/' + state.accessId + '/policies');
  if (policies.length)
    throw new Error('Access policies already exist. Review them before changing this setup.');
  await call(api + '/access/apps/' + state.accessId + '/policies', 'POST', {
    name: 'Sole Studio owner',
    decision: 'allow',
    precedence: 1,
    include: [{ email: { email: owner } }],
    exclude: [],
    require: [],
  });
  await call(api + '/access/apps/' + state.accessId + '/policies', 'POST', {
    name: 'Build coordinator and scoped MCP clients',
    decision: 'non_identity',
    precedence: 2,
    include: [{ service_token: { token_id: state.serviceToken.id } }],
    exclude: [],
    require: [],
  });
  state.policiesCreated = true;
  await save();
}
const environment = {
  ...process.env,
  ...credentials,
  CLOUDFLARE_ACCOUNT_ID: account,
  CI: 'true',
  WRANGLER_SEND_METRICS: 'false',
  GLASS_STUDIO_ORIGIN: 'https://' + hostname,
  GLASS_SITE_ORIGIN: site.url,
  GLASS_D1_ID: state.databaseId,
  GLASS_D1_NAME: state.databaseName,
  GLASS_PRIVATE_BUCKET: state.bucket,
  GLASS_STUDIO_WORKER: state.worker,
  ...(state.siteWorker ? { GLASS_SITE_WORKER: state.siteWorker } : {}),
  GLASS_ENABLE_CUSTOM_DOMAIN: 'true',
  ACCESS_TEAM: state.team,
  ACCESS_AUD: state.audience,
  ACCESS_ADMINS: owner,
  ...(state.stagingOrigin ? { SITE_STAGING_ORIGIN: state.stagingOrigin } : {}),
};
function run(args: string[], input?: string) {
  const result = spawnSync(process.execPath, args, {
    env: environment,
    input,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 ** 2,
  });
  for (const output of [result.stdout, result.stderr])
    if (output)
      process.stdout.write(
        redactSecrets(output, {
          ...credentials,
          STUDIO_SECRET: state.studioSecret,
          CI_TOKEN: state.ciToken,
          CF_ACCESS_CLIENT_SECRET: state.serviceToken.clientSecret,
        }),
      );
  if (result.status !== 0)
    throw new Error(
      'Hosted setup stopped. Owned resources and the existing public site were preserved.',
    );
}
run(['--import', 'tsx', 'scripts/cloud-build.ts', 'studio']);
const config = path.join(root, '.studio/cloud/studio/wrangler.jsonc');
run([
  'node_modules/wrangler/bin/wrangler.js',
  'd1',
  'migrations',
  'apply',
  'DB',
  '--remote',
  '--config',
  config,
]);
run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', config]);
run(
  ['node_modules/wrangler/bin/wrangler.js', 'secret', 'bulk', '--config', config],
  JSON.stringify({
    STUDIO_SECRET: state.studioSecret,
    CI_TOKEN: state.ciToken,
    ...(credentials.BUILDS_API_TOKEN ? { BUILDS_API_TOKEN: credentials.BUILDS_API_TOKEN } : {}),
    ...(credentials.BUILDS_DEPLOY_HOOK
      ? { BUILDS_DEPLOY_HOOK: credentials.BUILDS_DEPLOY_HOOK }
      : {}),
  }),
);
state.deployedAt = new Date().toISOString();
await save();
console.log(
  'Hosted Studio deployed at https://' +
    hostname +
    '/. GitHub-connected Builds still need to be connected before publishing. The public Pages site was not changed.',
);
