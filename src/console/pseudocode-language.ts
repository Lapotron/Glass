import { StreamLanguage } from '@codemirror/language';
import { Tag, tags } from '@lezer/highlight';
import { pseudocodeKeywords, pseudocodeOperatorPattern } from '../shared/pseudocode.js';
import { pseudocodeBuiltins } from '../shared/pseudocode-authoring.js';

export const pseudocodeTags = {
  declaration: Tag.define(tags.definitionKeyword),
  control: Tag.define(tags.controlKeyword),
  function: Tag.define(tags.variableName),
  variable: Tag.define(tags.variableName),
  constant: Tag.define(tags.atom),
  operator: Tag.define(tags.operator),
  math: Tag.define(tags.string),
  comment: Tag.define(tags.comment),
};
const keywords = new Set(pseudocodeKeywords);
const builtins = new Set(pseudocodeBuiltins.map((word) => word.toLowerCase()));
export const pseudocodeLanguage = StreamLanguage.define({
  startState: () => ({ declaration: false }),
  tokenTable: Object.fromEntries(
    Object.entries(pseudocodeTags).map(([key, tag]) => ['pseudo' + key, tag]),
  ),
  token(stream, state) {
    if (stream.sol()) state.declaration = false;
    if (stream.eatSpace()) return null;
    if (stream.match(/(?:\/\/|#).*/)) return 'pseudocomment';
    if (stream.match(/"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?/)) return 'string';
    if (stream.match(/\$(?:\\.|[^$\n])*(?:\$|$)/)) return 'pseudomath';
    if (stream.match(/\b\d+(?:\.\d+)?\b/)) return 'number';
    const word = stream.match(/[A-Za-z_][\w]*/);
    if (Array.isArray(word)) {
      const name = word[0].toLowerCase();
      if (/^(procedure|function|algorithm)$/.test(name)) {
        state.declaration = true;
        return 'pseudodeclaration';
      }
      if (/^(true|false|null)$/.test(name)) return 'pseudoconstant';
      if (/^(and|or|not)$/.test(name)) return 'pseudooperator';
      if (keywords.has(name)) return 'pseudocontrol';
      if (state.declaration || builtins.has(name) || stream.match(/\s*\(/, false)) {
        state.declaration = false;
        return 'pseudofunction';
      }
      return 'pseudovariable';
    }
    if (stream.match(pseudocodeOperatorPattern)) return 'pseudooperator';
    if (stream.match(/[()[\]{},:;]/)) return 'punctuation';
    stream.next();
    return null;
  },
});
