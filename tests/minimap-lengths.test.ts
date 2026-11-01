import { expect, it } from 'vitest';
import { EditorState, type ChangeSpec } from '@codemirror/state';
import { minimapLengths } from '../src/console/SourceMinimap.js';

it('updates minimap line lengths across ordinary edits, joined lines, multiple selections and large replacements', () => {
  let state = EditorState.create({
    doc: '  first  \nsecond\n\n fourth',
    extensions: [minimapLengths],
  });
  const check = () =>
    expect(state.field(minimapLengths)).toEqual(
      state.doc
        .toString()
        .split('\n')
        .map((line) => line.trim().length),
    );
  const change = (changes: ChangeSpec) => {
    state = state.update({ changes }).state;
    check();
  };
  check();
  change({ from: 3, to: 5, insert: 'XYZ\n  new  ' });
  const boundary = state.doc.line(2).to;
  change({ from: boundary, to: boundary + 1 });
  change([
    { from: 1, insert: 'a' },
    { from: 3, to: 4, insert: 'b' },
    { from: state.doc.length, insert: '\nend' },
  ]);
  change({ from: 0, to: state.doc.length, insert: '  row  \n'.repeat(6001) });
  change({ from: 0, to: state.doc.length, insert: '' });
  let seed = 13;
  const random = (maximum: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % maximum;
  };
  const inserts = ['', 'x', '\n', ' y \n z ', '\t', '  😀  '];
  for (let i = 0; i < 400; i++) {
    const from = random(state.doc.length + 1),
      to = from + random(state.doc.length - from + 1);
    change({ from, to, insert: inserts[random(inserts.length)] });
  }
});
