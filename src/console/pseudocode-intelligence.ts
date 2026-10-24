import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { EditorSelection, type EditorState, type Text } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { foldService, syntaxTree, indentUnit } from '@codemirror/language';
import {
  pseudocodeKeywords,
  pseudocodeOperatorPattern,
  pseudocodeOperatorSymbols,
  pseudocodeOperatorSymbol,
} from '../shared/pseudocode.js';
import { Transaction } from '@codemirror/state';
import {
  pseudocodeBuiltins,
  pseudocodeOperators,
  pseudocodeSnippets,
  quicksortSource,
} from '../shared/pseudocode-authoring.js';
import { fenceAt } from './source-language.js';
import { t } from '../shared/i18n.js';

type Fence = NonNullable<ReturnType<typeof fenceAt>>;
type Marker = { from: number; to: number };
export type PseudocodeBlock = { kind: string; open: Marker; close: Marker; branches: Marker[] };
export type PseudocodeIndex = {
  symbols: { name: string; type: string }[];
  blocks: PseudocodeBlock[];
};
const indexes = new WeakMap<Text, Map<string, PseudocodeIndex | null>>();
export const isPseudocode = (info: string) =>
  /^(pseudocode|pseudo|algorithm)(?:\s|$)/i.test(info.trim());
const escape = (text: string) => text.replace(/[{}]/g, (brace) => '\\' + brace);

/** Hide literal content while preserving offsets. This is notation assistance, not a grammar validator. */
export function pseudocodeMask(line: string) {
  return line.replace(
    /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|\$(?:\\.|[^$\n])*(?:\$|$)|(?:\/\/|#).*/g,
    (literal) => ' '.repeat(literal.length),
  );
}
function continuation(fence: Fence) {
  return fence.prefix.replace(/(?:[*+-]|\d+[.)])(?=\s)/g, (marker) => ' '.repeat(marker.length));
}
function codeLine(text: string, fence: Fence) {
  const prefix = continuation(fence);
  return prefix && text.startsWith(prefix)
    ? { text: text.slice(prefix.length), prefix }
    : { text, prefix: '' };
}
function prefixedTemplate(template: string, state: EditorState, from: number, prefix: string) {
  const whitespace = /^\s*/.exec(state.doc.lineAt(from).text)![0];
  const unit = state.facet(indentUnit);
  return template
    .replace(/^\t+/gm, (tabs) => unit.repeat(tabs.length))
    .replaceAll('\n', '\n' + prefix.slice(whitespace.length));
}

