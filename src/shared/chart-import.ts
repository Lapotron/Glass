import type { ChartConfig, ChartTree } from './chart-schema.js';
import { readDelimited } from './tabular-data.js';
export function importChartData(source: string, style: ChartConfig['style']): Partial<ChartConfig> {
  const [headers, ...rows] = readDelimited(source);
  if (!rows.length) throw new Error('Include a header and at least one data row.');
  const num = (value: string, nullable = false): number | null => {
    if (!value.trim() && nullable) return null;
    const n = Number(value);
    if (!value.trim() || !Number.isFinite(n))
      throw new Error(`Expected a finite number, received “${value}”.`);
    return n;
  };
  if (style === 'sankey') {
    if (headers.length !== 3) throw new Error('Sankey columns: source, target, value.');
    return {
      nodes: [...new Set(rows.flatMap((r) => [r[0], r[1]]))].map((id) => ({ id })),
      links: rows.map(([source, target, value]) => ({ source, target, value: num(value)! })),
    };
  }
  if (style === 'heatmap') {
    if (headers.length !== 3) throw new Error('Heatmap columns: x, y, value.');
    const labels = [...new Set(rows.map((r) => r[0]))],
      yLabels = [...new Set(rows.map((r) => r[1]))];
    return {
      labels,
      yLabels,
      cells: rows.map(([x, y, value]) => [labels.indexOf(x), yLabels.indexOf(y), num(value)!]),
    };
  }
  if (['treemap', 'sunburst'].includes(style)) {
    if (headers.length !== 2)
      throw new Error('Hierarchy columns: path, value. Separate path levels with /.');
    const tree: ChartTree[] = [];
    for (const [path, value] of rows) {
      let branch = tree;
      const parts = path
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length) throw new Error('Hierarchy paths must contain a name.');
      parts.forEach((name, i) => {
        let node = branch.find((n) => n.name === name);
        if (!node) {
          node = { name };
          branch.push(node);
        }
        if (i === parts.length - 1) node.value = num(value)!;
        else {
          node.children ||= [];
          branch = node.children;
        }
      });
    }
    return { tree };
  }
  if (['scatter', 'bubble'].includes(style)) {
    const keys = headers.map((h) => h.toLowerCase().trim());
    const xi = keys.indexOf('x'),
      yi = keys.indexOf('y');
    if (xi < 0 || yi < 0)
      throw new Error(
        'XY charts need x and y headers; r, low, high, label and series are optional.',
      );
    const groups = new Map<string, NonNullable<ChartConfig['series'][number]['points']>>();
    for (const row of rows) {
      const name = row[keys.indexOf('series')] || 'Observations',
        points = groups.get(name) || [];
      const x = row[xi];
      const p: NonNullable<ChartConfig['series'][number]['points']>[number] = {
        x: Number.isFinite(Number(x)) && x.trim() ? Number(x) : x,
        y: num(row[yi], true),
      };
      for (const k of ['r', 'low', 'high'] as const)
        if (keys.includes(k) && row[keys.indexOf(k)].trim()) p[k] = num(row[keys.indexOf(k)])!;
      if (keys.includes('label')) p.label = row[keys.indexOf('label')];
      points.push(p);
      groups.set(name, points);
    }
    const time = [...groups.values()].flat().some((p) => typeof p.x === 'string');
    return {
      labels: [],
      series: [...groups].map(([name, points]) => ({
        name,
        points,
        axis: 'left',
        unit: '',
        dashed: false,
      })),
      ...(time ? { xAxis: { type: 'time', title: '' } } : {}),
    };
  }
  if (headers.length < 2)
    throw new Error('Use a label column followed by one or more numeric series.');
  return {
    labels: rows.map((r) => r[0]),
    series: headers.slice(1).map((name, i) => ({
      name,
      values: rows.map((r) => num(r[i + 1], true)),
      axis: 'left',
      unit: '',
      dashed: false,
    })),
  };
}
