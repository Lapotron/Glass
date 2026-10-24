import { EditorState, Compartment, Prec, type Extension } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  keymap,
  tooltips,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
  StreamLanguage,
} from '@codemirror/language';
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { tags } from '@lezer/highlight';
import { currentUiCatalog, t } from '../../shared/i18n.js';
export type ToolEditor = {
  value: () => string;
  set: (source: string) => void;
  insert: (source: string) => void;
  destroy: () => void;
  view: EditorView;
};
const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.typeName, tags.attributeName], color: 'var(--accent-text)' },
    { tag: [tags.string, tags.regexp], color: 'var(--success)' },
    { tag: [tags.number, tags.bool, tags.atom], color: 'var(--warning)' },
    { tag: [tags.comment, tags.meta], color: 'var(--faint)' },
    { tag: [tags.operator, tags.punctuation], color: 'var(--muted)' },
    { tag: tags.invalid, color: 'var(--danger)' },
  ]),
);
export function editorExtensions(
  label: string,
  change: (value: string) => void,
  readonly = false,
): Extension[] {
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    highlighting,
    tooltips({ parent: document.body }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
    ]),
    EditorView.lineWrapping,
    EditorState.readOnly.of(readonly),
    EditorView.editable.of(!readonly),
    EditorView.contentAttributes.of({
      'aria-label': t(label),
      'data-no-ui': '',
      spellcheck: 'false',
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) change(update.state.doc.toString());
    }),
  ];
}
export function createToolEditor(
  parent: HTMLElement,
  source: string,
  change: (source: string) => void,
  options: {
    label: string;
    language?: string;
    readonly?: boolean;
    completion?: CompletionSource;
    extensions?: Extension[];
  },
): ToolEditor {
  const phrases = new Compartment(),
    attrs = new Compartment();
  const language =
    options.language === 'json'
      ? json()
      : options.language === 'yaml'
        ? StreamLanguage.define(yaml)
        : options.language === 'tex'
          ? StreamLanguage.define(stex)
          : [];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...editorExtensions(options.label, change, options.readonly),
        language,
        phrases.of(EditorState.phrases.of(currentUiCatalog())),
        Prec.high(attrs.of(EditorView.contentAttributes.of({ 'aria-label': t(options.label) }))),
        ...(options.completion ? [autocompletion({ override: [options.completion] })] : []),
        ...(options.extensions || []),
      ],
    }),
  });
  const translate = () =>
    view.dispatch({
      effects: [
        phrases.reconfigure(EditorState.phrases.of(currentUiCatalog())),
        attrs.reconfigure(EditorView.contentAttributes.of({ 'aria-label': t(options.label) })),
      ],
    });
  addEventListener('glass:tools-locale', translate);
  return {
    view,
    value: () => view.state.doc.toString(),
    set: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    insert: (text) => {
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    },
    destroy: () => {
      removeEventListener('glass:tools-locale', translate);
      view.destroy();
    },
  };
}
