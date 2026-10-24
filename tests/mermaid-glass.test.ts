import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiagramRenderer } from '../src/engine/diagrams.js';
import { renderMarkdown } from '../src/engine/markdown.js';
import { renderComponentPreviews } from '../src/engine/component-previews.js';
import { sourceComponents } from '../src/shared/source-components.js';
import { diagramPresentation } from '../src/shared/diagram-presentation.js';
import { themeSchema } from '../src/shared/contracts.js';
import { mermaidVersion, mermaidExamples } from '../src/shared/mermaid-authoring.js';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { mermaidLanguage } from '../src/console/mermaid-language.js';

it('uses resolved reading typography and invalidates diagram/preview caches when presentation changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-mermaid-presentation-'));
  const source = '```mermaid\nflowchart LR\n A[Alpha] --> B[Beta]\n```';
  const blocks = sourceComponents(source).map(({ from, to }) => ({ from, to }));
  const standard = diagramPresentation(themeSchema.parse({}));
  const serif = diagramPresentation(themeSchema.parse({ fontFamily: 'serif', fontScale: 1.2 }));
  expect(standard.light.text).toMatch(/^#[\da-f]{6}$/i);
  expect(standard.dark.secondary).toMatch(/^#[\da-f]{6}$/i);
  expect(serif.fontFamily).toContain('Charter');
  expect(serif.fontSize).toBe(19.2);
  try {
    const first = await renderComponentPreviews(
      source,
      blocks,
      root,
      undefined,
      undefined,
      standard,
    );
    const changed = await renderComponentPreviews(
      source,
      blocks,
      root,
      undefined,
      undefined,
      serif,
    );
    expect(first[0].html).toContain('data-diagram-rendered="glass-2"');
    expect(changed[0].html).toContain('Charter');
    expect(changed[0].html).not.toBe(first[0].html);
    expect((await fs.readdir(path.join(root, '.studio/render-cache/mermaid'))).length).toBe(2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('keeps the entire figure and SVG canvas transparent while preserving authored node colors', async () => {
  const renderer = createDiagramRenderer();
  try {
    const diagram = await renderer.render(
      'flowchart LR\n A[Default] --> B[Warning]\n classDef warning fill:#ffe4e6,stroke:#b91c1c,color:#7f1d1d;\n class B warning;',
      'paint-test',
    );
    for (const svg of [diagram.light, diagram.dark]) {
      expect(svg).toContain('background: transparent');
      expect(svg).toContain('data-diagram-surface');
      expect(svg).toContain('#ffe4e6');
      expect(svg).toContain('font-weight:400');
      expect(svg).not.toContain('NaN');
    }
    const result = await renderMarkdown('```mermaid\nflowchart LR\n A --> B\n```');
    expect(result.html).toMatch(/<figure[^>]+class="diagram"[^>]*data-mermaid/);
    expect(result.html).not.toContain('class="diagram glass-panel"');
    expect(result.html).not.toContain('<figcaption>Diagram</figcaption>');
    expect(result.html).toContain('View Mermaid source');
  } finally {
    await renderer.close();
  }
});

it('retains complete static variants for the main Mermaid families, including data colors and native math', async () => {
  const examples = [
    'flowchart LR\n A["$$x^2+1$$"] --> B[Done]',
    'sequenceDiagram\n participant Reader\n participant Blog\n Reader->>Blog: Read\n Note over Blog: A note\n Blog-->>Reader: Ready',
    'classDiagram\n class Article {\n +title\n +read()\n }\n Article --> Author',
    'stateDiagram-v2\n [*] --> Draft\n Draft --> Published',
    'erDiagram\n AUTHOR ||--o{ ARTICLE : writes',
    'gantt\n title A timeline\n dateFormat YYYY-MM-DD\n section Writing\n Draft :a, 2026-01-01, 2d',
    'pie title Reading\n "Posts" : 40\n "Articles" : 60',
  ];
  const result = await renderMarkdown(
    examples.map((source) => '```mermaid\n' + source + '\n```').join('\n\n'),
    { documentId: 'diagram-families' },
  );
  expect(result.html.match(/data-diagram-rendered="glass-2"/g)).toHaveLength(examples.length * 2);
  expect(result.html).toContain('<math');
  expect(result.html).not.toMatch(/<script|@font-face|NaN/);
  const ids = [...result.html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
});

it('uses the pinned latest verified Mermaid release and renders modern bundled diagram families', async () => {
  const metadata = JSON.parse(await fs.readFile('node_modules/mermaid/package.json', 'utf8'));
  const project = JSON.parse(await fs.readFile('package.json', 'utf8'));
  expect(metadata.version).toBe(mermaidVersion);
  expect(project.dependencies.mermaid).toBe(mermaidVersion);
  const renderer = createDiagramRenderer();
  try {
    for (const [index, example] of mermaidExamples.entries()) {
      const result = await renderer.render(example.source, 'modern-' + index);
      expect(result.light, example.name).toContain('data-diagram-rendered="glass-2"');
      expect(result.dark, example.name).toContain('viewBox=');
    }
  } finally {
    await renderer.close();
  }
});

it('keeps categorical Mermaid fills distinct while applying transparency only to structural nodes', async () => {
  const renderer = createDiagramRenderer();
  try {
    const diagram = await renderer.render(
      'pie\n "Posts":40\n "Articles":30\n "Notes":30',
      'semantic-palette',
    );
    for (const svg of [diagram.light, diagram.dark]) {
      const fills = [...svg.matchAll(/<path[^>]+fill="([^"]+)"/g)].map((match) => match[1]);
      expect(new Set(fills).size).toBeGreaterThanOrEqual(3);
      expect(svg).not.toContain('data-diagram-surface=');
    }
    const xy = await renderer.render(
      'xychart-beta\n x-axis [A,B]\n y-axis 0 --> 5\n bar [2,4]',
      'xy-canvas',
    );
    for (const svg of [xy.light, xy.dark]) {
      expect(svg).toMatch(/<rect[^>]+class="background"[^>]+fill="none"/);
      const bars = [...svg.matchAll(/<rect[^>]+fill="([^"]+)"/g)].filter(
        (match) => match[1] !== 'none',
      );
      expect(bars).toHaveLength(2);
    }
  } finally {
    await renderer.close();
  }
});

it('highlights Mermaid declarations, labels, arrows, configuration and comments without loading a renderer', () => {
  const source =
    'flowchart LR\n  %% ordinary comment\n  A["A -> label"] --> B[Done]\n  classDef warning fill:#ffe4e6\nradar-beta\n  axis Speed, Clarity\n  curve Current{1,2}';
  const state = EditorState.create({ doc: source, extensions: [mermaidLanguage] });
  ensureSyntaxTree(state, state.doc.length, 1000);
  const tree = syntaxTree(state).toString();
  for (const token of ['typeName', 'keyword', 'comment', 'string', 'operator', 'number'])
    expect(tree).toContain(token);
});
