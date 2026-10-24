import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { topK, upperBound } from '../src/shared/algorithms.js';
import { prepareSearch, searchEntries } from '../src/shared/search-index.js';
import { lensPixels } from '../src/shared/liquid-glass.js';
import { Store, digest } from '../src/engine/store.js';
import {
  ArtifactCache,
  RenderCache,
  mapConcurrent,
  resetWorkCounters,
  workCounters,
} from '../src/engine/work-cache.js';
import { markdownCompiler } from '../src/engine/markdown-cache.js';
import { copyMedia } from '../src/engine/build.js';
import { MediaService } from '../src/engine/media.js';
import { analyzeSource } from '../src/console/source-analysis.js';
import { sourceAnalyzer } from '../src/console/source-worker.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-performance-test-'));
  resetWorkCounters();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it('selects stable top results with a bounded heap, including ties and empty limits', () => {
  const values = Array.from({ length: 500 }, (_, id) => ({ id, score: (id * 73) % 17 }));
  for (const count of [0, 1, 4, 12, 600])
    expect(topK(values, count, (a, b) => b.score - a.score)).toEqual(
      [...values].sort((a, b) => b.score - a.score).slice(0, count),
    );
  expect(upperBound([0, 5, 5, 9], 5)).toBe(3);
  expect(upperBound([], 10)).toBe(0);
});

