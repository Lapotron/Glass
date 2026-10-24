/** Extract deliberate UI phrases. --write refreshes English and the per-surface catalogs. */
import ts from 'typescript';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { componentBrowserItems } from '../src/console/component-browser.js';
import { pseudocodeSnippets } from '../src/shared/pseudocode-authoring.js';
const usages = new Map<string, Set<string>>();
function add(key: string, file: string) {
  if (!/[A-Za-z]{2}/.test(key) || /^https?:/.test(key)) return;
  const sources = usages.get(key) || new Set<string>();
  sources.add(file);
  usages.set(key, sources);
}
async function files(folder: string): Promise<string[]> {
  return (
    await Promise.all(
      (await fs.readdir(folder, { withFileTypes: true })).map((entry) =>
        entry.isDirectory()
          ? files(path.join(folder, entry.name))
          : [path.join(folder, entry.name)],
      ),
    )
  ).flat();
}
const sourceFiles = (await files('src')).filter(
  (file) => /\.[tj]sx?$/.test(file) && !file.startsWith('src/locales/'),
);
for (const file of sourceFiles) {
  const text = await fs.readFile(file, 'utf8');
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const phrases = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text, file);
    else if (ts.isConditionalExpression(node)) {
      phrases(node.whenTrue);
      phrases(node.whenFalse);
    } else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(phrases);
  };
  const walk = (node: ts.Node) => {
    const toolsFile = file.includes('/site/tools/') || file.endsWith('/site/tools.ts') || file.endsWith('/shared/tools-catalog.ts') || file.endsWith('/shared/tools-crypto.ts');
    if (toolsFile) {
      if (ts.isCallExpression(node) && node.expression.getText(source).endsWith('.cancel') && node.arguments[0]) phrases(node.arguments[0]);
      if (ts.isPropertyAssignment(node) && ['label', 'group', 'description'].includes(node.name.getText(source))) phrases(node.initializer);
      if (ts.isNewExpression(node) && node.expression.getText(source) === 'Error' && node.arguments?.[0]) phrases(node.arguments[0]);
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(source);
        if (['button', 'field', 'input', 'choice', 'parameter', 'select'].includes(name) && node.arguments[0]) phrases(node.arguments[0]);
        if (name === 'element' && node.arguments[2]) phrases(node.arguments[2]);
        const rows = name === 'choice' ? node.arguments[2] : name === 'select' ? node.arguments[1] : undefined;
        if (rows && ts.isArrayLiteralExpression(rows)) for (const row of rows.elements) if (ts.isArrayLiteralExpression(row) && row.elements[1]) phrases(row.elements[1]);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ['t', 'uiAttrs', 'labelAttrs', 'setUiText', 'noteLabel'].includes(
        node.expression.getText(source),
      ) &&
      node.arguments[0]
    ) {
      if (node.expression.getText(source) === 't') phrases(node.arguments[0]);
      else if (
        ['setUiText', 'noteLabel'].includes(node.expression.getText(source)) &&
        node.arguments[1]
      )
        phrases(node.arguments[1]);
      else if (node.expression.getText(source) === 'labelAttrs')
        for (const argument of node.arguments) phrases(argument);
      else if (ts.isObjectLiteralExpression(node.arguments[0]))
        for (const value of node.arguments[0].properties)
          if (ts.isPropertyAssignment(value)) phrases(value.initializer);
    }
    if (
      file.endsWith('/site/discussions.ts') &&
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'setState' &&
      node.arguments[1]
    )
      phrases(node.arguments[1]);
    if (file.endsWith('/aca/reports.ts') || file.endsWith('/aca/audience-reports.ts')) {
      if (
        ts.isPropertyAssignment(node) &&
        ['label', 'note', 'notes'].includes(node.name.getText(source))
      )
        phrases(node.initializer);
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'report.notes.push')
        node.arguments.forEach(phrases);
      if (
        ts.isBinaryExpression(node) &&
        ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text === 'note'
      )
        phrases(node.right);
    }
    if (file.endsWith('/server/health.ts')) {
      if (
        ts.isPropertyAssignment(node) &&
        ['detail', 'metricsUnavailable'].includes(node.name.getText(source))
      )
        phrases(node.initializer);
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === 'add' &&
        node.arguments[2]
      )
        phrases(node.arguments[2]);
      if (ts.isBinaryExpression(node) && node.left.getText(source) === 'report.metricsUnavailable')
        phrases(node.right);
    }
    if (file.endsWith('/server/cloud-media.ts')) {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'reason')
        phrases(node.initializer);
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'blockers.push')
        node.arguments.forEach(phrases);
    }
    if (
      file.endsWith('/site/reading.ts') &&
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'button' &&
      node.arguments[0]
    )
      phrases(node.arguments[0]);
    if (
      ts.isJsxAttribute(node) &&
      ['message', 'data-ui'].includes(node.name.getText(source)) &&
      node.initializer
    ) {
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression)
        phrases(node.initializer.expression);
      else phrases(node.initializer);
    }
    if (
      file.startsWith('src/console/') &&
      ts.isPropertyAssignment(node) &&
      ['label', 'group', 'title', 'help', 'detail', 'description', 'message'].includes(
        node.name.getText(source),
      )
    )
      phrases(node.initializer);
    if (
      ts.isVariableDeclaration(node) &&
      [
        'appearanceLabels',
        'roleLabels',
        'projectStatusLabels',
        'analyticsColumns',
        'analyticsReports',
        'searchFilterLabels',
        'discussionCountLabels',
        'acaConnectionMessages',
      ].includes(node.name.getText(source)) &&
      node.initializer
    ) {
      const values = (child: ts.Node) => {
        if (ts.isStringLiteral(child)) add(child.text, file);
        ts.forEachChild(child, values);
      };
      values(node.initializer);
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  for (const match of text.matchAll(/data-ui(?:-label|-title|-placeholder)?="([^"{}]+)"/g))
    add(match[1], file);
  if (file.endsWith('/settings-navigation.ts')) {
    for (const match of text.matchAll(/\[\s*'[^']+',\s*'([^']+)',\s*'[^']+'\s*\]/g))
      add(match[1], file);
    for (const match of text.matchAll(/\[\s*'([^']+)',\s*\[/g)) add(match[1], file);
  }
}
for (const item of componentBrowserItems) {
  add(item.label, 'src/console/component-browser.ts');
  add(item.description, 'src/console/component-browser.ts');
}
for (const item of pseudocodeSnippets) add(item.description, 'src/console/pseudocode-intelligence.ts');
for (const name of ['view', 'search', 'merge', 'autocomplete', 'language', 'lint']) {
  const file = 'node_modules/@codemirror/' + name + '/dist/index.js';
  const text = await fs.readFile(file, 'utf8');
  for (const match of text.matchAll(/\.phrase\("([^"\n]+)"/g))
    { add(match[1], 'src/console/CodeMirror'); add(match[1], 'src/site/tools/editor.ts'); }
}
const english = Object.fromEntries([...usages.keys()].sort().map((key) => [key, key]));
const publicKey = (key: string) =>
  [...usages.get(key)!].some(
    (file) =>
      file.startsWith('src/site/') ||
      file.startsWith('src/shared/') ||
      file.endsWith('/engine/code.ts'),
  );
if (process.argv.includes('--write')) {
  await fs.writeFile('src/locales/en.json', JSON.stringify(english, null, 2) + '\n');
  for (const locale of ['zh-Hans', 'zh-Hant']) {
    const translations = JSON.parse(
      await fs.readFile('src/locales/' + locale + '.json', 'utf8').catch(() => '{}'),
    ) as Record<string, string>;
    for (const surface of ['public', 'studio'])
      await fs.writeFile(
        'src/locales/' + locale + '.' + surface + '.json',
        JSON.stringify(
          Object.fromEntries(
            Object.keys(english)
              .filter((key) => surface === 'studio' || publicKey(key))
              .map((key) => [key, translations[key] || key]),
          ),
          null,
          2,
        ) + '\n',
      );
  }
  if (process.argv.includes('--inventory'))
    await fs.writeFile(
      '/tmp/glass-ui-ordered.json',
      JSON.stringify(
        Object.keys(english).sort((a, b) => a.length - b.length || a.localeCompare(b)),
      ),
    );
} else {
  const stored = JSON.parse(await fs.readFile('src/locales/en.json', 'utf8'));
  if (JSON.stringify(Object.keys(stored).sort()) !== JSON.stringify(Object.keys(english).sort()))
    throw new Error(
      'UI phrases changed. Run npm run i18n:extract, translate the additions, then run npm run i18n:extract again.',
    );
  for (const locale of ['zh-Hans', 'zh-Hant']) {
    const translations = JSON.parse(await fs.readFile('src/locales/' + locale + '.json', 'utf8'));
    const missing = Object.keys(english).filter(
      (key) => typeof translations[key] !== 'string' || !translations[key].trim(),
    );
    if (missing.length)
      throw new Error(
        locale + ' is missing ' + missing.length + ' messages: ' + missing.slice(0, 4).join(', '),
      );
    const parameters = (value: string) =>
      [...value.matchAll(/\{(\w+)\}|\$/g)]
        .map((match) => match[0])
        .sort()
        .join(',');
    const invalid = Object.keys(english).filter(
      (key) => parameters(key) !== parameters(translations[key]),
    );
    if (invalid.length)
      throw new Error(locale + ' has mismatched placeholders: ' + invalid.slice(0, 4).join(', '));
    for (const surface of ['public', 'studio']) {
      const generated = JSON.parse(
        await fs.readFile('src/locales/' + locale + '.' + surface + '.json', 'utf8'),
      );
      const expected = Object.fromEntries(
        Object.keys(english)
          .filter((key) => surface === 'studio' || publicKey(key))
          .map((key) => [key, translations[key]]),
      );
      if (JSON.stringify(generated) !== JSON.stringify(expected))
        throw new Error(locale + '.' + surface + ' is outdated; run npm run i18n:extract.');
    }
  }
}
console.log(
  Object.keys(english).length +
    ' UI phrases; ' +
    Object.keys(english).filter(publicKey).length +
    ' public phrases.',
);
