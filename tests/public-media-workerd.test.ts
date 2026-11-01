import { afterAll, beforeAll, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { digest } from '../src/engine/store.js';

let runtime: Miniflare, folder: string;
const origin = 'https://assets.fixture.test';
const body = new TextEncoder().encode('public bytes in shared storage');
const sha = digest(Buffer.from(body)),
  key = `media/v2/${sha}.webp`;

beforeAll(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-public-media-'));
  const scriptPath = path.join(folder, 'worker.mjs');
  await build({
    entryPoints: ['src/cloud/public-media-worker.ts'],
    outfile: scriptPath,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      modulesRoot: folder,
      scriptPath,
      compatibilityDate: '2026-10-12',
      r2Buckets: ['BUCKET'],
      bindings: { MEDIA_ORIGIN: origin, MEDIA_PREFIX: 'media' },
    }),
  );
  const bucket = (await runtime.getR2Bucket('BUCKET')) as any;
  await bucket.put(key, body, {
    customMetadata: { 'glass-public': '1', sha256: sha },
    httpMetadata: {
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  await bucket.put('workspace/blobs/' + sha, 'private canary');
  await bucket.put(`media/v2/${'b'.repeat(64)}.webp`, 'unapproved');
}, 30000);
afterAll(async () => {
  await runtime?.dispose();
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});

it('serves marked R2 bytes and ranges with public CORS in real workerd', async () => {
  const url = origin + '/' + key;
  const response = await runtime.dispatchFetch(url, {
    headers: { Origin: 'https://blog.fixture.test' },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
  const head = await runtime.dispatchFetch(url, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(Number(head.headers.get('Content-Length'))).toBe(body.length);
  const partial = await runtime.dispatchFetch(url, { headers: { Range: 'bytes=1-4' } });
  expect(partial.status).toBe(206);
  expect(partial.headers.get('Content-Range')).toBe(`bytes 1-4/${body.length}`);
  expect(await partial.text()).toBe('ubli');
});

it('does not expose private, unapproved, executable, or alternate-host objects', async () => {
  for (const url of [
    origin + '/workspace/blobs/' + sha,
    origin + `/media/v2/${'b'.repeat(64)}.webp`,
    origin + `/media/v2/${sha}.svg`,
    'https://direct.fixture.workers.dev/' + key,
  ])
    expect((await runtime.dispatchFetch(url)).status).toBe(404);
});
