import { escapeHtml } from './utils.js';
import type { PlotConfig, ChartConfig } from './interactives.js';
export function curve(
  preset: PlotConfig['preset'],
  x: number,
  amplitude: number,
  frequency: number,
) {
  if (preset === 'gaussian') return amplitude * Math.exp(-Math.pow(x * frequency, 2) / 2);
  if (preset === 'polynomial')
    return amplitude * (Math.pow(x / Math.PI, 3) - (frequency * x) / Math.PI);
  return amplitude * Math.sin(frequency * x);
}
export function plotPath(
  config: PlotConfig,
  amplitude = config.amplitude,
  frequency = config.frequency,
) {
  return Array.from({ length: 241 }, (_, i) => {
    const x = -Math.PI * 2 + (i / 240) * Math.PI * 4;
    return `${i ? 'L' : 'M'}${(32 + (i / 240) * 576).toFixed(2)},${Math.max(12, Math.min(228, 120 - curve(config.preset, x, amplitude, frequency) * 32)).toFixed(2)}`;
  }).join(' ');
}
export const plotSvg = (c: PlotConfig) =>
  `<svg class="plot-svg" viewBox="0 0 640 250" role="img" aria-label="${escapeHtml(c.preset)} function plot">${[40, 80, 120, 160, 200].map((y) => `<path class="plot-grid" d="M32 ${y}H608"/>`).join('')}<path class="plot-axis" d="M32 120H608M320 18V222"/><path class="plot-curve" d="${plotPath(c)}"/><text x="34" y="246">−2π</text><text x="315" y="246">0</text><text x="592" y="246">2π</text></svg>`;
/** Small synchronous fallback for direct component specimens; Markdown builds inject ECharts SVG. */
export function chartSvg(config: ChartConfig, hidden = new Set<number>()) {
  if (!['line', 'bar', 'area'].includes(config.style) || config.series.some((s) => !s.values))
    return `<svg class="chart-svg" viewBox="0 0 720 360" role="img" aria-label="${escapeHtml(config.title)}"><text x="32" y="90" fill="currentColor">${escapeHtml(config.title)}</text><text x="32" y="130" fill="currentColor">Explore the full data table below.</text></svg>`;
  const values = config.series
    .flatMap((s, i) => (hidden.has(i) ? [] : s.values || []))
    .filter((v): v is number => v !== null);
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values);
  const y = (v: number) => 208 - ((v - min) / (max - min || 1)) * 174;
  const x = (i: number) => 46 + (i / Math.max(1, config.labels.length - 1)) * 544;
  const colors = ['#3868cf', '#16816f', '#9258b4', '#af621f', '#307e9b'];
  return `<svg class="chart-svg" viewBox="0 0 640 255" role="img" aria-label="${escapeHtml(config.title)}">${[0, 1, 2, 3, 4].map((i) => `<path class="plot-grid" d="M46 ${34 + i * 43.5}H608"/><text x="7" y="${38 + i * 43.5}">${Number((max - (i / 4) * (max - min)).toFixed(1))}</text>`).join('')}${config.series.map((s, index) => (hidden.has(index) ? '' : (s.values || []).map((v, i) => (v === null ? '' : config.style === 'bar' ? `<rect x="${x(i) - 12 + index * 12}" y="${Math.min(y(v), y(0))}" width="10" height="${Math.abs(y(v) - y(0))}" rx="3" fill="${colors[index % colors.length]}"/>` : `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${colors[index % colors.length]}"><title>${escapeHtml(`${s.name}: ${config.labels[i]} · ${v}`)}</title></circle>`)).join(''))).join('')}${config.labels
    .filter((_, i) => i % Math.max(1, Math.ceil(config.labels.length / 8)) === 0)
    .map(
      (l, i) =>
        `<text x="${x(i * Math.max(1, Math.ceil(config.labels.length / 8)))}" y="241" text-anchor="middle">${escapeHtml(l)}</text>`,
    )
    .join('')}</svg>`;
}
