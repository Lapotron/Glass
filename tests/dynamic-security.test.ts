import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(new URL('../apps/dynamic/package.json', import.meta.url));
type Ast = { type: string; nodes?: Ast[] };
const braces = require('braces') as {
  expand: (input: string | Ast) => string[];
  compile: (input: string | Ast) => string;
  stringify: (input: string | Ast) => string;
  parse: (input: string) => Ast;
};
it('keeps the installed Vinext brace guard reproducible and ordinary glob expansion intact', () => {
  execFileSync(process.execPath, ['apps/dynamic/scripts/guard-braces.mjs', '--check']);
  expect(braces.expand('src/{a,b}.{ts,tsx}').sort()).toEqual([
    'src/a.ts',
    'src/a.tsx',
    'src/b.ts',
    'src/b.tsx',
  ]);
});
it('rejects adversarial brace, parenthesis and supplied AST nesting without exhausting the stack', () => {
  for (const [open, close] of [
    ['{', '}'],
    ['(', ')'],
  ]) {
    expect(() => braces.parse(open.repeat(5000) + 'a,b' + close.repeat(5000))).toThrow(SyntaxError);
  }
  const ast: Ast = { type: 'root', nodes: [] };
  let parent = ast;
  for (let i = 0; i < 5000; i++) {
    const child: Ast = { type: 'brace', nodes: [] };
    parent.nodes = [child];
    parent = child;
  }
  for (const method of [braces.compile, braces.stringify, braces.expand])
    expect(() => method(ast)).toThrow(SyntaxError);
});
