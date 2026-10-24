import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
const root = process.cwd(),
  folder = path.join(root, '.agents/skills');
const entries = await fs.readdir(folder, { withFileTypes: true }).catch((error) => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
if (!entries.length) {
  console.log('No local development skills installed; repository builds do not require them.');
  process.exit(0);
}
const skills = entries.filter((e) => e.isDirectory());
for (const required of [
  'blog-console',
  'blog-content',
  'blog-design-system',
  'blog-engine',
  'blog-interactives',
  'blog-publish',
])
  if (!skills.some((skill) => skill.name === required))
    throw new Error(`Missing core skill: ${required}`);
for (const skill of skills) {
  const base = path.join(folder, skill.name),
    text = await fs.readFile(path.join(base, 'SKILL.md'), 'utf8');
  const frontmatter = text.match(/^---\n([\s\S]+?)\n---\n/);
  if (!frontmatter) throw new Error(`${skill.name}: missing frontmatter`);
  const metadata = parse(frontmatter[1]);
  if (
    metadata.name !== skill.name ||
    !/^[a-z0-9-]+$/.test(metadata.name) ||
    typeof metadata.description !== 'string' ||
    metadata.description.length < 30
  )
    throw new Error(`${skill.name}: invalid skill metadata`);
  const ui = parse(await fs.readFile(path.join(base, 'agents/openai.yaml'), 'utf8'));
  if (!ui.interface.default_prompt.includes(`$${skill.name}`))
    throw new Error(`${skill.name}: invocation example does not name the skill`);
  if (ui.interface.short_description.length < 25 || ui.interface.short_description.length > 64)
    throw new Error(`${skill.name}: UI description must be 25–64 characters`);
  for (const match of text.matchAll(/\]\(([^)]+)\)/g))
    if (!/^https?:/.test(match[1]))
      await fs.access(path.resolve(base, match[1].split('#')[0] || 'SKILL.md'));
  if (/\bTODO\b|\[INSERT|\[REPLACE/.test(text))
    throw new Error(`${skill.name}: unfinished scaffold`);
  console.log(`✓ ${skill.name}: metadata, invocation, and reference links`);
}
