import { z } from 'zod';
import { escapeHtml, scriptJson } from './utils.js';
import { rangeFill } from './forms.js';
import { plotSvg, chartSvg } from './interactive-geometry.js';
import { chartSchema as chart } from './chart-schema.js';
import { chartPalette, chartRows } from './chart-data.js';
import { chartLegend, cartesianChart } from './chart-options.js';
export { curve, plotPath, plotSvg, chartSvg } from './interactive-geometry.js';
import type { IconName } from './ui.js';

const plot = z.object({
  type: z.literal('function-plot'),
  title: z.string().default('A wave, in motion'),
  preset: z.enum(['sine', 'gaussian', 'polynomial']).default('sine'),
  amplitude: z.number().min(0.1).max(3).default(1),
  frequency: z.number().min(0.2).max(4).default(1),
  caption: z.string().default('Move a slider to explore how the parameters change the curve.'),
});
const comparison = z.object({
  type: z.literal('image-compare'),
  title: z.string().default('Between two moments'),
  before: z.string().startsWith('/media/'),
  after: z.string().startsWith('/media/'),
  beforeLabel: z.string().default('Before'),
  afterLabel: z.string().default('After'),
  caption: z.string().default('Drag the handle to compare the two images.'),
});
const quiz = z
  .object({
    type: z.literal('quiz'),
    title: z.string().default('A question worth trying'),
    prompt: z.string().min(1).max(1000),
    choices: z.array(z.string().min(1).max(300)).min(2).max(8),
    answer: z.number().int().min(0),
    explanation: z.string().max(5000).default(''),
    caption: z.string().default('Choose an answer, then check your reasoning.'),
  })
  .refine(
    (value) => value.answer < value.choices.length,
    'The answer must refer to an existing choice.',
  );
const tabs = z
  .object({
    type: z.literal('tabs'),
    title: z.string().default('One idea, several views'),
    tabs: z
      .array(z.object({ label: z.string().min(1).max(60), body: z.string().min(1).max(12000) }))
      .min(2)
      .max(6),
    active: z.number().int().min(0).default(0),
    caption: z.string().default('Choose a view. Use the arrow keys to move between tabs.'),
  })
  .refine((value) => value.active < value.tabs.length, 'The active tab must exist.');
