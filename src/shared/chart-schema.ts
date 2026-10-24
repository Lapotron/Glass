import { z } from 'zod';

export const chartStyles = [
  'line',
  'area',
  'bar',
  'scatter',
  'bubble',
  'pie',
  'doughnut',
  'radar',
  'mixed',
  'heatmap',
  'treemap',
  'sunburst',
  'sankey',
] as const;
const number = z.number().finite();
const format = z.object({
  precision: z.number().int().min(0).max(10).default(2),
  compact: z.boolean().default(false),
  prefix: z.string().max(24).default(''),
  suffix: z.string().max(24).default(''),
});
const axis = z
  .object({
    type: z.enum(['category', 'value', 'time', 'log']).optional(),
    title: z.string().max(100).default(''),
    min: number.optional(),
    max: number.optional(),
  })
  .refine(
    (a) => a.min === undefined || a.max === undefined || a.max > a.min,
    'Axis maximum must exceed minimum',
  )
  .refine(
    (a) => a.type !== 'log' || [a.min, a.max].every((value) => value === undefined || value > 0),
    'Logarithmic axis bounds must be positive',
  );
const point = z
  .object({
    x: z.union([number, z.string().max(80)]),
    y: number.nullable(),
    r: number.nonnegative().max(80).optional(),
    label: z.string().max(150).optional(),
    low: number.optional(),
    high: number.optional(),
  })
  .refine(
    (p) => p.low === undefined || p.high === undefined || p.low <= p.high,
    'Interval low must not exceed high',
  );
