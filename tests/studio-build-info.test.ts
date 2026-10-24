import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { studioBuildInfo } from '../scripts/studio-build-info.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture(git = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-studio-version-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '3.2.1' }));
  await fs.writeFile(path.join(root, 'src/app.ts'), 'export const value = 1;');
  if (git) {
    const run = (args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
    run(['init', '-q']);
    run(['add', 'package.json', 'src']);
    run([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-qm',
      'Fixture source',
    ]);
  }
  return root;
}
it('identifies compiled source changes independently of ordinary notebook edits', async () => {
  const root = await fixture();
  const initial = studioBuildInfo(root, false, {});
  expect(initial.version).toBe('3.2.1');
  expect(initial.commit).toMatch(/^[a-f\d]{40}$/);
  expect(initial.modified).toBe(false);
  expect(Number.isFinite(Date.parse(initial.builtAt))).toBe(true);
  await fs.mkdir(path.join(root, 'content'));
  await fs.writeFile(path.join(root, 'content/draft.md'), '# A private draft');
  expect(studioBuildInfo(root, false, {}).modified).toBe(false);
  await fs.writeFile(path.join(root, 'src/app.ts'), 'export const value = 2;');
  const modified = studioBuildInfo(root, true, {});
  expect(modified.modified).toBe(true);
  expect(modified.commit).toBe(initial.commit);
  expect(modified.development).toBe(true);
});
it('uses only valid Workers Builds source revisions and falls back to the checkout', async () => {
  const root = await fixture();
  const ci = 'A'.repeat(40);
  expect(studioBuildInfo(root, false, { WORKERS_CI_COMMIT_SHA: ci }).commit).toBe(ci.toLowerCase());
  expect(studioBuildInfo(root, false, { WORKERS_CI_COMMIT_SHA: 'untrusted revision' }).commit).toBe(
    studioBuildInfo(root, false, {}).commit,
  );
});
it('keeps version information usable for source archives without Git', async () => {
  const root = await fixture(false);
  expect(studioBuildInfo(root, false, {})).toMatchObject({
    version: '3.2.1',
    commit: null,
    modified: false,
  });
  expect(studioBuildInfo(root, false, { WORKERS_CI_COMMIT_SHA: 'b'.repeat(40) }).commit).toBe(
    'b'.repeat(40),
  );
});
