/** Managed, non-image files share the notebook's portable /media/ namespace. */
export const attachmentTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.tex': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.epub': 'application/epub+zip',
};
export const imageFile = (name: string) =>
  /\.(png|jpe?g|webp|svg|avif|gif)$/i.test(name.split(/[?#]/)[0]);
export const attachmentExtension = (name: string) =>
  /\.[a-z\d]+$/i.exec(name.split(/[?#]/)[0])?.[0].toLowerCase() || '';
export const attachmentFile = (name: string) => !!attachmentTypes[attachmentExtension(name)];
export const attachmentAccept = Object.keys(attachmentTypes).join(',');
export function attachmentGroup(name: string) {
  const type = attachmentTypes[attachmentExtension(name)] || '';
  return type.startsWith('audio/')
    ? 'Audio'
    : type.startsWith('video/')
      ? 'Video'
      : name.toLowerCase().endsWith('.pdf')
        ? 'PDF'
        : /\.(zip|epub)$/i.test(name)
          ? 'Archive'
          : 'Document';
}