export const interactiveSchema = z.discriminatedUnion('type', [
  plot,
  chart,
  comparison,
  quiz,
  tabs,
]);
export type InteractiveConfig = z.infer<typeof interactiveSchema>;
export type PlotConfig = z.infer<typeof plot>;
export type ChartConfig = z.infer<typeof chart>;
export type CompareConfig = z.infer<typeof comparison>;
export type QuizConfig = z.infer<typeof quiz>;
export type TabsConfig = z.infer<typeof tabs>;
export type StaticIconRenderer = (name: IconName, size?: number) => string;
export type InteractiveDefinition = {
  type: InteractiveConfig['type'];
  label: string;
  icon: IconName;
  schema: z.ZodType;
  clientEntry: string;
  renderStatic: (config: any, icon: StaticIconRenderer, id: string) => string;
  example: InteractiveConfig;
};
function renderPlot(c: PlotConfig, icon: StaticIconRenderer) {
  return `${plotSvg(c)}<div class="plot-controls"><label>Amplitude <output>${c.amplitude.toFixed(1)}</output><input aria-label="Amplitude" type="range" disabled data-param="amplitude" min="0.1" max="3" step="0.1" value="${c.amplitude}" style="--range-fill:${rangeFill(c.amplitude, 0.1, 3)}"/></label><label>Frequency <output>${c.frequency.toFixed(1)}</output><input aria-label="Frequency" type="range" disabled data-param="frequency" min="0.2" max="4" step="0.1" value="${c.frequency}" style="--range-fill:${rangeFill(c.frequency, 0.2, 4)}"/></label><button class="button small secondary" disabled data-reset>${icon('RotateCcw', 14)}<span>Reset</span></button></div>`;
}
function renderChart(c: ChartConfig, icon: StaticIconRenderer) {
  const { headers, rows } = chartRows(c);
  const button = (action: string, label: string, glyph: IconName) =>
    `<button type="button" class="button small secondary" data-chart-action="${action}" disabled>${icon(glyph, 14)}<span>${label}</span></button>`;
  return `<div class="chart-viewport" role="group" tabindex="0" aria-label="${escapeHtml(c.title)}. Hover, focus or tap to explore. Arrow keys navigate values; Escape dismisses the tooltip.">${chartSvg(c)}</div>${
    c.legend
      ? `<div class="chart-legend" aria-label="Chart legend">${chartLegend(c)
          .map(
            (name, i) =>
              `<button type="button" disabled aria-pressed="true" data-series="${i}" class="chip" title="Toggle ${escapeHtml(name)}. Shift-click to isolate."><span class="series-dot" style="--series-light:${(c.colors || chartPalette.light)[i % (c.colors?.length || chartPalette.light.length)]};--series-dark:${(c.colors || chartPalette.dark)[i % (c.colors?.length || chartPalette.dark.length)]}"></span>${escapeHtml(name)}</button>`,
          )
          .join('')}</div>`
      : ''
  }<div class="chart-tools" aria-label="Chart tools">${button('reset', 'Reset', 'RotateCcw')}${cartesianChart(c) && c.zoom ? button('zoom-in', 'Zoom in', 'ZoomIn') + button('zoom-out', 'Zoom out', 'ZoomOut') + '<label class="chart-pan"><input type="checkbox" data-chart-pan disabled/>Pan</label>' : ''}${button('svg', 'SVG', 'Download')}${button('png', 'PNG', 'Image')}${button('csv', 'CSV', 'Table2')}</div><p class="chart-status" role="status" aria-live="polite"></p><details class="chart-data"><summary><span class="summary-label">${icon('Table2', 14)}View data table</span></summary><div class="table-scroll" role="region" tabindex="0" aria-label="${escapeHtml(c.title)} data"><table><caption class="sr-only">${escapeHtml(c.title)} — full source data</caption><thead><tr>${headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v, i) => `<${i === 0 ? 'th scope="row"' : 'td'}>${escapeHtml(v === null ? '—' : String(v))}</${i === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
function renderComparison(c: CompareConfig, icon: StaticIconRenderer) {
  return `<div class="comparison"><img src="${escapeHtml(c.after)}" alt="${escapeHtml(c.afterLabel)}" loading="lazy"/><div class="comparison-before"><img src="${escapeHtml(c.before)}" alt="${escapeHtml(c.beforeLabel)}" loading="lazy"/></div><span class="compare-label before">${escapeHtml(c.beforeLabel)}</span><span class="compare-label after">${escapeHtml(c.afterLabel)}</span><div class="compare-handle" role="slider" aria-label="Comparison position" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-valuetext="50% first image" aria-disabled="true" tabindex="-1"><span class="compare-grip" aria-hidden="true">${icon('MoveHorizontal', 16) || '‹<span></span>›'}</span></div></div>`;
}
export const interactiveRegistry: InteractiveDefinition[] = [
  {
    type: 'quiz',
    label: 'Quick question',
    icon: 'CircleHelp',
    schema: quiz,
    clientEntry: 'widgets',
    renderStatic: (config: QuizConfig, icon, id) =>
      `<fieldset class="quiz-options"><legend>${escapeHtml(config.prompt)}</legend>${config.choices.map((choice, index) => `<label class="check-label"><input type="radio" name="${escapeHtml(id)}-answer" value="${index}"/>${escapeHtml(choice)}</label>`).join('')}</fieldset><div class="quiz-actions"><button type="button" class="button small secondary" data-check-answer hidden disabled>${icon('Check', 14)}Check answer</button><button type="button" class="button small ghost" data-reset-quiz hidden>${icon('RotateCcw', 14)}Reset</button></div><p class="quiz-feedback" role="status" aria-live="polite"></p><details class="quiz-solution"><summary>Reveal explanation</summary><p><strong>${escapeHtml(config.choices[config.answer])}</strong></p><p>${escapeHtml(config.explanation)}</p></details>`,
    example: {
      type: 'quiz',
      title: 'A small check for understanding',
      prompt: 'Which change increases a sine wave’s number of oscillations in a fixed interval?',
      choices: [
        'Increase the amplitude',
        'Increase the frequency',
        'Add a constant vertical shift',
      ],
      answer: 1,
      explanation:
        'Frequency changes how quickly the wave repeats. Amplitude changes its height; a vertical shift moves the entire curve.',
      caption: 'A self-check, rather than a score. The explanation also works without JavaScript.',
    },
  },
  {
    type: 'tabs',
    label: 'Tabbed explanation',
    icon: 'Layers',
    schema: tabs,
    clientEntry: 'widgets',
    renderStatic: (config: TabsConfig, _icon, id) =>
      `<div class="widget-tabs"><div class="widget-tab-list" role="tablist" aria-label="${escapeHtml(config.title)}" hidden>${config.tabs.map((tab, index) => `<button type="button" role="tab" id="${escapeHtml(id)}-tab-${index}" aria-controls="${escapeHtml(id)}-panel-${index}" aria-selected="false" tabindex="-1">${escapeHtml(tab.label)}</button>`).join('')}</div>${config.tabs.map((tab, index) => `<section class="widget-tab-panel" id="${escapeHtml(id)}-panel-${index}" aria-label="${escapeHtml(tab.label)}"><h4>${escapeHtml(tab.label)}</h4><p>${escapeHtml(tab.body)}</p></section>`).join('')}</div>`,
    example: {
      type: 'tabs',
      title: 'Look at the same idea three ways',
      tabs: [
        {
          label: 'Intuition',
          body: 'A wave repeats a pattern. Its amplitude tells you how tall that pattern is, and its frequency tells you how often it repeats.',
        },
        {
          label: 'Experiment',
          body: 'Move only one parameter at a time. Keep frequency fixed while changing amplitude; then reset and compare the other parameter.',
        },
        {
          label: 'Reflection',
          body: 'Try describing the change before you move the control. Compare the prediction with the curve, and revise the explanation.',
        },
      ],
      active: 0,
      caption: 'All three views remain readable when JavaScript is unavailable.',
    },
  },
  {
    type: 'function-plot',
    label: 'Function plot',
    icon: 'FunctionSquare',
    schema: plot,
    clientEntry: 'widgets',
    renderStatic: renderPlot,
    example: {
      type: 'function-plot',
      title: 'The shape of a wave',
      preset: 'sine',
      amplitude: 1,
      frequency: 1,
      caption:
        'Change the amplitude and frequency. The equation stays simple; the possibilities do not.',
    },
  },
  {
    type: 'chart',
    label: 'Data chart',
    icon: 'ChartNoAxesCombined',
    schema: chart,
    clientEntry: 'widgets',
    renderStatic: renderChart,
    example: chart.parse({
      type: 'chart',
      title: 'Small steps add up',
      style: 'line',
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      series: [
        { name: 'Reading', values: [12, 18, 15, 28, 35] },
        { name: 'Making', values: [8, 12, 23, 20, 32] },
      ],
      caption: 'An illustrative dataset. Toggle a series, or explore the data table.',
    }),
  },
  {
    type: 'image-compare',
    label: 'Image comparison',
    icon: 'Columns2',
    schema: comparison,
    clientEntry: 'widgets',
    renderStatic: renderComparison,
    example: {
      type: 'image-compare',
      title: 'A change in the light',
      before: '/media/coast-dawn.svg',
      after: '/media/coast-dusk.svg',
      beforeLabel: 'First light',
      afterLabel: 'Blue hour',
      caption: 'The same coast, two ways of seeing. Drag to compare these original illustrations.',
    },
  },
];
let sequence = 0;
export function renderInteractive(
  input: unknown,
  icon: StaticIconRenderer = () => '',
  id = `widget-${++sequence}`,
  chartSvgHtml?: string,
) {
  const config = interactiveSchema.parse(input);
  const definition = interactiveRegistry.find((d) => d.type === config.type)!;
  const glyph = icon(definition.icon, 18);
  let stage = definition.renderStatic(config, icon, id);
  if (config.type === 'chart' && chartSvgHtml)
    stage = stage.replace(chartSvg(config), chartSvgHtml);
  return `<figure class="interactive glass-panel" data-interactive="${config.type}" data-config="${escapeHtml(scriptJson(config))}"><div class="interactive-heading">${glyph ? `<span class="component-mark" aria-hidden="true">${glyph}</span>` : ''}<h3>${escapeHtml(config.title)}</h3></div><div class="interactive-stage">${stage}</div><figcaption>${escapeHtml(config.caption)}</figcaption></figure>`;
}
