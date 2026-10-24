/** Trusted branch previews use owned resources and an owner-only Access application. */
import './cloud-settings.js';
import { promises as fs } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { cloudFetch } from './cloud-client.js';
const target = process.argv[2];
if (!['site', 'studio'].includes(target)) throw new Error('Unknown preview target.');
const branch = process.env.WORKERS_CI_BRANCH;
if (!branch || branch === (process.env.GLASS_PRODUCTION_BRANCH || 'main'))
  throw new Error('Preview command requires a non-production branch.');
const configFile = path.resolve('.studio/cloud', target, 'wrangler.jsonc');
const previewName =
  branch
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .slice(0, 40) +
  '-' +
  createHash('sha256').update(branch).digest('hex').slice(0, 6);
const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
let secretsFile: string | undefined;
const run = (args: string[]) => {
  const result = spawnSync('npx', ['wrangler', ...args], { stdio: 'inherit' });
  if (result.status !== 0)
    throw new Error('Isolated preview setup stopped. Production resources were not changed.');
};
try {
  if (target === 'studio') {
    if (process.env.GLASS_CI_TOKEN)
      Object.assign(process.env, await (await cloudFetch('deployment-credentials')).json());
    const account = process.env.CLOUDFLARE_ACCOUNT_ID,
      token = process.env.CLOUDFLARE_API_TOKEN;
    if (!account || !token || !config.vars?.ACCESS_TEAM || !config.vars?.ACCESS_ADMINS)
      throw new Error('Preview setup needs the saved deployment token and Access owner settings.');
    async function call(
      route: string,
      method = 'GET',
      body?: unknown,
      missing = false,
    ): Promise<any> {
      const response = await fetch(
        'https://api.cloudflare.com/client/v4/accounts/' + account + route,
        {
          method,
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (missing && data.errors?.some((error: any) => [10025, 10222].includes(error.code)))
          return null;
        throw new Error(
          'Preview provisioning failed (' +
            response.status +
            '). Verify D1, R2, Workers and Access permissions; production was kept.',
        );
      }
      return data.result;
    }
    const suffix = createHash('sha256')
        .update(config.name + '|' + branch)
        .digest('hex')
        .slice(0, 16),
      name = 'glass-preview-' + suffix;
    const databases = await call('/d1/database?per_page=100');
    let database = databases.find((db: any) => db.name === name);
    if (!database) {
      if (
        databases.length >= 8 ||
        databases.filter((db: any) => db.name.startsWith('glass-preview-')).length >= 2
      )
        throw new Error(
          'Preview storage safety limit reached. Review old preview resources before creating another.',
        );
      database = await call('/d1/database', 'POST', { name });
    }
    const buckets = await call('/r2/buckets');
    if (!(buckets.buckets || []).some((bucket: any) => bucket.name === name))
      await call('/r2/buckets', 'POST', { name });
    const subdomain = await call('/workers/subdomain');
    const hostname = previewName + '-' + config.name + '.' + subdomain.subdomain + '.workers.dev';
    const appName = 'Glass Studio preview ' + suffix;
    const apps = await call('/access/apps');
    let app = apps.find((candidate: any) => candidate.domain === hostname);
    if (app && app.name !== appName)
      throw new Error(
        'Another Access application owns this preview hostname. It was not replaced.',
      );
    if (!app)
      app = await call('/access/apps', 'POST', {
        name: appName,
        type: 'self_hosted',
        domain: hostname,
        allow_iframe: true,
        session_duration: '24h',
        policies: [
          {
            name: 'Sole Studio owner',
            decision: 'allow',
            include: config.vars.ACCESS_ADMINS.split(',').map((email: string) => ({
              email: { email: email.trim() },
            })),
          },
        ],
      });
    const folder = path.resolve('.studio/cloud/previews', suffix);
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const migrations = path.join(folder, 'migrations.jsonc');
    await fs.writeFile(
      migrations,
      JSON.stringify({
        name: config.name,
        d1_databases: [
          {
            binding: 'DB',
            database_name: name,
            database_id: database.uuid,
            migrations_dir: path.resolve('infrastructure/cloud/migrations'),
          },
        ],
      }),
    );
    run(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', migrations]);
    config.previews = {
      vars: {
        ...config.vars,
        PREVIEW: 'true',
        STUDIO_ORIGIN: 'https://' + hostname,
        ACCESS_AUD: app.aud,
        WORKSPACE_ID: 'preview-' + suffix,
      },
      d1_databases: [{ binding: 'DB', database_name: name, database_id: database.uuid }],
      r2_buckets: [{ binding: 'BUCKET', bucket_name: name }],
    };
    const previous = await call(
      '/workers/workers/' +
        config.name +
        '/previews/' +
        encodeURIComponent(previewName) +
        '/deployments/latest',
      'GET',
      undefined,
      true,
    );
    if (!previous?.env?.STUDIO_SECRET) {
      secretsFile = path.join(folder, 'initial-secrets.json');
      await fs.writeFile(
        secretsFile,
        JSON.stringify({ STUDIO_SECRET: randomBytes(32).toString('hex') }),
        { mode: 0o600 },
      );
    }
    await fs.writeFile(
      path.join(folder, 'resources.json'),
      JSON.stringify({
        branch,
        previewName,
        hostname,
        databaseId: database.uuid,
        bucket: name,
        accessId: app.id,
        created: new Date().toISOString(),
      }),
    );
  } else config.previews = {};
  await fs.writeFile(configFile, JSON.stringify(config, null, 2));
  run([
    'preview',
    '--config',
    configFile,
    '--name',
    previewName,
    ...(secretsFile ? ['--secrets-file', secretsFile] : []),
  ]);
} finally {
  if (secretsFile) await fs.rm(secretsFile, { force: true });
}
