import { expect, it, vi, afterEach } from 'vitest';
import { EditorState, type Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  CompletionContext,
  nextSnippetField,
  prevSnippetField,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { history, undo } from '@codemirror/commands';
import { ensureSyntaxTree, foldable, indentUnit, syntaxTree } from '@codemirror/language';
import { sourceLanguage, fenceAt, mathAt } from '../src/console/source-language.js';
import { pseudocodeLanguage } from '../src/console/pseudocode-language.js';
import { blogCompletions } from '../src/console/markdown-assistance.js';
import {
  pseudocodeCompletion,
  pseudocodeIndex,
  matchingPseudocodeBlock,
  pseudocodeStructure,
  jumpPseudocodeBlock,
  beautifyPseudocodeOperators,
} from '../src/console/pseudocode-intelligence.js';
import { renderPseudocode } from '../src/engine/pseudocode.js';
import { readSourcePreferences } from '../src/console/source-analysis.js';
import { quicksortSource } from '../src/shared/pseudocode-authoring.js';
import { markdownSnippets, instantiateSnippet } from '../src/shared/markdown-snippets.js';
import { authoringCapabilities } from '../src/shared/authoring-capabilities.js';

afterEach(() => vi.unstubAllGlobals());
function stateFor(doc: string, position = doc.length, indent = '  ') {
  const state = EditorState.create({
    doc,
    selection: { anchor: position },
    extensions: [sourceLanguage(), history(), pseudocodeStructure, indentUnit.of(indent)],
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}
const markdown = (state: EditorState) =>
  blogCompletions(() => ({ links: [], media: [] }))(
    new CompletionContext(state, state.selection.main.head, true),
  );
const pseudo = (state: EditorState, explicit = true) =>
  pseudocodeCompletion(new CompletionContext(state, state.selection.main.head, explicit));
function apply(state: EditorState, result: CompletionResult | null, label: string) {
  const option = result?.options.find((option) => option.label === label);
  if (!option || !result) throw new Error('Missing completion: ' + label);
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
    focus() {},
  } as unknown as EditorView;
  if (typeof option.apply === 'function')
    option.apply(view, option, result.from, state.selection.main.head);
  else
    view.dispatch(
      state.update({
        changes: {
          from: result.from,
          to: state.selection.main.head,
          insert: option.apply || option.label,
        },
      }),
    );
  return {
    view,
    get state() {
      return state;
    },
  };
}

it('completes EOF headers, aliases and metadata before entering the fenced body', async () => {
  for (const alias of ['pseudo', 'pseudocode', 'algorithm']) {
    const state = stateFor('```' + alias);
    expect(markdown(state)?.options.map((option) => option.label)).toEqual(
      expect.arrayContaining(['pseudo', 'pseudocode', 'algorithm']),
    );
    expect(pseudo(state)?.options[0].label).toBe('Quicksort scaffold');
    expect(
      markdown(stateFor('```' + alias + ' st'))?.options.map((option) => option.label),
    ).toContain('style');
    expect(
      markdown(stateFor('```' + alias + ' style="c'))?.options.map((option) => option.label),
    ).toEqual(['algorithm', 'code']);
  }
  expect(markdown(stateFor('```pseudo title="Sort'))).toBeNull();
  // Warm the lazily loaded language, then verify outer Markdown context still survives its mount.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const body = stateFor('```pseudo title="Sort"\nPRO');
  expect(fenceAt(body, body.doc.length)?.info).toBe('pseudo title="Sort"');
  expect(pseudo(body)?.options.some((option) => option.label === 'PROCEDURE')).toBe(true);
  expect(markdown(body)).toBeNull();
});

it('fills empty aliased, tilde and nested fences without destroying metadata or doubling fences', () => {
  for (const [header, close] of [
    ['```pseudo title="Sort" style="code"', '```'],
    ['~~~algorithm wrap', '~~~~'],
    ['> ```pseudocode title="Sort"', '> ```'],
    ['- ```pseudo', '  ```'],
  ]) {
    const source = header + '\n' + close;
    const state = stateFor(source, header.length);
    const result = apply(state, pseudo(state), 'Quicksort scaffold');
    const text = result.state.doc.toString();
    expect(text.startsWith(header + '\n')).toBe(true);
    expect(text.endsWith('\n' + close)).toBe(true);
    expect(text).toContain('FUNCTION PARTITION');
    expect(text.match(/[`~]{3,}/g)).toHaveLength(2);
    expect(text).not.toContain('${');
    expect(undo(result.view)).toBe(true);
    expect(result.state.doc.toString()).toBe(source);
  }
  const nonempty = '```pseudo\nRETURN 1\n```';
  expect(pseudo(stateFor(nonempty, 9))).toBeNull();
  const compactQuote = '> ```pseudo\n>```';
  const quoteState = stateFor(compactQuote, compactQuote.indexOf('\n'));
  const quoteResult = apply(quoteState, pseudo(quoteState), 'Quicksort scaffold');
  expect(quoteResult.state.doc.toString()).toContain('\n> ```');
  expect(quoteResult.state.doc.toString().match(/`{3,}/g)).toHaveLength(2);
  const unclosed = stateFor('```pseudo');
  expect(apply(unclosed, pseudo(unclosed), 'Quicksort scaffold').state.doc.toString()).toBe(
    '```pseudo\n' + quicksortSource + '\n```',
  );
});

it('inserts linked snippet fields, configured indentation and matching END only on acceptance', () => {
  for (const prefix of ['', '> ', '  ']) {
    const source = prefix + '```pseudo\n' + prefix + '  pro\n' + prefix + '```';
    const state = stateFor(source, source.indexOf('pro\n') + 3, '    ');
    const inserted = apply(state, pseudo(state), 'procedure');
    const text = inserted.state.doc.toString();
    expect(text).toContain(
      prefix +
        '  PROCEDURE name(parameters)\n' +
        prefix +
        '      action\n' +
        prefix +
        '  END PROCEDURE',
    );
    expect(
      inserted.state.sliceDoc(inserted.state.selection.main.from, inserted.state.selection.main.to),
    ).toBe('name');
    expect(nextSnippetField(inserted.view)).toBe(true);
    expect(
      inserted.state.sliceDoc(inserted.state.selection.main.from, inserted.state.selection.main.to),
    ).toBe('parameters');
    expect(prevSnippetField(inserted.view)).toBe(true);
    expect(undo(inserted.view)).toBe(true);
    expect(inserted.state.doc.toString()).toBe(source);
  }
});

it('limits symbols and suggestions to the active fence, excluding literal strings/comments/math', () => {
  const source =
    '```pseudo\nFUNCTION FIRST(secret)\nEND FUNCTION\n```\n\n```algorithm\nPROCEDURE SORT(values, lo, hi)\n  pivot ← values[hi]\n  FOR j ← lo TO hi DO\n    IF TRUE THEN\n      RET\n    END IF\n  END FOR\nEND PROCEDURE\n```';
  const state = stateFor(source, source.indexOf('RET') + 3);
  const fence = fenceAt(state, state.selection.main.head)!;
  const indexed = pseudocodeIndex(state, fence)!;
  expect(pseudocodeIndex(state, fence)).toBe(indexed);
  expect(indexed.symbols.map((symbol) => symbol.name)).toEqual(
    expect.arrayContaining(['SORT', 'values', 'lo', 'hi', 'pivot', 'j']),
  );
  expect(indexed.symbols.map((symbol) => symbol.name)).not.toContain('secret');
  expect(pseudo(state)?.options.map((option) => option.label)).toEqual(
    expect.arrayContaining(['RETURN', 'values', 'length', '←', 'quicksort']),
  );
  for (const literal of ['// RETURN', '# note ', '"RETURN', '"a b ', '$x + RETURN', '$\\alpha$']) {
    expect(pseudo(stateFor('```pseudo\n' + literal))).toBeNull();
  }
  expect(pseudo(stateFor('```python\nRET'))).toBeNull();
  expect(pseudo(stateFor('ordinary pro'))).toBeNull();
  expect(pseudo(stateFor('```pseudo\n'), false)).toBeNull();
  expect(mathAt(stateFor('```pseudo\n$\\alpha$'), 20)).toBeNull();
});

it('matches nested END and UNTIL tokens and folds only recognized complete blocks', () => {
  const source =
    '```pseudo\nPROCEDURE SORT(A)\n  REPEAT\n    IF A THEN\n      // END IF\n      RETURN "END IF"\n    ELSE\n      A ← 1\n    END IF\n  UNTIL done\nEND PROCEDURE\n```';
  const state = stateFor(source, source.indexOf('IF A'));
  const fence = fenceAt(state, state.selection.main.head)!;
  const index = pseudocodeIndex(state, fence)!;
  expect(index.blocks.map((block) => block.kind)).toEqual(['IF', 'REPEAT', 'PROCEDURE']);
  const match = matchingPseudocodeBlock(state, state.selection.main.head)!;
  expect(state.sliceDoc(match.close.from, match.close.to)).toBe('END IF');
  expect(match.branches.map((marker) => state.sliceDoc(marker.from, marker.to))).toEqual(['ELSE']);
  const line = state.doc.lineAt(match.open.from);
  expect(foldable(state, line.from, line.to)).toEqual({ from: line.to, to: match.close.to });
  let changed = state;
  const view = {
    get state() {
      return changed;
    },
    dispatch(spec: Parameters<EditorState['update']>[0]) {
      changed = changed.update(spec).state;
    },
  } as unknown as EditorView;
  expect(jumpPseudocodeBlock(view)).toBe(true);
  expect(changed.selection.main.head).toBe(match.close.from);
  expect(jumpPseudocodeBlock(view)).toBe(true);
  expect(changed.selection.main.head).toBe(match.open.from);
  expect(
    pseudocodeIndex(
      stateFor('```pseudo\n' + 'IF x THEN\n'.repeat(2001)),
      fenceAt(stateFor('```pseudo\n' + 'IF x THEN\n'.repeat(2001)), 15)!,
    ),
  ).toBeNull();
});

it('retains authoring validity, unique labels and source-only preferences without erasing other settings', () => {
  const algorithm = markdownSnippets.find((item) => item.type === 'algorithm')!.value;
  expect(algorithm).toContain(quicksortSource);
  expect(instantiateSnippet(algorithm)).not.toBe(instantiateSnippet(algorithm));
  const state = stateFor('/algorithm');
  const result = apply(state, markdown(state), 'algorithm');
  expect(result.state.doc.toString()).toContain(quicksortSource);
  expect(result.state.doc.toString()).not.toContain('${');
  const fourSpaces = stateFor('/algorithm', 10, '    ');
  expect(apply(fourSpaces, markdown(fourSpaces), 'algorithm').state.doc.toString()).toContain(
    '\n    IF lo < hi THEN\n        p ← PARTITION',
  );
  expect(authoringCapabilities().code.pseudocode).toMatchObject({
    aliases: ['pseudo', 'algorithm'],
  });
  vi.stubGlobal('localStorage', {
    getItem: () =>
      JSON.stringify({
        version: 1,
        indent: 4,
        minimap: false,
        completeOnTyping: false,
        completionShortcut: 'Ctrl-Space',
        componentPreviews: { pseudocode: true, table: false, mermaid: true },
      }),
  });
  expect(readSourcePreferences('legacy')).toMatchObject({
    indent: 4,
    minimap: false,
    completeOnTyping: false,
    componentPreviews: { pseudocode: false, table: false, mermaid: true },
  });
});

it('keeps pseudocode-specific tokens inside mounted code and leaves dollar expressions literal', () => {
  const state = EditorState.create({
    doc: 'PROCEDURE Sort(A)\nIF true THEN\n  RETURN length(A) + $x^2$ // note\nEND IF',
    extensions: [pseudocodeLanguage],
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  const tree = syntaxTree(state).toString();
  expect(tree).toContain('pseudodeclaration');
  expect(tree).toContain('pseudofunction');
  expect(tree).toContain('pseudomath');
  expect(tree).not.toContain('InlineMath');
});

it('renders narrow mathematical operators while preserving literal content and exact copied source', async () => {
  const source =
    'x <- y\nx -> y\nx <-> y\nx <= y AND x >= 0\nx != y OR x <> y\np => q\np <=> q\nRETURN "x -> y" // -> literal\nRETURN $x \\to y$';
  for (const style of ['algorithm', 'code']) {
    const calls: string[] = [];
    const html = await renderPseudocode(
      source,
      'style="' + style + '"',
      'symbol-example',
      async (math, operator) => {
        if (operator) calls.push(math);
        return '<i>' + math + '</i>';
      },
    );
    const rendered = html.split('<template')[0];
    for (const symbol of ['←', '→', '↔', '≤', '≥', '≠', '⇒', '⇔'])
      expect(rendered).toContain('data-pseudo-symbol="' + symbol + '"');
    expect(calls).toContain('\\rightarrow');
    expect(calls).toContain('\\leq');
    expect(calls.filter((tex) => tex === '\\neq')).toHaveLength(1);
    expect(rendered).toContain('x -&gt; y');
    expect(rendered).toContain('// -&gt; literal');
    expect(html).toContain(
      '<template data-code-source>' +
        source
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;') +
        '</template>',
    );
  }
  const code = '```pseudo\nINPUT a, b\na <- b\nRETURN "a -> b" // <=\nRETURN $a \\to b$\n```';
  const state = stateFor(code, code.indexOf('a <-') + 2);
  let current = state;
  const view = {
    get state() {
      return current;
    },
    dispatch(spec: Parameters<EditorState['update']>[0] | Transaction) {
      current = 'state' in spec ? spec.state : current.update(spec).state;
    },
  } as unknown as EditorView;
  expect(beautifyPseudocodeOperators(view)).toBe(true);
  expect(current.doc.toString()).toBe(code.replace('a <- b', 'a ← b'));
  expect(undo(view)).toBe(true);
  expect(current.doc.toString()).toBe(code);
  const operatorState = stateFor('```pseudo\nx ->');
  const choice = pseudo(operatorState)!;
  expect(choice.options[0].label).toBe('→');
  expect(apply(operatorState, choice, '→').state.doc.toString()).toBe('```pseudo\nx →');
});
