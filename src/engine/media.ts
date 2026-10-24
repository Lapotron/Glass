import { mediaSourceSchema } from '../shared/media-upload.js';
import { effectiveMediaCode, mediaLinkMap } from './media-links.js';
import {
  mediaDownloadName,
  mediaMetadataSchema,
  type MediaMetadataResponse,
} from '../shared/media-metadata.js';
import { cameraInformation } from './image-details.js';
import { canonicalMediaUrl, type StudioImageDetails } from '../shared/media-details.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { MediaAsset, Repository } from '../shared/contracts.js';
import { Store, atomicWrite, contained, digest, ConflictError } from './store.js';
import { commitFiles } from './file-transaction.js';
import { librarySchema } from '../shared/contracts.js';
import { countWork, mapConcurrent } from './work-cache.js';
import { attachmentFile, attachmentExtension, imageFile } from '../shared/attachments.js';
export const transformSchema = z.object({
  crop: z
    .object({
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  resize: z
    .object({ width: z.number().int().min(1).max(2400), height: z.number().int().min(1).max(2400) })
    .optional(),
});
export type ImageTransform = z.infer<typeof transformSchema>;
const recordSchema = mediaSourceSchema;
const read = (bytes: Buffer, animated = false) =>
  sharp(bytes, { limitInputPixels: 40000000, animated });
type MediaIndex = {
  dimensions: Map<string, { fingerprint: string; value: { width?: number; height?: number } }>;
  records: Map<string, { raw: string; value: z.infer<typeof recordSchema> }>;
};
const mediaIndices = new WeakMap<Store, MediaIndex>();
export async function inspectImage(bytes: Buffer) {
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Files must be smaller than 20 MiB.');
  const metadata = await read(bytes).metadata();
  if (!['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heif'].includes(metadata.format || ''))
    throw new Error('Use a JPEG, PNG, WebP, AVIF, GIF, or PDF.');
  const width = metadata.autoOrient.width,
    height = metadata.autoOrient.height;
  return {
    width,
    height,
    animated: (metadata.pages || 1) > 1,
    preview: `data:image/webp;base64,${(await read(bytes).autoOrient().resize({ width: 1200, height: 900, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()).toString('base64')}`,
  };
}
export class MediaService {
  private dimensions: MediaIndex['dimensions'];
  private records: MediaIndex['records'];
  constructor(readonly store: Store) {
    let index = mediaIndices.get(store);
    if (!index) {
      index = { dimensions: new Map(), records: new Map() };
      mediaIndices.set(store, index);
    }
    this.dimensions = index.dimensions;
    this.records = index.records;
  }
  private folder(id: string) {
    z.uuid().parse(id);
    return path.join(this.store.root, '.studio/media-originals', id);
  }
  private async sourceIds() {
    const ids = await fs
      .readdir(path.join(this.store.root, '.studio/media-originals'))
      .catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    return ids.filter((id) => id !== '.DS_Store' && !id.startsWith('._'));
  }
  async source(id: string) {
    const base = this.folder(id);
    const record = recordSchema.parse(
      JSON.parse(await fs.readFile(await contained(base, 'record.json'), 'utf8')),
    );
    if (record.sourceId !== id) throw new Error('Image source identity does not match.');
    const bytes = await fs.readFile(await contained(base, 'original'));
    countWork('media.originalReadBytes', bytes.length);
    if (digest(bytes) !== record.sha256) throw new Error('Original image checksum does not match.');
    return { record, bytes };
  }
  async validate() {
    const ids = await this.sourceIds();
    for (const id of ids) {
      const { record } = await this.source(id);
      for (const variant of record.variants)
        await fs.access(await contained(path.join(this.store.content, 'media'), variant.name));
    }
    const model = await this.store.read(),
      files = await this.list(),
      urls = new Set(files.map((file) => file.url));
    mediaLinkMap(urls, model.library);
    for (const [url, metadata] of Object.entries(model.library.mediaDetails))
      if (metadata.publishForSharing && !urls.has(canonicalMediaUrl(url)))
        throw new Error('A file published for sharing is missing: ' + url);
  }
  async list(): Promise<MediaAsset[]> {
    const base = path.join(this.store.content, 'media');
    const { library } = await this.store.read();
    const ids = await this.sourceIds();
    const sources = new Map<string, { sourceId: string; width: number; height: number }>();
    const activeSources = new Set(ids);
    for (const id of this.records.keys()) if (!activeSources.has(id)) this.records.delete(id);
    await mapConcurrent(ids, 16, async (id) => {
      const folder = this.folder(id);
      const raw = await fs.readFile(await contained(folder, 'record.json'), 'utf8');
      let cached = this.records.get(id);
      if (cached?.raw !== raw) {
        cached = { raw, value: recordSchema.parse(JSON.parse(raw)) };
        this.records.set(id, cached);
      }
      const record = cached!.value;
      if (record.sourceId !== id) throw new Error('Image source identity does not match.');
      const original = await fs.stat(await contained(folder, 'original'));
      if (!original.isFile()) throw new Error('Original image is not a file.');
      for (const variant of record.variants)
        sources.set(variant.name, { sourceId: id, width: variant.width, height: variant.height });
    });
    const names = (await fs.readdir(base)).filter((n) => imageFile(n) || attachmentFile(n));
    const activeNames = new Set(names);
    for (const name of this.dimensions.keys())
      if (!activeNames.has(name)) this.dimensions.delete(name);
    return (
      await mapConcurrent(names, 16, async (name) => {
        const file = await contained(base, name),
          stat = await fs.stat(file),
          source = sources.get(name);
        const fingerprint = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
        let cached = this.dimensions.get(name);
        if (!source && cached?.fingerprint !== fingerprint) {
          const value = imageFile(name)
            ? await sharp(file)
                .metadata()
                .then((m) => ({
                  width: m.autoOrient.width,
                  height: m.pageHeight || m.autoOrient.height,
                }))
                .catch(() => ({}))
            : {};
          cached = { fingerprint, value };
          this.dimensions.set(name, cached);
          countWork('media.metadata');
        }
        const meta = source || cached?.value || {};
        return {
          name,
          displayName:
            library.mediaDetails['/media/' + encodeURIComponent(name)]?.displayName || name,
          downloadName: mediaDownloadName(
            name,
            library.mediaDetails['/media/' + encodeURIComponent(name)]?.displayName,
          ),
          shortCode: effectiveMediaCode('/media/' + encodeURIComponent(name), library),
          publishForSharing:
            library.mediaDetails['/media/' + encodeURIComponent(name)]?.publishForSharing || false,
          url: `/media/${encodeURIComponent(name)}`,
          bytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          revision: digest(name + '|' + stat.size + '|' + stat.mtimeMs),
          ...meta,
          sourceId: source?.sourceId,
          canEdit: !!source,
        };
      })
    ).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }
  async metadata(input: string): Promise<MediaMetadataResponse> {
    const url = canonicalMediaUrl(input),
      file = (await this.list()).find((file) => file.url === url);
    if (!file) throw new Error('Media file not found.');
    const model = await this.store.read();
    const metadata = mediaMetadataSchema.parse({
      ...model.library.mediaDetails[url],
      shortCode: effectiveMediaCode(url, model.library),
    });
    return {
      url,
      name: file.name,
      metadata,
      shortPath: '/m/' + metadata.shortCode,
      downloadName: mediaDownloadName(file.name, metadata.displayName),
      libraryRevision: model.libraryRevision,
    };
  }
  async saveMetadata(input: string, value: unknown, revision: string) {
    return this.store.exclusive(async () => {
      const previous = await this.metadata(input),
        metadata = mediaMetadataSchema.parse(value);
      if (previous.libraryRevision !== revision)
        throw new ConflictError(
          'Media settings changed. Reload metadata before saving; your draft is preserved.',
        );
      if (metadata.publishCameraExif && !imageFile(previous.name))
        throw new Error('Camera EXIF applies to images only.');
      if (!metadata.shortCode) metadata.shortCode = previous.metadata.shortCode;
      metadata.shortAliases = [...new Set(metadata.shortAliases)].filter(
        (code) => code !== metadata.shortCode,
      );
      if (
        metadata.shortCode !== previous.metadata.shortCode &&
        !metadata.shortAliases.includes(previous.metadata.shortCode)
      )
        metadata.shortAliases.push(previous.metadata.shortCode);
      mediaMetadataSchema.parse(metadata);
      const model = await this.store.read(),
        library = librarySchema.parse({
          ...model.library,
          mediaDetails: { ...model.library.mediaDetails, [previous.url]: metadata },
        });
      mediaLinkMap(
        (await this.list()).map((file) => file.url),
        library,
      );
      const raw = await fs.readFile(path.join(this.store.content, 'library.json'), 'utf8');
      if (digest(raw) !== revision)
        throw new ConflictError(
          'Media settings changed. Reload metadata before saving; your draft is preserved.',
        );
      await commitFiles(this.store.root, await this.store.prepareLibraryChange(raw, library));
      return this.metadata(previous.url);
    });
  }
  async details(
    input: string,
    context?: { files: MediaAsset[]; model: Repository },
  ): Promise<StudioImageDetails> {
    const url = canonicalMediaUrl(input);
    const file = (context?.files || (await this.list())).find((item) => item.url === url);
    if (!file || !imageFile(file.name)) throw new Error('Image not found.');
    const bytes = await fs.readFile(
      await contained(path.join(this.store.content, 'media'), file.name),
    );
    const source = file.sourceId ? (await this.source(file.sourceId)).bytes : bytes;
    const model = context?.model || (await this.store.read());
    return {
      name: file.name,
      displayName: file.displayName,
      downloadName: file.downloadName,
      shortUrl: '/m/' + file.shortCode,
      url,
      bytes: file.bytes,
      width: file.width,
      height: file.height,
      format: path.extname(file.name).slice(1).toUpperCase(),
      camera: await cameraInformation(source),
      publishCameraExif: model.library.mediaDetails[url]?.publishCameraExif || false,
      libraryRevision: model.libraryRevision,
    };
  }
  async upload(file: File, transform: unknown = {}): Promise<MediaAsset> {
    if (file.size > 20 * 1024 * 1024) throw new Error('Files must be smaller than 20 MiB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    if (attachmentFile(file.name)) {
      const extension = attachmentExtension(file.name);
      const ascii = (at: number, length: number) =>
        bytes.subarray(at, at + length).toString('ascii');
      const valid =
        extension === '.pdf'
          ? ascii(0, 5) === '%PDF-'
          : ['.mp4', '.m4v', '.m4a'].includes(extension)
            ? ascii(4, 4) === 'ftyp'
            : extension === '.mov'
              ? ['ftyp', 'moov', 'mdat', 'wide'].includes(ascii(4, 4))
              : extension === '.mp3'
                ? ascii(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224)
                : extension === '.aac'
                  ? bytes[0] === 255 && (bytes[1] & 240) === 240
                  : extension === '.wav'
                    ? ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE'
                    : extension === '.ogg'
                      ? ascii(0, 4) === 'OggS'
                      : extension === '.flac'
                        ? ascii(0, 4) === 'fLaC'
                        : extension === '.webm'
                          ? bytes.subarray(0, 4).toString('hex') === '1a45dfa3'
                          : ['.zip', '.docx', '.xlsx', '.pptx', '.epub'].includes(extension)
                            ? ascii(0, 2) === 'PK'
                            : !bytes.includes(0);
      if (!bytes.length || !valid)
        throw new Error('The file contents do not match its extension. Choose the original file.');
      return this.store.exclusive(async () => {
        const title =
          path
            .basename(file.name, path.extname(file.name))
            .normalize('NFKC')
            .replace(/[^\p{L}\p{N}_-]+/gu, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'attachment';
        const name = `${title}-${randomUUID()}${extension}`;
        await atomicWrite(path.join(this.store.content, 'media', name), bytes);
        return {
          name,
          url: `/media/${name}`,
          bytes: bytes.length,
          modifiedAt: new Date().toISOString(),
          canEdit: false,
        };
      });
    }
    return this.process(bytes, file.name, transform);
  }
  async variant(id: string, transform: unknown) {
    const { record, bytes } = await this.source(id);
    return this.process(bytes, record.name, transform, id);
  }
  private async process(bytes: Buffer, filename: string, input: unknown, existingId?: string) {
    const transform = transformSchema.parse(input),
      metadata = await read(bytes).metadata();
    if (!['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heif'].includes(metadata.format || ''))
      throw new Error('Unsupported image format.');
    const animated = (metadata.pages || 1) > 1;
    const w = metadata.autoOrient.width,
      h = metadata.autoOrient.height;
    if (
      transform.crop &&
      (animated ||
        transform.crop.x + transform.crop.width > w ||
        transform.crop.y + transform.crop.height > h)
    )
      throw new Error(
        animated
          ? 'Animated images support resizing without cropping.'
          : 'Crop must stay within the oriented original image.',
      );
    let image = read(bytes, animated).autoOrient();
    if (transform.crop)
      image = image.extract({
        left: transform.crop.x,
        top: transform.crop.y,
        width: transform.crop.width,
        height: transform.crop.height,
      });
    const size = transform.resize || { width: 2400, height: 2400 };
    const { data, info } = await image
      .resize({ ...size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    return this.store.exclusive(async () => {
      const sourceId = existingId || randomUUID();
      const folder = this.folder(sourceId);
      const record = existingId
        ? (await this.source(existingId)).record
        : { sourceId, name: filename.slice(0, 300), sha256: digest(bytes), variants: [] };
      const stem =
        filename
          .replace(/\.[^.]*$/, '')
          .replace(/[^a-z0-9-]/gi, '-')
          .slice(0, 50) || 'image';
      const name = `${stem}-${randomUUID()}.webp`,
        target = path.join(this.store.content, 'media', name);
      try {
        if (!existingId) await atomicWrite(path.join(folder, 'original'), bytes);
        await atomicWrite(target, data);
        const height = animated ? info.height / (metadata.pages || 1) : info.height;
        record.variants.push({ name, width: info.width, height, transform });
        await atomicWrite(path.join(folder, 'record.json'), JSON.stringify(record));
        return {
          name,
          url: `/media/${name}`,
          bytes: data.length,
          modifiedAt: new Date().toISOString(),
          width: info.width,
          height,
          sourceId,
          canEdit: true,
        };
      } catch (error) {
        await fs.rm(target, { force: true });
        if (!existingId) await fs.rm(folder, { recursive: true, force: true });
        throw error;
      }
    });
  }
}
