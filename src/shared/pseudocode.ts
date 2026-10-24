export const pseudocodeLanguages = ['pseudocode', 'pseudo', 'algorithm'];
export const pseudocodeOperatorSymbols: Record<string, string> = {
  '<=>': '⇔',
  '<->': '↔',
  '->': '→',
  '<-': '←',
  '=>': '⇒',
  '<=': '≤',
  '>=': '≥',
  '!=': '≠',
  '<>': '≠',
};
export const pseudocodeOperatorPattern =
  /(?:<=>|<->|->|<-|=>|<=|>=|!=|<>|:=|←|→|↔|⇒|⇐|⇔|≤|≥|≠|∈|∉|∧|∨|¬|[=+*/<>%-])/;
export function pseudocodeOperatorSymbol(operator: string) {
  return pseudocodeOperatorSymbols[operator] || operator;
}
/** Fixed compiler-owned TeX; authored strings, comments and math never pass through this map. */
export const pseudocodeOperatorMath: Record<string, string> = {
  '←': '\\leftarrow',
  '→': '\\rightarrow',
  '↔': '\\leftrightarrow',
  '⇒': '\\Rightarrow',
  '⇐': '\\Leftarrow',
  '⇔': '\\Leftrightarrow',
  '≤': '\\leq',
  '≥': '\\geq',
  '≠': '\\neq',
  '∈': '\\in',
  '∉': '\\notin',
  '∧': '\\land',
  '∨': '\\lor',
  '¬': '\\neg',
  ':=': '\\mathrel{:=}',
  '=': '=',
  '<': '<',
  '>': '>',
  '+': '+',
  '-': '-',
  '*': '\\ast',
  '/': '/',
  '%': '\\%',
};
export const pseudocodeKeywords = [
  'procedure',
  'function',
  'algorithm',
  'input',
  'output',
  'require',
  'ensure',
  'if',
  'then',
  'else',
  'elseif',
  'end',
  'endif',
  'for',
  'each',
  'in',
  'to',
  'downto',
  'do',
  'while',
  'repeat',
  'until',
  'return',
  'yield',
  'break',
  'continue',
  'and',
  'or',
  'not',
  'true',
  'false',
  'null',
];
export type PseudoToken = {
  kind: 'text' | 'keyword' | 'comment' | 'string' | 'number' | 'operator' | 'math';
  text: string;
};
export function pseudocodeOptions(meta: string) {
  const value = (name: string) =>
    new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)'|([^\\s]+))`)
      .exec(meta)
      ?.slice(1)
      .find((v) => v !== undefined);
  const style = value('style') || 'algorithm';
  if (style !== 'algorithm' && style !== 'code')
    throw new Error('Pseudocode style must be algorithm or code.');
  return {
    style,
    title: value('title') || 'Pseudocode',
    numbers: !/(?:^|\s)showLineNumbers=(?:false|"false")/.test(meta),
    wrap: /(?:^|\s)wrap(?:\s|$)/.test(meta),
  };
}
export function pseudocodeLines(source: string) {
  if (source.length > 65536 || source.split('\n').length > 2000)
    throw new Error('Pseudocode supports up to 2,000 lines and 64 KiB per block.');
  return source.split('\n').map((raw) => {
    const parts: PseudoToken[] = [],
      pattern = new RegExp(
        String.raw`\$[^$\n]+\$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?:\/\/|#).*|\b[A-Za-z_][\w]*\b|\b\d+(?:\.\d+)?\b|${pseudocodeOperatorPattern.source}`,
        'g',
      );
    let last = 0;
    for (const match of raw.matchAll(pattern)) {
      if (match.index! > last) parts.push({ kind: 'text', text: raw.slice(last, match.index) });
      const text = match[0];
      const kind: PseudoToken['kind'] = text.startsWith('$')
        ? 'math'
        : /^(?:\/\/|#)/.test(text)
          ? 'comment'
          : /^['"]/.test(text)
            ? 'string'
            : /^\d/.test(text)
              ? 'number'
              : pseudocodeKeywords.includes(text.toLowerCase())
                ? 'keyword'
                : pseudocodeOperatorPattern.test(text)
                  ? 'operator'
                  : 'text';
      parts.push({ kind, text });
      last = match.index! + text.length;
    }
    if (last < raw.length) parts.push({ kind: 'text', text: raw.slice(last) });
    return { raw, parts };
  });
}
