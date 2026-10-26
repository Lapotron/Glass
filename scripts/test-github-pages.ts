/** Plain static hosting only: no Studio APIs, Cloudflare Worker or redirect/header adapters. */
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/engine/store.js';
import { buildAssets, buildSite } from '../src/engine/build.js';

const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-github-browser-'));
await fs.cp('tests/fixtures/notebook', path.join(folder, 'content'), { recursive: true });
await fs.copyFile(
  'tests/fixtures/cloud-portrait.webp',
  path.join(folder, 'content/media/test-photo.webp'),
);
const store = new Store(folder);
const model = await store.read();
model.site.integrations.comments.enabled = true;
model.site.integrations.comments.onDemand = true;
model.site.collections.posts = { ...model.site.collections.posts, path: 'post', aliases: ['blog'] };
model.site.collections.lab = { ...model.site.collections.lab, path: 'article', aliases: ['lab'] };
const example = model.entries.find((entry) => entry.id === 'post-curiosity')!;
model.entries.push({
  ...example,
  id: 'github-components',
  slug: 'github-components',
  file: 'github-components.md',
  title: 'GitHub Pages components',
  shortCode: 'ghcomponents',
  shortAliases: [],
  routeAliases: ['/old-github-note/'],
  cover: '/media/test-photo.webp',
  body: '# Static features\n\nA searchable telescope nebula note. An inline equation $E=mc^2$.\n\n![A fixture photo](/media/test-photo.webp)\n\n## Exact source\n\n```html\n<a href="/post/github-components/">An example</a>\n```\n\nA footnote[^note].\n\n[^note]: A static footnote.\n\n$$\\int_0^1 x^2\\,dx=\\frac13$$\n',
});
for (let i = 0; i < 26; i++)
  model.entries.push({
    ...example,
    id: `github-${i}`,
    slug: `github-${i}`,
    title: `Archive example ${i}`,
    file: `github-${i}.md`,
    shortCode: `ghsample${i}`,
    shortAliases: [],
    routeAliases: [],
    body: `Archive sample ${i}.`,
    publishedAt: `2025-02-${String(i + 1).padStart(2, '0')}`,
  });
const assets = await buildAssets(process.cwd());
const sites = [
  { port: 4396, prefix: '/Glass', url: 'https://owner.github.io/Glass/' },
  { port: 4397, prefix: '', url: 'https://owner.github.io/' },
  { port: 4399, prefix: '', url: 'https://blog.example.test/' },
];
const servers: ReturnType<typeof createServer>[] = [];
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};
for (const site of sites) {
  const build = await buildSite(store, {
    model,
    assets,
    updateDist: false,
    deployment: { target: 'github-pages', baseUrl: site.url },
  });
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.writeHead(405);
      response.end();
      return;
    }
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (site.prefix && !url.pathname.startsWith(site.prefix + '/')) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    let relative: string;
    try {
      relative = decodeURIComponent(url.pathname.slice(site.prefix.length));
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    if (
      relative.split('/').some((part) => part === '..' || part === '.') ||
      /[\\\0]/.test(relative)
    ) {
      response.writeHead(400);
      response.end();
      return;
    }
    let file = path.join(
      build.outputDir,
      relative.endsWith('/') ? relative + 'index.html' : relative,
    );
    let status = 200;
    try {
      if ((await fs.stat(file)).isDirectory()) {
        response.writeHead(301, { Location: url.pathname + '/' + url.search });
        response.end();
        return;
      }
    } catch {
      file = path.join(build.outputDir, '404.html');
      status = 404;
    }
    const bytes = await fs.readFile(file);
    response.writeHead(status, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Content-Length': bytes.length,
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise<void>((resolve) => server.listen(site.port, '127.0.0.1', resolve));
  servers.push(server);
}
console.log('Plain GitHub Pages fixture ready at http://127.0.0.1:4396/Glass/');
async function close() {
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await fs.rm(folder, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
