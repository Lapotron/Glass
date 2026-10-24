import { afterEach, expect, it, vi } from 'vitest';
import { EditorState, EditorSelection, type TransactionSpec } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import {
  analyzeSource,
  readSourcePreferences,
  sourceDefaults,
} from '../src/console/source-analysis.js';
import { wrapSource, prefixSource } from '../src/console/source-commands.js';
import { markdownPatch, summarizeDiff } from '../src/console/diff-model.js';
import {
  layoutMindmap,
  mapNodes,
  renderMindmapSvg,
  validateMindmap,
  type MindmapDocument,
} from '../src/shared/mindmap.js';
import { renderMarkdown } from '../src/engine/markdown.js';

const map: MindmapDocument = {
  version: 1,
  title: 'A map',
  layout: 'map',
  root: {
    id: 'root',
    label: 'Question',
    children: [
      {
        id: 'a',
        label: 'Evidence',
        children: [
          {
            id: 'a-1',
            label: 'A long bilingual label 中文 that wraps rather than overlapping another branch',
            children: [],
          },
        ],
      },
      { id: 'b', label: 'Making', children: [] },
      { id: 'c', label: 'Reflection', children: [] },
    ],
  },
};
afterEach(() => vi.unstubAllGlobals());
it('extracts ATX and Setext headings with exact ranges, excludes code and counts Unicode words', () => {
  const source =
    '# First **idea**\n\n中文学习计划\n\nSecond\n------\n\n```md\n# not an outline item\n```\n\n:ref[missing]';
  const result = analyzeSource(source);
  expect(result.headings.map((h) => [h.text, h.level, h.line])).toEqual([
    ['First idea', 1, 1],
    ['Second', 2, 5],
  ]);
  expect(source.slice(result.headings[1].from, result.headings[1].to)).toBe('Second\n------');
  expect(result.diagnostics[0].line).toBe(12);
  expect(result.words).toBeGreaterThan(8);
  expect(result.characters).toBe([...source].length);
});
it('isolates editor preferences by workspace and rejects malformed or unsupported values', () => {
  const stored = new Map([
    [
      'fieldnotes-editor:one',
      JSON.stringify({
        version: 1,
        minimap: false,
        scale: 1.2,
        numbers: 'no',
        indent: 3,
        imagePreviews: 'thumbnails',
        completeOnTyping: false,
        closeBrackets: false,
        formatOnSave: true,
      }),
    ],
  ]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) });
  expect(readSourcePreferences('one')).toMatchObject({
    minimap: false,
    scale: 1.2,
    numbers: true,
    indent: 2,
    imagePreviews: 'thumbnails',
    completeOnTyping: false,
    closeBrackets: false,
    formatOnSave: true,
  });
  expect(readSourcePreferences('two')).toEqual(sourceDefaults);
  stored.set('fieldnotes-editor:one', '{broken');
  expect(readSourcePreferences('one')).toEqual(sourceDefaults);
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('Storage disabled');
    },
  });
  expect(readSourcePreferences('one')).toEqual(sourceDefaults);
});
function sourceView(doc: string, ranges: [number, number][]) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(
      ranges.map(([anchor, head]) => EditorSelection.range(anchor, head)),
    ),
    extensions: [history(), EditorState.allowMultipleSelections.of(true)],
  });
  const view = {
    get state() {
      return state;
    },
    focus() {},
    dispatch(...specs: TransactionSpec[]) {
      state = state.update(...specs).state;
    },
  } as unknown as EditorView;
  return view;
}
it('formats multiple selections without replacing the document and retains one-step undo', () => {
  const view = sourceView('first and second', [
    [0, 5],
    [10, 16],
  ]);
  wrapSource(view, '**');
  expect(view.state.doc.toString()).toBe('**first** and **second**');
  wrapSource(view, '**');
  expect(view.state.doc.toString()).toBe('first and second');
  undo(view);
  expect(view.state.doc.toString()).toBe('**first** and **second**');
});
it('toggles Markdown prefixes on selected lines in one undoable transaction', () => {
  const view = sourceView('alpha\nbeta\ngamma', [[0, 10]]);
  prefixSource(view, '- [ ] ');
  expect(view.state.doc.toString()).toBe('- [ ] alpha\n- [ ] beta\ngamma');
  undo(view);
  expect(view.state.doc.toString()).toBe('alpha\nbeta\ngamma');
});
it('exports full-fidelity patches including blank source, CRLF and missing final newline', () => {
  expect(markdownPatch('', 'New\n')).toContain('@@ -0,0 +1,1 @@\n+New\n');
  const patch = markdownPatch('Old\r\n', 'New');
  expect(patch).toContain('-Old\r\n+New\n\\ No newline at end of file\n');
  expect(markdownPatch('a', 'a')).not.toContain('@@');
  expect(
    summarizeDiff([
      {
        originalStartLineNumber: 1,
        originalEndLineNumber: 0,
        modifiedStartLineNumber: 2,
        modifiedEndLineNumber: 4,
      },
    ]),
  ).toMatchObject({ state: 'ready', added: 3, removed: 0 });
});
it('lays out balanced maps and trees deterministically without overlapping node rectangles', () => {
  validateMindmap(map);
  const a = layoutMindmap(map),
    b = layoutMindmap(map);
  expect(a).toEqual(b);
  expect(a.positions.some((p) => p.x < 0)).toBe(true);
  for (const left of a.positions)
    for (const right of a.positions)
      if (left !== right) {
        expect(
          Math.abs(left.x - right.x) >= (left.width + right.width) / 2 ||
            Math.abs(left.y - right.y) >= (left.height + right.height) / 2,
        ).toBe(true);
      }
  expect(layoutMindmap({ ...map, layout: 'tree' }).positions.every((p) => p.x >= 0)).toBe(true);
  expect(layoutMindmap(map, new Set(['a'])).positions.some((p) => p.node.id === 'a-1')).toBe(false);
  expect(mapNodes(map.root)).toHaveLength(5);
  expect(renderMindmapSvg(map, 'light', 'first')).toContain('id="first-light-a-1"');
  expect(renderMindmapSvg(map, 'dark', 'second')).not.toContain('id="first-');
});
it('renders list-based mindmaps in both layouts without invoking the Mermaid renderer', async () => {
  const source =
    ':::mindmap[Research]{layout="tree"}\n- Question\n  - Evidence\n    - Test <script>alert(1)</script>\n  - Conclusion\n:::';
  const diagrams = {
    render: () => {
      throw new Error('Mindmaps must not invoke Mermaid.');
    },
  } as any;
  const rendered = await renderMarkdown(source, { diagrams });
  expect(rendered.html).toContain('data-map-layout="tree" aria-pressed="true"');
  expect(rendered.html.match(/class="mindmap-drawing"/g)).toHaveLength(2);
  expect(rendered.html).toContain('Read text outline');
  expect(rendered.html).not.toContain('<script>');
  expect(
    analyzeSource(source.replace('layout="tree"', 'layout="radial"')).diagnostics.some(
      (d) => d.code === 'mindmap-layout',
    ),
  ).toBe(true);
});
it('rejects duplicate ids, oversized trees and empty labels before layout', () => {
  expect(() =>
    validateMindmap({
      ...map,
      root: { id: 'root', label: 'x', children: [{ id: 'root', label: 'y', children: [] }] },
    }),
  ).toThrow('Invalid mindmap tree');
  expect(() =>
    validateMindmap({ ...map, root: { id: 'root', label: '', children: [] } }),
  ).toThrow();
  expect(() =>
    validateMindmap({
      ...map,
      root: {
        id: 'root',
        label: 'x',
        children: Array.from({ length: 201 }, (_, n) => ({
          id: 'n' + n,
          label: 'x',
          children: [],
        })),
      },
    }),
  ).toThrow();
});
