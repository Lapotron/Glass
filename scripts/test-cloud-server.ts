import { cloudSchemaStatements } from './cloud-schema.js';
/** Isolated hosted-Studio harness. The production entry never contains this authentication seam. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { bundleCloudWorker } from './cloud-bundle.js';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { getRequestListener } from '@hono/node-server';
const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-cloud-browser-'));
const output = path.join(folder, 'app.mjs');
await bundleCloudWorker(output, "export {createCloudApp} from './src/cloud/worker.ts'");
const { createCloudApp } = await import(output),
  app = createCloudApp({
    authenticate: async () => ({ id: 'fixture-owner', email: 'fixture@example.test' }),
  });
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    cf: false,
    script: 'export default {fetch(){return new Response("ok")}}',
    modules: true,
    compatibilityDate: '2026-10-12',
    d1Databases: ['DB'],
    r2Buckets: ['BUCKET'],
  }),
);
const db = await runtime.getD1Database('DB');
for (const sql of await cloudSchemaStatements()) await db.exec(sql);
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) =>
  String(input instanceof Request ? input.url : input).startsWith('https://api.cloudflare.com/')
    ? Promise.resolve(Response.json({ success: true, result: { build_uuid: crypto.randomUUID() } }))
    : nativeFetch(input, options);
const assetRoot = path.resolve('.studio/cloud/studio/assets');
const env = {
  DB: db,
  BUCKET: await runtime.getR2Bucket('BUCKET'),
  STUDIO_SECRET: 'fixture-secret-only-not-production-123456789',
  CI_TOKEN: 'fixture-ci-only-not-production-123456789',
  ACCESS_TEAM: 'fixture',
  ACCESS_AUD: 'fixture',
  ACCESS_ADMINS: 'fixture@example.test',
  STUDIO_ORIGIN: 'http://127.0.0.1:4398',
  SITE_ORIGIN: 'https://fixture.example.test',
  SITE_WORKER: 'glass-site-fixture',
  WORKSPACE_ID: 'isolated-cloud-test',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  BUILDS_TRIGGER_ID: 'fixture-trigger',
  BUILDS_API_TOKEN: 'fixture-builds-token',
  ASSETS: {
    async fetch(request: Request) {
      const url = new URL(request.url),
        name = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
      if (name.split('/').includes('..')) return new Response(null, { status: 403 });
      try {
        const bytes = await fs.readFile(path.join(assetRoot, name));
        return new Response(bytes, {
          headers: {
            'Content-Type':
              (
                {
                  js: 'application/javascript',
                  css: 'text/css',
                  html: 'text/html',
                  json: 'application/json',
                  woff2: 'font/woff2',
                  wasm: 'application/wasm',
                } as Record<string, string>
              )[name.split('.').at(-1)!] || 'application/octet-stream',
          },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    },
  },
};
const server = createServer(getRequestListener((request: Request) => app.fetch(request, env)));
server.listen(4398, '127.0.0.1', () => console.log('Isolated cloud Studio http://127.0.0.1:4398/'));
let busy = false,
  child: ReturnType<typeof spawn> | undefined;
const timer = setInterval(async () => {
  if (busy) return;
  const row = await db
    .prepare(
      "SELECT * FROM cloud_jobs WHERE state='queued' AND build_uuid IS NOT NULL ORDER BY created LIMIT 1",
    )
    .first<any>();
  if (!row) return;
  busy = true;
  child = spawn(process.execPath, ['--import', 'tsx', 'scripts/cloud-ci.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      GLASS_STUDIO_ORIGIN: env.STUDIO_ORIGIN,
      GLASS_CI_TOKEN: env.CI_TOKEN,
      WORKERS_CI_BUILD_UUID: row.build_uuid,
      WORKERS_CI_COMMIT_SHA: 'fixture-commit',
      WORKERS_CI_BRANCH: 'main',
    },
  });
  child.once('exit', () => {
    busy = false;
    child = undefined;
  });
}, 500);
async function close() {
  clearInterval(timer);
  child?.kill('SIGTERM');
  server.close();
  await runtime.dispose();
  await fs.rm(folder, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
