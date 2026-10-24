import { MergeView, goToNextChunk, goToPreviousChunk } from '@codemirror/merge';
import { editorExtensions } from './editor.js';
export function createToolDiff(
  parent: HTMLElement,
  before: string,
  after: string,
  change: (side: 'before' | 'after', value: string) => void,
) {
  const view = new MergeView({
    parent,
    a: {
      doc: before,
      extensions: editorExtensions('Original text', (value) => change('before', value)),
    },
    b: {
      doc: after,
      extensions: editorExtensions('Changed text', (value) => change('after', value)),
    },
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: { margin: 3, minSize: 6 },
  });
  return {
    value: (side: 'before' | 'after') => (side === 'before' ? view.a : view.b).state.doc.toString(),
    navigate: (next: boolean) => {
      (next ? goToNextChunk : goToPreviousChunk)(view.a);
      view.a.focus();
    },
    destroy: () => view.destroy(),
  };
}
