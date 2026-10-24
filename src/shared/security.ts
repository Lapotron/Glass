import type { SiteConfig } from './contracts.js';
export function contentSecurityPolicy(site: SiteConfig) {
  const scripts = ["'self'", "'wasm-unsafe-eval'"],
    connections = ["'self'"],
    frames = ["'self'"];
  if (site.integrations.aca.enabled && site.integrations.aca.endpoint)
    connections.push(new URL(site.integrations.aca.endpoint).origin);
  if (site.mediaDelivery.mode === 'r2' && site.mediaDelivery.publicOrigin)
    connections.push(new URL(site.mediaDelivery.publicOrigin).origin);
  if (site.integrations.comments.enabled) {
    scripts.push('https://giscus.app');
    frames.push('https://giscus.app');
  }
  if (site.integrations.analytics.enabled) {
    scripts.push('https://static.cloudflareinsights.com');
    connections.push('https://cloudflareinsights.com');
  }
  if (site.integrations.googleAnalytics.enabled) {
    scripts.push('https://www.googletagmanager.com');
    connections.push(
      'https://www.googletagmanager.com',
      'https://*.google-analytics.com',
      'https://*.google.com',
    );
  }
  return `default-src 'self'; script-src ${scripts.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src ${connections.join(' ')}; frame-src ${frames.join(' ')}; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`;
}
