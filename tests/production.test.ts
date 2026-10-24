import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDiagramRenderer } from '../src/engine/diagrams.js';
import { renderMarkdown } from '../src/engine/markdown.js';
import { readReaderAssets, stageReaderAssets } from '../src/engine/reader-assets.js';
import { inspectReaderAssets } from '../src/engine/asset-report.js';
import {
  resolveResponsiveImages,
  useOriginalMediaImages,
} from '../src/engine/responsive-images.js';
import { responsiveWidths } from '../src/shared/utils.js';
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-production-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('renders complete accessible diagram variants and namespaces repeated SVG references', async () => {
  const source =
    '```mermaid\nflowchart LR\n accTitle: A static reading diagram\n A[Reader] --> B[SVG]\n```';
  const rendered = await renderMarkdown(source + '\n\n' + source, {
    documentId: 'duplicate-diagrams',
  });
  expect((rendered.html.match(/data-diagram-rendered="glass-2"/g) || []).length).toBe(4);
  expect(rendered.html).toContain('A static reading diagram');
  expect(rendered.html).toContain('View Mermaid source');
  const ids = [...rendered.html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  const references = [...rendered.html.matchAll(/(?:href="#|url\(#)([^)"']+)/g)].map(
    (match) => match[1],
  );
  expect(references.length).toBeGreaterThan(0);
  expect(references.every((reference) => ids.includes(reference))).toBe(true);
  expect(rendered.html).not.toContain('enhanced when JavaScript');
});
it('reuses persisted diagram results after a process restart without launching Chromium', async () => {
  const cacheDir = path.join(root, 'cache'),
    source =
      'sequenceDiagram\n participant Cache\n participant Reader\n Cache->>Reader: Already rendered';
  const renderer = createDiagramRenderer({ cacheDir });
  try {
    await renderer.render(source, 'first-document');
  } finally {
    await renderer.close();
  }
  expect((await fs.readdir(cacheDir)).length).toBe(1);
  const script = `import { createDiagramRenderer } from './src/engine/diagrams.ts'; const renderer=createDiagramRenderer({cacheDir:${JSON.stringify(cacheDir)},launch:async()=>{throw new Error('Must not launch');}});try{const result=await renderer.render(${JSON.stringify(source)},'after-restart');console.log(JSON.stringify({cached:result.light.includes('after-restart')}));}finally{await renderer.close();}`;
  const result = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: process.cwd() },
  );
  expect(JSON.parse(result.stdout)).toEqual({ cached: true });
});
it('preserves native MathML in diagram labels without requiring KaTeX browser code or fonts', async () => {
  const result = await renderMarkdown('```mermaid\nflowchart LR\n A["$$x^2+1$$"] --> B[Done]\n```');
  expect((result.html.match(/<math\b/g) || []).length).toBe(2);
  expect(result.html).toContain('<msup>');
  expect(result.html).not.toContain('katex-html');
  expect(result.html).not.toContain('@font-face');
});
it('rejects malformed diagrams and gives an actionable missing-renderer error', async () => {
  await expect(renderMarkdown('```mermaid\nnot-a-diagram impossible\n```')).rejects.toThrow();
  const launch = vi.fn(async () => {
    throw new Error('Browser missing');
  });
  const renderer = createDiagramRenderer({ launch });
  try {
    await expect(
      renderer.render('flowchart TB\n A[Missing renderer fixture]-->B', 'missing'),
    ).rejects.toThrow('npm run renderers:install');
  } finally {
    await renderer.close();
  }
  expect(launch).toHaveBeenCalledOnce();
});
it('does not block a plain Markdown response behind another session’s diagram queue', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    ready = new Promise<void>((resolve) => (entered = resolve));
  const renderer = createDiagramRenderer({
    launch: async () => {
      entered();
      await gate;
      throw new Error('Controlled missing browser');
    },
  });
  const pending = renderer
    .render('flowchart TB\n A[Concurrent queue fixture] --> B', 'queue')
    .catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await ready;
    const note = renderMarkdown('A plain note should stay responsive.');
    expect(
      await Promise.race([
        note.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 1000);
        }),
      ]),
    ).toBe(true);
  } finally {
    clearTimeout(timer);
    release();
    await pending;
    await renderer.close();
  }
});
it('locks diagram security despite source configuration and keeps hostile labels inert', async () => {
  const source =
    '```mermaid\n%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\n A["<script>alert(1)</script>Reader"] --> B[Safe]\n click B "javascript:alert(1)"\n```';
  const result = await renderMarkdown(source);
  for (const svg of result.html.match(/<svg[\s\S]*?<\/svg>/g) || []) {
    expect(svg).not.toMatch(/<script|\son\w+=|href="javascript:/i);
    expect(svg).toContain(
      svg.includes('data-diagram-rendered') ? 'role="img"' : 'aria-hidden="true"',
    );
  }
});
it('fingerprints the complete reader bundle, excludes private files and reports static imports', async () => {
  const source = path.join(root, 'bundle'),
    output = path.join(root, 'public');
  await fs.mkdir(path.join(source, 'chunks'), { recursive: true });
  await fs.writeFile(
    path.join(source, 'site.js'),
    'import {value} from "./chunks/shared.js"; console.log(value);',
  );
  await fs.writeFile(path.join(source, 'chunks/shared.js'), 'export const value=1;');
  for (const file of [
    'site.css',
    'settings.css',
    'appearance.js',
    'annotations-worker.js',
    '.complete',
    'private.map',
    'chunks/search-fixture.js',
  ])
    await fs.writeFile(path.join(source, file), '/* fixture */');
  const first = await stageReaderAssets(source, output);
  expect(first.search).toBe(`${path.dirname(first.script)}/chunks/search-fixture.js`);
  expect(first.settingsStyle).toBe(`${path.dirname(first.script)}/settings.css`);
  expect(await readReaderAssets(output)).toEqual(first);
  expect(await stageReaderAssets(source, path.join(root, 'same'))).toEqual(first);
  const report = await inspectReaderAssets(output);
  expect(report.initial.some((file) => file.file.endsWith('/chunks/shared.js'))).toBe(true);
  expect(report.budgets.every((budget) => budget.passed)).toBe(true);
  const directory = path.dirname(path.join(output, first.script));
  expect(await fs.readdir(directory)).not.toContain('annotations-worker.js');
  expect(await fs.readdir(directory)).not.toContain('.complete');
  expect(await fs.readdir(directory)).not.toContain('private.map');
  await fs.writeFile(path.join(source, 'site.css'), 'body { color: red; }');
  expect((await stageReaderAssets(source, path.join(root, 'changed'))).script).not.toBe(
    first.script,
  );
  await fs.writeFile(
    path.join(output, 'assets/reader-assets.json'),
    JSON.stringify({ ...first, script: 'https://outside.invalid/script.js' }),
  );
  await expect(readReaderAssets(output)).rejects.toThrow('manifest is invalid');
  await fs.writeFile(
    path.join(output, 'assets/reader-assets.json'),
    JSON.stringify({ ...first, settingsStyle: 'https://outside.invalid/settings.css' }),
  );
  await expect(readReaderAssets(output)).rejects.toThrow('manifest is invalid');
  await fs.writeFile(
    path.join(output, 'assets/reader-assets.json'),
    JSON.stringify({ ...first, search: 'https://outside.invalid/search.js' }),
  );
  await expect(readReaderAssets(output)).rejects.toThrow('manifest is invalid');
});
it('uses actual widths consistently in images and preload candidates while retaining authored layout', () => {
  expect(responsiveWidths(200)).toEqual([200]);
  expect(responsiveWidths(736)).toEqual([480, 736]);
  expect(responsiveWidths(960)).toEqual([480, 960]);
  expect(responsiveWidths(2400)).toEqual([480, 960, 1600]);
  const images = new Map([['/media/small image.jpg', { width: 736, height: 400 }]]);
  const html = resolveResponsiveImages(
    '<link rel="preload" as="image" href="/media/small%20image.jpg" imagesrcset="wrong 1600w"/><img src="/media/small%20image.jpg" srcset="wrong 1600w" sizes="100vw" loading="eager"/><img src="https://outside.test/photo.jpg"/>',
    images,
  );
  expect(html).toContain('small%20image-480.webp 480w');
  expect(html).toContain('small%20image-736.webp 736w');
  expect(html).not.toContain('1600w');
  expect(html).toContain('width="736" height="400"');
  expect(html).toContain('fetchpriority="high"');
  expect(html).toContain('sizes="100vw"');
  expect(html).toContain('<img src="https://outside.test/photo.jpg"/>');
});
it('uses private originals in hosted previews without changing layout or external images', () => {
  const external =
    '<img src="https://outside.test/photo.jpg" srcset="https://outside.test/small.jpg 480w"/>';
  const html = useOriginalMediaImages(
    '<link rel="preload" as="image" href="/media/a%20portrait.webp" imagesrcset="/media/a%20portrait-480.webp 480w"/>' +
      '<img src="/media/a%20portrait.webp" srcset="/media/a%20portrait-480.webp 480w" width="128" height="128" sizes="128px" alt="Portrait"/>' +
      "<IMG SRC='/media/cover.webp' SRCSET='/media/cover-480.webp 480w'/>" +
      external,
  );
  expect(html).not.toContain('portrait-480.webp');
  expect(html).not.toContain('cover-480.webp');
  expect(html).toContain('href="/media/a%20portrait.webp"');
  expect(html).toContain(
    'src="/media/a%20portrait.webp" width="128" height="128" sizes="128px" alt="Portrait"',
  );
  expect(html).toContain(external);
});
