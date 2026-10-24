import type { SiteConfig } from '../shared/contracts.js';
export function r2Readiness(site: SiteConfig, environment = process.env) {
  const missing = [
    !site.cloudflare.accountId && 'Cloudflare account ID',
    !site.mediaDelivery.bucket && 'R2 bucket',
    !site.mediaDelivery.publicOrigin && 'Production media domain',
    !environment.R2_ACCESS_KEY_ID && 'R2_ACCESS_KEY_ID',
    !environment.R2_SECRET_ACCESS_KEY && 'R2_SECRET_ACCESS_KEY',
  ].filter(Boolean) as string[];
  return {
    configured: !missing.length,
    missing,
    mode: site.mediaDelivery.mode,
    bucket: site.mediaDelivery.bucket,
    publicOrigin: site.mediaDelivery.publicOrigin,
  };
}
