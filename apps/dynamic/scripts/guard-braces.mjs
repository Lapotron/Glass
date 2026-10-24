import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('braces/package.json'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '3.0.3')
  throw new Error('Review the braces guard against the new dependency version before building.');
const marker = 'GLASS-BRACES-DEPTH-GUARD';
const refusal =
  "if (depth > 64) throw new SyntaxError('Brace pattern exceeds the safe nesting limit');";
const plans = [
  [
    'lib/parse.js',
    (source) =>
      source.replaceAll(
        'stack.push(block);',
        "if (stack.length >= 64) throw new SyntaxError('Brace pattern exceeds the safe nesting limit');\n      stack.push(block);",
      ),
  ],
  [
    'lib/compile.js',
    (source) =>
      source
        .replace(
          'const walk = (node, parent = {}) => {',
          'const walk = (node, parent = {}, depth = 0) => {\n    ' + refusal,
        )
        .replaceAll('walk(child, node)', 'walk(child, node, depth + 1)'),
  ],
  [
    'lib/expand.js',
    (source) =>
      source
        .replace(
          'const walk = (node, parent = {}) => {',
          'const walk = (node, parent = {}, depth = 0) => {\n    ' + refusal,
        )
        .replaceAll('walk(child, node)', 'walk(child, node, depth + 1)'),
  ],
  [
    'lib/stringify.js',
    (source) =>
      source
        .replace(
          'const stringify = (node, parent = {}) => {',
          'const stringify = (node, parent = {}, depth = 0) => {\n    ' + refusal,
        )
        .replaceAll('stringify(child)', 'stringify(child, node, depth + 1)'),
  ],
];
const prepared = [];
for (const [file, transform] of plans) {
  const target = path.join(root, file),
    source = await readFile(target, 'utf8');
  if (source.includes(marker)) continue;
  if (process.argv.includes('--check'))
    throw new Error('Missing reproducible braces guard. Run npm install in apps/dynamic.');
  const patched = transform(source);
  if (patched === source || !patched.includes('safe nesting limit'))
    throw new Error('Unexpected braces source: ' + file);
  prepared.push([target, '// ' + marker + ': GHSA-vfj7-8cjw-p6xm\n' + patched]);
}
for (const [target, contents] of prepared) await writeFile(target, contents);
console.log(
  'Vinext build dependency: bounded brace/AST depth verified (upstream advisory remains recorded).',
);
