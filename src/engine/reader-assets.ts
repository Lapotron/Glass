import { promises as fs } from 'node:fs';
import path from 'node:path';
import { digest } from './store.js';
import { legacyReaderAssets, type ReaderAssets } from '../shared/reader-assets.js';
import { chartModuleKeys, validChartModules, type ChartModules } from '../shared/chart-modules.js';

export async function readerAssetFiles(folder: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(path.join(folder, prefix), { withFileTypes: true })) {
    if (
      entry.name.startsWith('.') ||
      entry.name === 'annotations-worker.js' ||
      entry.name.endsWith('.map')
    )
      continue;
    const file = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await readerAssetFiles(folder, file)));
    else files.push(file);
  }
  return files.sort();
}
export async function stageReaderAssets(source: string, output: string): Promise<ReaderAssets> {
  const files = await readerAssetFiles(source);
  for (const required of ['site.js', 'site.css', 'appearance.js'])
    if (!files.includes(required)) throw new Error(`The reader bundle is missing ${required}.`);
  const hash = digest(
    Buffer.concat(
      await Promise.all(
        files.map(async (file) =>
          Buffer.concat([Buffer.from(file + '\0'), await fs.readFile(path.join(source, file))]),
        ),
      ),
    ),
  ).slice(0, 20);
  const base = `/assets/bundles/${hash}`;
  for (const file of files) {
    const destination = path.join(output, base.slice(1), file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(source, file), destination);
  }
  const chartModules: ChartModules = {};
  const search = files.find((name) => /^chunks\/search-[\w-]+\.js$/.test(name));
  for (const key of chartModuleKeys) {
    const file = files.find((name) =>
      new RegExp(`^chunks/echarts-${key}-[\\w-]+\\.js$`).test(name),
    );
    if (file) chartModules[key] = `${base}/${file}`;
  }
  const manifest: ReaderAssets = {
    version: 1,
    script: `${base}/site.js`,
    style: `${base}/site.css`,
    appearance: `${base}/appearance.js`,
    ...(files.includes('discovery.css') ? { discoveryStyle: `${base}/discovery.css` } : {}),
    ...(files.includes('code.css') ? { codeStyle: `${base}/code.css` } : {}),
    ...(files.includes('content.css') ? { contentStyle: `${base}/content.css` } : {}),
    ...(files.includes('settings.css') ? { settingsStyle: `${base}/settings.css` } : {}),
    ...(files.includes('tools.js') ? { toolsScript: `${base}/tools.js` } : {}),
    ...(files.includes('tools.css') ? { toolsStyle: `${base}/tools.css` } : {}),
    ...(files.includes('archive-worker.js') ? { archiveWorker: `${base}/archive-worker.js` } : {}),
    ...(search ? { search: `${base}/${search}` } : {}),
    ...(Object.keys(chartModules).length ? { chartModules } : {}),
  };
  await fs.mkdir(path.join(output, 'assets'), { recursive: true });
  await fs.writeFile(path.join(output, 'assets/reader-assets.json'), JSON.stringify(manifest));
  return manifest;
}
export async function readReaderAssets(output: string): Promise<ReaderAssets> {
  let contents: string;
  try {
    contents = await fs.readFile(path.join(output, 'assets/reader-assets.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return legacyReaderAssets;
    throw error;
  }
  const manifest = JSON.parse(contents) as ReaderAssets;
  if (
    manifest.version !== 1 ||
    (manifest.search !== undefined &&
      !/^\/assets\/bundles\/[a-f0-9]{20}\/chunks\/search-[\w-]+\.js$/.test(manifest.search)) ||
    (manifest.chartModules !== undefined && !validChartModules(manifest.chartModules)) ||
    ![
      'script',
      'style',
      'appearance',
      ...(manifest.discoveryStyle !== undefined ? ['discoveryStyle'] : []),
      ...(manifest.codeStyle !== undefined ? ['codeStyle'] : []),
      ...(manifest.contentStyle !== undefined ? ['contentStyle'] : []),
      ...(manifest.settingsStyle !== undefined ? ['settingsStyle'] : []),
      ...(manifest.toolsStyle !== undefined ? ['toolsStyle'] : []),
      ...(manifest.archiveWorker !== undefined ? ['archiveWorker'] : []),
      ...(manifest.toolsScript !== undefined ? ['toolsScript'] : []),
    ].every((key) =>
      /^\/assets\/bundles\/[a-f0-9]{20}\/[\w.-]+$/.test(
        manifest[key as keyof ReaderAssets] as string,
      ),
    )
  )
    throw new Error('The reader asset manifest is invalid. Build the site again.');
  return manifest;
}
