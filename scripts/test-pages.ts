import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../src/engine/store.js';
import { buildAssets, buildSite } from '../src/engine/build.js';

// Exercise real Pages headers/routing without building or serving the author's notebook.
const project = process.cwd();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-pages-test-'));
let cleaning: Promise<void> | undefined;
const cleanup = () => (cleaning ||= fs.rm(root, { recursive: true, force: true }));
try {
  await fs.cp(path.join(project, 'tests/fixtures/notebook'), path.join(root, 'content'), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(project, 'tests/fixtures/authoring-showcase.md'),
    path.join(root, 'content/posts/authoring-showcase.md'),
  );
  const result = await buildSite(new Store(root), {
    assets: await buildAssets(project),
    updateDist: false,
  });
  const environment: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  delete environment.CLOUDFLARE_API_TOKEN;
  delete environment.R2_ACCESS_KEY_ID;
  delete environment.R2_SECRET_ACCESS_KEY;
  const child = spawn(
    process.execPath,
    [
      path.join(project, 'node_modules/wrangler/bin/wrangler.js'),
      'pages',
      'dev',
      result.outputDir,
      '--port',
      '4174',
      '--ip',
      '127.0.0.1',
    ],
    { cwd: project, env: environment, stdio: 'inherit' },
  );
  child.on('error', (error) => {
    console.error(error.message);
    void cleanup().finally(() => process.exit(1));
  });
  child.on('exit', (code) => {
    void cleanup().finally(() => process.exit(code || 0));
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      child.kill(signal);
    });
} catch (error) {
  await cleanup();
  throw error;
}
