/** CSV/TSV without dependencies; quoted cells, embedded newlines and escaped quotes are preserved. */
export function readDelimited(source: string): string[][] {
  if (source.length > 2_000_000) throw new Error('Use a data file smaller than 2 MB.');
  const text = source.replace(/^\uFEFF/, '');
  const delimiter = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && (quoted || !cell)) {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('The data has an unclosed quoted cell.');
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  if (!rows.length || rows.length > 5001 || rows.some((r) => r.length > 50))
    throw new Error('Use 1–5,000 data rows and at most 50 columns.');
  if (rows.some((r) => r.length !== rows[0].length))
    throw new Error('Every row needs the same number of columns.');
  return rows;
}
export const escapeTableCell = (value: string) =>
  value
    .replace(/(\\*)\|/g, (match, slashes: string) => (slashes.length % 2 ? match : slashes + '\\|'))
    .replace(/\r?\n/g, '<br>');
export function markdownTable(rows: string[][]) {
  if (!rows.length) return '';
  return [rows[0], rows[0].map(() => '---'), ...rows.slice(1)]
    .map((r) => '| ' + r.map(escapeTableCell).join(' | ') + ' |')
    .join('\n');
}
export function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((s) => s.trim());
}
