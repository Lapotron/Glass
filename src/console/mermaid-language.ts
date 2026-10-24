import { StreamLanguage } from '@codemirror/language';
import { mermaidDeclarations, mermaidKeywords } from '../shared/mermaid-authoring.js';

const declarations = new Set(mermaidDeclarations.map((word) => word.toLowerCase()));
const keywords = new Set(mermaidKeywords.map((word) => word.toLowerCase()));
/** Incremental notation highlighting; the private build renderer remains the syntax authority. */
export const mermaidLanguage = StreamLanguage.define({
  startState: () => ({ quote: '', labels: [] as string[], yaml: false }),
  token(stream, state) {
    if (stream.sol() && stream.match(/^\s*---\s*$/)) {
      state.yaml = !state.yaml;
      return 'meta';
    }
    if (stream.eatSpace()) return null;
    if (state.quote) {
      let escaped = false;
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === state.quote && !escaped) {
          state.quote = '';
          break;
        }
        escaped = ch === '\\' && !escaped;
      }
      return 'string';
    }
    if (stream.match(/%%\{.*\}%%/)) return 'meta';
    if (stream.match(/%%.*/)) return 'comment';
    if (stream.match(/#[\da-f]{3,8}\b/i)) return 'atom';
    const next = stream.peek();
    if (next === '"' || next === "'" || next === '`') {
      state.quote = stream.next()!;
      return 'string';
    }
    if (stream.match(/[<ox*]?(?:-{1,}|={2,}|\.{2,})(?:[<>ox*|}]*)/)) return 'operator';
    if (stream.match(/\b\d+(?:\.\d+)?(?:ms|[dhmsw])?\b/)) return 'number';
    const word = stream.match(/[A-Za-z_$][\w$]*(?:-[\w$]+)*/);
    if (Array.isArray(word)) {
      const name = word[0].toLowerCase();
      if (declarations.has(name)) return 'typeName';
      if (state.labels.length) return 'string';
      if (keywords.has(name)) return 'keyword';
      if (/^(?:tb|td|bt|lr|rl|true|false)$/.test(name)) return 'atom';
      return state.yaml || stream.match(/\s*:/, false) ? 'attributeName' : 'variableName';
    }
    if (next === '[' || next === '(') {
      state.labels.push(next === '[' ? ']' : ')');
      stream.next();
      return 'bracket';
    }
    if (next === state.labels.at(-1)) {
      state.labels.pop();
      stream.next();
      return 'bracket';
    }
    if (stream.match(/[{}[\]():,;|@]/)) return 'punctuation';
    stream.next();
    return null;
  },
});
