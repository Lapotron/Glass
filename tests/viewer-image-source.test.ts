import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ViewerImageSources } from '../src/shared/viewer-image-source.js';

let sources: ViewerImageSources;
const image = { src: 'https://media.example.test/media/hash/full.webp' };
const picture = () =>
  new Response('published image bytes', { headers: { 'Content-Type': 'image/webp' } });
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('location', {
    href: 'https://blog.example.test/blog/post/',
    origin: 'https://blog.example.test',
  });
  sources = new (await import('../src/shared/viewer-image-source.js')).ViewerImageSources();
});
afterEach(() => {
  sources.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('shares the original bytes between viewing and downloading, and releases the final URL', async () => {
  const fetch = vi.fn(async () => picture());
  vi.stubGlobal('fetch', fetch);
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const slide = sources.acquire(image),
    download = sources.acquire(image);
  const resource = await slide.value;
  expect(await download.value).toBe(resource);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(resource.url).toMatch(/^blob:/);
  expect(resource.name).toBe('full.webp');
  expect(await resource.blob.text()).toBe('published image bytes');
  slide.release();
  expect(revoke).not.toHaveBeenCalled();
  download.release();
  expect(revoke).toHaveBeenCalledWith(resource.url);
});

it('reloads a stale non-CORS browser cache entry without credentials', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(picture());
  vi.stubGlobal('fetch', fetch);
  await sources.acquire(image).value;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]).toEqual([
    image.src,
    expect.objectContaining({ cache: 'reload', mode: 'cors', credentials: 'omit' }),
  ]);
});

it('uses only the manifest-matched same-origin published copy when CDN CORS fails', async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url === image.src) throw new TypeError('CORS blocked');
    if (url === '/assets/media-details.json')
      return Response.json({
        version: 1,
        images: {
          '/media/full.webp': { url: image.src },
        },
      });
    if (url === 'https://blog.example.test/media/full.webp') return picture();
    throw new Error('Unexpected URL: ' + url);
  });
  vi.stubGlobal('fetch', fetch);
  expect(await (await sources.acquire(image).value).blob.text()).toBe('published image bytes');
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    image.src,
    image.src,
    '/assets/media-details.json',
    'https://blog.example.test/media/full.webp',
  ]);
});

it('does not infer a local fallback from an unregistered external filename or unsafe manifest key', async () => {
  const fetch = vi.fn(async (url: string) =>
    url === '/assets/media-details.json'
      ? Response.json({
          version: 1,
          images: {
            '/media/full.webp': { url: 'https://different.example.test/media/hash/full.webp' },
            '/api/private.webp': { url: image.src },
          },
        })
      : Promise.reject(new TypeError('CORS blocked')),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(sources.acquire(image).value).rejects.toThrow('CORS blocked');
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('rejects oversized and non-image responses, then permits a clean retry', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('error page', { headers: { 'Content-Type': 'text/html' } }))
    .mockResolvedValueOnce(
      new Response('too large', {
        headers: { 'Content-Type': 'image/gif', 'Content-Length': String(26 * 1024 * 1024) },
      }),
    )
    .mockResolvedValueOnce(picture());
  vi.stubGlobal('fetch', fetch);
  const local = { src: '/media/full.webp' };
  await expect(sources.acquire(local).value).rejects.toThrow('Download unavailable');
  await expect(sources.acquire(local).value).rejects.toThrow('too large');
  expect((await sources.acquire(local).value).url).toMatch(/^blob:/);
});

it('bounds actual stream bytes and total viewer memory even without Content-Length', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(new Uint8Array((url.includes('oversized') ? 26 : 20) * 1024 * 1024), {
          headers: { 'Content-Type': 'image/gif' },
        }),
    ),
  );
  await expect(sources.acquire({ src: '/media/oversized.gif' }).value).rejects.toThrow('too large');
  const first = sources.acquire({ src: '/media/first.gif' });
  await first.value;
  await sources.acquire({ src: '/media/second.gif' }).value;
  await expect(sources.acquire({ src: '/media/third.gif' }).value).rejects.toThrow('too large');
  first.release();
  expect((await sources.acquire({ src: '/media/third.gif' }).value).url).toMatch(/^blob:/);
});

it('keeps active vector documents out of same-origin Blob URLs', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', {
          headers: { 'Content-Type': 'image/svg+xml' },
        }),
    ),
  );
  const create = vi.spyOn(URL, 'createObjectURL');
  await expect(sources.acquire({ src: '/media/vector.svg' }).value).rejects.toThrow(
    'Open the image',
  );
  expect(create).not.toHaveBeenCalled();
});

it('aborts pending work on close and never creates a late object URL', async () => {
  let signal: AbortSignal;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      );
    }),
  );
  const create = vi.spyOn(URL, 'createObjectURL');
  const reading = sources.acquire(image).value;
  sources.destroy();
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  expect(signal!.aborted).toBe(true);
  expect(create).not.toHaveBeenCalled();
});
