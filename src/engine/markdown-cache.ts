import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { renderMarkdown, type MarkdownResult } from './markdown.js';
import { RenderCache } from './work-cache.js';

let fingerprint: Promise<string> | undefined;
const caches = new Map<string, RenderCache<MarkdownResult>>();
async function rendererFingerprint() {
  const root = path.resolve(import.meta.dirname, '../..');
  const hash = createHash('sha256');
  const walk = async (folder: string) => {
    for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else {
        hash.update(path.relative(root, file));
        hash.update(await fs.readFile(file));
      }
    }
  };
  await walk(path.join(root, 'src/engine'));
  await walk(path.join(root, 'src/shared'));
  hash.update(await fs.readFile(path.join(root, 'package-lock.json')));
  hash.update(process.platform);
  hash.update(process.arch);
  hash.update(process.versions.node);
  return hash.digest('hex');
}
export async function markdownCompiler(folder?: string) {
  if (!folder) return { render: renderMarkdown, prune: async () => {} };
  let cache = caches.get(folder);
  if (!cache) {
    cache = new RenderCache<MarkdownResult>(folder);
    if (caches.size >= 4) caches.delete(caches.keys().next().value!);
    caches.set(folder, cache);
  }
  try {
    await cache.sync();
  } catch {
    return { render: renderMarkdown, prune: async () => {} };
  }
  const engine = await (fingerprint ??= rendererFingerprint());
  return {
    render(source: string, context: Parameters<typeof renderMarkdown>[1] = {}) {
      // Anonymous fragments use occurrence-specific renderer IDs and cannot share a result.
      if (!context.entryId && !context.documentId) return renderMarkdown(source, context);
      const { diagrams: _diagrams, chartCacheDir: _chartCacheDir, ...settings } = context;
      const key = createHash('sha256')
        .update(JSON.stringify([engine, source, settings]))
        .digest('hex');
      return cache!.get(key, () => renderMarkdown(source, context));
    },
    prune: () => cache!.disk.prune(),
  };
}
