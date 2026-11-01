import { validPublicMediaPrefix } from '../src/shared/public-media-policy.js';

/** Media is dispatched by the Studio Worker only on an explicitly configured separate origin. */
export function studioMediaConfig(environment: NodeJS.ProcessEnv, studioOrigin: string) {
  const input = environment.GLASS_MEDIA_ORIGIN;
  const vars: Record<string, string> = {};
  if (input === undefined) {
    if (environment.GLASS_MEDIA_ZONE_ID) throw new Error('Set the media origin with its zone ID.');
    return { vars };
  }
  if (!input) {
    if (environment.GLASS_MEDIA_ZONE_ID) throw new Error('Set the media origin with its zone ID.');
    return { vars: { MEDIA_ORIGIN: '' } };
  }
  let media: URL, studio: URL;
  try {
    media = new URL(input);
    studio = new URL(studioOrigin);
  } catch {
    throw new Error('Set GLASS_MEDIA_ORIGIN to an HTTPS origin.');
  }
  const prefix = environment.GLASS_MEDIA_PREFIX || 'media';
  if (
    media.protocol !== 'https:' ||
    media.username ||
    media.password ||
    media.port ||
    media.pathname !== '/' ||
    media.search ||
    media.hash ||
    media.origin === studio.origin ||
    !validPublicMediaPrefix(prefix)
  )
    throw new Error('Choose a separate HTTPS media origin and a safe public-only prefix.');
  if (
    environment.GLASS_MEDIA_LEGACY_COMPAT &&
    !['true', 'false'].includes(environment.GLASS_MEDIA_LEGACY_COMPAT)
  )
    throw new Error('GLASS_MEDIA_LEGACY_COMPAT must be true or false.');
  vars.MEDIA_ORIGIN = media.origin;
  vars.MEDIA_PREFIX = prefix;
  vars.MEDIA_LEGACY_COMPAT = environment.GLASS_MEDIA_LEGACY_COMPAT || 'false';
  const zone = environment.GLASS_MEDIA_ZONE_ID;
  if (!zone || !/^[a-f0-9]{32}$/i.test(zone))
    throw new Error('Set the media origin and its 32-character Cloudflare zone ID together.');
  return { vars, route: { pattern: media.hostname + '/*', zone_id: zone } };
}
