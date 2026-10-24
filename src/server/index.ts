import { createServer } from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getRequestListener } from '@hono/node-server';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app.js';
import { buildSite } from '../engine/build.js';
import { acquireRuntime } from './runtime.js';
import { applicationRoot, resolveLaunchOptions } from './configuration.js';
import { DevelopmentPreview } from './development.js';

const launch = await resolveLaunchOptions(process.argv.slice(2));
const root = launch.notebookRoot;
const port = launch.port;
const production = process.argv.includes('--production');
const runtime = await acquireRuntime(root, `http://127.0.0.1:${port}`);
if (!runtime.release) throw new Error('This notebook is already open in another Studio process.');
const development = production ? undefined : new DevelopmentPreview(root);
const context = await createApp(root, { applicationRoot, activePort: port, development });
try {
  await fs.access(path.join(root, 'dist/index.html'));
} catch {
  if (production) await buildSite(context.store, { onLog: console.log });
}
if (development) await development.start(context.store);
const listener = getRequestListener(context.app.fetch);
const server = createServer();
const vite = production
  ? null
  : await createViteServer({
      configFile: path.join(applicationRoot, 'vite.config.ts'),
      root: path.join(applicationRoot, 'src/console'),
      server: { middlewareMode: true, ws: { server, port } },
    });
server.on('request', (request, response) => {
  if (vite && request.url?.startsWith('/studio/'))
    vite.middlewares(request, response, () => {
      void listener(request, response);
    });
  else void listener(request, response);
});
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `Studio port ${port} is already in use. Start with --port followed by another port, or change Local Studio settings.`
      : error.message,
  );
  context.close();
  development?.close();
  void Promise.allSettled([vite?.close(), runtime.release?.()]).then(() => {
    process.exitCode = 1;
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(
    `\nNotebook  http://127.0.0.1:${port}/\nStudio    http://127.0.0.1:${port}/studio/\nMaterials http://127.0.0.1:${port}/__components/\n`,
  );
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    development?.close();
    context.close();
    server.close();
    server.closeAllConnections();
    void Promise.allSettled([vite?.close(), runtime.release?.()]).then(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
