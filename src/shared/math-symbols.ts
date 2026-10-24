export type MathMacro = {
  name: string;
  arguments: number;
  optional?: string;
  from: number;
  to: number;
  body: string;
  raw: string;
};
/** Index declarative TeX without evaluating it or loading a LaTeX package. */
export function mathMacros(source: string, offset = 0): MathMacro[] {
  const result: MathMacro[] = [];
  const pattern =
    /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def)\*?\s*(?:\{\\([A-Za-z]+)\}|\\([A-Za-z]+))\s*(?:\[(\d)\])?(?:\[([^\]]*)\])?\s*((?:#\d\s*)*)\{/g;
  for (const match of source.matchAll(pattern)) {
    const start = match.index! + match[0].length;
    let end = start,
      depth = 1;
    for (; end < source.length; end++) {
      if (source[end] === '\\') {
        end++;
        continue;
      }
      if (source[end] === '{') depth++;
      if (source[end] === '}' && --depth === 0) break;
    }
    // Count braces only; ordinary characters cannot change the nesting level.
    if (end >= source.length) continue;
    const args =
      match[1] === 'DeclareMathOperator'
        ? 0
        : Number(
            match[4] || Math.max(0, ...[...match[6].matchAll(/#(\d)/g)].map((m) => Number(m[1]))),
          );
    result.push({
      name: match[2] || match[3],
      arguments: args,
      optional: match[5],
      from: offset + match.index!,
      to: offset + end + 1,
      body: source.slice(start, end),
      raw: source.slice(match.index!, end + 1),
    });
  }
  return result;
}
