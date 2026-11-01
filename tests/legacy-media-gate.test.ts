import { expect, it } from 'vitest';
import { gateLegacyMedia } from '../src/cloud/legacy-media-gate.js';

it('proxies only published media-shaped keys and never forwards credentials or private paths', async () => {
  const digest = 'a'.repeat(64),
    calls: Request[] = [];
  const fetcher = (async (request: Request) => {
    calls.push(request);
    return new Response('test', {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }) as typeof fetch;
  const env = { MEDIA_ORIGIN: 'https://assets.example.com', MEDIA_PREFIX: 'media' };
  const response = await gateLegacyMedia(
    new Request('https://assets.example.com/media/v2/' + digest + '.webp', {
      headers: {
        Cookie: 'private',
        Authorization: 'Bearer secret',
        Origin: 'https://site.example.com',
      },
    }),
    env,
    fetcher,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(calls[0].headers.has('Cookie')).toBe(false);
  expect(calls[0].headers.has('Authorization')).toBe(false);
  for (const key of [
    '/workspace/blobs/' + digest,
    '/jobs/private',
    '/media/v2/' + digest + '.html',
    '/media/%2fworkspace/blobs/' + digest,
  ])
    expect(
      (await gateLegacyMedia(new Request('https://assets.example.com' + key), env, fetcher)).status,
    ).toBe(404);
  expect(calls).toHaveLength(1);
});
