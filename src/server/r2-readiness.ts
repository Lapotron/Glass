import type { SiteConfig } from '../shared/contracts.js';
import { validPublicMediaPrefix } from '../shared/public-media-policy.js';
export function r2Readiness(
  site: SiteConfig,
  environment = process.env,
  studioBinding?: { bucketName?: string; available: boolean },
) {
  const shared = site.mediaDelivery.transport === 'studio-binding';
  const missing = [
    !site.cloudflare.accountId && 'Cloudflare account ID',
    !site.mediaDelivery.bucket && 'R2 bucket',
    !site.mediaDelivery.publicOrigin && 'Production media domain',
    shared && !studioBinding?.available && 'Hosted Studio R2 binding',
    shared && studioBinding?.available && !studioBinding.bucketName && 'Studio private bucket name',
    shared &&
      studioBinding?.bucketName &&
      studioBinding.bucketName !== site.mediaDelivery.bucket &&
      'R2 bucket matching the Studio binding',
    shared && !validPublicMediaPrefix(site.mediaDelivery.prefix) && 'Public-only media prefix',
    !shared && !environment.R2_ACCESS_KEY_ID && 'R2_ACCESS_KEY_ID',
    !shared && !environment.R2_SECRET_ACCESS_KEY && 'R2_SECRET_ACCESS_KEY',
  ].filter(Boolean) as string[];
  return {
    configured: !missing.length,
    missing,
    mode: site.mediaDelivery.mode,
    bucket: site.mediaDelivery.bucket,
    publicOrigin: site.mediaDelivery.publicOrigin,
  };
}
