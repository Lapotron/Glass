import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { CloudError, hex, type Actor, type CloudEnv } from './types.js';
const resolvers = new Map<string, JWTVerifyGetKey>();
export async function authenticate(
  request: Request,
  env: CloudEnv,
  resolver?: JWTVerifyGetKey,
): Promise<Actor> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(env.ACCESS_TEAM) || !env.ACCESS_AUD || !env.ACCESS_ADMINS)
    throw new CloudError('Configure Cloudflare Access before opening Studio.', 503);
  const issuer = `https://${env.ACCESS_TEAM}.cloudflareaccess.com`;
  if (!resolvers.has(issuer))
    resolvers.set(issuer, createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs')));
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16000)
    throw new CloudError('Cloudflare Access login is required.', 401);
  try {
    const { payload } = await jwtVerify(token, resolver || resolvers.get(issuer)!, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'email', 'iat', 'exp'],
      clockTolerance: 5,
    });
    const email = String(payload.email).toLowerCase();
    if (
      !env.ACCESS_ADMINS.split(',')
        .map((x) => x.trim().toLowerCase())
        .includes(email)
    )
      throw new Error('Owner not allowed');
    return { id: payload.sub!, email };
  } catch {
    throw new CloudError('This login is not an authorized Studio owner.', 403);
  }
}
export async function csrf(actor: Actor, env: CloudEnv) {
  if (!env.STUDIO_SECRET || env.STUDIO_SECRET.length < 32)
    throw new CloudError('Configure STUDIO_SECRET before opening Studio.', 503);
  const encoder = new TextEncoder(),
    key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(env.STUDIO_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  return hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(actor.id + '|' + new Date().toISOString().slice(0, 10)),
    ),
  );
}
export function checkOrigin(request: Request, env: CloudEnv) {
  const origin = new URL(request.url).origin;
  if (origin !== env.STUDIO_ORIGIN)
    throw new CloudError('This Studio hostname is not configured.', 403);
  // Access returns from its separate login hostname through a top-level GET.
  // It is a legitimate cross-site navigation, followed by mandatory JWT verification.
  const path = new URL(request.url).pathname;
  const readOnlyPage =
    path === '/' ||
    path === '/studio' ||
    path.startsWith('/studio/') ||
    path.startsWith('/authoring/') ||
    path.startsWith('/media/') ||
    path.startsWith('/m/') ||
    /^\/api\/(?:cloud-jobs\/[\w-]+\/file\/[\w.-]+|content\/[\w-]+\/download|backups\/[\w-]+\/download|notebook\/reset\/[\w-]+\/backup|jobs\/[\w-]+\/log)$/.test(
      path,
    );
  const ownerNavigation =
    readOnlyPage &&
    request.method === 'GET' &&
    request.headers.get('Sec-Fetch-Mode') === 'navigate' &&
    request.headers.get('Sec-Fetch-Dest') === 'document';
  if (
    !ownerNavigation &&
    ((request.headers.get('Origin') && request.headers.get('Origin') !== origin) ||
      ['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site') || ''))
  )
    throw new CloudError('Cross-origin access is not allowed.', 403);
}
export async function equalSecret(input: string | null, expected: string) {
  if (!input || !expected || expected.length < 32) return false;
  const encoder = new TextEncoder(),
    a = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input))),
    b = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(expected)));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