/** One bounded index per edited fence; selection and viewport changes reuse it without copying source. */
export function pseudocodeIndex(state: EditorState, fence: Fence): PseudocodeIndex | null {
  const key = `${fence.from}:${fence.to}:${fence.bodyFrom}:${fence.bodyTo}`;
  let cache = indexes.get(state.doc);
  if (!cache) indexes.set(state.doc, (cache = new Map()));
  if (cache.has(key)) return cache.get(key)!;
  const start = state.doc.lineAt(fence.headerTo).number + 1;
  const end =
    fence.closeFrom === undefined
      ? state.doc.lineAt(fence.to).number
      : state.doc.lineAt(fence.closeFrom).number - 1;
  if (end - start + 1 > 2000 || fence.to - fence.from > 65536) {
    if (cache.size >= 8) cache.delete(cache.keys().next().value!);
    cache.set(key, null);
    return null;
  }
  const symbols = new Map<string, string>();
  const blocks: PseudocodeBlock[] = [];
  const stack: { kind: string; open: Marker; branches: Marker[] }[] = [];
  const add = (name: string, type: string) => {
    if (symbols.size < 200 && !pseudocodeKeywords.includes(name.toLowerCase()))
      symbols.set(name, type);
  };
  for (let number = start; number <= end; number++) {
    const line = state.doc.line(number),
      body = codeLine(line.text, fence);
    const code = pseudocodeMask(body.text),
      offset = line.from + body.prefix.length;
    const declaration =
      /^\s*(?:PROCEDURE|FUNCTION|ALGORITHM)\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/i.exec(code);
    if (declaration) {
      add(declaration[1], 'function');
      for (const param of (declaration[2] || '').split(',')) {
        const name = /^\s*([A-Za-z_]\w*)/.exec(param)?.[1];
        if (name) add(name, 'variable');
      }
    }
    const input = /^\s*INPUT\s+(.+)$/i.exec(code);
    if (input)
      for (const part of input[1].split(',')) {
        const name = /^\s*([A-Za-z_]\w*)/.exec(part)?.[1];
        if (name) add(name, 'variable');
      }
    for (const match of code.matchAll(/\b([A-Za-z_]\w*)(?:\[[^\]\n]*\])?\s*(?:←|<-|:=)/g))
      add(match[1], 'variable');
    const each = /^\s*FOR\s+EACH\s+([A-Za-z_]\w*)/i.exec(code);
    if (each) add(each[1], 'variable');
    const token =
      /^\s*(END\s+(?:PROCEDURE|FUNCTION|ALGORITHM|IF|FOR|WHILE)|END(?:PROCEDURE|FUNCTION|ALGORITHM|IF|FOR|WHILE)|END|UNTIL|ELSE\s+IF|ELSEIF|ELSE|PROCEDURE|FUNCTION|ALGORITHM|IF|FOR|WHILE|REPEAT)\b/i.exec(
        code,
      );
    if (!token) continue;
    const word = token[1].toUpperCase().replace(/\s+/g, ' '),
      from = offset + token[0].indexOf(token[1]);
    const marker = { from, to: from + token[1].length };
    if (word.startsWith('ELSE')) {
      if (stack.at(-1)?.kind === 'IF') stack.at(-1)!.branches.push(marker);
    } else if (word.startsWith('END') || word === 'UNTIL') {
      const kind = word === 'UNTIL' ? 'REPEAT' : word.replace(/^END\s*/, '');
      if (stack.length && (!kind || stack.at(-1)!.kind === kind)) {
        blocks.push({ ...stack.pop()!, close: marker });
      }
    } else stack.push({ kind: word, open: marker, branches: [] });
  }
  const result = { symbols: [...symbols].map(([name, type]) => ({ name, type })), blocks };
  // Do not retain an unbounded number of fences in a long-lived document state.
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

/** Turn valid source examples into linked editable fields; never export snippet markers in Markdown. */
export function pseudocodeTemplate(source: string, fields: readonly string[], first = 1) {
  const numbers = new Map(fields.map((field, i) => [field, first + i]));
  return escape(source).replace(/\b[A-Za-z_]\w*\b/g, (word) =>
    numbers.has(word) ? '${' + numbers.get(word) + ':' + word + '}' : word,
  );
}

function blockCompletion(item: (typeof pseudocodeSnippets)[number], fence: Fence): Completion {
  return {
    label: item.name,
    detail: t(item.description),
    type: 'text',
    section: { name: t('Block snippets'), rank: 0 },
    boost: 10,
    apply(view, completion, from, to) {
      // Re-check the captured context before applying a possibly stale menu item.
      const current = fenceAt(view.state, from);
      if (
        !current ||
        current.from !== fence.from ||
        !isPseudocode(current.info) ||
        from <= current.headerTo
      )
        return;
      const prefix = continuation(current);
      const source =
        item.name === 'quicksort'
          ? item.source.replace(/^(?: {2})+/gm, (spaces) => '\t'.repeat(spaces.length / 2))
          : item.source;
      const template = pseudocodeTemplate(source, item.fields) + '${0}';
      // CodeMirror supplies whitespace indentation; only quote prefixes need explicit continuation.
      const quote = prefix.includes('>')
        ? prefix + /^\s*/.exec(codeLine(view.state.doc.lineAt(from).text, current).text)![0]
        : '';
      snippet(quote ? prefixedTemplate(template, view.state, from, quote) : template)(
        view,
        completion,
        from,
        to,
      );
    },
  };
}

function emptyBody(state: EditorState, fence: Fence) {
  if (fence.to - fence.from > 65536) return false;
  const start = state.doc.lineAt(fence.headerTo).number + 1;
  const end =
    fence.closeFrom === undefined
      ? state.doc.lineAt(fence.to).number
      : state.doc.lineAt(fence.closeFrom).number - 1;
  for (let n = start; n <= end; n++)
    if (codeLine(state.doc.line(n).text, fence).text.trim()) return false;
  return true;
}

