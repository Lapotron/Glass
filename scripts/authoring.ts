import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authoringCapabilities } from '../src/shared/authoring-capabilities.js';
import { authoringInstructions } from '../src/shared/authoring-instructions.js';
import { checkMarkdownDocument } from '../src/engine/authoring.js';
const [command, ...args] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
try {
  if (command === 'check') {
    const files = args.filter((a) => !a.startsWith('--'));
    if (!files.length)
      throw new Error(
        'Usage: npm run markdown:check -- path.md [more.md] [--json] [--syntax-only]. Use - for stdin.',
      );
    const results = [];
    for (const filename of files) {
      let source = '';
      if (filename === '-') {
        for await (const chunk of process.stdin) source += chunk;
      } else source = await fs.readFile(filename, 'utf8');
      results.push({
        file: filename,
        ...(await checkMarkdownDocument(source, !args.includes('--syntax-only'))),
      });
    }
    if (args.includes('--json')) console.log(JSON.stringify(results, null, 2));
    else
      for (const result of results) {
        console.log(`${result.ok ? '✓' : '✗'} ${result.file}`);
        for (const d of result.diagnostics)
          console.log(
            `  ${d.line}:${d.column} ${d.severity} ${d.code}${d.path ? ` (${d.path})` : ''}: ${d.message}`,
          );
      }
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  } else if (command === 'pack') {
    const index = args.indexOf('--out');
    if (index >= 0 && !args[index + 1]) throw new Error('Supply a folder after --out.');
    const output = path.resolve(
      args[index + 1] && index >= 0 ? args[index + 1] : '.studio/authoring-pack',
    );
    const marker = path.join(output, '.fieldnotes-authoring-pack');
    try {
      const items = await fs.readdir(output);
      if (items.length && !(await fs.readFile(marker, 'utf8').catch(() => '')))
        throw new Error('Choose a new or empty folder; this folder is not an authoring pack.');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(marker, 'fieldnotes-markdown/1\n');
    await fs.writeFile(
      path.join(output, 'capabilities.json'),
      JSON.stringify(authoringCapabilities(), null, 2) + '\n',
    );
    const guides = [
      'authoring.md',
      'article-settings.md',
      'markdown-reference.md',
      'reader-upgrades.md',
      'charts.md',
      'mindmaps.md',
      'editor-workspace.md',
      'article-footer.md',
      'recovery.md',
      'latex-conversion.md',
      'mcp-authoring.md',
      'math-authoring.md',
      'math-reference.md',
      'pseudocode.md',
      'markdown-ide.md',
      'diagrams.md',
    ];
    for (const name of guides)
      await fs.copyFile(path.join(root, 'docs', name), path.join(output, name));
    for (const dir of ['authoring-templates', 'conversion'])
      await fs.cp(path.join(root, 'docs', dir), path.join(output, dir), { recursive: true });
    const skill = path.join(output, 'skills/glass-markdown-authoring');
    await fs.mkdir(path.join(skill, 'references'), { recursive: true });
    await fs.writeFile(path.join(skill, 'SKILL.md'), authoringInstructions('pack'));
    for (const name of guides)
      await fs.copyFile(path.join(output, name), path.join(skill, 'references', name));
    await fs.copyFile(
      path.join(output, 'capabilities.json'),
      path.join(skill, 'references/capabilities.json'),
    );
    await fs.cp(
      path.join(output, 'authoring-templates'),
      path.join(skill, 'references/authoring-templates'),
      { recursive: true },
    );
    await fs.cp(path.join(output, 'conversion'), path.join(skill, 'references/conversion'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(output, 'README.md'),
      '# Glass authoring pack\n\nStart with `skills/glass-markdown-authoring/SKILL.md`. Its references, executable capabilities, and validated templates are bundled here for another LLM or a local MCP client. No author notebook, credentials, or private history is included.\n\nValidate drafts in the Glass project with `npm run markdown:check -- draft.md --json`; saving and publishing remain separate actions.\n',
    );
    console.log(`Authoring pack: ${output}`);
  } else throw new Error('Use check or pack.');
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
