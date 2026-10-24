import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
export type AccessConfig = { ACCESS_TEAM: string; ACCESS_AUD: string; ACCESS_ADMINS: string };
const keys = new Map<string, JWTVerifyGetKey>();
/** Validate Access at the application boundary, including direct Workers URLs. */
export async function verifyAdmin(
  request: Request,
  config: AccessConfig,
  resolver?: JWTVerifyGetKey,
) {
  if (
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.ACCESS_TEAM) ||
    !config.ACCESS_AUD ||
    !config.ACCESS_ADMINS
  )
    throw new Error('Access is not configured.');
  const issuer = `https://${config.ACCESS_TEAM}.cloudflareaccess.com`;
  if (!keys.has(issuer))
    keys.set(
      issuer,
      createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
        timeoutDuration: 4000,
        cacheMaxAge: 3600000,
      }),
    );
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16000) throw new Error('Access authentication required.');
  const { payload } = await jwtVerify(token, resolver || keys.get(issuer)!, {
    issuer,
    audience: config.ACCESS_AUD,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat', 'email'],
    clockTolerance: 5,
  });
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  const admins = config.ACCESS_ADMINS.split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.includes(email)) throw new Error('This account is not an allowed administrator.');
  return { email, subject: payload.sub! };
}
