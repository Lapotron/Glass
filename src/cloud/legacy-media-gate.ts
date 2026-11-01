import { publicMediaKey, publicMediaMime } from '../shared/public-media-policy.js';

type Environment = { MEDIA_ORIGIN: string; MEDIA_PREFIX: string; UPSTREAM_ORIGIN?: string };

/** Temporary compatibility gate for existing public URLs in a private bucket. */
export async function gateLegacyMedia(
  request: Request,
  env: Environment,
  fetcher: typeof fetch = fetch,
) {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-None-Match',
    'Access-Control-Max-Age': '3600',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
  const fail = (status: number) => {
    const result = new Headers(headers);
    result.set('Cache-Control', 'no-store');
    return new Response(null, { status, headers: result });
  };
  let origin: URL, upstream: URL;
  try {
    origin = new URL(env.MEDIA_ORIGIN);
    upstream = new URL(env.UPSTREAM_ORIGIN || env.MEDIA_ORIGIN);
  } catch {
    return fail(503);
  }
  const url = new URL(request.url);
  if (
    origin.protocol !== 'https:' ||
    upstream.protocol !== 'https:' ||
    origin.pathname !== '/' ||
    upstream.pathname !== '/' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash ||
    url.origin !== origin.origin
  )
    return fail(404);
  const media = publicMediaKey(url.pathname, env.MEDIA_PREFIX);
  if (!media) return fail(404);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return fail(405);
  const target = new URL(url.pathname + url.search, upstream);
  const forwarded = new Headers();
  for (const name of ['Range', 'If-None-Match', 'If-Modified-Since']) {
    const value = request.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  try {
    const response = await fetcher(
      new Request(target, { method: request.method, headers: forwarded, redirect: 'manual' }),
    );
    if (![200, 206, 304, 404, 416].includes(response.status)) return fail(502);
    if (
      [200, 206].includes(response.status) &&
      response.headers.get('Content-Type')?.split(';')[0] !== publicMediaMime(media.extension)
    )
      return fail(404);
    for (const name of [
      'Content-Type',
      'Content-Length',
      'Content-Range',
      'Accept-Ranges',
      'ETag',
      'Last-Modified',
      'Cache-Control',
    ]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (response.status === 404 || response.status === 416)
      headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return fail(503);
  }
}
export default { fetch: (request: Request, env: Environment) => gateLegacyMedia(request, env) };
