export const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
export const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
export const headingSlug = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-') || 'section';
export const responsiveWidths = (width: number) =>
  [
    ...new Set([480, 960, 1600, Math.min(width, 1600)].filter((candidate) => candidate <= width)),
  ].sort((a, b) => a - b);
export const imageSet = (src: string, width?: number) =>
  /\.(png|jpe?g|webp|avif)$/i.test(src) && src.startsWith('/media/')
    ? (width ? responsiveWidths(width) : [480, 960, 1600])
        .map((w) => `${src.replace(/\.[^.]+$/, '')}-${w}.webp ${w}w`)
        .join(', ')
    : undefined;
