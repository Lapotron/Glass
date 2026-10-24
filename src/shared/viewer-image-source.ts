import type { ViewerImage } from './image-viewer.js';
import { publicImageFallback } from './public-media-details.js';

const imageLimit = 25 * 1024 * 1024;
const viewerLimit = 50 * 1024 * 1024;
const rasterTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);
export function publicImageUrl(value: string) {
  const url = new URL(value, location.href);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('This image has no downloadable public URL.');
  return url;
}
type Resource = { url: string; blob: Blob; name: string };
type Entry = {
  controller: AbortController;
  promise: Promise<Resource>;
  resource?: Resource;
  bytes: number;
  users: number;
};
class ImageReadError extends Error {}

/** One bounded, reference-counted image read shared by the slide and its download. */
export class ViewerImageSources {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  private disposed = false;

  acquire(image: ViewerImage) {
    const url = publicImageUrl(image.src);
    let entry = this.entries.get(url.href);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, bytes: 0, users: 0, promise: undefined! };
      const added = entry;
      this.entries.set(url.href, added);
      added.promise = this.load(image, url, added).catch((error) => {
        this.remove(url.href, added);
        throw error;
      });
    }
    entry.users++;
    let released = false;
    return {
      value: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        if (--entry.users === 0) this.remove(url.href, entry);
      },
    };
  }

  private remove(key: string, entry: Entry) {
    if (this.entries.get(key) === entry) this.entries.delete(key);
    entry.controller.abort();
    this.bytes -= entry.bytes;
    entry.bytes = 0;
    if (entry.resource) {
      URL.revokeObjectURL(entry.resource.url);
      entry.resource = undefined;
    }
  }

  private async load(image: ViewerImage, url: URL, entry: Entry): Promise<Resource> {
    if (this.disposed) throw new DOMException('Viewer closed.', 'AbortError');
    const signal = AbortSignal.any([entry.controller.signal, AbortSignal.timeout(30000)]);
    let blob: Blob;
    try {
      try {
        blob = await this.read(url.href, entry, signal);
      } catch (error) {
        signal.throwIfAborted();
        // An earlier native <img> may have cached a response without CORS headers.
        if (!(error instanceof TypeError) || url.origin === location.origin) throw error;
        blob = await this.read(url.href, entry, signal, 'reload');
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ImageReadError || url.origin === location.origin) throw error;
      const fallback = await publicImageFallback(image).catch(() => undefined);
      signal.throwIfAborted();
      if (!fallback) throw error;
      blob = await this.read(fallback, entry, signal);
    }
    signal.throwIfAborted();
    const filename = url.pathname.split('/').at(-1) || 'image';
    let name = filename;
    try {
      name = decodeURIComponent(filename);
    } catch {}
    entry.resource = {
      url: URL.createObjectURL(blob),
      blob,
      name,
    };
    return entry.resource;
  }

  private async read(
    url: string,
    entry: Entry,
    signal: AbortSignal,
    cache: RequestCache = 'default',
  ) {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal, cache });
    const type = response.headers.get('content-type')?.split(';')[0].trim();
    if (!response.ok || !type?.startsWith('image/')) {
      await response.body?.cancel();
      throw new Error('Download unavailable. Open the image to save it.');
    }
    // Vector documents keep their native response URL and its sandbox policy.
    if (!rasterTypes.has(type)) {
      await response.body?.cancel();
      throw new ImageReadError('Download unavailable. Open the image to save it.');
    }
    if (Number(response.headers.get('content-length')) > imageLimit) {
      await response.body?.cancel();
      throw new ImageReadError('This image is too large to download here.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Download unavailable.');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        if (entry.bytes + value.length > imageLimit || this.bytes + value.length > viewerLimit)
          throw new ImageReadError('This image is too large to download here.');
        entry.bytes += value.length;
        this.bytes += value.length;
        chunks.push(value as Uint8Array<ArrayBuffer>);
      }
      if (!entry.bytes) throw new Error('The image response was empty.');
      return new Blob(chunks, { type });
    } catch (error) {
      this.bytes -= entry.bytes;
      entry.bytes = 0;
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  destroy() {
    this.disposed = true;
    for (const [key, entry] of this.entries) this.remove(key, entry);
  }
}
