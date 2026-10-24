import { escapeHtml } from './utils.js';
import type { SiteConfig } from './contracts.js';

export function pageTitle(site: SiteConfig, title: string, home = false) {
  if (home) return site.metadata.homeTitle || `${site.name} — An open notebook`;
  return site.metadata.titleTemplate.replace(/\{title\}|\{site\}/g, (token) =>
    token === '{title}' ? title : site.name,
  );
}
export function socialLocale(site: SiteConfig, language = site.language) {
  if (site.metadata.locale) return site.metadata.locale;
  try {
    const locale = new Intl.Locale(language).maximize();
    return `${locale.language}_${locale.region || 'US'}`;
  } catch {
    return 'en_US';
  }
}
export function footerCopyright(site: SiteConfig, year = new Date().getUTCFullYear()) {
  const since = site.footer.since;
  return `© ${since && since < year ? `${since}–${year}` : year} ${site.footer.copyrightName || site.profile.name}`;
}
export function feedLinks(site: SiteConfig) {
  return [
    ...(site.feeds.rss ? [{ label: 'RSS', href: '/feed.xml', type: 'application/rss+xml' }] : []),
    ...(site.feeds.atom
      ? [{ label: 'Atom', href: '/atom.xml', type: 'application/atom+xml' }]
      : []),
    ...(site.feeds.json
      ? [{ label: 'JSON', href: '/feed.json', type: 'application/feed+json' }]
      : []),
  ];
}

export function fallbackFavicon(site: SiteConfig) {
  const mark =
    site.branding.iconStyle === 'monogram'
      ? `<text x="32" y="34" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="28" font-weight="650">${escapeHtml(
          Array.from(site.branding.monogram || site.branding.shortName || site.name)
            .slice(0, 2)
            .join(''),
        )}</text>`
      : '<path d="M16 18q16-10 32 0v30q-16-10-32 0Z M32 14v30" fill="none" stroke="white" stroke-width="3" stroke-linejoin="round"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="20" fill="${escapeHtml(site.branding.iconBackground)}"/>${mark}</svg>`;
}
