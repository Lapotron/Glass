/** Immediate browser inspection. Prepared variants upload directly; production rendering stays in Node. */
export async function inspectCloudImage(route: string, options: RequestInit) {
  options.signal?.throwIfAborted();
  let blob: Blob;
  if (options.body instanceof FormData) {
    const file = options.body.get('file');
    if (!(file instanceof File)) throw new Error('Choose an image.');
    blob = file;
  } else {
    const response = await fetch('/api/' + route.replace(/\/inspect$/, '/source'), {
      signal: options.signal,
    });
    if (!response.ok) throw new Error('The private original could not be loaded.');
    blob = await response.blob();
  }
  if (blob.size > 20 * 1024 * 1024) throw new Error('Files must be smaller than 20 MiB.');
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    options.signal?.throwIfAborted();
    const width = bitmap.width,
      height = bitmap.height;
    if (width * height > 40000000)
      throw new Error('This image exceeds the 40 megapixel preparation limit.');
    const sample = new Uint8Array(await blob.slice(0, 65536).arrayBuffer()),
      text = new TextDecoder('latin1').decode(sample);
    const animated = /ANIM|acTL|avis/.test(text) || text.startsWith('GIF');
    const scale = Math.min(1, 1200 / width, 900 / height),
      canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image preparation is unavailable in this browser.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { width, height, animated, preview: canvas.toDataURL('image/webp', 0.8) };
  } finally {
    bitmap.close();
  }
}