export function pseudocodeCompletion(context: CompletionContext): CompletionResult | null {
  const fence = fenceAt(context.state, context.pos);
  if (!fence || !isPseudocode(fence.info)) return null;
  const line = context.state.doc.lineAt(context.pos);
  if (context.pos <= fence.headerTo) {
    // A complete alias at the end of an empty fence offers the scaffold alongside language names.
    if (context.pos !== fence.headerTo || !emptyBody(context.state, fence)) return null;
    return {
      from: context.pos,
      filter: false,
      options: [
        {
          label: t('Quicksort scaffold'),
          detail: t('Fill this empty fence; preserve its language and metadata'),
          type: 'text',
          apply(view, completion) {
            const current = fenceAt(view.state, context.pos);
            if (
              !current ||
              current.info !== fence.info ||
              current.from !== fence.from ||
              !emptyBody(view.state, current)
            )
              return;
            const prefix = continuation(current);
            const closed = current.closeFrom !== undefined;
            const closing = closed ? view.state.doc.lineAt(current.closeFrom!) : null;
            const source = quicksortSource.replace(/^(?: {2})+/gm, (spaces) =>
              '\t'.repeat(spaces.length / 2),
            );
            const template = prefixedTemplate(
              '\n' + pseudocodeTemplate(source, ['A', 'lo', 'hi']) + '\n' + current.marker + '${0}',
              view.state,
              current.headerTo,
              prefix,
            );
            // The existing closing marker (including a longer marker) is retained verbatim.
            const closingText = closing
              ? closing.text.slice(current.closeFrom! - closing.from)
              : current.marker;
            snippet(template.replace(current.marker + '${0}', closingText + '${0}'))(
              view,
              completion,
              current.headerTo,
              closing?.to ?? current.to,
            );
          },
        },
      ],
    };
  }
  if (
    fence.closeFrom !== undefined &&
    line.number >= context.state.doc.lineAt(fence.closeFrom).number
  )
    return null;
  const body = codeLine(line.text, fence);
  const localPos = context.pos - line.from - body.prefix.length;
  if (localPos < 0) return null;
  const before = body.text.slice(0, localPos);
  const word = /[A-Za-z_]\w*$/.exec(before);
  const masked = pseudocodeMask(body.text);
  // Never offer code inside strings, comments or $math$, including incomplete literals.
  const check = word ? localPos - word[0].length : before.search(/\S(?=\s*$)/);
  if (body.text[check] && masked[check] === ' ' && body.text[check] !== ' ') return null;
  const operator = /(?:<=>|<->|->|<-|=>|<=|>=|!=|<>)$/.exec(before);
  if (operator)
    return {
      from: context.pos - operator[0].length,
      filter: false,
      options: [
        {
          label: pseudocodeOperatorSymbols[operator[0]],
          displayLabel: pseudocodeOperatorSymbols[operator[0]] + '  ' + operator[0],
          detail: t('Typographic operator'),
          type: 'operator',
        },
      ],
    };
  if (!word && !context.explicit) return null;
  const from = context.pos - (word?.[0].length || 0);
  const index = pseudocodeIndex(context.state, fence);
  return {
    from,
    validFor: /^[\w]*$/,
    options: [
      ...pseudocodeSnippets
        .filter(
          (item) =>
            !before.slice(0, before.length - (word?.[0].length || 0)).trim() ||
            ['assign', 'swap'].includes(item.name),
        )
        .map((item) => blockCompletion(item, fence)),
      ...pseudocodeKeywords.map((keyword): Completion => ({
        label: keyword.toUpperCase(),
        type: 'keyword',
        section: { name: t('Keywords'), rank: 2 },
      })),
      ...pseudocodeBuiltins.map((label): Completion => ({
        label,
        type: 'function',
        section: { name: t('Built-ins'), rank: 3 },
      })),
      ...pseudocodeOperators.map((label): Completion => ({
        label,
        type: 'operator',
        section: { name: t('Operators'), rank: 4 },
      })),
      ...(index?.symbols || []).map(({ name, type }): Completion => ({
        label: name,
        type,
        detail: t('This fence'),
        section: { name: t('Local symbols'), rank: 1 },
      })),
    ],
  };
}

