import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  syntaxTree,
} from '@codemirror/language';
import type { MarkdownConfig } from '@lezer/markdown';
import { tags, Tag } from '@lezer/highlight';
import type { EditorState } from '@codemirror/state';
import { pseudocodeLanguage } from './pseudocode-language.js';
const pseudoDescription = LanguageDescription.of({
  name: 'Pseudocode',
  alias: ['pseudo', 'algorithm'],
  load: async () => new LanguageSupport(pseudocodeLanguage),
});
const texDescription = LanguageDescription.of({
  name: 'TeX',
  alias: ['tex', 'latex', 'stex'],
  load: async () => {
    const { stex } = await import('@codemirror/legacy-modes/mode/stex');
    return new LanguageSupport(StreamLanguage.define(stex));
  },
});
const mermaidDescription = LanguageDescription.of({
  name:'Mermaid',alias:['mmd'],
  load:async()=>new LanguageSupport((await import('./mermaid-language.js')).mermaidLanguage),
});

export const inlineHighlightTag = Tag.define();
/** Editor-only structure: remark remains authoritative for publishing and validation. */
export const mathMarkdown: MarkdownConfig = {
  defineNodes: [
    { name: 'DisplayMath', block: true },
    'InlineMath',
    { name: 'MathMark', style: tags.processingInstruction },
    { name: 'MathCommand', style: tags.keyword },
    { name: 'MathArgument', style: tags.brace },
    { name: 'InlineHighlight', style: inlineHighlightTag },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'DisplayMath',
      before: 'FencedCode',
      parse(cx, line) {
        if (!/^\s*\$\$\s*$/.test(line.text)) return false;
        const from = cx.lineStart + line.pos;
        const children = [cx.elt('MathMark', from, from + 2)];
        let to = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          to = cx.lineStart + line.text.length;
          if (/^\s*\$\$\s*$/.test(line.text)) {
            const at = cx.lineStart + line.text.indexOf('$$');
            children.push(cx.elt('MathMark', at, at + 2));
            cx.nextLine();
            break;
          }
          for (const match of line.text.matchAll(/\\[a-zA-Z]+|[{}]/g))
            children.push(
              cx.elt(
                match[0][0] === '\\' ? 'MathCommand' : 'MathArgument',
                cx.lineStart + match.index!,
                cx.lineStart + match.index! + match[0].length,
              ),
            );
        }
        cx.addElement(cx.elt('DisplayMath', from, to, children));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: 'InlineHighlight',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (
          next !== 61 ||
          cx.char(pos + 1) !== 61 ||
          cx.char(pos + 2) === 61 ||
          /\s/.test(cx.slice(pos + 2, pos + 3)) ||
          cx.char(pos - 1) === 61
        )
          return -1;
        for (let end = pos + 2; end < cx.end - 1; end++) {
          if (cx.char(end) === 10) return -1;
          if (cx.char(end) === 92) {
            end++;
            continue;
          }
          if (
            cx.char(end) === 61 &&
            cx.char(end + 1) === 61 &&
            cx.char(end + 2) !== 61 &&
            !/\s/.test(cx.slice(end - 1, end))
          )
            return cx.addElement(
              cx.elt('InlineHighlight', pos, end + 2, [
                cx.elt('HighlightMark', pos, pos + 2),
                ...cx.parser.parseInline(cx.slice(pos + 2, end), pos + 2),
                cx.elt('HighlightMark', end, end + 2),
              ]),
            );
        }
        return -1;
      },
    },
    {
      name: 'InlineMath',
      before: 'Escape',
      parse(cx, next, pos) {
        if (next !== 36 || cx.char(pos + 1) === 36 || cx.char(pos - 1) === 36) return -1;
        let end = pos + 1;
        for (; end < cx.end; end++) {
          if (cx.char(end) === 92) {
            end++;
            continue;
          }
          if (cx.char(end) === 36) break;
        }
        const closed = end < cx.end,
          to = closed ? end + 1 : cx.end;
        const children = [cx.elt('MathMark', pos, pos + 1)];
        for (const match of cx.slice(pos + 1, end).matchAll(/\\[a-zA-Z]+|[{}]/g))
          children.push(
            cx.elt(
              match[0][0] === '\\' ? 'MathCommand' : 'MathArgument',
              pos + 1 + match.index!,
              pos + 1 + match.index! + match[0].length,
            ),
          );
        if (closed) children.push(cx.elt('MathMark', end, end + 1));
        return cx.addElement(cx.elt('InlineMath', pos, to, children));
      },
    },
  ],
};
export function sourceLanguage() {
  return markdown({
    extensions: [mathMarkdown],
    codeLanguages(info) {
      const name = info.trim().split(/\s+/, 1)[0];
      if (/^(?:pseudocode|pseudo|algorithm)$/i.test(name)) return pseudoDescription;
      if (/^(?:tex|latex|stex)$/i.test(name)) return texDescription;
      if (/^(?:mermaid|mmd)$/i.test(name)) return mermaidDescription;
      return LanguageDescription.matchLanguageName(languages, name, true);
    },
  });
}
export function mathAt(state: EditorState, position: number) {
  let node = syntaxTree(state).resolveInner(position, -1);
  for (;;) {
    if (node.name === 'InlineMath' || node.name === 'DisplayMath') {
      const line = state.doc.lineAt(node.from),
        prefix = state.doc.sliceString(line.from, node.from);
      let ticks = 0;
      for (const match of prefix.matchAll(/(?<!\\)`+/g))
        if (ticks === match[0].length) ticks = 0;
        else if (!ticks) ticks = match[0].length;
      if (ticks) return null;
      return { from: node.from, to: node.to, display: node.name === 'DisplayMath' };
    }
    if (!node.parent) return null;
    node = node.parent;
  }
}
export function fenceAt(state: EditorState, position: number) {
  // resolveInner enters the asynchronously mounted language tree and loses the Markdown fence.
  let node = syntaxTree(state).resolve(position, -1);
  while (node.name !== 'FencedCode' && node.parent) node = node.parent;
  if (node.name !== 'FencedCode') return null;
  const info = node.getChild('CodeInfo'),
    text = node.getChild('CodeText'),
    header = state.doc.lineAt(node.from),
    marks = node.getChildren('CodeMark'),
    close = marks.length > 1 ? marks.at(-1)! : null;
  return {
    from: node.from,
    to: node.to,
    info: info ? state.doc.sliceString(info.from, info.to) : '',
    infoFrom: info?.from ?? marks[0]?.to ?? header.to,
    headerTo: header.to,
    prefix: state.doc.sliceString(header.from, node.from),
    marker: marks[0] ? state.doc.sliceString(marks[0].from, marks[0].to) : '```',
    closeFrom: close?.from,
    bodyFrom: text?.from ?? Math.min(header.to + 1, node.to),
    bodyTo: text?.to ?? (close ? state.doc.lineAt(close.from).from : node.to),
  };
}
