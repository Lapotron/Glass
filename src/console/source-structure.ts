import { Decoration, ViewPlugin, EditorView } from '@codemirror/view';
import { mathAt } from './source-language.js';

const guides = (view: EditorView) => {
  const ranges = [];
  let last = -1;
  for (const visible of view.visibleRanges) {
    for (let line = view.state.doc.lineAt(visible.from); line.from <= visible.to;) {
      if (line.from !== last) {
        const indent = /^\s+/.exec(line.text)?.[0].replaceAll('\t', '    ').length || 0;
        if (indent)
          ranges.push(
            Decoration.line({
              class: 'cm-indent-guides',
              attributes: { style: `--indent-depth:${indent}ch` },
            }).range(line.from),
          );
        last = line.from;
      }
      if (line.to >= view.state.doc.length) break;
      line = view.state.doc.lineAt(line.to + 1);
    }
  }
  return Decoration.set(ranges);
};
export const sourceStructure = ViewPlugin.define(
  (view) => ({
    decorations: guides(view),
    update(change) {
      if (change.docChanged || change.viewportChanged) this.decorations = guides(change.view);
    },
  }),
  { decorations: (value) => value.decorations },
);

export function matchingMathEnvironment(view: EditorView) {
  const pos = view.state.selection.main.head,
    region = mathAt(view.state, pos);
  if (!region) return false;
  const text = view.state.doc.sliceString(region.from, region.to),
    tokens = [...text.matchAll(/\\(begin|end)\{([\w*]+)\}/g)];
  const current = tokens.findIndex(
    (token) =>
      region.from + token.index! <= pos && region.from + token.index! + token[0].length >= pos,
  );
  if (current < 0) return false;
  const direction = tokens[current][1] === 'begin' ? 1 : -1,
    name = tokens[current][2];
  let depth = 0;
  for (let index = current; index >= 0 && index < tokens.length; index += direction) {
    const token = tokens[index];
    if (token[2] !== name) continue;
    depth += token[1] === tokens[current][1] ? 1 : -1;
    if (depth === 0) {
      const target = region.from + token.index!;
      view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: 'center' }),
      });
      return true;
    }
  }
  return false;
}