export function matchingPseudocodeBlock(state: EditorState, position: number) {
  const fence = fenceAt(state, position);
  if (!fence || !isPseudocode(fence.info) || position <= fence.headerTo) return null;
  const blocks = pseudocodeIndex(state, fence)?.blocks || [];
  return (
    blocks
      .filter((block) => block.open.from <= position && position <= block.close.to)
      .sort((a, b) => a.close.to - a.open.from - (b.close.to - b.open.from))[0] || null
  );
}

export function jumpPseudocodeBlock(view: EditorView) {
  const position = view.state.selection.main.head;
  const block = matchingPseudocodeBlock(view.state, position);
  if (!block) return false;
  const target = position >= block.close.from ? block.open.from : block.close.from;
  view.dispatch({
    selection: EditorSelection.cursor(target),
    effects: EditorView.scrollIntoView(target, { y: 'center' }),
  });
  return true;
}

export function beautifyPseudocodeOperators(view: EditorView) {
  const fence = fenceAt(view.state, view.state.selection.main.head);
  if (!fence || !isPseudocode(fence.info) || !pseudocodeIndex(view.state, fence)) return false;
  const changes: { from: number; to: number; insert: string }[] = [];
  const start = view.state.doc.lineAt(fence.headerTo).number + 1;
  const end =
    fence.closeFrom === undefined
      ? view.state.doc.lineAt(fence.to).number
      : view.state.doc.lineAt(fence.closeFrom).number - 1;
  for (let n = start; n <= end; n++) {
    const line = view.state.doc.line(n),
      body = codeLine(line.text, fence);
    const code = pseudocodeMask(body.text),
      offset = line.from + body.prefix.length;
    for (const token of code.matchAll(new RegExp(pseudocodeOperatorPattern.source, 'g'))) {
      if (pseudocodeOperatorSymbol(token[0]) !== token[0])
        changes.push({
          from: offset + token.index,
          to: offset + token.index + token[0].length,
          insert: pseudocodeOperatorSymbol(token[0]),
        });
    }
  }
  if (changes.length)
    view.dispatch({ changes, annotations: Transaction.userEvent.of('input.format') });
  return true;
}

const matched = Decoration.mark({ class: 'cm-pseudo-match' });
function matchingDecorations(view: EditorView): DecorationSet {
  const block = matchingPseudocodeBlock(view.state, view.state.selection.main.head);
  if (!block) return Decoration.none;
  return Decoration.set(
    [block.open, ...block.branches, block.close]
      .filter((marker) =>
        view.visibleRanges.some((range) => marker.from >= range.from && marker.to <= range.to),
      )
      .map((marker) => matched.range(marker.from, marker.to)),
    true,
  );
}
export const pseudocodeStructure = [
  foldService.of((state, from) => {
    const fence = fenceAt(state, state.doc.lineAt(from).to);
    if (!fence || !isPseudocode(fence.info) || from <= fence.headerTo) return null;
    const block = pseudocodeIndex(state, fence)?.blocks.find(
      (block) => state.doc.lineAt(block.open.from).from === from,
    );
    return block
      ? { from: state.doc.lineAt(block.open.from).to, to: state.doc.lineAt(block.close.from).to }
      : null;
  }),
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      tree;
      constructor(view: EditorView) {
        this.tree = syntaxTree(view.state);
        this.decorations = matchingDecorations(view);
      }
      update(update: import('@codemirror/view').ViewUpdate) {
        const tree = syntaxTree(update.state);
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          tree !== this.tree
        )
          this.decorations = matchingDecorations(update.view);
        this.tree = tree;
      }
    },
    { decorations: (value) => value.decorations },
  ),
  EditorView.baseTheme({
    '.cm-pseudo-match': {
      backgroundColor: 'color-mix(in srgb,var(--accent) 12%,transparent)',
      borderRadius: '3px',
      textDecoration: 'underline',
      textDecorationColor: 'color-mix(in srgb,var(--accent-text) 45%,transparent)',
      textUnderlineOffset: '3px',
    },
  }),
];
