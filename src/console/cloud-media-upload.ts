import { api, type ApiOptions } from './api.js';
import { attachmentFile } from '../shared/attachments.js';
import { imageTransformSchema } from '../shared/media-upload.js';
import { BACKUP_CHUNK_BYTES, type BackupUpload } from '../shared/backup-transfer.js';
const digest = async (value: Blob) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await value.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
async function largeDigest(
  file: Blob,
  signal?: AbortSignal | null,
  onProgress?: (bytes: number) => void,
) {
  if (file.size <= 20 * 1024 ** 2) return digest(file);
  const worker = new Worker(new URL('./cloud-backup.worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise<string>((resolve, reject) => {
    const close = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      close();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    worker.onmessage = (event) => {
      if (event.data.type === 'progress') onProgress?.(event.data.bytes);
      if (event.data.type === 'hash') {
        close();
        resolve(event.data.sha);
      }
      if (event.data.type === 'error') {
        close();
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      close();
      reject(new Error(event.message));
    };
    worker.postMessage({ action: 'hash', file });
  });
}
export async function uploadCloudMedia(route: string, options: ApiOptions) {
  options.onCloudProgress?.({ id: 'local', state: 'preparing' });
  const sourceId = /^media\/([a-f0-9-]+)\/variants$/.exec(route)?.[1];
  let original: File | Blob,
    filename: string,
    transform: ReturnType<typeof imageTransformSchema.parse>;
  if (sourceId) {
    const response = await fetch('/api/media/' + sourceId + '/source', { signal: options.signal });
    if (!response.ok) throw new Error('The private original could not be loaded.');
    original = await response.blob();
    filename = 'image';
    transform = imageTransformSchema.parse(JSON.parse(String(options.body)).transform);
  } else {
    const form = options.body as FormData,
      file = form.get('file');
    if (!(file instanceof File)) throw new Error('Choose a file.');
    original = file;
    filename = file.name;
    transform = imageTransformSchema.parse(JSON.parse(String(form.get('transform') || '{}')));
  }
  const attachment = attachmentFile(filename);
  if (original.size > (attachment ? 4 * 1024 ** 3 : 20 * 1024 ** 2))
    throw new Error(
      attachment
        ? 'Attachments support up to 4 GiB, subject to available transfer storage.'
        : 'Images must be smaller than 20 MiB.',
    );
  options.signal?.throwIfAborted();
  let output: Blob = original,
    width: number | undefined,
    height: number | undefined;
  if (!attachment) {
    const sample = new TextDecoder('latin1').decode(await original.slice(0, 65536).arrayBuffer());
    if (/ANIM|acTL|avis/.test(sample) || sample.startsWith('GIF'))
      throw new Error(
        'Animated image preparation is not supported in hosted Studio yet. Upload a still frame or prepare it locally; no build was queued.',
      );
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(original, { imageOrientation: 'from-image' });
    } catch {
      throw new Error(
        'This browser cannot decode the image. Convert it to PNG, JPEG or WebP and try again.',
      );
    }
    try {
      if (bitmap.width * bitmap.height > 40000000)
        throw new Error('This image exceeds the 40 megapixel preparation limit.');
      const crop = transform.crop || { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
      if (crop.x + crop.width > bitmap.width || crop.y + crop.height > bitmap.height)
        throw new Error('Crop must stay within the oriented original image.');
      const size = transform.resize || { width: 2400, height: 2400 },
        scale = Math.min(1, size.width / crop.width, size.height / crop.height);
      width = Math.max(1, Math.round(crop.width * scale));
      height = Math.max(1, Math.round(crop.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image preparation is unavailable in this browser.');
      context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
      output = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob && ['image/webp', 'image/png'].includes(blob.type)
              ? resolve(blob)
              : reject(new Error('Image encoding is unavailable in this browser.')),
          'image/webp',
          0.88,
        ),
      );
    } finally {
      bitmap.close();
    }
  }
  const outputInfo = {
      bytes: output.size,
      sha: await largeDigest(output, options.signal, (bytes) =>
        options.onCloudProgress?.({
          id: 'local',
          state: 'checking',
          bytes,
          totalBytes: output.size,
        }),
      ),
    },
    originalInfo =
      !attachment && !sourceId ? { bytes: original.size, sha: await digest(original) } : undefined;
  const session = await api<{ id: string }>('media/uploads', {
    method: 'POST',
    body: JSON.stringify({
      filename,
      sourceId,
      original: originalInfo,
      output: outputInfo,
      format: output.type === 'image/png' ? 'png' : 'webp',
      width,
      height,
      transform,
    }),
    signal: options.signal,
  });
  let done = 0;
  const totalBytes = output.size + (originalInfo ? original.size : 0),
    report = (state = 'uploading') =>
      options.onCloudProgress?.({ id: session.id, state, bytes: done, totalBytes });
  report();
  for (const [role, blob] of [
    ...(originalInfo ? [['original', original] as const] : []),
    ['output', output] as const,
  ]) {
    const base = 'media/uploads/' + session.id,
      transfer = await api<BackupUpload & { reused?: boolean }>(base + '/transfer', {
        method: 'POST',
        body: JSON.stringify({ role }),
        signal: options.signal,
      });
    if (transfer.reused) {
      done += blob.size;
      report();
      continue;
    }
    const parts = new Map(transfer.parts.map((part) => [part.part, part]));
    for (let offset = 0, part = 1; offset < blob.size; offset += BACKUP_CHUNK_BYTES, part++) {
      options.signal?.throwIfAborted();
      const chunk = blob.slice(offset, offset + BACKUP_CHUNK_BYTES),
        sha = await digest(chunk);
      if (parts.has(part)) {
        if (parts.get(part)!.sha256 !== sha)
          throw new Error('The selected file differs from its uploaded parts.');
        done += chunk.size;
        report();
        continue;
      }
      await api(base + '/transfers/' + transfer.id + '/parts/' + part, {
        method: 'PUT',
        body: chunk,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Part-SHA256': sha },
        signal: options.signal,
      });
      done += chunk.size;
      report();
    }
    await api(base + '/transfers/' + transfer.id + '/complete', {
      method: 'POST',
      body: '{}',
      signal: options.signal,
    });
  }
  report('verifying');
  return api('media/uploads/' + session.id + '/commit', {
    method: 'POST',
    body: '{}',
    signal: options.signal,
  });
}