it('preserves search matching, weighting, Unicode and stable ties', () => {
  const entries = Array.from({ length: 80 }, (_, id) => ({
    title: id % 4 ? `Note ${id}` : 'Glass curious',
    summary: id % 3 ? 'Curious summary' : 'Something else',
    tags: id % 5 ? ['Glass'] : ['Research'],
    text: `A curious reader. ${id % 7 ? '' : '玻璃'}`,
    url: `/post/${id}/`,
    kind: 'posts',
  }));
  for (const query of ['glass curious', 'summary', '玻璃', 'no results', '', '  GLASS ']) {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const expected = !words.length
      ? []
      : entries
          .map((entry) => ({
            entry,
            score: words.reduce(
              (score, word) =>
                score +
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
    expect(searchEntries(prepareSearch(entries), query)).toEqual(expected);
  }
});

it('keeps the optimized Liquid Glass pixels identical to accepted maps', () => {
  const cases: [number[], string][] = [
    // Zero corners now honor a square lens instead of silently using a 1px radius.
    [[1, 1, 0, 640], 'ede83dbed1f95e4cebf2e298d9d02727c7fcb278fbd45917780bda64e1056cfe'],
    [[120, 40, 20, 640], '1cab8c4352a9054caf1d8b8d3db4b5b5e82931d7cd8120d55269b943b9ed2269'],
    [[280, 720, 24, 640], 'f9e1e3f97e4e1379e64ac903c7b6f64ebe8e2d7d8f11b4ec6c0db11a4f3a559d'],
    [[700, 600, 28, 640], '908fd9ddff82a6c1fbfd9d0112e6570b31b6866f029105e61e953d6b51c81be4'],
    [[333, 199, 92, 128], '46bac2f1acc6231c76c19eaacb04150d96b465b84a3f8675f7a7a6406333db93'],
    [[640, 640, 320, 640], 'dd6ad2917aab9470eb891379e1566b2e478fec50aedd78e29086e606773caa83'],
    [[129, 181, 0, 640], '5f38a58f8e7fa466539ff86139f08dbcf1e588e43a067ab28eb48dd304d87ef6'],
    [[200, 100, 70, 640], '432ac164dac402d036ee184307da265d29d7ec11a1d9de115daf0e823bc8bf2d'],
  ];
  for (const [[width, height, radius, resolution], expected] of cases)
    expect(
      createHash('sha256')
        .update(lensPixels(width, height, radius, resolution).pixels)
        .digest('hex'),
    ).toBe(expected);
  expect(lensPixels(129, 181, 0).pixels[2]).toBeGreaterThan(0);
  expect(lensPixels(129, 181, 24).pixels[2]).toBe(0);
});

it('retains diagnostic coordinates, exclusions and Unicode word counts', () => {
  const source =
    '# Heading\r\n\r\n#### Skipped\r\n\r\n[missing](/absent/) \t\n\n`[ignored][unknown]`\n\n中文 words 🙂\n';
  const result = analyzeSource(source, { links: [], media: [] });
  expect(result.diagnostics.some((item) => item.code === 'missing-link-reference')).toBe(false);
  expect(result.diagnostics.some((item) => item.code === 'broken-local-link')).toBe(true);
  for (const item of result.diagnostics) {
    const prefix = source.slice(0, item.from);
    expect(item.line).toBe(prefix.split('\n').length);
    expect(item.column).toBe(item.from - prefix.lastIndexOf('\n'));
  }
  expect(result.characters).toBe([...source].length);
  expect(result.lines).toBe(source.split('\n').length);
  expect(result.words).toBe(
    [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(source)].filter(
      (item) => item.isWordLike,
    ).length,
  );
});

it('reuses parsed files while detecting same-timestamp external edits and isolating snapshots', async () => {
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  const store = new Store(root),
    first = await store.snapshot();
  const original = first.entries[0].body;
  first.entries[0].body = 'Unsaved preview';
  first.site.name = 'Unsaved name';
  resetWorkCounters();
  const second = await store.snapshot();
  expect(second.entries[0].body).toBe(original);
  expect(second.site.name).not.toBe(first.site.name);
  expect(workCounters['notebook.parse'] || 0).toBe(0);
  const entry = second.entries[0],
    file = path.join(root, 'content', entry.kind, entry.file);
  const stat = await fs.stat(file),
    raw = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, raw.replace(entry.title, 'X'.repeat(entry.title.length)));
  await fs.utimes(file, stat.atime, stat.mtime);
  const third = await store.snapshot();
  expect(third.entries.find((value) => value.id === entry.id)!.revision).not.toBe(entry.revision);
  expect(workCounters['notebook.parse']).toBe(1);
  await expect(
    store.saveEntry(entry.id, { metadata: entry, body: original, revision: entry.revision }),
  ).rejects.toThrow();
});

it('deduplicates cache work, returns isolated values, and repairs corrupt disk entries', async () => {
  const folder = path.join(root, 'render'),
    key = digest('cached result');
  const cache = new RenderCache<{ html: string }>(folder);
  await cache.sync();
  const generate = vi.fn(async () => ({ html: '<p>Accepted</p>' }));
  const [first, second] = await Promise.all([cache.get(key, generate), cache.get(key, generate)]);
  first.html = 'Changed';
  expect(second.html).toBe('<p>Accepted</p>');
  expect(generate).toHaveBeenCalledOnce();
  const restarted = new RenderCache<{ html: string }>(folder);
  await restarted.sync();
  await restarted.get(key, generate);
  expect(generate).toHaveBeenCalledOnce();
  await fs.writeFile(path.join(folder, key, 'result.json'), 'corrupt');
  const repaired = new RenderCache<{ html: string }>(folder);
  await repaired.sync();
  expect(await repaired.get(key, generate)).toEqual({ html: '<p>Accepted</p>' });
  expect(generate).toHaveBeenCalledTimes(2);
  await fs.rm(folder, { recursive: true });
  await cache.sync();
  await cache.get(key, generate);
  expect(generate).toHaveBeenCalledTimes(3);
});

it('keeps preview and production Markdown caches separate and never caches rendering errors', async () => {
  const compiler = await markdownCompiler(path.join(root, 'markdown'));
  const source = '# Reading\n\n$\\newcommand{\\cachedvalue}{3}$\n\n$$\ny=\\cachedvalue x\n$$';
  const first = await compiler.render(source, { entryId: 'one', preview: true });
  const second = await compiler.render(source, { entryId: 'one', preview: true });
  expect(second).toEqual(first);
  expect(workCounters['markdown.render']).toBe(1);
  expect(first.html).toContain('data-source-start');
  const published = await compiler.render(source, { entryId: 'one', preview: false });
  expect(published.html).not.toContain('data-source-start');
  expect(workCounters['markdown.render']).toBe(2);
  await compiler.render('Anonymous fragment.');
  await compiler.render('Anonymous fragment.');
  expect(workCounters['markdown.render']).toBe(4);
  const cache = new ArtifactCache(path.join(root, 'errors'));
  const generate = vi.fn(async () => {
    throw new Error('Invalid source');
  });
  await expect(cache.get(digest('bad'), generate)).rejects.toThrow('Invalid source');
  await expect(cache.get(digest('bad'), generate)).rejects.toThrow('Invalid source');
  expect(generate).toHaveBeenCalledTimes(2);
});

it('evicts the least recently used disk artifact without deleting canonical files', async () => {
  const cache = new ArtifactCache<string>(path.join(root, 'limited'), 1000);
  const first = digest('first'),
    second = digest('second');
  const now = Date.now();
  let time = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now + ++time * 100);
  await cache.get(first, async () => ({ value: 'first', files: { image: Buffer.alloc(400) } }));
  await cache.get(second, async () => ({ value: 'second', files: { image: Buffer.alloc(400) } }));
  cache.touch(first);
  const canonical = path.join(root, 'canonical.md');
  await fs.writeFile(canonical, 'Keep');
  await cache.prune();
  expect(await fs.readFile(canonical, 'utf8')).toBe('Keep');
  await expect(fs.access(path.join(cache.folder, first))).resolves.toBeUndefined();
  await expect(fs.access(path.join(cache.folder, second))).rejects.toThrow();
});

it('does not reinstall an in-flight cache artifact after reset replaces its directory', async () => {
  const cache = new ArtifactCache<string>(path.join(root, 'reset-cache'));
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => (entered = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve));
  const pending = cache.get(digest('in-flight'), async () => {
    entered();
    await gate;
    return { value: 'Old preview', files: { result: Buffer.from('Old preview') } };
  });
  await ready;
  await fs.rm(cache.folder, { recursive: true });
  await fs.mkdir(cache.folder);
  release();
  expect((await pending).value).toBe('Old preview');
  expect(await fs.readdir(cache.folder)).toEqual([]);
});

it('reuses verified image variants and regenerates corrupt or changed sources', async () => {
  await fs.mkdir(path.join(root, 'content/media'), { recursive: true });
  const file = path.join(root, 'content/media/picture.png');
  await fs.writeFile(
    file,
    await sharp({ create: { width: 736, height: 500, channels: 4, background: '#2288aa' } })
      .png()
      .toBuffer(),
  );
  const first = path.join(root, 'first'),
    second = path.join(root, 'second');
  await copyMedia(root, first, ['/media/picture.png']);
  expect(workCounters['image.encode']).toBe(2);
  resetWorkCounters();
  await copyMedia(root, second, ['/media/picture.png']);
  expect(workCounters['image.encode'] || 0).toBe(0);
  expect(await fs.readFile(path.join(second, 'media/picture-736.webp'))).toEqual(
    await fs.readFile(path.join(first, 'media/picture-736.webp')),
  );
  const cacheFolder = path.join(root, '.studio/render-cache/images'),
    key = (await fs.readdir(cacheFolder))[0];
  await fs.writeFile(path.join(cacheFolder, key, '480.webp'), 'broken');
  await copyMedia(root, path.join(root, 'third'), ['/media/picture.png']);
  expect(workCounters['image.encode']).toBe(2);
  const stat = await fs.stat(file);
  await fs.writeFile(
    file,
    await sharp({ create: { width: 736, height: 500, channels: 4, background: '#aa8822' } })
      .png()
      .toBuffer(),
  );
  await fs.utimes(file, stat.atime, stat.mtime);
  await copyMedia(root, path.join(root, 'fourth'), ['/media/picture.png']);
  expect(workCounters['image.encode']).toBe(4);
  await fs.unlink(file);
  await expect(copyMedia(root, path.join(root, 'fifth'), ['/media/picture.png'])).rejects.toThrow();
});

it('lists metadata without original reads and still rejects corrupt originals on access', async () => {
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  const media = new MediaService(new Store(root));
  const png = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#4488cc' } })
    .png()
    .toBuffer();
  const file = await media.upload(
    new File([new Uint8Array(png)], 'sample.png', { type: 'image/png' }),
  );
  resetWorkCounters();
  await media.list();
  await media.list();
  expect(workCounters['media.originalReadBytes'] || 0).toBe(0);
  resetWorkCounters();
  await new MediaService(media.store).list();
  expect(workCounters['media.metadata'] || 0).toBe(0);
  expect((await media.source(file.sourceId!)).bytes).toEqual(png);
  expect(workCounters['media.originalReadBytes']).toBe(png.length);
  await fs.writeFile(path.join(root, '.studio/media-originals', file.sourceId!, 'original'), 'bad');
  await expect(media.source(file.sourceId!)).rejects.toThrow('checksum');
});

it('bounds filesystem concurrency and waits for active work after a failure', async () => {
  let active = 0,
    maximum = 0;
  const result = await mapConcurrent([1, 2, 3, 4, 5], 2, async (value) => {
    active++;
    maximum = Math.max(active, maximum);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return value * 2;
  });
  expect(maximum).toBe(2);
  expect(result).toEqual([2, 4, 6, 8, 10]);
  await expect(
    mapConcurrent([1, 2, 3], 2, async (value) => {
      if (value === 1) throw new Error('stop');
      active++;
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return value;
    }),
  ).rejects.toThrow('stop');
  expect(active).toBe(0);
});

it('replaces obsolete worker requests and sends unchanged context only once', async () => {
  class WorkerStub {
    static current: WorkerStub;
    messages: any[] = [];
    onmessage?: (event: any) => void;
    onerror?: (event: any) => void;
    constructor() {
      WorkerStub.current = this;
    }
    postMessage(value: any) {
      this.messages.push(value);
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', WorkerStub);
  const analyzer = sourceAnalyzer(),
    context = { links: [{ url: '/post/', status: 'published' }] };
  const first = analyzer.analyze('# First', context),
    second = analyzer.analyze('# Second', context),
    third = analyzer.analyze('# Third', context);
  const worker = WorkerStub.current;
  expect(worker.messages.filter((message) => message.type === 'analyze')).toHaveLength(1);
  expect((await second).superseded).toBe(true);
  worker.onmessage!({ data: { id: 1, result: analyzeSource('# First') } });
  expect((await first).superseded).toBe(true);
  expect(worker.messages.filter((message) => message.type === 'context')).toHaveLength(1);
  expect(worker.messages.filter((message) => message.type === 'analyze')).toHaveLength(2);
  worker.onmessage!({ data: { id: 3, result: analyzeSource('# Third') } });
  expect((await third).headings[0].text).toBe('Third');
  const fourth = analyzer.analyze('# Fourth', context),
    fifth = analyzer.analyze('# Fifth', context);
  worker.onerror!({ preventDefault() {} });
  expect((await fourth).superseded).toBe(true);
  expect((await fifth).headings[0].text).toBe('Fifth');
  analyzer.dispose();
});
