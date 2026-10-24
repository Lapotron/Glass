import type { Processor } from 'unified';
import type { Tokenizer, Construct } from 'micromark-util-types';

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    glassHighlight: 'glassHighlight';
    glassHighlightSequence: 'glassHighlightSequence';
  }
}
const whitespace = (code: number | null) => code === null || code === 32 || code === 9 || code < 0;
const closing: Construct = {
  tokenize(effects, ok, nok) {
    return first;
    function first(code: number | null) {
      if (code !== 61) return nok(code);
      effects.consume(code);
      return second;
    }
    function second(code: number | null) {
      if (code !== 61) return nok(code);
      effects.consume(code);
      return after;
    }
    function after(code: number | null) {
      return code === 61 ? nok(code) : ok(code);
    }
  },
};
const tokenize: Tokenizer = function (effects, ok, nok) {
  const before = this.previous;
  let previous: number | null = null;
  return first;
  function first(code: number | null) {
    if (code !== 61 || before === 61) return nok(code);
    effects.enter('glassHighlight');
    effects.enter('glassHighlightSequence');
    effects.consume(code);
    return second;
  }
  function second(code: number | null) {
    if (code !== 61) return nok(code);
    effects.consume(code);
    return startContent;
  }
  function startContent(code: number | null) {
    if (code === 61 || whitespace(code)) return nok(code);
    effects.exit('glassHighlightSequence');
    effects.enter('chunkText', { contentType: 'text' });
    return content(code);
  }
  function consume(code: number | null) {
    previous = code;
    effects.consume(code);
    return content;
  }
  function content(code: number | null): any {
    if (code === null || code === -3 || code === -4 || code === -5) return nok(code);
    if (code === 92) {
      previous = code;
      effects.consume(code);
      return escaped;
    }
    if (code === 61 && !whitespace(previous))
      return effects.check(closing, endContent, consume)(code);
    return consume(code);
  }
  function escaped(code: number | null) {
    if (code === null || code === -3 || code === -4 || code === -5) return nok(code);
    return consume(code);
  }
  function endContent(code: number | null) {
    effects.exit('chunkText');
    effects.enter('glassHighlightSequence');
    effects.consume(code);
    return last;
  }
  function last(code: number | null) {
    effects.consume(code);
    effects.exit('glassHighlightSequence');
    effects.exit('glassHighlight');
    return ok;
  }
};
/** Parser-level ==highlight==, shared by validation, previews and production. */
export function remarkInlineHighlight(this: Processor) {
  const data = this.data() as any;
  (data.micromarkExtensions ||= []).push({ text: { 61: { name: 'glassHighlight', tokenize } } });
  (data.fromMarkdownExtensions ||= []).push({
    enter: {
      glassHighlight(this: any, token: any) {
        this.enter(
          {
            type: 'glassHighlight',
            children: [],
            data: { hName: 'mark', hProperties: { className: ['md-mark'] } },
          },
          token,
        );
      },
    },
    exit: {
      glassHighlight(this: any, token: any) {
        this.exit(token);
      },
    },
  });
}