export type ChartTree = { name: string; value?: number; children?: ChartTree[] };
const tree: z.ZodType<ChartTree> = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(150),
    value: number.nonnegative().optional(),
    children: z.array(tree).max(1000).optional(),
  }),
);
export const chartSchema = z
  .object({
    type: z.literal('chart'),
    title: z.string().max(200).default('A different perspective'),
    style: z.enum(chartStyles).default('line'),
    labels: z.array(z.string().max(200)).max(5000).default([]),
    series: z
      .array(
        z.object({
          name: z.string().min(1).max(100),
          values: z.array(number.nullable()).max(5000).optional(),
          points: z.array(point).max(5000).optional(),
          style: z.enum(['line', 'area', 'bar', 'scatter']).optional(),
          axis: z.enum(['left', 'right']).default('left'),
          unit: z.string().max(24).default(''),
          dashed: z.boolean().default(false),
        }),
      )
      .max(12)
      .default([]),
    cells: z
      .array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), number]))
      .max(5000)
      .default([]),
    yLabels: z.array(z.string().max(200)).max(1000).default([]),
    tree: z.array(tree).max(1000).default([]),
    nodes: z
      .array(z.object({ id: z.string().min(1).max(100), label: z.string().max(150).optional() }))
      .max(500)
      .default([]),
    links: z
      .array(
        z.object({
          source: z.string().max(100),
          target: z.string().max(100),
          value: number.nonnegative(),
        }),
      )
      .max(2000)
      .default([]),
    horizontal: z.boolean().default(false),
    stacking: z.enum(['none', 'normal', 'percent']).default('none'),
    xAxis: axis.optional(),
    yAxis: axis.optional(),
    rightAxis: axis.optional(),
    format: format.default({ precision: 2, compact: false, prefix: '', suffix: '' }),
    tooltip: z.enum(['shared', 'item']).default('shared'),
    zoom: z.boolean().default(false),
    syncGroup: z
      .string()
      .regex(/^[a-zA-Z][\w-]{0,63}$/)
      .optional(),
    legend: z.boolean().default(true),
    colors: z
      .array(z.string().regex(/^#[a-fA-F0-9]{6}$/))
      .min(1)
      .max(12)
      .optional(),
    annotations: z
      .array(
        z.object({
          type: z.enum(['line', 'point', 'band']),
          axis: z.enum(['x', 'y']).default('y'),
          value: z.union([number, z.string().max(100)]),
          end: z.union([number, z.string().max(100)]).optional(),
          x: z.union([number, z.string().max(100)]).optional(),
          label: z.string().max(100).default(''),
        }),
      )
      .max(30)
      .default([]),
    caption: z
      .string()
      .max(2000)
      .default('Hover or focus to explore. The data table is always available.'),
  })
  .superRefine((c, ctx) => {
    const error = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: 'custom', message, path });
    if (['treemap', 'sunburst'].includes(c.style)) {
      if (!c.tree.length) error('This chart needs a tree.', ['tree']);
      let count = 0;
      const inspect = (nodes: ChartTree[], depth = 0) => {
        if (depth > 12) {
          error('Tree depth must not exceed 12.', ['tree']);
          return;
        }
        for (const n of nodes) {
          count++;
          if (!n.children?.length && n.value === undefined)
            error('Tree leaves need a value.', ['tree']);
          if (n.children) inspect(n.children, depth + 1);
        }
      };
      inspect(c.tree);
      if (count > 1000) error('A tree may have at most 1000 nodes.', ['tree']);
    } else if (c.style === 'sankey') {
      const ids = new Set(c.nodes.map((n) => n.id));
      if (!ids.size || !c.links.length || ids.size !== c.nodes.length)
        error('Sankey needs uniquely named nodes and links.', ['nodes']);
      const edges = new Map<string, string[]>();
      for (const l of c.links) {
        if (!ids.has(l.source) || !ids.has(l.target))
          error('Every link must refer to known nodes.', ['links']);
        edges.set(l.source, [...(edges.get(l.source) || []), l.target]);
      }
      const active = new Set<string>(),
        done = new Set<string>();
      const walk = (id: string): boolean => {
        if (active.has(id)) return false;
        if (done.has(id)) return true;
        active.add(id);
        for (const next of edges.get(id) || []) if (!walk(next)) return false;
        active.delete(id);
        done.add(id);
        return true;
      };
      if ([...ids].some((id) => !walk(id)))
        error('Sankey links must not contain a cycle.', ['links']);
    } else if (c.style === 'heatmap') {
      if (!c.labels.length || !c.yLabels.length || !c.cells.length)
        error('Heatmaps need labels, yLabels and cells.', ['cells']);
      if (c.cells.some(([x, y]) => x >= c.labels.length || y >= c.yLabels.length))
        error('Heatmap cell indices must match the label arrays.', ['cells']);
    } else {
      if (!c.series.length) error('A chart needs at least one series.', ['series']);
      if (c.series.some((s) => s.points?.length) && c.series.some((s) => s.values?.length))
        error('Use the same category or XY data shape for every series.', ['series']);
      c.series.forEach((s, i) => {
        if (s.points?.length) {
          if (['pie', 'doughnut', 'radar'].includes(c.style))
            error('This chart uses labels and values, not XY points.', ['series', i, 'points']);
          s.points.forEach((p, j) => {
            if (
              typeof p.x === 'string' &&
              (c.xAxis?.type !== 'time' ||
                !/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(p.x) ||
                !Number.isFinite(Date.parse(p.x)))
            )
              error('String X values require a time axis and ISO dates.', [
                'series',
                i,
                'points',
                j,
                'x',
              ]);
          });
        } else if (!s.values?.length || s.values.length !== c.labels.length)
          error('Each series must have one value per label.', ['series', i, 'values']);
        if (
          ['pie', 'doughnut', 'radar'].includes(c.style) &&
          s.values?.some((v) => v !== null && v < 0)
        )
          error('This chart requires nonnegative values.', ['series', i]);
        const y = s.axis === 'right' ? c.rightAxis : c.yAxis;
        if (
          y?.type === 'log' &&
          [...(s.values || []), ...(s.points || []).flatMap((p) => [p.y, p.low, p.high])].some(
            (v) => typeof v === 'number' && v <= 0,
          )
        )
          error('A logarithmic axis requires positive values.', ['series', i]);
        if (c.xAxis?.type === 'log' && s.points?.some((p) => typeof p.x !== 'number' || p.x <= 0))
          error('A logarithmic X axis requires positive numeric X values.', ['series', i]);
      });
      if (['pie', 'doughnut'].includes(c.style) && c.series.length !== 1)
        error('Pie and doughnut charts use exactly one series.', ['series']);
      if (c.style === 'radar' && c.labels.length < 3)
        error('Radar charts need at least three labels.', ['labels']);
      if (
        c.stacking !== 'none' &&
        (!['line', 'area', 'bar', 'mixed'].includes(c.style) ||
          c.series.some((s) => s.points?.length || s.axis === 'right'))
      )
        error('Stacking requires categorical series on one axis.', ['stacking']);
      if (
        c.stacking === 'percent' &&
        c.series.some((s) => s.values?.some((v) => v !== null && v < 0))
      )
        error('Percentage stacks require nonnegative values.', ['stacking']);
      if (c.series.reduce((n, s) => n + (s.values?.length || s.points?.length || 0), 0) > 20000)
        error('Charts are limited to 20,000 total points.', ['series']);
    }
    if (new Set(c.series.map((s) => s.name)).size !== c.series.length)
      error('Series names must be unique.', ['series']);
    if (
      (c.yAxis?.type && !['value', 'log'].includes(c.yAxis.type)) ||
      (c.rightAxis?.type && !['value', 'log'].includes(c.rightAxis.type))
    )
      error('Y axes support value and log scales.', ['yAxis']);
    if (c.series.some((s) => s.points?.length) && c.xAxis?.type === 'category')
      error('XY points need a value, time or logarithmic X axis.', ['xAxis']);
    if (c.series.some((s) => s.values?.length) && c.xAxis?.type && c.xAxis.type !== 'category')
      error('Use XY points for numeric, time or logarithmic X axes.', ['xAxis']);
    if (c.horizontal && c.series.some((s) => s.axis === 'right'))
      error('Horizontal charts use one value axis.', ['horizontal']);
    if (c.annotations.some((a) => a.type === 'band' && a.end === undefined))
      error('Reference bands need an end value.', ['annotations']);
  });
export type ChartConfig = z.infer<typeof chartSchema>;
