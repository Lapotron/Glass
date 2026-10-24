import type { ChartConfig, ChartTree } from './chart-schema.js';
export const chartPalette = {
  light: ['#3868cf', '#16816f', '#9258b4', '#af621f', '#307e9b', '#bd4770', '#687921'],
  dark: ['#8caaff', '#6fd4b9', '#d1a0ed', '#edb379', '#86cadf', '#f69bb9', '#bfd67f'],
};
export function formatChartValue(value: unknown, c: ChartConfig, unit = ''): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return String(value);
  return (
    c.format.prefix +
    new Intl.NumberFormat('en', {
      maximumFractionDigits: c.format.precision,
      notation: c.format.compact ? 'compact' : 'standard',
    }).format(value) +
    (unit || c.format.suffix)
  );
}
export function chartRows(c: ChartConfig): {
  headers: string[];
  rows: (string | number | null)[][];
} {
  if (c.style === 'sankey') {
    const names = new Map(c.nodes.map((n) => [n.id, n.label || n.id]));
    return {
      headers: ['Source', 'Target', 'Value'],
      rows: c.links.map((l) => [names.get(l.source)!, names.get(l.target)!, l.value]),
    };
  }
  if (c.style === 'heatmap')
    return {
      headers: ['X', 'Y', 'Value'],
      rows: c.cells.map(([x, y, v]) => [c.labels[x], c.yLabels[y], v]),
    };
  if (['treemap', 'sunburst'].includes(c.style)) {
    const rows: (string | number | null)[][] = [];
    const walk = (nodes: ChartTree[], path: string[]) => {
      for (const n of nodes) {
        const p = [...path, n.name];
        rows.push([p.join(' / '), n.value ?? null]);
        if (n.children) walk(n.children, p);
      }
    };
    walk(c.tree, []);
    return { headers: ['Path', 'Value'], rows };
  }
  if (c.series.some((s) => s.points?.length))
    return {
      headers: ['Series', 'Label', 'X', 'Y', 'Radius', 'Low', 'High'],
      rows: c.series.flatMap(
        (s) =>
          s.points?.map((p) => [
            s.name,
            p.label || '',
            p.x,
            p.y,
            p.r ?? null,
            p.low ?? null,
            p.high ?? null,
          ]) || [],
      ),
    };
  return {
    headers: ['Label', ...c.series.map((s) => s.name + (s.unit ? ` (${s.unit})` : ''))],
    rows: c.labels.map((l, i) => [l, ...c.series.map((s) => s.values?.[i] ?? null)]),
  };
}
export function chartCsv(c: ChartConfig) {
  const { headers, rows } = chartRows(c);
  const cell = (v: string | number | null) => {
    const s =
      v === null ? '' : typeof v === 'number' ? String(v) : /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export function chartPointLabel(c: ChartConfig, series: number, index: number) {
  const s = c.series[series];
  if (s?.points?.[index]) {
    const p = s.points[index];
    return `${s.name} · ${p.label || p.x}: ${formatChartValue(p.y, c, s.unit)}${p.low !== undefined && p.high !== undefined ? ` [${p.low}, ${p.high}]` : ''}`;
  }
  if (s) return `${s.name} · ${c.labels[index]}: ${formatChartValue(s.values?.[index], c, s.unit)}`;
  const { headers, rows } = chartRows(c);
  return rows[index]?.map((v, i) => `${headers[i]}: ${v ?? '—'}`).join(' · ') || c.title;
}
