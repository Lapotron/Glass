import type { ArchiveCatalog } from '../shared/archive.js';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { BuildResult, SiteConfig } from '../shared/contracts.js';
import type { MediaDetailsManifest } from '../shared/media-details.js';
import { digest } from './store.js';
import { escapeHtml, scriptJson } from '../shared/utils.js';
import { attachmentTypes } from '../shared/attachments.js';
export type DeliveryAsset = {
  file: string;
  key: string;
  url: string;
  sha256: string;
  bytes: number;
  contentType: string;
};
export type DeliveryManifest = { version: 1; assets: DeliveryAsset[] };
const types: Record<string, string> = {
  ...attachmentTypes,
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
};
export function mediaResolver(assets: DeliveryAsset[], canonical: string) {
  const lookup = new Map(
    assets.flatMap((asset) => {
      const file = asset.file.slice('media/'.length);
      return [
        ['/media/' + file, asset.url],
        ['/media/' + encodeURIComponent(file), asset.url],
      ];
    }),
  );
  const origin = new URL(canonical).origin;
  return (value: string) => {
    let local = value;
    if (value.startsWith(origin + '/media/')) local = value.slice(origin.length);
    const [base] = local.split(/[?#]/);
    return lookup.has(base) ? lookup.get(base)! + local.slice(base.length) : value;
  };
}
export function resolveMediaData(value: unknown, resolve: (url: string) => string): unknown {
  if (typeof value === 'string') return resolve(value);
  if (Array.isArray(value)) return value.map((child) => resolveMediaData(child, resolve));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, resolveMediaData(child, resolve)]),
    );
  return value;
}
function resolvePublishedImages(value: unknown, resolve: (url: string) => string): unknown {
  if (Array.isArray(value)) return value.map((child) => resolvePublishedImages(child, resolve));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key === 'image' && typeof child === 'string'
          ? resolve(child)
          : resolvePublishedImages(child, resolve),
      ]),
    );
  return value;
}
/** Rewrite only URL-bearing HTML, CSS URLs and structured image data; prose stays canonical. */
export function resolveMediaHtml(html: string, resolve: (url: string) => string) {
  const css = (value: string) =>
    value.replace(
      /url\((['"]?)([^)'"\s]+)\1\)/g,
      (_all, quote: string, url: string) => 'url(' + quote + resolve(url) + quote + ')',
    );
  let output = html.replace(
    /\b(src|srcset|imagesrcset|href|poster|style|data-view-image|data-photo|data-config|data-archive-catalog)=(["'])([\s\S]*?)\2/gi,
    (all, name: string, quote: string, encoded: string) => {
      const value = encoded
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&amp;/g, '&');
      let rewritten: string;
      if (name === 'data-photo' || name === 'data-config') {
        try {
          rewritten = JSON.stringify(resolveMediaData(JSON.parse(value), resolve));
        } catch {
          return all;
        }
      } else if (name.toLowerCase().endsWith('srcset'))
        rewritten = value
          .split(',')
          .map((part) => {
            const [url, width] = part.trim().split(/\s+/);
            return resolve(url) + (width ? ' ' + width : '');
          })
          .join(', ');
      else if (name === 'style') rewritten = css(value);
      else rewritten = resolve(value);
      const identity =
        name.toLowerCase() === 'src' && value.startsWith('/media/') && rewritten !== value
          ? ' data-media-source="' + escapeHtml(value) + '"'
          : '';
      return name + '=' + quote + escapeHtml(rewritten) + quote + identity;
    },
  );
  output = output.replace(/<meta\b[^>]*>/g, (tag) => {
    if (!/\b(?:property|name)="(?:og:image(?::secure_url)?|twitter:image)"/.test(tag)) return tag;
    return tag.replace(
      /\bcontent="([^"]*)"/,
      (_all, value: string) => `content="${escapeHtml(resolve(value.replace(/&amp;/g, '&')))}"`,
    );
  });
  output = output.replace(
    /<style>([\s\S]*?)<\/style>/g,
    (_all, value: string) => '<style>' + css(value) + '</style>',
  );
  output = output.replace(
    /(<script\b[^>]*(?:id="reader-defaults"|type="application\/ld\+json")[^>]*>)([\s\S]*?)(<\/script>)/g,
    (_all, start: string, value: string, end: string) => {
      return (
        start +
        scriptJson(
          start.includes('application/ld+json')
            ? resolvePublishedImages(JSON.parse(value), resolve)
            : resolveMediaData(JSON.parse(value), resolve),
        ) +
        end
      );
    },
  );
  return output;
}
export async function prepareMediaDelivery(
  build: BuildResult,
  site: SiteConfig,
): Promise<BuildResult> {
  if (site.mediaDelivery.mode !== 'r2') return build;
  const { bucket, publicOrigin, prefix } = site.mediaDelivery;
  if (!bucket || !publicOrigin)
    throw new Error('Set the R2 bucket and production media domain in Site settings.');
  const outputDir = path.join(path.dirname(build.outputDir), 'delivery-public');
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.cp(build.outputDir, outputDir, { recursive: true });
  const assets: DeliveryAsset[] = [];
  const manifest = [...build.manifest];
  for (const file of build.manifest) {
    if (!file.startsWith('media/') || !types[path.extname(file).toLowerCase()]) continue;
    const bytes = await fs.readFile(path.join(outputDir, file)),
      sha256 = digest(bytes);
    const name = file.slice('media/'.length),
      key =
        prefix +
        '/v2/' +
        sha256 +
        (Object.entries(types).find(
          ([, type]) => type === types[path.extname(name).toLowerCase()],
        )?.[0] || path.extname(name).toLowerCase());
    assets.push({
      file,
      key,
      url: new URL('/' + key.split('/').map(encodeURIComponent).join('/'), publicOrigin).href,
      sha256,
      bytes: bytes.length,
      contentType: types[path.extname(file).toLowerCase()],
    });
  }
  const resolve = mediaResolver(assets, site.url);
  const redirects = path.join(outputDir, '_redirects');
  await fs.writeFile(
    redirects,
    (await fs.readFile(redirects, 'utf8'))
      .split('\n')
      .map((line) => {
        const parts = line.split(' ');
        if (parts[0]?.startsWith('/m/') && parts[1]?.startsWith('/media/'))
          parts[1] = resolve(parts[1]);
        return parts.join(' ');
      })
      .join('\n'),
  );
  const catalogPaths = new Map<string, string>();
  for (const file of build.manifest.filter((file) =>
    /^assets\/archive\/catalog-[a-f0-9]+\.json$/.test(file),
  )) {
    const target = path.join(outputDir, file);
    const catalog = JSON.parse(await fs.readFile(target, 'utf8')) as ArchiveCatalog;
    const data = JSON.stringify({
      ...catalog,
      records: catalog.records.map((record) => ({
        ...record,
        ...(record.cover ? { cover: resolve(record.cover) } : {}),
      })),
    });
    const next = `assets/archive/catalog-${digest(data).slice(0, 20)}.json`;
    await fs.writeFile(path.join(outputDir, next), data);
    if (next !== file) await fs.rm(target);
    manifest[manifest.indexOf(file)] = next;
    catalogPaths.set('/' + file, '/' + next);
  }
  for (const file of build.manifest.filter((file) => file.endsWith('.html'))) {
    const target = path.join(outputDir, file);
    await fs.writeFile(
      target,
      resolveMediaHtml(
        await fs.readFile(target, 'utf8'),
        (url) => catalogPaths.get(url) || resolve(url),
      ),
    );
  }
  const metadataFile = path.join(outputDir, 'assets/media-details.json');
  const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8')) as MediaDetailsManifest;
  Object.values(metadata.images).forEach((image) => (image.url = resolve(image.url)));
  await fs.writeFile(metadataFile, JSON.stringify(metadata));
  if (build.manifest.includes('feed.json')) {
    const file = path.join(outputDir, 'feed.json');
    await fs.writeFile(
      file,
      JSON.stringify(resolvePublishedImages(JSON.parse(await fs.readFile(file, 'utf8')), resolve)),
    );
  }
  // This transfer journal is private; upload only delivery-public to Pages.
  await fs.writeFile(
    path.join(path.dirname(build.outputDir), 'media-transfer.json'),
    JSON.stringify({ version: 1, assets } satisfies DeliveryManifest, null, 2),
  );
  let totalBytes = 0;
  for (const file of manifest) totalBytes += (await fs.stat(path.join(outputDir, file))).size;
  return {
    ...build,
    manifest: manifest.sort(),
    outputDir,
    totalBytes,
    media: { version: 1, assets },
  };
}
