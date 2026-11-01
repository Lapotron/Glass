import { publicMediaKey, publicMediaMime } from '../shared/public-media-policy.js';

type MediaObject = {
  size: number;
  etag?: string;
  httpEtag?: string;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string; cacheControl?: string };
  body?: ReadableStream<Uint8Array>;
};
type MediaEnvironment = {
  BUCKET: {
    head(key: string): Promise<MediaObject | null>;
    get(
      key: string,
      options?: { range?: { offset: number; length: number } },
    ): Promise<MediaObject | null>;
  };
  MEDIA_ORIGIN: string;
  MEDIA_PREFIX: string;
};

/** Only objects explicitly marked by an approved publication are eligible. */
export async function servePublicMedia(request: Request, env: MediaEnvironment): Promise<Response> {
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
  let origin: URL;
  try {
    origin = new URL(env.MEDIA_ORIGIN);
  } catch {
    return fail(503);
  }
  const url = new URL(request.url);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    url.origin !== origin.origin
  )
    return fail(404);
  const media = publicMediaKey(url.pathname, env.MEDIA_PREFIX);
  if (!media) return fail(404);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return fail(405);

  try {
    const range = request.method === 'GET' ? request.headers.get('Range') : null;
    let object =
      range || request.method === 'HEAD'
        ? await env.BUCKET.head(media.key)
        : await env.BUCKET.get(media.key);
    if (
      !object ||
      object.customMetadata?.['glass-public'] !== '1' ||
      (media.digest && object.customMetadata?.sha256 !== media.digest) ||
      object.httpMetadata?.contentType?.split(';')[0] !== publicMediaMime(media.extension)
    )
      return fail(404);
    const etag = object.httpEtag || (object.etag ? `"${object.etag}"` : '');
    headers.set('Content-Type', object.httpMetadata.contentType!);
    headers.set('Cache-Control', object.httpMetadata.cacheControl || 'public, max-age=3600');
    headers.set('Accept-Ranges', 'bytes');
    if (etag) headers.set('ETag', etag);
    if (
      etag &&
      request.headers
        .get('If-None-Match')
        ?.split(',')
        .map((item) => item.trim())
        .includes(etag)
    )
      return new Response(null, { status: 304, headers });
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const suffix = match?.[1] === '' ? Number(match[2]) : 0;
      const start = suffix ? Math.max(object.size - suffix, 0) : Number(match?.[1]);
      const end =
        match?.[2] && !suffix ? Math.min(Number(match[2]), object.size - 1) : object.size - 1;
      if (
        !match ||
        (!match[1] && !match[2]) ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        start >= object.size ||
        (match[1] === '' && !suffix)
      ) {
        headers.set('Content-Range', `bytes */${object.size}`);
        headers.set('Cache-Control', 'no-store');
        return new Response(null, { status: 416, headers });
      }
      const length = end - start + 1;
      object = await env.BUCKET.get(media.key, { range: { offset: start, length } });
      if (
        !object?.body ||
        object.customMetadata?.['glass-public'] !== '1' ||
        (media.digest && object.customMetadata?.sha256 !== media.digest)
      )
        return fail(404);
      headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
      headers.set('Content-Length', String(length));
      return new Response(object.body, { status: 206, headers });
    }
    headers.set('Content-Length', String(object.size));
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    if (!object.body) return fail(404);
    return new Response(object.body, { status: 200, headers });
  } catch {
    return fail(503);
  }
}

export default { fetch: servePublicMedia };
