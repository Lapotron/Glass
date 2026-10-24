/** Rendered-text coordinates, shared by the reader and the public annotation index. */
export type LineReference = { key: string; start: number; end: number };
export const lineFragment = ({ key, start, end }: LineReference) => `line-${key}-${start}-${end}`;
export function parseLineFragment(hash: string): LineReference | null {
  const match = /^#?line-([a-f\d]{20}-[1-9]\d{0,4})-(\d{1,7})-(\d{1,7})$/.exec(hash);
  if (!match) return null;
  const start = Number(match[2]),
    end = Number(match[3]);
  return end > start && end - start <= 2000 ? { key: match[1], start, end } : null;
}
