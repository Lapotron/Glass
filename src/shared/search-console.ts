export type SearchRow = {
  label: string;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
};
export type SearchDataset = {
  id: string;
  name: string;
  property: string;
  dimension: string;
  from: string;
  to: string;
  timezone: 'America/Los_Angeles';
  importedAt: string;
  revision: string;
  partial: boolean;
  rows: SearchRow[];
};
export type SearchImportReview = {
  id: string;
  dataset: SearchDataset;
  replaces: boolean;
  expiresAt: string;
};
/** RFC 4180 fields, including quoted line breaks. Deliberately bounded before parsing. */
export function parseCsv(source: string, options: { preserveEmptyRows?: boolean; maxFieldLength?: number } = {}): string[][] {
  if (source.length > 2000000) throw new Error('CSV is too large. Export a smaller report.');
  source = source.replace(/^\uFEFF/, '');
  const result: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    afterQuote = false;
  const finish = () => {
    row.push(cell);
    if (row.some((v) => v.trim()) || options.preserveEmptyRows && (row.length > 1 || afterQuote || row.some((value) => value.length))) result.push(row);
    row = [];
    cell = '';
    afterQuote = false;
    if (result.length > 10001) throw new Error('CSV supports at most 10,000 data rows.');
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else cell += c;
    } else if (c === '"' && !cell && !afterQuote) quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
      afterQuote = false;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      finish();
    } else if (afterQuote) {
      if (!/\s/.test(c)) throw new Error('Unexpected content after a quoted CSV field.');
    } else cell += c;
    if (cell.length > (options.maxFieldLength || 10000) || row.length > 100)
      throw new Error('CSV fields exceed their supported bounds.');
  }
  if (quoted) throw new Error('CSV has an unclosed quote.');
  if (cell || row.length || afterQuote) finish();
  return result;
}
const headers: Record<string, string> = {
  date: 'date',
  日期: 'date',
  'top queries': 'query',
  query: 'query',
  熱門查詢: 'query',
  热门查询: 'query',
  最多查詢: 'query',
  'top pages': 'page',
  page: 'page',
  熱門網頁: 'page',
  热门网页: 'page',
  網頁: 'page',
  网页: 'page',
  country: 'country',
  '國家/地區': 'country',
  '国家/地区': 'country',
  device: 'device',
  裝置: 'device',
  设备: 'device',
  'search appearance': 'appearance',
  搜尋外觀: 'appearance',
  搜索外观: 'appearance',
  clicks: 'clicks',
  點擊次數: 'clicks',
  点击次数: 'clicks',
  impressions: 'impressions',
  曝光次數: 'impressions',
  展示次数: 'impressions',
  ctr: 'ctr',
  點閱率: 'ctr',
  点击率: 'ctr',
  position: 'position',
  'average position': 'position',
  平均排名: 'position',
  排名: 'position',
};
export function searchRows(source: string) {
  const table = parseCsv(source);
  if (table.length < 2) throw new Error('CSV contains no report rows.');
  const keys = table[0].map((h) => headers[h.toLowerCase().trim()] || '');
  const dimension = keys.find((k) =>
    ['date', 'query', 'page', 'country', 'device', 'appearance'].includes(k),
  );
  if (!dimension || !keys.includes('clicks') || !keys.includes('impressions'))
    throw new Error(
      'Use a Search Console performance CSV with a dimension, Clicks and Impressions columns.',
    );
  const number = (value: string | undefined, count = false): number | null => {
    if (!value || /^[~—–-]$/.test(value.trim())) return null;
    const n = Number(value.replace(/[,%\s]/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 1e12 || (count && !Number.isInteger(n)))
      throw new Error('CSV contains an invalid metric.');
    return n;
  };
  const rows: SearchRow[] = table.slice(1).map((cells) => {
    if (cells.length !== keys.length) throw new Error('CSV row width does not match its header.');
    const label = cells[keys.indexOf(dimension)].trim();
    if (!label || label.length > 2000)
      throw new Error('CSV dimension value is missing or too long.');
    const clicks = number(cells[keys.indexOf('clicks')], true),
      impressions = number(cells[keys.indexOf('impressions')], true),
      position = number(cells[keys.indexOf('position')]);
    return {
      label,
      clicks,
      impressions,
      position,
      ctr: clicks !== null && impressions ? (clicks / impressions) * 100 : null,
    };
  });
  if (new Set(rows.map((r) => r.label)).size !== rows.length)
    throw new Error('CSV repeats a dimension row. Import one exported table at a time.');
  return { dimension, rows };
}
