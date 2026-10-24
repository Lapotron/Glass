import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { parse } from 'yaml';
import { authoringInstructions } from '../src/shared/authoring-instructions.js';

it('exports an installable product workflow with existing portable and hosted guide targets', async () => {
  for (const target of ['pack', 'cloud'] as const) {
    const text = authoringInstructions(target);
    const metadata = parse(text.match(/^---\n([\s\S]+?)\n---/)![1]);
    expect(metadata.name).toBe('glass-markdown-authoring');
    expect(metadata.description).toContain('Glass Markdown');
    const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(4);
    for (const link of links) {
      expect(link.startsWith(target === 'pack' ? 'references/' : './')).toBe(true);
      await fs.access('docs/' + link.replace(/^(?:references\/|\.\/)/, ''));
    }
    expect(text).not.toContain('.agents/');
    expect(text).not.toContain('AGENTS.md');
  }
});

it('serves MCP links through existing bounded resources rather than private local paths', () => {
  const text = authoringInstructions('mcp');
  const resources = new Set([
    'glass://authoring/reference',
    ...['math-authoring', 'pseudocode', 'diagrams', 'markdown-ide', 'latex-conversion'].map(
      (name) => 'glass://authoring/guides/' + name,
    ),
  ]);
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) expect(resources.has(match[1])).toBe(true);
  expect(text).toContain('validate_markdown');
  expect(text).toContain('prepare_draft');
  expect(text).toContain('do not authorize publication');
  expect(text).not.toContain('file://');
  expect(text).not.toContain('.agents/');
});
