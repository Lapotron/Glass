import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Store, digest } from '../src/engine/store.js';
import { createRenderer } from '../src/site/pages.js';
import { routeFor } from '../src/shared/contracts.js';
const root = process.cwd(),
  model = await new Store(root).snapshot();
const renderer = await createRenderer(model, {
  diagramCacheDir: path.join(root, '.studio/render-cache/mermaid'),
});
// This published-only, compiled projection is private server input. Never copy the notebook or Studio.
const entries = renderer.entries.map((entry) => ({
  id: entry.id,
  title: entry.title,
  summary: entry.summary,
  publishedAt: entry.publishedAt,
  revision: entry.revision,
  url: new URL(routeFor(entry, model.site.collections), model.site.url).href,
  html: entry.rendered.html.replace(
    /((?:src|href)=")\/(media\/)/g,
    `$1${model.site.url.replace(/\/$/, '')}/$2`,
  ),
}));
const output = path.join(root, 'apps/dynamic/.generated');
await fs.mkdir(output, { recursive: true });
await fs.writeFile(
  path.join(output, 'published.json'),
  JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    revision: digest(JSON.stringify(entries)),
    entries,
  }),
);
console.log(`Prepared ${entries.length} published entries for the isolated prototype.`);
