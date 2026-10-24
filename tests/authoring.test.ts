import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderMarkdown } from '../src/engine/markdown.js';
import { inspectMarkdown } from '../src/shared/markdown-analysis.js';
import { checkMarkdownDocument } from '../src/engine/authoring.js';
import { authoringCapabilities } from '../src/shared/authoring-capabilities.js';
import { chartSchema, chartStyles } from '../src/shared/chart-schema.js';
import { chartExample } from '../src/shared/chart-examples.js';
import { chartCsv, chartRows } from '../src/shared/chart-data.js';
import { renderChartSvg } from '../src/engine/charts.js';
import { importChartData } from '../src/shared/chart-import.js';
import { readDelimited, markdownTable } from '../src/shared/tabular-data.js';
import { instantiateSnippet } from '../src/shared/markdown-snippets.js';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { blogCompletions } from '../src/console/markdown-assistance.js';

it('resolves forward references, shared statement counters, citations and semantic table alignment', async () => {
  const source =
    '## Argument\n\nSee :ref[eq-energy], :ref[tab-values] and :cite[source].\n\n:::theorem[A result]{#thm}\n$x>0$.\n:::\n\n:::lemma[A consequence]{#lem}\n$x+1>1$.\n:::\n\n:::proof\nThe result follows.\n:::\n\n:::equation[Energy]{#eq-energy}\n$$\nE=mc^2\n$$\n:::\n\n:::table[Values]{#tab-values}\n| Name | Value |\n| :--- | ---: |\n| Test | $2$ |\n:::\n\n::::references\n:::reference[Source]{#source}\nA manually authored source.\n:::\n::::';
  const result = await renderMarkdown(source);
  expect(result.html).toContain('Theorem 1');
  expect(result.html).toContain('Lemma 2');
  expect(result.html).toContain('href="#user-content-eq-energy"');
  expect(result.html).toContain('href="#user-content-source"');
  expect(result.html).toContain('>Equation 1</a>');
  expect(result.html).toContain('align="right"');
  expect(result.html).toContain('role="region"');
  expect(result.html).toContain('equation-number');
  expect(result.html).toContain('proof-end');
  expect(result.headings.map((h) => h.text)).toEqual(['Argument']);
});
it('reports actionable source ranges, invalid nesting, duplicate labels and unsupported attributes', () => {
  const source = 'A paragraph.\n\n:ref[missing]\n\n:::comparison\nText\n:::';
  const result = inspectMarkdown(source);
  const unresolved = result.diagnostics.find((d) => d.code === 'unresolved-reference')!;
  expect(source.slice(unresolved.from, unresolved.to)).toBe(':ref[missing]');
  expect(unresolved.line).toBe(3);
  expect(result.diagnostics.some((d) => d.code === 'component-children')).toBe(true);
  expect(
    inspectMarkdown(':::theorem{#same}\nOne\n:::\n:::lemma{#same}\nTwo\n:::').diagnostics.some(
      (d) => d.code === 'duplicate-label',
    ),
  ).toBe(true);
  expect(inspectMarkdown(':::proof\nText').diagnostics[0].code).toBe('unclosed-component');
  expect(inspectMarkdown(':mark[Text]{onclick="evil()"}').diagnostics[0].severity).toBe('warning');
});
it('validates the LaTeX conversion pair and preserves frontmatter offsets in full diagnostics', async () => {
  const source = await fs.readFile('docs/conversion/example.md', 'utf8');
  expect((await checkMarkdownDocument(source)).ok).toBe(true);
  const prefix =
    '---\nid: note\nslug: note\ntitle: Note\npublishedAt: 2026-01-01\nstatus: draft\n---\n';
  const result = await checkMarkdownDocument(prefix + ':ref[missing]');
  expect(result.ok).toBe(false);
  expect(result.diagnostics[0].line).toBe(8);
  expect(result.diagnostics[0].from).toBe(prefix.length);
});
it('keeps every exported authoring template renderable', async () => {
  for (const file of (await fs.readdir('docs/authoring-templates')).filter((f) =>
    f.endsWith('.md'),
  )) {
    const report = await checkMarkdownDocument(
      await fs.readFile(path.join('docs/authoring-templates', file), 'utf8'),
    );
    expect(
      report.diagnostics.filter((d) => d.severity === 'error'),
      file,
    ).toEqual([]);
  }
});
it('renders each supported chart to safe namespaced light/dark SVG with no reader dependency', async () => {
  for (const style of chartStyles) {
    const c = chartExample(style),
      svg = await renderChartSvg(c, 'chart-' + style);
    expect(svg).toContain('data-chart-variant="dark"');
    expect(svg).toContain('<path');
    expect(svg).not.toMatch(/<script|onmouseover|https?:\/\/(?!www\.w3\.org)/);
    expect(chartRows(c).rows.length).toBeGreaterThan(0);
  }
});
it('reuses a checksum-protected chart cache and namespaces repeated instances', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'chart-cache-'));
  try {
    const c = chartSchema.parse({ ...chartExample('bar'), title: 'Cache fixture ' + folder });
    const [a, b] = await Promise.all([
      renderChartSvg(c, 'first', folder),
      renderChartSvg(c, 'second', folder),
    ]);
    expect(await fs.readdir(folder)).toHaveLength(1);
    expect(a).not.toBe(b);
    expect(a).toContain('first-light-');
    expect(b).toContain('second-light-');
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
it('rejects cycles, bad cells, invalid logarithmic values, missing data and malformed intervals', () => {
  expect(
    chartSchema.safeParse({ ...chartExample('line'), xAxis: { title: 'Month' } }).success,
  ).toBe(true);
  expect(
    chartSchema.safeParse({
      type: 'chart',
      style: 'sankey',
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [
        { source: 'a', target: 'b', value: 1 },
        { source: 'b', target: 'a', value: 1 },
      ],
    }).success,
  ).toBe(false);
  expect(
    chartSchema.safeParse({
      ...chartExample('line'),
      series: [
        { name: 'Category', values: [1, 2, 3, 4] },
        { name: 'XY', points: [{ x: 1, y: 2 }] },
      ],
    }).success,
  ).toBe(false);
  expect(
    chartSchema.safeParse({
      ...chartExample('scatter'),
      yAxis: { type: 'log' },
      series: [{ name: 'Interval', points: [{ x: 1, y: 2, low: 0, high: 3 }] }],
    }).success,
  ).toBe(false);
  expect(chartSchema.safeParse({ ...chartExample('heatmap'), cells: [[999, 0, 1]] }).success).toBe(
    false,
  );
  expect(
    chartSchema.safeParse({
      ...chartExample('line'),
      yAxis: { type: 'log' },
      series: [{ name: 'Bad', values: [0, -1, 2, 3] }],
    }).success,
  ).toBe(false);
  expect(
    chartSchema.safeParse({ type: 'chart', style: 'line', labels: ['a'], series: [] }).success,
  ).toBe(false);
  expect(
    chartSchema.safeParse({
      type: 'chart',
      style: 'scatter',
      series: [{ name: 'Bad', points: [{ x: 1, y: 2, low: 4, high: 1 }] }],
    }).success,
  ).toBe(false);
});
it('imports quoted CSV, XY, hierarchies, heatmaps and graphs without losing source values', () => {
  expect(readDelimited('label,value\n"a,b",2\n"two\nlines",3')).toEqual([
    ['label', 'value'],
    ['a,b', '2'],
    ['two\nlines', '3'],
  ]);
  for (const [style, source] of [
    ['line', 'Label,A,B\nFirst,1,2\nSecond,,3'],
    ['scatter', 'x,y,low,high\n1,2,1,3\n2,4,3,5'],
    ['heatmap', 'x,y,value\nMon,Read,3\nTue,Make,4'],
    ['treemap', 'path,value\nA/B,2\nA/C,3'],
    ['sankey', 'source,target,value\nA,B,3\nB,C,2'],
  ] as const) {
    const config = chartSchema.parse({ ...chartExample(style), ...importChartData(source, style) });
    expect(chartRows(config).rows.length).toBeGreaterThan(0);
  }
  const c = chartSchema.parse({ ...chartExample('pie'), labels: ['=unsafe', 'B', 'C', 'D'] });
  expect(chartCsv(c)).toContain("'=unsafe");
  expect(
    markdownTable([
      ['A', 'B'],
      ['x|y', 'two\nlines'],
    ]),
  ).toContain('x\\|y');
});
it('exports versioned JSON schemas and creates noncolliding linked snippets', () => {
  const pack = authoringCapabilities();
  expect(pack.version).toBe('fieldnotes-markdown/1');
  expect(pack.components.length).toBeGreaterThan(30);
  expect(JSON.stringify(pack.chartSchema)).toContain('sankey');
  const value = ':::equation{#energy}\n$$x$$\n:::\nSee :ref[energy].';
  const a = instantiateSnippet(value),
    b = instantiateSnippet(value);
  expect(a).not.toBe(b);
  const label = /#(energy-[\w-]+)/.exec(a)![1];
  expect(a).toContain(`:ref[${label}]`);
  const prefixed = instantiateSnippet(
    ':::theorem{#result}\nFirst\n:::\n:::lemma{#result-next}\nSecond\n:::\n:ref[result] and :ref[result-next]',
  );
  expect(inspectMarkdown(prefixed).diagnostics).toEqual([]);
});
it('offers contextual Markdown/JSON/math completions without taking over code or prose', () => {
  const complete = blogCompletions(() => ({
    links: [{ label: 'A post', url: '/post/note/', status: 'published' }],
    media: [{ label: 'Image', url: '/media/note.webp' }],
  }));
  const run = (doc: string) =>
    complete(new CompletionContext(EditorState.create({ doc }), doc.length, true));
  expect(run('/theo')?.options.some((o) => o.label === 'theorem')).toBe(true);
  expect(run('```js\n:::theo')).toBeNull();
  expect(run('`:::theo')).toBeNull();
  expect(run('Plain prose')).toBeNull();
  expect(run('$\\fr')?.options.some((o) => o.label === 'frac')).toBe(true);
  expect(run('[A](/po')?.options[0].label).toBe('/post/note/');
  expect(run('---\nstatus: p')?.options.some((o) => o.label === 'published')).toBe(true);
  expect(run('```mer')?.options.some((o) => o.label === 'mermaid')).toBe(true);
  expect(run('[^source]: A source.\n\nA note[^s')?.options.some((o) => o.label === 'source')).toBe(
    true,
  );
  expect(run('## Same\n\n## Same\n\n[Link](#')?.options.some((o) => o.label === '#same-2')).toBe(
    true,
  );
  expect(
    run('```interactive\n{"type":"chart","style":"')?.options.some((o) => o.label === 'sankey'),
  ).toBe(true);
  expect(
    run('```interactive\n{"type":"chart","series":[{"')?.options.some((o) => o.label === 'points'),
  ).toBe(true);
});
