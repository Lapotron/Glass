import { escapeHtml, imageSet } from '../shared/utils.js';
export type ImageDimensions = { width: number; height: number };
const imageTags = /<(?:img|link)\b(?:[^"'>]|"[^"]*"|'[^']*')*>/gi;
const attribute = (tag: string, name: string) =>
  tag.match(new RegExp(`\\s${name}=(["'])(.*?)\\1`, 'i'))?.[2];
/** React can preload a responsive image with only imagesrcset, without href. */
function responsiveSources(html: string) {
  const sources = new Map<string, string>();
  for (const [tag] of html.matchAll(imageTags)) {
    if (!/^<img\b/i.test(tag)) continue;
    const src = attribute(tag, 'src'),
      candidates = attribute(tag, 'srcset');
    if (src && candidates) sources.set(candidates, src);
  }
  return sources;
}
/** Hosted previews have canonical media, while resized candidates exist only in build artifacts. */
export function useOriginalMediaImages(html: string) {
  const sources = responsiveSources(html);
  return html.replace(imageTags, (tag) => {
    const image = /^<img\b/i.test(tag);
    if (!image && !/\bas=["']image["']/i.test(tag)) return tag;
    const src =
      attribute(tag, image ? 'src' : 'href') ||
      (!image ? sources.get(attribute(tag, 'imagesrcset') || '') : undefined);
    if (!src?.startsWith('/media/')) return tag;
    if (!image && !attribute(tag, 'href')) tag = tag.replace(/\s*\/?>$/, ` href="${src}"/>`);
    return tag.replace(
      new RegExp(`\\s${image ? 'srcset' : 'imagesrcset'}=(["'])[\\s\\S]*?\\1`, 'gi'),
      '',
    );
  });
}
/** One image-size map resolves both normal images and responsive preload candidates. */
export function resolveResponsiveImages(html: string, images: Map<string, ImageDimensions>) {
  const sources = responsiveSources(html);
  return html.replace(imageTags, (tag) => {
    const image = /^<img\b/i.test(tag);
    if (!image && !/\bas=["']image["']/i.test(tag)) return tag;
    const src =
      attribute(tag, image ? 'src' : 'href') ||
      (!image ? sources.get(attribute(tag, 'imagesrcset') || '') : undefined);
    if (!src?.startsWith('/media/')) return tag;
    const url = src.replace(/&amp;/g, '&').split(/[?#]/)[0];
    let size: ImageDimensions | undefined;
    try {
      size = images.get(decodeURIComponent(url));
    } catch {
      return tag;
    }
    if (!size) return tag;
    const candidates = imageSet(url, size.width);
    let result = tag.replace(/\s(?:srcset|imagesrcset)=(["'])[\s\S]*?\1/gi, '');
    const attributes: string[] = [];
    if (candidates)
      attributes.push(`${image ? 'srcset' : 'imagesrcset'}="${escapeHtml(candidates)}"`);
    if (image && !/\swidth=/i.test(result)) {
      attributes.push(`width="${size.width}"`);
      if (!/\sheight=/i.test(result)) attributes.push(`height="${size.height}"`);
    }
    if (image && /\bloading=["']eager["']/i.test(result) && !/\sfetchpriority=/i.test(result))
      attributes.push('fetchpriority="high"');
    if (attributes.length) result = result.replace(/\s*\/?>$/, ` ${attributes.join(' ')}/>`);
    return result;
  });
}
