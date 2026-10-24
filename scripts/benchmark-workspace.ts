/** Generated notebooks only. Reports and fixtures never enter publication or canonical content. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import * as React from 'react';

// tsx may use classic JSX for an archived checkout outside its project include paths.
// Supply the same React implementation while benchmarking either source tree.
Object.assign(globalThis, { React });

const args = process.argv.slice(2);
const option = (name: string, fallback: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] || fallback : fallback;
const sourceRoot = path.resolve(option('--source', '.'));
const label = option('--label', 'optimized');
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple report label.');
const number = (name: string, fallback: string, maximum: number) => {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}.`);
  return value;
};
const entryCount = number('--entries', '1000', 5000),
  mediaCount = number('--media', '3000', 10000),
  runs = number('--runs', '3', 5);
const load = (name: string) => import(pathToFileURL(path.join(sourceRoot, name)).href);
const { Store, serializeEntry, parseEntry, digest } = await load('src/engine/store.ts');
const { MediaService } = await load('src/engine/media.ts');
const { createRenderer } = await load('src/site/pages.tsx');
const { buildSite, buildAssets } = await load('src/engine/build.ts');
const { analyzeSource } = await load('src/console/source-analysis.ts');
const { routeFor, siteSchema } = await load('src/shared/contracts.ts');
const counters = await load('src/engine/work-cache.ts').catch(() => undefined);
const search = await load('src/shared/search-index.ts').catch(() => ({
  prepareSearch: (entries: any[]) => entries,
  // Equivalent to the reader search before the worker/index extraction.
  searchEntries: (entries: any[], query: string) => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/);
    return entries
      .map((entry) => ({
        entry,
        score: words.reduce(
          (sum, word) =>
            sum +
            (entry.title.toLocaleLowerCase().includes(word) ? 5 : 0) +
            (entry.tags.join(' ').toLocaleLowerCase().includes(word) ? 3 : 0) +
            (entry.text.toLocaleLowerCase().includes(word) ? 1 : 0),
          0,
        ),
      }))
      .filter(({ entry }) =>
        words.every((word) =>
          `${entry.title} ${entry.summary} ${entry.tags.join(' ')} ${entry.text}`
            .toLocaleLowerCase()
            .includes(word),
        ),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ entry }) => entry);
  },
}));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-performance-'));
const results: Record<string, unknown> = {};
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function measure(name: string, task: () => Promise<unknown> | unknown, repeats = runs) {
  const timings: number[] = [],
    counts: Record<string, number>[] = [];
  for (let i = 0; i < repeats; i++) {
    counters?.resetWorkCounters();
    const start = performance.now();
    await task();
    timings.push(+(performance.now() - start).toFixed(2));
    counts.push({ ...counters?.workCounters });
  }
  results[name] = { medianMs: median(timings), timings, counts };
  console.log(`${name}: ${median(timings).toFixed(1)} ms median`);
}
try {
  const content = path.join(root, 'content');
  await fs.mkdir(path.join(content, 'posts'), { recursive: true });
  await fs.mkdir(path.join(content, 'lab'), { recursive: true });
  await fs.mkdir(path.join(content, 'media'), { recursive: true });
  const template = parseEntry(
    await fs.readFile('tests/fixtures/notebook/posts/curiosity.md', 'utf8'),
    'posts',
    'curiosity.md',
  );
  const settings = siteSchema.parse(
    JSON.parse(await fs.readFile('tests/fixtures/notebook/site.json', 'utf8')),
  );
  settings.home.slides = [];
  settings.profile.portrait = '';
  settings.theme.backgroundImage = '';
  settings.metadata.socialImage = '';
  settings.branding.favicon = '';
  settings.branding.logo = '';
  settings.branding.darkLogo = '';
  settings.integrations.comments.enabled = false;
  await fs.writeFile(path.join(content, 'site.json'), JSON.stringify(settings));
  await fs.writeFile(path.join(content, 'library.json'), JSON.stringify({ photos: [], news: [] }));
  await fs.writeFile(
    path.join(content, 'about.md'),
    '# About\n\nAn isolated performance notebook.\n',
  );
  const imageCount = Math.min(mediaCount, 150);
  for (let i = 0; i < mediaCount; i++) {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="hsl(${i % 360},40%,70%)"/><circle cx="${(i % 780) + 90}" cy="320" r="85" fill="#345"/></svg>`,
    );
    if (i < imageCount) {
      const bytes = await sharp(svg).webp({ quality: 90 }).toBuffer();
      await fs.writeFile(path.join(content, 'media', `image-${i}.webp`), bytes);
      if (i < 32) {
        const id = randomUUID(),
          folder = path.join(root, '.studio/media-originals', id);
        await fs.mkdir(folder, { recursive: true });
        const original = await sharp(svg).png().toBuffer();
        await fs.writeFile(path.join(folder, 'original'), original);
        await fs.writeFile(
          path.join(folder, 'record.json'),
          JSON.stringify({
            sourceId: id,
            name: `original-${i}.png`,
            sha256: digest(original),
            variants: [{ name: `image-${i}.webp`, width: 960, height: 640, transform: {} }],
          }),
        );
      }
    } else await fs.writeFile(path.join(content, 'media', `unused-${i}.svg`), svg);
  }
  const paragraph =
    'A clear paragraph for a growing blog, with useful reading, ordinary text, and **emphasis**. '.repeat(
      4,
    );
  for (let i = 0; i < entryCount; i++) {
    const body =
      `# Entry ${i}\n\n` +
      Array.from({ length: 4 }, (_, n) => `## Section ${n}\n\n${paragraph}\n`).join('\n') +
      `\n![Benchmark image](/media/image-${i % imageCount}.webp)\n` +
      (i % 20 === 0 ? '\n$$\ny=\\frac{x^2}{2}+1\n$$\n' : '');
    await fs.writeFile(
      path.join(content, 'posts', `entry-${i}.md`),
      serializeEntry(
        {
          ...template,
          id: randomUUID(),
          slug: `entry-${i}`,
          title: `Entry ${i}`,
          summary: 'A generated benchmark entry.',
          status: 'published',
          cover: '',
          tags: ['Benchmark', `Topic ${i % 20}`],
          shortCode: '',
          shortAliases: [],
        },
        body,
      ),
    );
  }
  console.log(
    `Fixture: ${entryCount} entries, ${mediaCount} media files; author notebook untouched.`,
  );
  const store = new Store(root),
    media = new MediaService(store);
  await measure('snapshotCold', () => store.snapshot(), 1);
  await measure('snapshotWarm', () => store.snapshot());
  await measure('mediaCold', () => media.list(), 1);
  await measure('mediaWarm', () => media.list());
  const model = await store.snapshot();
  const preview = async () => {
    const snapshot = await store.snapshot();
    const renderer = await createRenderer(snapshot, {
      preview: true,
      diagramCacheDir: path.join(root, '.studio/render-cache/mermaid'),
    });
    renderer.render(routeFor(snapshot.entries[0], snapshot.site.collections));
    await media.list();
  };
  await measure('previewCold', preview, 1);
  await measure('previewWarm', preview);
  const context = {
    links: model.entries.map((entry: { status: string }) => ({
      url: routeFor(entry, model.site.collections),
      status: entry.status,
    })),
    media: (await media.list()).map((asset: { url: string }) => asset.url),
  };
  for (const warnings of [false, true]) {
    const source = Array.from(
      { length: 1250 },
      (_, i) =>
        `## Section ${i}\n\nA paragraph with ${warnings ? '[a missing page](/missing/)' : 'ordinary text'} for this benchmark.${warnings ? ' \t' : ''}\n`,
    ).join('\n');
    analyzeSource(source, context);
    await measure(warnings ? 'analysisWarnings5000' : 'analysis5000', () =>
      analyzeSource(source, context),
    );
  }
  const searchRecords = model.entries.map((entry: any) => ({
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
    text: entry.body,
    url: routeFor(entry, model.site.collections),
    kind: entry.kind,
  }));
  const searchIndex = search.prepareSearch(searchRecords);
  const queries = [
    'entry',
    'clear paragraph',
    'benchmark',
    'ordinary text',
    'topic 1',
    'entry 23',
    'useful reading',
    'emphasis',
    'a generated',
    'nonexistent',
  ];
  await measure('readerSearchBatch', () => {
    for (const query of queries) search.searchEntries(searchIndex, query);
  });
  const { lensPixels } = await load('src/shared/liquid-glass.ts');
  lensPixels(700, 600, 28);
  await measure('glassLens', () => lensPixels(700, 600, 28), 5);
  if (!args.includes('--skip-build')) {
    const assets = await buildAssets(root);
    await measure('buildCold', () => buildSite(store, { assets, updateDist: false }), 1);
    await measure('buildWarm', () => buildSite(store, { assets, updateDist: false }));
  }
  const report = {
    label,
    createdAt: new Date().toISOString(),
    sourceRoot,
    node: process.version,
    platform: process.platform,
    workload: {
      entries: entryCount,
      media: mediaCount,
      publishedImages: imageCount,
      documentLines: 5000,
      runs,
    },
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    results,
  };
  await fs.mkdir('.studio/reports', { recursive: true });
  await fs.writeFile(`.studio/reports/workspace-${label}.json`, JSON.stringify(report, null, 2));
  console.log(`Report: .studio/reports/workspace-${label}.json`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
