import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { mermaidLanguage } from './mermaid-language.js';
import { sourceHighlighting } from './source-theme.js';
import { t } from '../shared/i18n.js';

/** The component dialog gets a small source view, independent from the mounted article editor. */
export function MermaidSourceField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView>(null),
    callback = useRef(onChange),
    syncing = useRef(false);
  callback.current = onChange;
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          mermaidLanguage,
          sourceHighlighting,
          search(),
          EditorView.contentAttributes.of({ 'aria-label': t('Mermaid source') }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current)
              callback.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      syncing.current = true;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
      syncing.current = false;
    }
  }, [value]);
  return <div className="code-editor mermaid-source-editor" ref={host} />;
}
