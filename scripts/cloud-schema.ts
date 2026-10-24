import { promises as fs } from 'node:fs';
/** Test harnesses apply exactly the committed production migrations in filename order. */
export async function cloudSchemaStatements() {
  const statements: string[] = [];
  for (const name of (await fs.readdir('infrastructure/cloud/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    statements.push(
      ...(await fs.readFile('infrastructure/cloud/migrations/' + name, 'utf8'))
        .split('\n')
        .filter((line) => line.trim() && !line.trim().startsWith('--')),
    );
  return statements;
}
