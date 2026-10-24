import { parseMarkdown } from './markdown-analysis.js';
import { escapeTableCell } from './tabular-data.js';
export const tableActions = {
  insert: 'Insert table',
  paste: 'Paste CSV / TSV table',
  row: 'Add row below',
  column: 'Add column after',
  'delete-row': 'Remove row',
  'delete-column': 'Remove column',
  left: 'Align left',
  center: 'Align center',
  right: 'Align right',
  format: 'Format table',
} as const;
export type SourceTable = {
  rows: string[][];
  align: ('left' | 'center' | 'right' | null)[];
  cells: { from: number; to: number }[][];
};
export function parseSourceTable(source: string): SourceTable {
  const tree: any = parseMarkdown(source),
    node = tree.children.find((n: any) => n.type === 'table');
  if (!node || tree.children.length !== 1) throw new Error('Select a complete Markdown table.');
  const columns = node.children[0].children.length;
  if (columns > 50 || node.children.length > 5001)
    throw new Error('Table editing supports up to 5,000 data rows and 50 columns.');
  const rows = node.children.map((row: any) =>
    Array.from({ length: columns }, (_, index) => {
      const cell = row.children[index];
      if (!cell) return '';
      let raw = source.slice(cell.position.start.offset, cell.position.end.offset).trim();
      if (raw.startsWith('|')) raw = raw.slice(1);
      if (raw.endsWith('|')) {
        let escapes = 0;
        for (let at = raw.length - 2; at >= 0 && raw[at] === '\\'; at--) escapes++;
        if (!(escapes % 2)) raw = raw.slice(0, -1);
      }
      return raw.trim();
    }),
  );
  return {
    rows,
    align: node.align,
    cells: node.children.map((row: any) =>
      row.children.map((cell: any) => ({
        from: cell.position.start.offset,
        to: cell.position.end.offset,
      })),
    ),
  };
}
export function writeSourceTable(table: Pick<SourceTable, 'rows' | 'align'>): string {
  if (
    !table.rows.length ||
    !table.rows[0].length ||
    table.rows.length > 5001 ||
    table.rows[0].length > 50
  )
    throw new Error('Use at least one column, at most 50 columns and 5,000 data rows.');
  const count = table.rows[0].length;
  const rows = table.rows.map((row) =>
    Array.from({ length: count }, (_, i) => escapeTableCell(row[i] || '')),
  );
  const rules = table.align
    .slice(0, count)
    .map((value) =>
      value === 'left' ? ':---' : value === 'right' ? '---:' : value === 'center' ? ':---:' : '---',
    );
  while (rules.length < count) rules.push('---');
  rows.splice(1, 0, rules);
  const widths = rows[0].map((_, i) => Math.max(3, ...rows.map((row) => (row[i] || '').length)));
  return rows
    .map((row) => '| ' + widths.map((width, i) => row[i].padEnd(width)).join(' | ') + ' |')
    .join('\n');
}
export function changeSourceTable(
  table: SourceTable,
  action: string,
  row: number,
  column: number,
): SourceTable {
  const next = { rows: table.rows.map((r) => [...r]), align: [...table.align], cells: [] };
  const r = Math.max(0, Math.min(row, next.rows.length - 1)),
    c = Math.max(0, Math.min(column, next.rows[0].length - 1));
  if (action === 'row')
    next.rows.splice(
      r + 1,
      0,
      next.rows[0].map(() => ''),
    );
  else if (action === 'column') {
    next.rows.forEach((values) => values.splice(c + 1, 0, ''));
    next.align.splice(c + 1, 0, null);
  } else if (action === 'delete-row') {
    if (!r) throw new Error('The header row cannot be removed.');
    next.rows.splice(r, 1);
  } else if (action === 'delete-column') {
    if (next.rows[0].length < 2) throw new Error('Keep at least one table column.');
    next.rows.forEach((values) => values.splice(c, 1));
    next.align.splice(c, 1);
  } else if (['left', 'center', 'right'].includes(action))
    next.align[c] = action as 'left' | 'center' | 'right';
  writeSourceTable(next);
  return next;
}
export function tableDelimited(table: Pick<SourceTable, 'rows'>, delimiter: ',' | '\t') {
  return table.rows
    .map((row) =>
      row
        .map((cell) => (/["\r\n,\t]/.test(cell) ? '"' + cell.replaceAll('"', '""') + '"' : cell))
        .join(delimiter),
    )
    .join('\n');
}
