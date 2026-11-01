import handler from 'vinext/server/fetch-handler';
import { verifyAdmin, type AccessConfig } from '../lib/access';
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};
export default {
  async fetch(
    request: Request,
    env: AccessConfig & { ASSETS: { fetch(request: Request): Promise<Response> } },
    context: unknown,
  ) {
    let admin;
    try {
      admin = await verifyAdmin(request, env);
    } catch {
      return new Response(
        'This private prototype requires a valid Cloudflare Access administrator session.',
        {
          status: 401,
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            ...privateHeaders,
          },
        },
      );
    }
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.get('Origin') !== new URL(request.url).origin
    )
      return new Response('Origin not allowed.', {
        status: 403,
        headers: privateHeaders,
      });
    const forwarded = new Request(request);
    forwarded.headers.delete('X-Glass-Admin');
    forwarded.headers.set('X-Glass-Admin', admin.email);
    let response: Response;
    try {
      // Worker-first protects every asset; Vinext's fetch handler does not serve
      // its generated client chunks itself, so forward them after JWT validation.
      response =
        ['GET', 'HEAD'].includes(request.method) &&
        new URL(request.url).pathname.startsWith('/_next/static/')
          ? await env.ASSETS.fetch(new Request(request.url, { method: request.method }))
          : await handler.fetch(forwarded, env, context);
    } catch {
      return new Response('The private staging application is temporarily unavailable.', {
        status: 503,
        headers: { ...privateHeaders, 'Content-Type': 'text/plain;charset=utf-8' },
      });
    }
    const result = new Response(response.body, response);
    for (const [key, value] of Object.entries(privateHeaders)) result.headers.set(key, value);
    return result;
  },
};
