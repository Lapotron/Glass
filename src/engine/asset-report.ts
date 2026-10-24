import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { readerAssetFiles, readReaderAssets } from './reader-assets.js';

export async function inspectReaderAssets(output: string) {
  const manifest = await readReaderAssets(output);
  const records = await Promise.all(
    (await readerAssetFiles(path.join(output, 'assets')))
      .filter((file) => /\.(js|css)$/.test(file))
      .map(async (file) => {
        const source = await fs.readFile(path.join(output, 'assets', file), 'utf8');
        return {
          file: 'assets/' + file,
          bytes: Buffer.byteLength(source),
          gzip: gzipSync(source).length,
          source,
        };
      }),
  );
  const byFile = new Map(records.map((item) => [item.file, item]));
  const closure = (entries: string[]) => {
    const names = new Set(entries.map((file) => file.replace(/^\//, '')));
    const queue = [...names];
    while (queue.length) {
      const file = queue.shift()!,
        record = byFile.get(file);
      if (!record) throw new Error(`Missing reader asset: ${file}`);
      for (const match of record.source.matchAll(
        /\b(?:import|export)\s*(?:[^;]*?\bfrom\s*)?["']([^"']+\.js)["']/g,
      )) {
        if (!match[1].startsWith('.')) continue;
        const dependency = path.posix.normalize(
          path.posix.join(path.posix.dirname(file), match[1]),
        );
        if (!names.has(dependency)) {
          names.add(dependency);
          queue.push(dependency);
        }
      }
    }
    return records.filter((record) => names.has(record.file));
  };
  const initial = closure([manifest.script, manifest.appearance, manifest.style]);
  const showcase = closure([
    ...initial.map((record) => record.file),
    ...(manifest.contentStyle ? [manifest.contentStyle] : []),
    ...(manifest.codeStyle ? [manifest.codeStyle] : []),
    ...records
      .filter((record) =>
        /\/(?:widgets|function-plot|chart|quiz|tabs|image-compare|line-discussions|mindmap|article-experience|code-tools|diagram-viewer|integrations)-[A-Za-z0-9_-]{8,12}\.js$/.test(
          record.file,
        ),
      )
      .map((record) => record.file),
  ]);
  const chartInteraction = closure([
    ...showcase.map((record) => record.file),
    ...records
      .filter((record) => /\/echarts-[^/]+\.js$/.test(record.file))
      .map((record) => record.file),
  ]);
  const settings = closure([
    ...initial.map((record) => record.file),
    ...(manifest.settingsStyle ? [manifest.settingsStyle] : []),
    ...(manifest.contentStyle ? [manifest.contentStyle] : []),
    ...records
      .filter((record) => /\/reader-settings-[\w-]+\.js$/.test(record.file))
      .map((record) => record.file),
  ]);
  const sum = (items: typeof records) => items.reduce((total, item) => total + item.gzip, 0);
  const initialGzip = sum(initial),
    initialJsGzip = sum(initial.filter((item) => item.file.endsWith('.js'))),
    showcaseGzip = sum(showcase);
  const budgets = [
    { name: 'Initial JavaScript', actual: initialJsGzip, limit: 20 * 1024 },
    { name: 'Initial JavaScript and CSS', actual: initialGzip, limit: 45 * 1024 },
    { name: 'Activated showcase JavaScript and CSS', actual: showcaseGzip, limit: 90 * 1024 },
  ].map((budget) => ({ ...budget, passed: budget.actual <= budget.limit }));
  const publicRecord = ({ source: _source, ...record }: (typeof records)[number]) => record;
  return {
    settingsGzip: sum(settings),
    createdAt: new Date().toISOString(),
    initialGzip,
    initialJsGzip,
    showcaseGzip,
    budgets,
    initial: initial.map(publicRecord),
    showcase: showcase.map(publicRecord),
    chartInteractionGzip: sum(chartInteraction),
    chartInteraction: chartInteraction.map(publicRecord),
    largestDeferred: records
      .filter((item) => !initial.includes(item))
      .sort((a, b) => b.gzip - a.gzip)
      .slice(0, 8)
      .map(publicRecord),
  };
}
