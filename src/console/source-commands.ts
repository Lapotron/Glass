import { EditorSelection, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  undo,
  redo,
  moveLineUp,
  moveLineDown,
  copyLineUp,
  copyLineDown,
  deleteLine,
  cursorMatchingBracket,
} from '@codemirror/commands';
import { foldAll, unfoldAll, foldCode, unfoldCode } from '@codemirror/language';
import {
  openSearchPanel,
  gotoLine,
  selectNextOccurrence,
  selectSelectionMatches,
} from '@codemirror/search';

export function wrapSource(view: EditorView, before: string, after = before, placeholder = 'text') {
  view.dispatch(
    view.state.changeByRange((range) => {
      const selected = view.state.sliceDoc(range.from, range.to) || placeholder;
      const wrapped =
        range.from >= before.length &&
        view.state.sliceDoc(range.from - before.length, range.from) === before &&
        view.state.sliceDoc(range.to, range.to + after.length) === after;
      return wrapped
        ? {
            changes: [
              { from: range.from - before.length, to: range.from, insert: '' },
              { from: range.to, to: range.to + after.length, insert: '' },
            ],
            range: EditorSelection.range(range.from - before.length, range.to - before.length),
          }
        : {
            changes: { from: range.from, to: range.to, insert: before + selected + after },
            range: EditorSelection.range(
              range.from + before.length,
              range.from + before.length + selected.length,
            ),
          };
    }),
    { annotations: Transaction.userEvent.of('input.format') },
  );
  view.focus();
  return true;
}
export function prefixSource(view: EditorView, prefix: string) {
  const selected = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const end = view.state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to).number;
    for (let line = view.state.doc.lineAt(range.from).number; line <= end; line++)
      selected.add(line);
  }
  const lines = [...selected].map((number) => view.state.doc.line(number));
  const remove = lines.every((line) => line.text.startsWith(prefix));
  view.dispatch({
    changes: lines.map((line) => ({
      from: line.from,
      to: line.from + (remove ? prefix.length : 0),
      insert: remove ? '' : prefix,
    })),
    annotations: Transaction.userEvent.of('input.format'),
  });
  view.focus();
  return true;
}
export const editingCommands = [
  {
    id: 'matching-bracket',
    label: 'Go to matching bracket',
    shortcut: 'Mod Shift \\',
    run: cursorMatchingBracket,
  },
  { id: 'find', label: 'Find and replace', shortcut: 'Mod F', run: openSearchPanel },
  { id: 'line', label: 'Go to line / column', shortcut: 'Mod Alt G', run: gotoLine },
  { id: 'undo', label: 'Undo', shortcut: 'Mod Z', run: undo },
  { id: 'redo', label: 'Redo', shortcut: 'Mod Shift Z', run: redo },
  {
    id: 'bold',
    label: 'Bold selection',
    shortcut: 'Mod B',
    run: (v: EditorView) => wrapSource(v, '**'),
  },
  {
    id: 'italic',
    label: 'Italic selection',
    shortcut: 'Mod I',
    run: (v: EditorView) => wrapSource(v, '*'),
  },
  { id: 'heading', label: 'Toggle heading', run: (v: EditorView) => prefixSource(v, '## ') },
  { id: 'bullet', label: 'Toggle bullet list', run: (v: EditorView) => prefixSource(v, '- ') },
  { id: 'numbered', label: 'Toggle numbered list', run: (v: EditorView) => prefixSource(v, '1. ') },
  { id: 'task', label: 'Toggle task list', run: (v: EditorView) => prefixSource(v, '- [ ] ') },
  { id: 'quote', label: 'Toggle blockquote', run: (v: EditorView) => prefixSource(v, '> ') },
  { id: 'inline-code', label: 'Inline code', run: (v: EditorView) => wrapSource(v, '`') },
  { id: 'highlight', label: 'Highlight selection', run: (v: EditorView) => wrapSource(v, '==') },
  {
    id: 'code',
    label: 'Code fence',
    run: (v: EditorView) => wrapSource(v, '```\n', '\n```', '// code'),
  },
  { id: 'math', label: 'Inline math', run: (v: EditorView) => wrapSource(v, '$', '$', 'x^2') },
  {
    id: 'equation',
    label: 'Display equation',
    run: (v: EditorView) => wrapSource(v, '\n$$\n', '\n$$\n', 'y = x^2'),
  },
  {
    id: 'link',
    label: 'Insert link',
    run: (v: EditorView) => wrapSource(v, '[', '](https://example.com)', 'link text'),
  },
  {
    id: 'rule',
    label: 'Insert horizontal rule',
    run: (v: EditorView) => wrapSource(v, '\n\n---\n', '\n', ''),
  },
  { id: 'fold', label: 'Fold section', run: foldCode },
  { id: 'unfold', label: 'Unfold section', run: unfoldCode },
  { id: 'fold-all', label: 'Fold all sections', run: foldAll },
  { id: 'unfold-all', label: 'Unfold all sections', run: unfoldAll },
  { id: 'up', label: 'Move line up', shortcut: 'Alt ↑', run: moveLineUp },
  { id: 'down', label: 'Move line down', shortcut: 'Alt ↓', run: moveLineDown },
  { id: 'copy-up', label: 'Duplicate line above', shortcut: 'Alt Shift ↑', run: copyLineUp },
  { id: 'copy-down', label: 'Duplicate line below', shortcut: 'Alt Shift ↓', run: copyLineDown },
  { id: 'delete', label: 'Delete line', shortcut: 'Mod Shift K', run: deleteLine },
  { id: 'next', label: 'Select next occurrence', shortcut: 'Mod D', run: selectNextOccurrence },
  { id: 'all', label: 'Select all occurrences', run: selectSelectionMatches },
];
