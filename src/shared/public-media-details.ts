import {
  canonicalMediaUrl,
  type ImageDetails,
  type MediaDetailsManifest,
} from './media-details.js';
import type { ViewerImage } from './image-viewer.js';

let manifest: Promise<MediaDetailsManifest> | undefined;
async function imageManifest() {
  if (!manifest)
    manifest = fetch('/assets/media-details.json', {
      signal: AbortSignal.timeout(10000),
      credentials: 'omit',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Image information could not load.');
        const data = (await response.json()) as MediaDetailsManifest;
        if (data.version !== 1 || !data.images)
          throw new Error('Image information is unavailable.');
        return data;
      })
      .catch((error) => {
        manifest = undefined;
        throw error;
      });
  return manifest;
}
async function imageEntry(image: ViewerImage) {
  const data = await imageManifest();
  const url = new URL(image.src, location.href);
  return Object.entries(data.images).find(([key, item]) => {
    if (image.canonicalSrc && key !== image.canonicalSrc) return false;
    const published = new URL(item.url, location.href);
    return (
      (url.origin === location.origin && url.pathname === key) ||
      (published.origin === url.origin && published.pathname === url.pathname)
    );
  });
}
export async function publicImageDetails(image: ViewerImage): Promise<Partial<ImageDetails>> {
  return (await imageEntry(image))?.[1] || { width: image.width, height: image.height };
}
/** Only the generated manifest can identify a CDN image's same-origin published copy. */
export async function publicImageFallback(image: ViewerImage): Promise<string | undefined> {
  const entry = await imageEntry(image);
  if (!entry) return;
  return new URL(canonicalMediaUrl(entry[0]), location.origin).href;
}
