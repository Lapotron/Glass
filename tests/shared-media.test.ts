import { afterAll, beforeAll, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { cloudSchemaStatements } from '../scripts/cloud-schema.js';
import { bundleCloudWorker } from '../scripts/cloud-bundle.js';
import { digest } from '../src/engine/store.js';

let runtime: Miniflare, folder: string;
const origin = 'https://studio.fixture.test';
const token = 'fixture-ci-token-with-sufficient-length';
const job = 'shared-media-fixture',
  release = 'shared-release';
const bytes = new TextEncoder().encode('published fixture image');
const sha = digest(Buffer.from(bytes));
const asset = {
  key: `media/v2/${sha}.webp`,
  sha256: sha,
  bytes: bytes.length,
  contentType: 'image/webp',
};

beforeAll(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-shared-media-'));
  await bundleCloudWorker(path.join(folder, 'worker.mjs'));
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      modulesRoot: folder,
      scriptPath: path.join(folder, 'worker.mjs'),
      compatibilityDate: '2026-10-12',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      r2Buckets: ['BUCKET'],
      serviceBindings: { ASSETS: async () => new Response(null, { status: 404 }) },
      bindings: {
        STUDIO_ORIGIN: origin,
        SITE_ORIGIN: 'https://blog.fixture.test',
        WORKSPACE_ID: 'fixture',
        ACCESS_TEAM: 'fixture',
        ACCESS_AUD: 'fixture',
        ACCESS_ADMINS: 'owner@fixture.test',
        STUDIO_SECRET: 'fixture-secret-'.repeat(4),
        CI_TOKEN: token,
        CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
        PRIVATE_BUCKET_NAME: 'glass-assets',
      },
    }),
  );
  const db = await runtime.getD1Database('DB');
  for (const sql of await cloudSchemaStatements()) await db.exec(sql);
  const site = JSON.parse(await fs.readFile('tests/fixtures/notebook/site.json', 'utf8'));
  site.cloudflare.accountId = 'a'.repeat(32);
  site.mediaDelivery = {
    mode: 'r2',
    transport: 'studio-binding',
    bucket: 'glass-assets',
    prefix: 'media',
    publicOrigin: 'https://media.fixture.test',
  };
  const text = JSON.stringify(site);
  const bucket = (await runtime.getR2Bucket('BUCKET')) as any;
  await bucket.put(
    `jobs/${job}/manifest.json`,
    JSON.stringify({
      version: 0,
      files: [
        {
          path: 'content/site.json',
          sha: digest(text),
          bytes: text.length,
          modified: new Date().toISOString(),
          text,
          encrypted: 0,
        },
      ],
    }),
  );
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO cloud_jobs(id,kind,state,actor,version,request,created,updated,release_id) VALUES(?, 'publish', 'running', 'owner', 0, '{}', ?, ?, ?)",
    )
    .bind(job, now, now, release)
    .run();
  await db.prepare('UPDATE cloud_control SET approved_release=? WHERE id=1').bind(release).run();
}, 30000);
afterAll(async () => {
  await runtime?.dispose();
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});

const headers = { Authorization: `Bearer ${token}` };
const url = (suffix: string) => `${origin}/__ci/jobs/${job}/shared-media/${suffix}`;
it('uses the approved snapshot and Studio R2 binding without S3 credentials', async () => {
  expect((await runtime.dispatchFetch(url('begin'), { method: 'POST' })).status).toBe(401);
  expect((await runtime.dispatchFetch(url('begin'), { method: 'POST', headers })).status).toBe(200);
  const matches = () =>
    runtime.dispatchFetch(url('matches'), { method: 'POST', headers, body: JSON.stringify(asset) });
  expect(await (await matches()).json()).toEqual({ matches: false });
  const upload = await runtime.dispatchFetch(url('object'), {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Length': String(bytes.length),
      'X-Glass-Media': JSON.stringify(asset),
    },
    body: bytes,
  });
  expect(upload.status, await upload.text()).toBe(200);
  expect(await (await matches()).json()).toEqual({ matches: true });
  const stored = await ((await runtime.getR2Bucket('BUCKET')) as any).get(asset.key);
  expect(stored?.customMetadata).toMatchObject({ 'glass-public': '1', sha256: sha });
  expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(bytes);
}, 30000);

it('refuses private keys and jobs that no longer own the approved release', async () => {
  const privateAsset = { ...asset, key: `workspace/blobs/${sha}` };
  const response = await runtime.dispatchFetch(url('matches'), {
    method: 'POST',
    headers,
    body: JSON.stringify(privateAsset),
  });
  expect(response.status).toBe(400);
  const db = await runtime.getD1Database('DB');
  await db
    .prepare('UPDATE cloud_control SET approved_release=? WHERE id=1')
    .bind('different-release')
    .run();
  try {
    expect(
      (
        await runtime.dispatchFetch(url('matches'), {
          method: 'POST',
          headers,
          body: JSON.stringify(asset),
        })
      ).status,
    ).toBe(409);
  } finally {
    await db.prepare('UPDATE cloud_control SET approved_release=? WHERE id=1').bind(release).run();
  }
});
