import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, digest, ConflictError } from '../src/engine/store.js';
import { saveProjects, undoProjects, importGithubProject } from '../src/engine/projects.js';
import { emptyProjects, projectSchema } from '../src/shared/projects.js';
import { createRenderer } from '../src/site/pages.js';
import { buildSite } from '../src/engine/build.js';
import { BackupService } from '../src/engine/backup.js';
import { renderMarkdown } from '../src/engine/markdown.js';
import { discussionThemeCss, discussionThemePrefix } from '../src/engine/integrations.js';
import { contentSecurityPolicy } from '../src/shared/security.js';
let root: string, store: Store;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-reader-upgrades-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('uses an absent Projects default without writing, saves atomically, detects conflicts and undoes removal after restart', async () => {
  const model = await store.read();
  expect(model.projects).toEqual(emptyProjects());
  await expect(fs.access(path.join(root, 'content/projects.json'))).rejects.toThrow();
  const project = projectSchema.parse({
    id: 'public-project',
    title: 'A project',
    visibility: 'public',
    image: '/media/wave.svg',
  });
  const initial = await saveProjects(store, { version: 1, projects: [project] }, digest(''));
  await expect(saveProjects(store, emptyProjects(), digest(''))).rejects.toBeInstanceOf(
    ConflictError,
  );
  const removed = await saveProjects(store, emptyProjects(), initial.revision);
  expect((await store.read()).projects?.projects).toHaveLength(0);
  const restored = await undoProjects(new Store(root), removed.revision);
  expect(restored.value.projects).toEqual([project]);
  const backup = await new BackupService(store).portableSnapshot();
  await new BackupService(store).verifyPortableSnapshot(backup);
});
it('renders Projects in navigation order, excludes draft projects and indexes complete published content, including code', async () => {
  const model = await store.read();
  model.projects = {
    version: 1,
    projects: [
      projectSchema.parse({
        id: 'shown',
        title: 'Visible repository',
        visibility: 'public',
        technologies: ['Rust'],
      }),
      projectSchema.parse({ id: 'hidden', title: 'Private project sentinel', visibility: 'draft' }),
    ],
  };
  const entry = model.entries.find((e) => e.status === 'published')!;
  entry.body +=
    '\n\n## Deep search\n\n' +
    'long paragraph '.repeat(2000) +
    ' quasarneedle\n\n```rust\nlet searchablecode = 42;\n```';
  const renderer = await createRenderer(model);
  const html = renderer.render('/projects/');
  expect(html).toContain('Visible repository');
  expect(html).not.toContain('Private project sentinel');
  const nav = html.match(/<nav[^>]*aria-label="Main navigation"[\s\S]*?<\/nav>/)![0];
  expect(nav.indexOf('/archive/')).toBeLessThan(nav.indexOf('/projects/'));
  expect(nav.indexOf('/projects/')).toBeLessThan(nav.indexOf('/life/'));
  const assets = path.join(root, 'assets-fixture');
  await fs.mkdir(assets);
  for (const file of ['site.js', 'site.css', 'appearance.js', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, file), '/* fixture */');
  const build = await buildSite(store, { model, assets, updateDist: false });
  const manifest = JSON.parse(
    await fs.readFile(path.join(build.outputDir, 'assets/search-manifest.json'), 'utf8'),
  );
  expect(manifest.languages.some((l: { language: string }) => l.language === 'en')).toBe(true);
  expect(manifest.languages.some((l: { language: string }) => l.language === 'zh')).toBe(true);
  const searchFiles = build.manifest.filter((file) => file.endsWith('.pf_fragment'));
  const fragments = await Promise.all(
    searchFiles.map((file) => fs.readFile(path.join(build.outputDir, file))),
  );
  expect(fragments.length).toBeGreaterThan(0);
  const serialized = JSON.stringify(renderer.search);
  expect(serialized).not.toContain('Private project sentinel');
  expect(contentSecurityPolicy(model.site)).toContain("'wasm-unsafe-eval'");
  expect(contentSecurityPolicy(model.site)).not.toContain("'unsafe-eval'");
});
it('compiles Expressive Code metadata, unknown languages and non-code math without a reader highlighter', async () => {
  const rendered = await renderMarkdown(
    '```ts title="example.ts" {2} ins={3} collapse={4-4} wrap\nconst value = 1;\n  console.log(value);\n// later\n// hidden\n```\n\n```not-a-real-language\n<safe>\n```\n\n$$\nx^2\n$$',
  );
  expect(rendered.html).toContain('expressive-code');
  expect(rendered.html).toContain('data-code-line="2"');
  expect(rendered.html).toContain('highlight mark');
  expect(rendered.html).toContain('collapse');
  expect(rendered.html).toContain('copy-code');
  expect(rendered.html).toContain('class="code-filename" title="example.ts">example.ts</span>');
  expect(rendered.html).not.toMatch(/<figure\b[^>]*class="[^"]*\bhas-title\b/);
  expect(rendered.html).toContain('data-code-download');
  expect(rendered.html).toContain('aria-pressed="true"');
  expect((rendered.html.match(/data-code-line="\d+"/g) || []).length).toBe(5);
  expect(rendered.html).toContain('math-display');
  expect(rendered.html).not.toContain('<script');
  const inferred = await renderMarkdown('```js\n// src/inferred.js\nconst value = 1;\n```');
  expect(inferred.html).toContain(
    'class="code-filename" title="src/inferred.js">src/inferred.js</span>',
  );
});
it('generates complete light/dark custom themes and invalidates their fingerprint when tokens change', async () => {
  const { site } = await store.read();
  const light = discussionThemeCss(site, 'light'),
    dark = discussionThemeCss(site, 'dark');
  expect(light).not.toContain('@import');
  expect(light).toContain('--color-prettylights-syntax-keyword');
  expect(light).toContain('.gsc-comment-box-textarea');
  expect(light).toContain('.gsc-comment > div');
  expect(light).toContain('--gsc-panel:rgb(');
  expect(dark).toContain('color-scheme:dark');
  expect(light).not.toEqual(dark);
  expect(
    discussionThemeCss({ ...site, theme: { ...site.theme, background: 'sand' } }, 'light'),
  ).not.toEqual(light);
  expect(discussionThemePrefix(site)).not.toEqual(
    discussionThemePrefix({ ...site, theme: { ...site.theme, accent: '#9448aa' } }),
  );
});
it('keeps Giscus inset layers transparent through the glass opacity range and retains a solid accessibility fallback', async () => {
  const { site } = await store.read();
  for (const mode of ['light', 'dark'] as const) {
    for (const opacity of [0, 0.6, 1]) {
      const css = discussionThemeCss(
        { ...site, theme: { ...site.theme, glassOpacity: opacity, reduceTransparency: false } },
        mode,
      );
      const alpha = Number(css.match(/--gsc-panel:rgb\([^;]+\/ ([\d.]+)\)/)?.[1]);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(0.12);
      if (opacity === 0) expect(alpha).toBe(0);
      expect(css).toContain('--color-canvas-default:transparent;');
      expect(css).toContain('--color-btn-bg:var(--gsc-control);');
    }
    const solid = discussionThemeCss(
      { ...site, theme: { ...site.theme, reduceTransparency: true } },
      mode,
    );
    expect(solid).toMatch(/--gsc-panel:#[a-f0-9]{6};/);
  }
});
it('imports only explicit public GitHub repositories and leaves application of fields to the author', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      private: false,
      name: 'Test project',
      description: 'Public import',
      language: 'TypeScript',
      topics: ['ui'],
      homepage: 'https://project.example',
      archived: false,
    }),
  );
  const result = await importGithubProject('test-fixture/selected', fetcher);
  expect(result).toMatchObject({
    visibility: 'draft',
    title: 'Test project',
    technologies: ['TypeScript', 'ui'],
  });
  expect(fetcher.mock.calls).toHaveLength(1);
  await importGithubProject('test-fixture/selected', fetcher);
  expect(fetcher.mock.calls).toHaveLength(1);
  await expect(importGithubProject('https://internal.example', fetcher)).rejects.toThrow();
  await expect(importGithubProject('owner/..', fetcher)).rejects.toThrow();
  expect((await store.read()).projects?.projects).toHaveLength(0);
});
