import qrcode from 'qrcode-generator';
const cache = new Map<string, string>();
/** Build-time only. Reader devices receive a complete, self-contained SVG. */
export function articleQrSvg(canonical: string) {
  const cached = cache.get(canonical);
  if (cached) return cached;
  const code = qrcode(0, 'M');
  code.addData(canonical, 'Byte');
  code.make();
  const svg = code
    .createSvgTag({ cellSize: 4, margin: 16, scalable: true })
    .replace('<svg ', '<svg role="img" aria-label="QR code for this article" ');
  if (cache.size >= 1000) cache.clear();
  cache.set(canonical, svg);
  return svg;
}
