import { createHash } from 'node:crypto';
import type { Library } from '../shared/contracts.js';
import { canonicalMediaUrl } from '../shared/media-details.js';
import { shortLinkPattern } from '../shared/shortlinks.js';
export const effectiveMediaCode = (url: string, library: Library) =>
  library.mediaDetails[canonicalMediaUrl(url)]?.shortCode ||
  createHash('sha256')
    .update('glass-media-v1:' + canonicalMediaUrl(url))
    .digest('hex')
    .slice(0, 16);
export function mediaLinkMap(urls: Iterable<string>, library: Library) {
  const links = new Map<string, string>();
  for (const input of urls) {
    const url = canonicalMediaUrl(input),
      codes = [
        effectiveMediaCode(url, library),
        ...(library.mediaDetails[url]?.shortAliases || []),
      ];
    for (const code of codes) {
      if (!shortLinkPattern.test(code)) throw new Error('Invalid media short code.');
      const key = '/m/' + code;
      if (links.has(key)) throw new Error('Media short link “' + code + '” is already in use.');
      links.set(key, url);
    }
  }
  return links;
}
export function resolveMediaLink(value: string, links: Map<string, string>) {
  if (!value.startsWith('/m/')) return value;
  const [base] = value.split(/[?#]/),
    key = base.replace(/\/$/, '');
  const target = links.get(key);
  if (!target) throw new Error('Unknown media short link: ' + base);
  return target + value.slice(base.length);
}
