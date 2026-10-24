import type { ChartConfig } from './chart-schema.js';
import { chartPalette, formatChartValue, chartPointLabel } from './chart-data.js';
import { escapeHtml } from './utils.js';

export const cartesianChart = (c: ChartConfig) =>
  ['line', 'area', 'bar', 'mixed', 'scatter', 'bubble'].includes(c.style);
export function chartLegend(c: ChartConfig): string[] {
  return ['pie', 'doughnut'].includes(c.style) ? c.labels : c.series.map((s) => s.name);
}
/** A data-only authoring contract is mapped to trusted library options here. No author callbacks. */
export function chartOptions(
  c: ChartConfig,
  theme: 'light' | 'dark',
  interactive = false,
  fontScale = 1,
): any {
  const ink = theme === 'dark' ? '#e3e9f3' : '#23354c';
  const muted = theme === 'dark' ? '#adbed4' : '#526880';
  const grid = theme === 'dark' ? '#a5b8d424' : '#26496920';
  const palette = c.colors || chartPalette[theme];
  const options: any = {
    animation: false,
    useUTC: true,
    color: palette,
    backgroundColor: 'transparent',
    textStyle: {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: ink,
      fontSize: 13 * fontScale,
    },
    aria: {
      enabled: true,
      label: { description: c.title + '. Use the accompanying data table for exact values.' },
      decal: { show: true },
    },
    legend: { show: false, data: chartLegend(c) },
    tooltip: {
      show: interactive,
      trigger:
        cartesianChart(c) && c.tooltip === 'shared' && !['scatter', 'bubble'].includes(c.style)
          ? 'axis'
          : 'item',
      confine: true,
      className: 'chart-tooltip',
      borderWidth: 0,
      padding: 0,
      backgroundColor: 'transparent',
      textStyle: { color: ink },
      axisPointer: {
        type: c.style === 'bar' ? 'shadow' : 'cross',
        lineStyle: { color: muted, type: 'dashed' },
        label: { backgroundColor: theme === 'dark' ? '#26364d' : '#e6edf6', color: ink },
      },
      formatter: (params: any) => {
        const rows = (Array.isArray(params) ? params : [params]).filter(
          (p: any) => !String(p.seriesId).startsWith('interval-'),
        );
        return `<div class="chart-tooltip-body">${rows
          .map((p: any) => {
            const match = /^series-(\d+)$/.exec(String(p.seriesId));
            let label = match
              ? chartPointLabel(c, Number(match[1]), p.dataIndex)
              : `${p.name || c.title}: ${formatChartValue(Array.isArray(p.value) ? p.value.at(-1) : p.value, c)}`;
            if (c.style === 'heatmap')
              label = `${c.labels[p.value[0]]} · ${c.yLabels[p.value[1]]}: ${formatChartValue(p.value[2], c)}`;
            if (c.style === 'sankey') {
              const names = new Map(c.nodes.map((n) => [n.id, n.label || n.id]));
              label =
                p.dataType === 'edge'
                  ? `${names.get(p.data.source)} → ${names.get(p.data.target)}: ${formatChartValue(p.value, c)}`
                  : `${names.get(p.name) || p.name}: ${formatChartValue(p.value, c)}`;
            }
            if (['pie', 'doughnut'].includes(c.style) && typeof p.percent === 'number')
              label += ` · ${p.percent}%`;
            return `<div>${escapeHtml(label)}</div>`;
          })
          .join('')}</div>`;
      },
    },
  };
  const numbers = c.series.flatMap((s) => (s.values || []).filter((v): v is number => v !== null));
  if (cartesianChart(c)) {
    const xy = c.series.some((s) => s.points?.length);
    const makeAxis = (a: ChartConfig['xAxis'], type: string, data?: string[]) => ({
      type: a?.type || type,
      name: a?.title || '',
      nameLocation: 'middle',
      nameGap: 33 * fontScale,
      min: a?.min,
      max: a?.max,
      data,
      nameTextStyle: { color: muted, fontSize: 13 * fontScale },
      axisLine: { lineStyle: { color: grid } },
      axisTick: { show: false },
      axisLabel: {
        color: muted,
        hideOverlap: true,
        fontSize: 12 * fontScale,
        formatter: type === 'category' ? undefined : (v: number) => formatChartValue(v, c),
      },
      splitLine: { show: type !== 'category', lineStyle: { color: grid, type: 'dashed' } },
    });
    const x = makeAxis(c.xAxis, xy ? 'value' : 'category', xy ? undefined : c.labels);
    if (c.xAxis?.type === 'time') delete x.axisLabel.formatter;
    const y = makeAxis(c.yAxis, 'value');
    if (c.stacking === 'percent') {
      y.min = 0;
      y.max = 100;
      y.axisLabel.formatter = (v: number) => v + '%';
    }
    options.grid = {
      left: 58,
      right: c.rightAxis || c.series.some((s) => s.axis === 'right') ? 62 : 30,
      top: 30,
      bottom: c.zoom ? 85 : 64,
      outerBoundsMode: 'same',
      outerBoundsContain: 'all',
    };
    options.xAxis = c.horizontal ? y : x;
    options.yAxis = c.horizontal ? x : y;
    if (!c.horizontal && (c.rightAxis || c.series.some((s) => s.axis === 'right')))
      options.yAxis = [
        y,
        { ...makeAxis(c.rightAxis, 'value'), position: 'right', splitLine: { show: false } },
      ];
    options.series = c.series.map((s, index) => {
      const kind = c.style === 'mixed' ? s.style || 'line' : c.style;
      const scatter = ['scatter', 'bubble'].includes(kind);
      const values = s.points?.length
        ? s.points.map((p) => [typeof p.x === 'string' ? Date.parse(p.x) : p.x, p.y, p.r ?? 6])
        : s.values;
      const data =
        c.stacking === 'percent'
          ? s.values?.map((v, j) => {
              const total = c.series.reduce((n, item) => n + (item.values?.[j] || 0), 0);
              return v === null ? null : total ? (v! / total) * 100 : 0;
            })
          : values;
      return {
        id: `series-${index}`,
        name: s.name,
        type: scatter ? 'scatter' : kind === 'bar' ? 'bar' : 'line',
        data:
          c.horizontal && s.points?.length ? (data as any[]).map(([x, y, r]) => [y, x, r]) : data,
        yAxisIndex: c.horizontal ? 0 : s.axis === 'right' ? 1 : 0,
        connectNulls: false,
        smooth: false,
        showSymbol: (data?.length || 0) < 80,
        symbol: ['circle', 'rect', 'triangle', 'diamond'][index % 4],
        symbolSize: kind === 'bubble' ? (v: any) => Math.max(4, Math.min(80, (v[2] || 6) * 2)) : 7,
        stack: c.stacking !== 'none' ? 'total' : undefined,
        areaStyle: kind === 'area' ? { opacity: 0.17 } : undefined,
        lineStyle: { width: 2.5, type: s.dashed ? 'dashed' : 'solid' },
        itemStyle: {
          color: palette[index % palette.length],
          borderRadius: kind === 'bar' && c.stacking === 'none' ? [4, 4, 0, 0] : 0,
        },
        emphasis: { focus: 'series', scale: true },
        barMaxWidth: 42,
      };
    });
    c.series.forEach((s, i) => {
      const points = s.points?.filter((p) => p.low !== undefined && p.high !== undefined) || [];
      if (!points.length || c.horizontal) return;
      const axis = s.axis === 'right' ? 1 : 0;
      const data = points.map((p) => [
        typeof p.x === 'string' ? Date.parse(p.x) : p.x,
        p.low!,
        p.high!,
      ]);
      options.series.push({
        id: `interval-${i}`,
        name: s.name,
        type: 'custom',
        yAxisIndex: axis,
        silent: true,
        tooltip: { show: false },
        data,
        renderItem: (_params: any, api: any) => {
          const a = api.coord([api.value(0), api.value(1)]),
            b = api.coord([api.value(0), api.value(2)]),
            color = palette[i % palette.length];
          return {
            type: 'group',
            children: [
              [a[0], a[1], b[0], b[1]],
              [a[0] - 4, a[1], a[0] + 4, a[1]],
              [b[0] - 4, b[1], b[0] + 4, b[1]],
            ].map(([x1, y1, x2, y2]) => ({
              type: 'line',
              shape: { x1, y1, x2, y2 },
              style: { stroke: color, lineWidth: 1.5, opacity: 0.6 },
            })),
          };
        },
      });
      if (['line', 'area'].includes(c.style) && points.length > 1) {
        options.series.push({
          id: `interval-band-${i}`,
          name: s.name,
          type: 'custom',
          yAxisIndex: axis,
          silent: true,
          tooltip: { show: false },
          data: [0],
          z: 0,
          renderItem: (_p: any, api: any) => ({
            type: 'polygon',
            shape: {
              points: [
                ...data.map(([x, lo]) => api.coord([x, lo])),
                ...[...data].reverse().map(([x, , hi]) => api.coord([x, hi])),
              ],
            },
            style: { fill: palette[i % palette.length], opacity: 0.13 },
          }),
        });
      }
    });
    if (c.annotations.length && options.series[0]) {
      const first = options.series[0];
      first.markLine = {
        symbol: 'none',
        label: { color: ink },
        lineStyle: { color: muted, type: 'dashed' },
        data: c.annotations
          .filter((a) => a.type === 'line')
          .map((a) => ({
            [a.axis === 'x' ? 'xAxis' : 'yAxis']: a.value,
            name: a.label,
            label: { formatter: a.label },
          })),
      };
      first.markArea = {
        itemStyle: { color: palette[0] + '18' },
        label: { color: muted },
        data: c.annotations
          .filter((a) => a.type === 'band')
          .map((a) => [
            { [a.axis === 'x' ? 'xAxis' : 'yAxis']: a.value, name: a.label },
            { [a.axis === 'x' ? 'xAxis' : 'yAxis']: a.end },
          ]),
      };
      first.markPoint = {
        symbol: 'circle',
        symbolSize: 9,
        label: { show: true, color: ink, position: 'top', formatter: (p: any) => p.name },
        data: c.annotations
          .filter((a) => a.type === 'point')
          .map((a) => ({ coord: [a.x ?? c.labels[0] ?? 0, a.value], name: a.label })),
      };
    }
    if (interactive && c.zoom)
      options.dataZoom = [
        {
          type: 'inside',
          xAxisIndex: c.horizontal ? undefined : 0,
          yAxisIndex: c.horizontal ? 0 : undefined,
          zoomOnMouseWheel: 'ctrl',
          moveOnMouseMove: false,
          moveOnMouseWheel: false,
          preventDefaultMouseMove: false,
        },
        {
          type: 'slider',
          xAxisIndex: c.horizontal ? undefined : 0,
          yAxisIndex: c.horizontal ? 0 : undefined,
          bottom: 12,
          height: 22,
          borderColor: grid,
          textStyle: { color: muted },
          fillerColor: palette[0] + '22',
        },
      ];
  } else if (['pie', 'doughnut'].includes(c.style)) {
    options.series = [
      {
        id: 'series-0',
        name: c.series[0].name,
        type: 'pie',
        radius: c.style === 'doughnut' ? ['43%', '70%'] : '70%',
        center: ['50%', '48%'],
        data: c.labels.map((name, i) => ({ name, value: c.series[0].values?.[i] ?? 0 })),
        label: { color: ink, fontSize: 12 * fontScale },
        labelLine: { lineStyle: { color: muted } },
        emphasis: { scaleSize: 6 },
      },
    ];
  } else if (c.style === 'radar') {
    const max = Math.max(1, ...numbers) * 1.15;
    options.radar = {
      indicator: c.labels.map((name) => ({ name, max })),
      radius: '64%',
      axisName: { color: muted },
      splitArea: { show: false },
      splitLine: { lineStyle: { color: grid } },
      axisLine: { lineStyle: { color: grid } },
    };
    options.series = [
      {
        type: 'radar',
        data: c.series.map((s, i) => ({
          name: s.name,
          value: s.values?.map((v) => v ?? 0),
          areaStyle: { opacity: 0.1 },
          lineStyle: { width: 2, type: s.dashed ? 'dashed' : 'solid' },
          itemStyle: { color: palette[i % palette.length] },
        })),
        tooltip: {
          formatter: (p: any) =>
            `<div class="chart-tooltip-body">${escapeHtml(p.name)}${c.labels.map((l, i) => `<div>${escapeHtml(l)}: ${escapeHtml(formatChartValue(p.value[i], c))}</div>`).join('')}</div>`,
        },
      },
    ];
  } else if (c.style === 'heatmap') {
    const values = c.cells.map((cell) => cell[2]);
    options.grid = {
      left: 65,
      right: 25,
      top: 25,
      bottom: 90,
      outerBoundsMode: 'same',
      outerBoundsContain: 'all',
    };
    options.xAxis = {
      type: 'category',
      data: c.labels,
      axisLabel: { color: muted, hideOverlap: true },
      splitArea: { show: false },
      axisTick: { show: false },
    };
    options.yAxis = {
      type: 'category',
      data: c.yLabels,
      axisLabel: { color: muted },
      splitArea: { show: false },
      axisTick: { show: false },
    };
    options.visualMap = {
      min: Math.min(...values),
      max: Math.max(...values) || 1,
      calculable: interactive,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      textStyle: { color: muted },
      inRange: { color: theme === 'dark' ? ['#263b58', palette[0]] : ['#e0e9f7', palette[0]] },
    };
    options.series = [
      {
        type: 'heatmap',
        data: c.cells,
        label: { show: c.cells.length < 80, color: theme === 'dark' ? '#f1f5ff' : '#15263c' },
        itemStyle: {
          borderColor: theme === 'dark' ? '#182638' : '#f0f5fc',
          borderWidth: 2,
          borderRadius: 3,
        },
        emphasis: { itemStyle: { borderWidth: 3, borderColor: palette[1] } },
      },
    ];
  } else if (c.style === 'treemap') {
    options.series = [
      {
        type: 'treemap',
        data: c.tree,
        roam: false,
        nodeClick: interactive ? 'zoomToNode' : false,
        visibleMin: 0,
        leafDepth: 2,
        top: 10,
        bottom: 40,
        left: 10,
        right: 10,
        label: { color: '#fff', overflow: 'truncate' },
        upperLabel: { show: true, height: 26 },
        breadcrumb: {
          show: interactive,
          bottom: 4,
          itemStyle: { color: theme === 'dark' ? '#334865' : '#dce6f5', textStyle: { color: ink } },
        },
        itemStyle: {
          borderColor: theme === 'dark' ? '#253346' : '#edf3fb',
          borderWidth: 2,
          gapWidth: 3,
        },
      },
    ];
  } else if (c.style === 'sunburst') {
    options.series = [
      {
        type: 'sunburst',
        data: c.tree,
        radius: [0, '88%'],
        sort: null,
        nodeClick: interactive ? 'rootToNode' : false,
        label: { color: '#fff', minAngle: 12 },
        itemStyle: { borderColor: theme === 'dark' ? '#253346' : '#edf3fb', borderWidth: 2 },
      },
    ];
  } else if (c.style === 'sankey') {
    const names = new Map(c.nodes.map((n) => [n.id, n.label || n.id]));
    options.series = [
      {
        type: 'sankey',
        top: 25,
        bottom: 25,
        left: 16,
        right: 120,
        data: c.nodes.map((n) => ({ name: n.id })),
        links: c.links,
        draggable: false,
        nodeWidth: 14,
        nodeGap: 22,
        label: { color: ink, formatter: (p: any) => names.get(p.name) || p.name },
        lineStyle: { color: 'gradient', opacity: 0.3, curveness: 0.5 },
        emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.55 } },
      },
    ];
  }
  return options;
}
