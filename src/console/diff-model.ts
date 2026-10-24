export type DiffMode = 'auto' | 'split' | 'inline' | 'accessible';
export type DiffOptions = {
  mode: DiffMode;
  wrap: boolean;
  ignoreWhitespace: boolean;
  showWhitespace: boolean;
  collapse: boolean;
  minimap: boolean;
};
export type DiffRegion = {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
};
export type DiffSummary = {
  state: 'loading' | 'ready' | 'unavailable';
  regions: DiffRegion[];
  active: number;
  added: number;
  removed: number;
  message?: string;
};
export const diffDefaults: DiffOptions = {
  mode: 'auto',
  wrap: true,
  ignoreWhitespace: false,
  showWhitespace: false,
  collapse: false,
  minimap: true,
};
export function summarizeDiff(regions: DiffRegion[], active = 0): DiffSummary {
  return {
    state: 'ready',
    regions,
    active,
    added: regions.reduce(
      (sum, r) =>
        sum +
        (r.modifiedEndLineNumber ? r.modifiedEndLineNumber - r.modifiedStartLineNumber + 1 : 0),
      0,
    ),
    removed: regions.reduce(
      (sum, r) =>
        sum +
        (r.originalEndLineNumber ? r.originalEndLineNumber - r.originalStartLineNumber + 1 : 0),
      0,
    ),
  };
}
/** A complete replacement hunk retains every whitespace and final-newline difference,
 * including differences hidden by the viewer's display preferences. */
export function markdownPatch(earlier: string, current: string) {
  const header = '--- a/document.md\n+++ b/document.md\n';
  if (earlier === current) return header;
  const lines = (text: string) =>
    text ? text.split('\n').slice(0, text.endsWith('\n') ? -1 : undefined) : [];
  const before = lines(earlier),
    after = lines(current);
  const side = (items: string[], text: string, sign: string) =>
    items
      .map(
        (line, i) =>
          `${sign}${line}\n${i === items.length - 1 && !text.endsWith('\n') ? '\\ No newline at end of file\n' : ''}`,
      )
      .join('');
  return (
    header +
    `@@ -${before.length ? 1 : 0},${before.length} +${after.length ? 1 : 0},${after.length} @@\n` +
    side(before, earlier, '-') +
    side(after, current, '+')
  );
}
export function downloadText(text: string, filename: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type })),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
