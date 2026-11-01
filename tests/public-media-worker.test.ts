import { expect, it, vi } from 'vitest';
import { servePublicMedia } from '../src/cloud/public-media-worker.js';
import { mediaWorkerConfig } from '../scripts/cloud-media-build.js';

const digest = 'a'.repeat(64);
const key = `media/v2/${digest}.webp`;
const meta = {
  size: 10,
  etag: 'fixture-etag',
  customMetadata: { 'glass-public': '1', sha256: digest },
  httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
};
function environment(overrides: Record<string, unknown> = {}) {
  const content = new TextEncoder().encode('0123456789');
  const bucket = {
    head: vi.fn(async (name: string) => (name === key ? { ...meta } : null)),
    get: vi.fn(async (name: string, options?: { range?: { offset: number; length: number } }) => {
      if (name !== key) return null;
      const slice = options?.range
        ? content.slice(options.range.offset, options.range.offset + options.range.length)
        : content;
      return { ...meta, body: new Response(slice).body! };
    }),
  };
  return {
    env: {
      BUCKET: bucket,
      MEDIA_ORIGIN: 'https://assets.example.test',
      MEDIA_PREFIX: 'media',
      ...overrides,
    },
    bucket,
  };
}

it('serves only marked public media with CORS, caching, HEAD and byte ranges', async () => {
  const { env, bucket } = environment();
  const url = `https://assets.example.test/${key}`;
  const get = await servePublicMedia(
    new Request(url, { headers: { Origin: 'https://blog.example.test' } }),
    env,
  );
  expect(get.status).toBe(200);
  expect(get.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(get.headers.get('Cache-Control')).toContain('immutable');
  expect(await get.text()).toBe('0123456789');
  const head = await servePublicMedia(new Request(url, { method: 'HEAD' }), env);
  expect(head.status).toBe(200);
  expect(head.headers.get('Content-Length')).toBe('10');
  const partial = await servePublicMedia(
    new Request(url, { headers: { Range: 'bytes=2-5' } }),
    env,
  );
  expect(partial.status).toBe(206);
  expect(partial.headers.get('Content-Range')).toBe('bytes 2-5/10');
  expect(await partial.text()).toBe('2345');
  expect(
    (await servePublicMedia(new Request(url, { headers: { Range: 'bytes=100-200' } }), env)).status,
  ).toBe(416);
  expect(
    (
      await servePublicMedia(
        new Request(url, { headers: { 'If-None-Match': '"fixture-etag"' } }),
        env,
      )
    ).status,
  ).toBe(304);
  expect((await servePublicMedia(new Request(url, { method: 'OPTIONS' }), env)).status).toBe(204);
  expect(bucket.get).toHaveBeenCalled();
});

it('fails closed for private namespaces, unmarked files, mismatched hashes, methods and hosts', async () => {
  const { env, bucket } = environment();
  for (const path of [
    '/workspace/blobs/' + digest,
    '/media/../workspace/blobs/' + digest,
    '/media/v2/%2f' + digest + '.webp',
    '/media/v2/' + digest + '.svg',
  ])
    expect(
      (await servePublicMedia(new Request('https://assets.example.test' + path), env)).status,
    ).toBe(404);
  expect(
    (await servePublicMedia(new Request('https://other.example.test/' + key), env)).status,
  ).toBe(404);
  expect(
    (
      await servePublicMedia(
        new Request('https://assets.example.test/' + key, { method: 'PUT' }),
        env,
      )
    ).status,
  ).toBe(405);
  bucket.get.mockResolvedValueOnce({
    ...meta,
    customMetadata: { sha256: digest },
    body: new Response('private').body!,
  } as any);
  expect(
    (await servePublicMedia(new Request('https://assets.example.test/' + key), env)).status,
  ).toBe(404);
  bucket.get.mockResolvedValueOnce({
    ...meta,
    customMetadata: { 'glass-public': '1', sha256: 'b'.repeat(64) },
    body: new Response('private').body!,
  });
  expect(
    (await servePublicMedia(new Request('https://assets.example.test/' + key), env)).status,
  ).toBe(404);
});

it('requires an explicit existing bucket and never adds a hostname route during build', () => {
  const environment = {
    GLASS_MEDIA_WORKER: 'glass-media',
    GLASS_PRIVATE_BUCKET: 'glass-assets',
    GLASS_MEDIA_ORIGIN: 'https://assets.example.test',
    GLASS_MEDIA_PREFIX: 'media',
  };
  const config = mediaWorkerConfig(environment);
  expect(config.r2_buckets).toEqual([{ binding: 'BUCKET', bucket_name: 'glass-assets' }]);
  expect(config).not.toHaveProperty('routes');
  expect(() => mediaWorkerConfig({ ...environment, GLASS_PRIVATE_BUCKET: '' })).toThrow(
    'existing Studio bucket',
  );
  expect(() => mediaWorkerConfig({ ...environment, GLASS_MEDIA_PREFIX: 'workspace' })).toThrow(
    'public-only',
  );
});
