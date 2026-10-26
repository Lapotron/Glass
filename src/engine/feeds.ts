import { promises as fs } from 'node:fs';
import path from 'node:path';
import { routeFor, type SiteConfig } from '../shared/contracts.js';
import type { RenderedEntry } from '../site/pages.js';
import { escapeHtml } from '../shared/utils.js';
import { footerCopyright } from '../shared/site-presentation.js';
import { publicUrl } from '../shared/public-path.js';

export async function writeFeeds(
  output: string,
  site: SiteConfig,
  entries: RenderedEntry[],
  version: string,
  basePath = '',
) {
  const url = site.url.replace(/\/$/, '') + basePath;
  const title = site.feeds.title || site.name;
  const description = site.feeds.description || site.description;
  const selected = entries
    .filter(
      (entry) =>
        entry.status === 'published' &&
        (entry.kind === 'posts' ? site.feeds.posts : site.feeds.lab),
    )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))
    .slice(0, site.feeds.limit);
  const address = (entry: RenderedEntry) => `${url}${routeFor(entry, site.collections)}`;
  const timestamp = (entry: RenderedEntry) =>
    `${entry.updatedAt || entry.publishedAt}T12:00:00.000Z`;
  const updated = selected.length
    ? selected.map(timestamp).sort().at(-1)!
    : '1970-01-01T00:00:00.000Z';
  if (site.feeds.rss)
    await fs.writeFile(
      path.join(output, 'feed.xml'),
      `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeHtml(title)}</title><link>${escapeHtml(url)}</link><description>${escapeHtml(description)}</description><language>${escapeHtml(site.language)}</language><copyright>${escapeHtml(footerCopyright(site))}</copyright><image><url>${escapeHtml(`${url}/favicon-32x32.png?v=${version}`)}</url><title>${escapeHtml(title)}</title><link>${escapeHtml(url)}</link></image>${selected.map((entry) => `<item><title>${escapeHtml(entry.title)}</title><link>${escapeHtml(address(entry))}</link><guid isPermaLink="true">${escapeHtml(address(entry))}</guid><pubDate>${new Date(`${entry.publishedAt}T12:00:00Z`).toUTCString()}</pubDate><description>${escapeHtml(entry.summary)}</description>${entry.tags.map((tag) => `<category>${escapeHtml(tag)}</category>`).join('')}${site.feeds.author ? `<dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">${escapeHtml(site.profile.name)}</dc:creator>` : ''}</item>`).join('')}</channel></rss>`,
    );
  if (site.feeds.atom)
    await fs.writeFile(
      path.join(output, 'atom.xml'),
      `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${escapeHtml(site.language)}"><id>${escapeHtml(url + '/')}</id><title>${escapeHtml(title)}</title><subtitle>${escapeHtml(description)}</subtitle><link href="${escapeHtml(url + '/atom.xml')}" rel="self"/><link href="${escapeHtml(url + '/')}"/><updated>${updated}</updated><icon>${escapeHtml(`${url}/favicon-32x32.png?v=${version}`)}</icon><author><name>${escapeHtml(site.feeds.author ? site.profile.name : site.name)}</name><uri>${escapeHtml(url + (site.feeds.author ? '/about/' : '/'))}</uri></author>${selected.map((entry) => `<entry><id>${escapeHtml(address(entry))}</id><title>${escapeHtml(entry.title)}</title><link href="${escapeHtml(address(entry))}"/><published>${entry.publishedAt}T12:00:00.000Z</published><updated>${timestamp(entry)}</updated><summary>${escapeHtml(entry.summary)}</summary>${entry.tags.map((tag) => `<category term="${escapeHtml(tag)}"/>`).join('')}</entry>`).join('')}</feed>`,
    );
  if (site.feeds.json)
    await fs.writeFile(
      path.join(output, 'feed.json'),
      JSON.stringify(
        {
          version: 'https://jsonfeed.org/version/1.1',
          title,
          description,
          home_page_url: url + '/',
          feed_url: url + '/feed.json',
          language: site.language,
          icon: `${url}/app-icon-512.png?v=${version}`,
          favicon: `${url}/favicon-32x32.png?v=${version}`,
          ...(site.feeds.author
            ? { authors: [{ name: site.profile.name, url: url + '/about/' }] }
            : {}),
          items: selected.map((entry) => ({
            id: address(entry),
            url: address(entry),
            title: entry.title,
            content_text: entry.summary,
            summary: entry.summary,
            date_published: `${entry.publishedAt}T12:00:00.000Z`,
            date_modified: timestamp(entry),
            ...(entry.cover ? { image: publicUrl(entry.cover, site.url, basePath) } : {}),
            tags: entry.tags,
            language: entry.lang,
          })),
        },
        null,
        2,
      ),
    );
}
