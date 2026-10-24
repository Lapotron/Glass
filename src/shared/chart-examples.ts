import { chartSchema, type ChartConfig } from './chart-schema.js';
export function chartExample(style: ChartConfig['style']): ChartConfig {
  const base: Record<string, unknown> = {
    type: 'chart',
    style,
    title: `${style[0].toUpperCase() + style.slice(1)} · a small experiment`,
    labels: ['Observe', 'Try', 'Reflect', 'Refine'],
    series: [
      { name: 'Study', values: [12, 21, 17, 32] },
      { name: 'Practice', values: [8, 16, 22, 26] },
    ],
  };
  if (['pie', 'doughnut'].includes(style))
    base.series = [{ name: 'Time', values: [12, 21, 17, 32] }];
  if (style === 'mixed')
    base.series = [
      { name: 'Practice', style: 'bar', values: [8, 16, 22, 26] },
      { name: 'Progress', style: 'line', values: [12, 21, 17, 32] },
    ];
  if (['scatter', 'bubble'].includes(style)) {
    base.labels = [];
    base.series = [
      {
        name: 'Observations',
        points: [
          { x: 1, y: 2, r: 6, low: 1.5, high: 2.5 },
          { x: 2, y: 4, r: 12, low: 3, high: 5 },
          { x: 3, y: 3, r: 9, low: 2.5, high: 3.5 },
        ],
      },
    ];
  }
  if (style === 'heatmap') {
    base.series = [];
    base.labels = ['Mon', 'Tue', 'Wed'];
    base.yLabels = ['Read', 'Make'];
    base.cells = [
      [0, 0, 3],
      [1, 0, 7],
      [2, 0, 4],
      [0, 1, 8],
      [1, 1, 2],
      [2, 1, 6],
    ];
  }
  if (['treemap', 'sunburst'].includes(style)) {
    base.series = [];
    base.labels = [];
    base.tree = [
      {
        name: 'Learning',
        children: [
          {
            name: 'Theory',
            children: [
              { name: 'Reading', value: 12 },
              { name: 'Notes', value: 8 },
            ],
          },
          {
            name: 'Practice',
            children: [
              { name: 'Experiments', value: 18 },
              { name: 'Review', value: 10 },
            ],
          },
        ],
      },
    ];
  }
  if (style === 'sankey') {
    base.series = [];
    base.labels = [];
    base.nodes = [
      { id: 'Reading' },
      { id: 'Experiment' },
      { id: 'Notes' },
      { id: 'Understanding' },
    ];
    base.links = [
      { source: 'Reading', target: 'Notes', value: 6 },
      { source: 'Reading', target: 'Experiment', value: 4 },
      { source: 'Notes', target: 'Understanding', value: 6 },
      { source: 'Experiment', target: 'Understanding', value: 4 },
    ];
  }
  return chartSchema.parse(base);
}
