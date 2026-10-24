import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as builder from '../src/engine/build.js';
import { Store } from '../src/engine/store.js';
import { DevelopmentPreview, withDevelopmentReload } from '../src/server/development.js';
import { createApp } from '../src/server/app.js';
let root: string, development: DevelopmentPreview;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-development-test-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'dist/index.html'), 'accepted production sentinel');
  development = new DevelopmentPreview(root);
});
afterEach(async () => {
  development.close();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
it('rebuilds content in an isolated development directory and retains the last successful preview on error', async () => {
  let count = 0;
  const spy = vi.spyOn(builder, 'buildSite').mockImplementation(async (_store, options) => {
    const id = String(++count),
      outputDir = path.join(options!.artifactRoot!, id, 'public');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'index.html'), 'development ' + id);
    return { id, outputDir } as Awaited<ReturnType<typeof builder.buildSite>>;
  });
  const store = new Store(root);
  await development.start(store);
  expect(development.directory).toContain('.studio/development/1/public');
  expect(spy.mock.calls[0][1]?.updateDist).toBe(false);
  const first = development.generation;
  await fs.writeFile(path.join(root, 'content/reload-probe.txt'), 'changed');
  await vi.waitFor(() => expect(development.generation).not.toBe(first), { timeout: 3000 });
  const successful = development.directory;
  spy.mockRejectedValueOnce(new Error('Invalid content sentinel'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await development.rebuild(store);
  expect(development.directory).toBe(successful);
  expect(development.error).toContain('Invalid content');
  expect(log).toHaveBeenCalled();
  expect(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8')).toBe(
    'accepted production sentinel',
  );
  expect(withDevelopmentReload('<body>preview</body>')).toContain('src="/__dev/reload.js"');
});
it('keeps development helpers behind the local-host and origin checks', async () => {
  const context = await createApp(root, { watchFiles: false, development });
  try {
    expect((await context.app.request('http://example.com/__dev/reload.js')).status).toBe(403);
    expect(
      (
        await context.app.request('http://localhost/__dev/reload.js', {
          headers: { Origin: 'https://example.com' },
        })
      ).status,
    ).toBe(403);
    const local = await context.app.request('http://localhost/__dev/reload.js');
    expect(local.status).toBe(200);
    expect(local.headers.get('Cache-Control')).toBe('no-store');
    expect(await local.text()).toContain('EventSource');
  } finally {
    context.close();
  }
});
