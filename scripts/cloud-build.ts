import './cloud-settings.js';
import { bundleCloudWorker } from './cloud-bundle.js';
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { authoringInstructions } from '../src/shared/authoring-instructions.js';
import { spawnSync } from 'node:child_process';
const mode = process.argv[2] || 'studio';
const root = process.cwd(),
  folder = path.join(root, '.studio/cloud', mode);
await fs.mkdir(folder, { recursive: true });
if (mode === 'studio') {
  const consoleSource = path.join(folder, 'console-source');
  const result = spawnSync(
    'npx',
    ['vite', 'build', '--config', 'vite.config.ts', '--base', '/', '--outDir', consoleSource],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status || 1);
  await fs.rm(path.join(folder, 'assets'), { recursive: true, force: true });
  await fs.cp(consoleSource, path.join(folder, 'assets'), { recursive: true });
  await fs.rm(consoleSource, { recursive: true, force: true });
  await bundleCloudWorker(path.join(folder, 'worker.mjs'));
  const compiler = spawnSync('npx', ['vite', 'build', '--config', 'vite.cloud-preview.config.ts'], {
    stdio: 'inherit',
  });
  if (compiler.status !== 0) process.exit(compiler.status || 1);
  await fs.writeFile(
    path.join(folder, 'assets/cloud-compiler/index.html'),
    '<!doctype html><meta charset="utf-8"><script type="module" src="/cloud-compiler/compiler.js"></script>',
  );
  const { buildAssets } = await import('../src/engine/build.js');
  const { stageReaderAssets } = await import('../src/engine/reader-assets.js');
  const reader = await stageReaderAssets(
    await buildAssets(path.join(root, '.studio/cloud/reader-cache')),
    path.join(folder, 'assets'),
  );
  await fs.writeFile(path.join(folder, 'assets/cloud-reader-assets.json'), JSON.stringify(reader));
  await fs.mkdir(path.join(folder, 'assets/authoring'), { recursive: true });
  for (const name of [
    'markdown-reference',
    'authoring',
    'diagrams',
    'math-authoring',
    'pseudocode',
    'latex-conversion',
    'markdown-ide',
    'hosted-studio',
    'hosted-studio-clean-install',
  ])
    await fs.copyFile(
      'docs/' + name + '.md',
      path.join(folder, 'assets/authoring/' + name + '.md'),
    );
  await fs.cp('docs/authoring-templates', path.join(folder, 'assets/authoring/templates'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(folder, 'assets/authoring/SKILL.md'),
    authoringInstructions('cloud'),
  );
  const vars: Record<string, string> = {
    STUDIO_ORIGIN: process.env.GLASS_STUDIO_ORIGIN || 'https://console.example.com',
    SITE_ORIGIN: process.env.GLASS_SITE_ORIGIN || 'https://example.com',
    SITE_WORKER: process.env.GLASS_SITE_WORKER || 'glass-site',
    STUDIO_WORKER: process.env.GLASS_STUDIO_WORKER || 'glass-studio',
    PAGES_PROJECT: process.env.GLASS_PAGES_PROJECT || '',
    WORKSPACE_ID: process.env.GLASS_WORKSPACE_ID || 'glass',
    PRODUCTION_BRANCH: process.env.GLASS_PRODUCTION_BRANCH || 'main',
    SITE_STAGING_ORIGIN:
      process.env.GLASS_SITE_STAGING_ORIGIN || process.env.SITE_STAGING_ORIGIN || '',
  };
  for (const name of [
    'ACCESS_TEAM',
    'ACCESS_AUD',
    'ACCESS_ADMINS',
    'CLOUDFLARE_ACCOUNT_ID',
    'BUILDS_TRIGGER_ID',
    'STORAGE_BUDGET_BYTES',
  ])
    if (process.env[name]) vars[name] = process.env[name]!;
  const config = {
    name: process.env.GLASS_STUDIO_WORKER || 'glass-studio',
    main: 'worker.mjs',
    compatibility_date: '2026-10-12',
    compatibility_flags: ['nodejs_compat'],
    keep_vars: true,
    triggers: { crons: ['* * * * *'] },
    workers_dev: process.env.GLASS_ENABLE_CUSTOM_DOMAIN !== 'true',
    preview_urls: true,
    previews: {},
    assets: { directory: 'assets', binding: 'ASSETS', run_worker_first: true },
    vars,
    d1_databases: [
      {
        binding: 'DB',
        migrations_dir: path.relative(folder, path.join(root, 'infrastructure/cloud/migrations')),
        ...(process.env.GLASS_D1_ID
          ? {
              database_id: process.env.GLASS_D1_ID,
              database_name: process.env.GLASS_D1_NAME || 'glass-studio',
            }
          : {}),
      },
    ],
    r2_buckets: [
      {
        binding: 'BUCKET',
        ...(process.env.GLASS_PRIVATE_BUCKET
          ? { bucket_name: process.env.GLASS_PRIVATE_BUCKET }
          : {}),
      },
    ],
    ...(process.env.GLASS_ENABLE_CUSTOM_DOMAIN === 'true'
      ? { routes: [{ pattern: new URL(vars.STUDIO_ORIGIN).hostname, custom_domain: true }] }
      : {}),
  };
  await fs.writeFile(path.join(folder, 'wrangler.jsonc'), JSON.stringify(config, null, 2));
  console.log('Hosted Studio artifact: ' + path.relative(root, folder));
} else if (mode === 'site') {
  await build({
    entryPoints: ['src/cloud/public.ts'],
    outfile: path.join(folder, 'worker.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
  });
  const config = {
    name: process.env.GLASS_SITE_WORKER || 'glass-site',
    main: 'worker.mjs',
    compatibility_date: '2026-10-12',
    workers_dev: true,
    preview_urls: true,
    previews: {},
    assets: {
      directory: 'public',
      binding: 'ASSETS',
      not_found_handling: '404-page',
      run_worker_first: ['/api/annotations/*'],
    },
    ...(process.env.GLASS_ENABLE_SITE_DOMAIN === 'true'
      ? {
          routes: [
            {
              pattern: new URL(process.env.GLASS_SITE_ORIGIN || 'https://example.com').hostname,
              ...(process.env.GLASS_SITE_ZONE_ID
                ? {
                    pattern: new URL(process.env.GLASS_SITE_ORIGIN!).hostname + '/*',
                    zone_id: process.env.GLASS_SITE_ZONE_ID,
                  }
                : { custom_domain: true }),
            },
          ],
        }
      : {}),
  };
  await fs.writeFile(path.join(folder, 'wrangler.jsonc'), JSON.stringify(config, null, 2));
} else throw new Error('Unknown cloud build target.');
