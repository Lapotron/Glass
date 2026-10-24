import * as echarts from 'echarts/core';
import {
  LineChart,
  BarChart,
  ScatterChart,
  PieChart,
  RadarChart,
  HeatmapChart,
  TreemapChart,
  SunburstChart,
  SankeyChart,
  CustomChart,
} from 'echarts/charts';
import {
  TooltipComponent,
  GridComponent,
  LegendComponent,
  RadarComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  AriaComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { chartOptions } from '../shared/chart-options.js';
import { chartSchema, type ChartConfig } from '../shared/chart-schema.js';
import { digest } from './store.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { escapeHtml } from '../shared/utils.js';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  PieChart,
  RadarChart,
  HeatmapChart,
  TreemapChart,
  SunburstChart,
  SankeyChart,
  CustomChart,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  RadarComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  AriaComponent,
  SVGRenderer,
]);
const memory = new Map<string, { light: string; dark: string }>();
const rendererVersion = 'fieldnotes-charts-1-echarts-6.1.0';
const rendererHash = Promise.all(
  ['./charts.ts', '../shared/chart-options.ts', '../shared/chart-data.ts'].map((name) =>
    fs.readFile(fileURLToPath(new URL(name, import.meta.url))),
  ),
).then((files) => digest(Buffer.concat(files)));
function safeSvg(svg: string) {
  if (
    /<(?:script|foreignObject|image|iframe)\b|\bon\w+\s*=|(?:href|xlink:href)\s*=\s*["'](?!#)|url\(\s*["']?(?!#)[^)]/i.test(
      svg,
    )
  )
    throw new Error('Chart SVG contains unsupported resources.');
  return svg.replace('<svg ', '<svg class="chart-svg" role="img" ');
}
export async function renderChartSvg(
  input: ChartConfig,
  namespace: string,
  cacheDir?: string,
  fontScale = 1,
) {
  const config = chartSchema.parse(input);
  const key = digest(
    rendererVersion + (await rendererHash) + process.platform + JSON.stringify([config, fontScale]),
  );
  let result = memory.get(key);
  if (!result && cacheDir) {
    try {
      const cached = JSON.parse(await fs.readFile(path.join(cacheDir, key + '.json'), 'utf8'));
      if (cached.hash === digest(cached.light + cached.dark))
        result = {
          light: safeSvg(cached.light.replace('class="chart-svg" role="img" ', '')),
          dark: safeSvg(cached.dark.replace('class="chart-svg" role="img" ', '')),
        };
    } catch {
      /* A corrupt cache is rebuilt, never published. */
    }
  }
  if (!result) {
    const render = (theme: 'light' | 'dark') => {
      const chart = echarts.init(null, null, {
        renderer: 'svg',
        ssr: true,
        width: 720,
        height: 360,
      });
      try {
        chart.setOption(chartOptions(config, theme, false, fontScale));
        return safeSvg(chart.renderToSVGString());
      } finally {
        chart.dispose();
      }
    };
    result = { light: render('light'), dark: render('dark') };
    if (cacheDir) {
      await fs.mkdir(cacheDir, { recursive: true });
      const tmp = path.join(cacheDir, `${key}-${randomUUID()}.tmp`);
      await fs.writeFile(
        tmp,
        JSON.stringify({ ...result, hash: digest(result.light + result.dark) }),
      );
      await fs.rename(tmp, path.join(cacheDir, key + '.json'));
    }
    if (memory.size >= 128) memory.delete(memory.keys().next().value!);
    memory.set(key, result);
  }
  const namespaced = (svg: string, theme: string) => {
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    for (const id of ids)
      svg = svg
        .replaceAll(`id="${id}"`, `id="${namespace}-${theme}-${id}"`)
        .replaceAll(`#${id})`, `#${namespace}-${theme}-${id})`)
        .replaceAll(`href="#${id}"`, `href="#${namespace}-${theme}-${id}"`);
    return svg
      .replace(/\bzr\d+-cls-\d+\b/g, (name) => `${namespace}-${theme}-${name}`)
      .replace('role="img"', `role="img" aria-label="${escapeHtml(config.title)}"`);
  };
  return `<div class="chart-static" aria-label="${config.title.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}"><div data-chart-variant="light">${namespaced(result.light, 'light')}</div><div data-chart-variant="dark">${namespaced(result.dark, 'dark')}</div></div>`;
}
