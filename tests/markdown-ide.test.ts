import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Transaction } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { sourceLanguage, mathAt } from '../src/console/source-language.js';
import { mathCompletion, mathCommandSnippet } from '../src/console/math-completion.js';
import { mathCommandCatalog, mathSettingsSchema } from '../src/shared/math-authoring.js';
import { mathMacros } from '../src/shared/math-symbols.js';
import { sourceCodeBlocks, virtualCodeFiles } from '../src/shared/code-projects.js';
import {
  renderMathPreviews,
  renderSourceMathPreviews,
  renderMarkdown,
} from '../src/engine/markdown.js';
import { analyzeSource } from '../src/console/source-analysis.js';
import { checkMarkdownDocument } from '../src/engine/authoring.js';

function complete(
  source: string,
  packages: ('physics' | 'mathtools')[] = [],
  macros: ReturnType<typeof mathMacros> = [],
) {
  const state = EditorState.create({ doc: source, extensions: [sourceLanguage()] });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return mathCompletion(() => ({ math: { packages }, macros }))(
    new CompletionContext(state, state.doc.length, true),
  );
}
it('parses math incrementally while excluding fenced and escaped dollar lookalikes', () => {
  const source =
    'Escaped \\$x.\n\n```text\n$\\alpha$\n```\n\n$$\n\\frac{a}{b}\n$$\n\nInline $\\beta$';
  const state = EditorState.create({ doc: source, extensions: [sourceLanguage()] });
  ensureSyntaxTree(state, state.doc.length, 1000);
  expect(mathAt(state, source.indexOf('alpha'))).toBeNull();
  expect(mathAt(state, source.indexOf('frac'))?.display).toBe(true);
  expect(mathAt(state, source.indexOf('beta'))?.display).toBe(false);
  expect(syntaxTree(state).toString()).toContain('MathCommand');
  expect(complete('$\\al')?.options.some((option) => option.label === '\\alpha')).toBe(true);
  expect(complete('`$\\al')?.options.length || 0).toBe(0);
  const nested = ':::equation{#energy}\n$$\nE=mc^2\n$$\n:::';
  const nestedState = EditorState.create({ doc: nested, extensions: [sourceLanguage()] });
  ensureSyntaxTree(nestedState, nested.length, 1000);
  // A directive can be a Lezer paragraph, but its $$ pairs must never become $ fragments.
  expect(syntaxTree(nestedState).toString()).not.toContain('InlineMath');
});
it('offers package-aware physics, environments, local macros and symbol descriptions', () => {
  expect(complete('$\\pd')?.options.some((option) => option.label === '\\pdv')).toBe(false);
  expect(
    complete('$\\pd', ['physics'])?.options.find((option) => option.label === '\\pdv')?.info,
  ).toBeTypeOf('function');
  expect(complete('$$\n\\begin{bmat')?.options.some((option) => option.label === 'bmatrix')).toBe(
    true,
  );
  expect(
    complete('$$\n\\begin{aligned}\nx&=y\\\\\n\\end{')?.options.map((option) => option.label),
  ).toEqual(['aligned']);
  const macro = mathMacros('\\newcommand{\\energy}[2]{#1^{#2}}', 0);
  expect(
    complete('$\\ener', [], macro)?.options.some((option) => option.label === '\\energy'),
  ).toBe(true);
  const optionalMacro = mathMacros('\\newcommand{\\optional}[2][x]{#1+#2}');
  const optional = complete('$\\opti', [], optionalMacro)?.options.find(
    (option) => option.label === '\\optional',
  );
  expect(optional).toBeTruthy();
  // Only the mandatory argument is inserted; TeX supplies the declared optional default.
  const optionState = EditorState.create({ doc: '$\\opti', extensions: [sourceLanguage()] });
  let edited: EditorState | undefined;
  if (typeof optional?.apply !== 'function') throw new Error('Expected a math snippet.');
  optional.apply(
    {
      state: optionState,
      dispatch: (transaction: Transaction) => {
        edited = transaction.state;
      },
    } as EditorView,
    optional,
    1,
    optionState.doc.length,
  );
  expect(edited?.doc.toString()).toBe('$\\optional{argument 2}');
  expect(
    mathCommandSnippet(mathCommandCatalog.find((command) => command.name === 'frac')!),
  ).toContain('${1:numerator}');
});
it('indexes nested and optional macro definitions without executing TeX', () => {
  const source =
    '\\newcommand{\\nested}[2][x]{\\frac{#1}{#2}} \\DeclareMathOperator{\\ranker}{rank} \\def\\pair#1#2{(#1,#2)}';
  const macros = mathMacros(source, 12);
  expect(macros.map((macro) => [macro.name, macro.arguments, macro.optional])).toEqual([
    ['nested', 2, 'x'],
    ['ranker', 0, undefined],
    ['pair', 2, undefined],
  ]);
  expect(macros[0].body).toBe('\\frac{#1}{#2}');
  expect(macros[0].from).toBe(12);
  expect(source.slice(macros[0].from - 12, macros[0].to - 12)).toBe(macros[0].raw);
});
it('renders allowlisted STEM notation consistently and isolates physics from core defaults', async () => {
  expect(mathSettingsSchema.safeParse({ packages: ['require'] }).success).toBe(false);
  expect(
    (await renderMathPreviews([{ source: '\\dv{x}{t}', display: true }]))[0].error,
  ).toBeTruthy();
  const results = await renderMathPreviews(
    [
      { source: '\\dv[2]{x}{t}+\\pdv{f}{x}+\\vb{F}+\\bra{a}\\ket{b}', display: true },
      { source: '\\cancel{x}+\\upalpha+\\units[3]{m/s}+\\ce{H2O}', display: true },
    ],
    { packages: ['physics', 'cancel', 'upgreek', 'units', 'mhchem'] },
  );
  expect(results.every((result) => result.html?.includes('<svg'))).toBe(true);
  expect(
    (await renderMathPreviews([{ source: '\\dv{x}{t}', display: true }]))[0].error,
  ).toBeTruthy();
});
it('previews selected equations beyond 200 with ordered macro context and cache-safe edits', async () => {
  const source =
    '$\\newcommand{\\coefficient}{3}$\n\n' +
    Array.from({ length: 240 }, (_, i) => `$$\ny_${i}=\\coefficient x\n$$`).join('\n\n');
  const math = analyzeSource(source).maths!.at(-1)!;
  const first = (await renderSourceMathPreviews(source, [math]))[0];
  expect(first.html).toContain('<svg');
  const prefix = 'A new paragraph.\n\n';
  expect(
    (
      await renderSourceMathPreviews(prefix + source, [
        { from: math.from + prefix.length, to: math.to + prefix.length },
      ])
    )[0],
  ).toEqual(first);
  const changed = source.replace('{3}', '{4}');
  expect((await renderSourceMathPreviews(changed, [math]))[0].html).not.toBe(first.html);
  await expect(renderSourceMathPreviews(source, [{ from: 0, to: 7 }])).rejects.toThrow(
    'equation changed',
  );
});
it('maps named virtual JS/TS projects to exact source ranges, preserving CRLF and isolation', () => {
  const source =
    '```ts title="lib.ts" project="demo"\r\nexport const answer = 42;\r\n```\r\n\n```js\nconst isolated = true;\n```';
  const blocks = sourceCodeBlocks(source),
    files = virtualCodeFiles(blocks);
  expect(blocks[0].text).toBe(source.slice(blocks[0].bodyFrom, blocks[0].bodyTo));
  expect(files[0].name).toBe('/project/project-demo/lib.ts');
  expect(files[1].group).toBe('block-2');
  expect(files[0].text).toContain('export const answer');
});
it('renders academic and code pseudocode with static math, stable line links and exact source payloads', async () => {
  const body =
    'INPUT values\nFOR each $x$ in values DO\n  RETURN $\\frac{x}{2}$ // a comment\nEND FOR\n<script>alert(1)</script>';
  const academic = await renderMarkdown('```pseudocode title="Example"\n' + body + '\n```');
  expect(academic.html).toContain('pseudo-algorithm');
  expect(academic.html).toContain('<svg');
  expect(academic.html).toContain('data-code-source');
  expect(academic.html).toContain('data-code-line="3"');
  expect(academic.html).not.toContain('<script>');
  expect(academic.html.match(/code-toolbar/g)).toHaveLength(1);
  const code = await renderMarkdown('```pseudo style="code"\n' + body + '\n```');
  expect(code.html).not.toContain('aria-label="\\frac{x}{2}"');
  expect(code.html).toContain('data-pseudo-symbol');
  expect(code.html).toContain('pseudo-keyword');
  expect((await checkMarkdownDocument('```pseudocode style="unknown"\nRETURN x\n```')).ok).toBe(
    false,
  );
});
it('renders inline highlights with nested Markdown and preserves code, math, escapes and unmatched markers', async () => {
  const source =
    '==A **strong** result with $x^2$== and :mark[another result].\n\n`==code==` and \\==escaped==, == unfinished.\n\n```text\n==literal==\n```';
  const result = await renderMarkdown(source);
  expect(result.html).toContain('<mark class="md-mark">A <strong>strong</strong> result');
  expect(result.html).toContain('another result</mark>');
  expect(result.html).toContain('<code>==code==</code>');
  expect(result.html).toContain('==escaped==');
  expect(result.html).toContain('== unfinished.');
  const state = EditorState.create({ doc: '==A **highlight**==', extensions: [sourceLanguage()] });
  ensureSyntaxTree(state, state.doc.length, 1000);
  expect(syntaxTree(state).toString()).toContain('InlineHighlight');
});
