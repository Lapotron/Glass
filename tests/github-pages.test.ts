import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'yaml';
import { Store } from '../src/engine/store.js';
import { buildSite } from '../src/engine/build.js';
import { publicDeployment } from '../src/engine/deployment.js';
import { deploymentHtml, assertStaticSvg } from '../src/engine/deployment-html.js';
import {
  publicPath,
  publicUrl,
  validBasePath,
  publicAsset,
  readerBasePath,
} from '../src/shared/public-path.js';
import { readReaderAssets } from '../src/engine/reader-assets.js';
import { validateGithubArtifact } from '../src/engine/github-pages.js';
import { githubPagesSetup } from '../scripts/github-pages-setup.mjs';
import { buildGithubPages } from '../scripts/github-pages.js';

let root: string, store: Store, assets: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-github-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  assets = path.join(root, 'test-assets');
  await fs.mkdir(assets);
  for (const file of ['site.js', 'site.css', 'appearance.js', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, file), '/* isolated fixture */');
});
afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

it('separates origin, project path and custom-domain metadata without unsafe URL components', () => {
  expect(
    publicDeployment('https://old.test', {
      target: 'github-pages',
      baseUrl: 'https://owner.github.io/Glass/',
    }),
  ).toMatchObject({
    origin: 'https://owner.github.io',
    basePath: '/Glass',
    baseUrl: 'https://owner.github.io/Glass',
  });
  expect(publicDeployment('https://old.test').basePath).toBe('');
  expect(publicUrl('/blog/note/#heading', 'https://owner.github.io', '/Glass')).toBe(
    'https://owner.github.io/Glass/blog/note/#heading',
  );
  expect(publicPath('https://other.test/media/file', '/Glass')).toBe(
    'https://other.test/media/file',
  );
  for (const value of ['/a/../b', '//other', '/a%2Fb', '/a\\b', '/a?q'])
    expect(validBasePath(value)).toBe(false);
  for (const baseUrl of [
    'http://example.test/',
    'https://a:b@example.test/',
    'https://example.test/?q=1',
    'https://example.test/a/../b/',
  ])
    expect(() =>
      publicDeployment('https://old.test', { target: 'github-pages', baseUrl }),
    ).toThrow();
  expect(
    publicAsset(
      '/Elsewhere/assets/archive/catalog-' + 'a'.repeat(20) + '.json',
      /^\/assets\//,
      '/Glass',
    ),
  ).toBe(false);
});

it('rewrites only real HTML URL contexts, preserving examples, title text and SVG geometry', () => {
  const deployment = publicDeployment('https://example.test', {
    target: 'github-pages',
    baseUrl: 'https://example.test/Glass/',
  });
  const source =
    '<html><head><title>/blog/note</title></head><body><a href="/blog/note/?q=1#head">Go</a><pre><code>href="/blog/note/"</code></pre><img src="/media/a.webp" srcset="/media/a.webp 1x, /media/b.webp 2x"><svg><path d="M0 0L1 2"/><use href="#symbol"/></svg><figure data-interactive="image-compare" data-config="{&quot;before&quot;:&quot;/media/a.webp&quot;,&quot;after&quot;:&quot;/media/b.webp&quot;,&quot;title&quot;:&quot;/a title&quot;}"></figure></body></html>';
  const html = deploymentHtml(source, deployment);
  expect(html).toContain('href="/Glass/blog/note/?q=1#head"');
  expect(html).toContain('<code>href="/blog/note/"</code>');
  expect(html).toContain('<title>/blog/note</title>');
  expect(html).toContain('srcset="/Glass/media/a.webp 1x, /Glass/media/b.webp 2x"');
  expect(html).toContain('d="M0 0L1 2"');
  expect(html).toContain('href="#symbol"');
  expect(html).toContain('&quot;before&quot;:&quot;/Glass/media/a.webp&quot;');
  expect(html).toContain('&quot;title&quot;:&quot;/a title&quot;');
});

it('resolves worker prefixes and tolerates partial non-browser locations', () => {
  try {
    vi.stubGlobal('location', { origin: 'https://example.test' });
    expect(readerBasePath()).toBe('');
    vi.stubGlobal('location', { pathname: '/Glass/assets/bundles/123/archive-worker.js' });
    expect(publicPath('/assets/catalog.json')).toBe('/Glass/assets/catalog.json');
    vi.stubGlobal('document', { documentElement: { dataset: { siteBase: '/Glass' } } });
    expect(readerBasePath()).toBe('/Glass');
    vi.stubGlobal('document', { documentElement: { dataset: { siteBase: '/a/../b' } } });
    expect(readerBasePath()).toBe('');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('rejects active SVG while keeping ordinary SVG images supported', () => {
  expect(() => assertStaticSvg('<svg><path d="M0 0L1 1"/></svg>', 'safe.svg')).not.toThrow();
  for (const source of [
    '<svg onload="alert(1)"/>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><foreignObject>HTML</foreignObject></svg>',
    '<svg><a href="javascript:alert(1)">Link</a></svg>',
  ])
    expect(() => assertStaticSvg(source, 'unsafe.svg')).toThrow('active SVG');
});

it.each([
  'https://owner.github.io/',
  'https://owner.github.io/Glass/',
  'https://blog.example.test/',
])(
  'builds a complete static reader at %s without changing author settings',
  async (baseUrl) => {
    const original = await fs.readFile(path.join(root, 'content/site.json'), 'utf8');
    const result = await buildSite(store, {
      assets,
      deployment: { target: 'github-pages', baseUrl },
    });
    const base = new URL(baseUrl).pathname.replace(/\/$/, '');
    const output = result.outputDir;
    const home = await fs.readFile(path.join(output, 'index.html'), 'utf8');
    const article = await fs.readFile(
      path.join(output, 'blog/a-small-case-for-curiosity/index.html'),
      'utf8',
    );
    expect(home).toContain(`href="${base}/archive/"`);
    expect(home).toContain(`rel="canonical" href="${baseUrl}"`);
    expect(article).toContain(`${baseUrl}blog/a-small-case-for-curiosity/`);
    expect(article).toContain('Content-Security-Policy');
    expect(article).not.toContain('data-annotation-endpoint');
    expect(result.manifest).toContain('.nojekyll');
    expect(result.manifest).not.toEqual(
      expect.arrayContaining(['_headers', '_redirects', '_worker.js', '_routes.json']),
    );
    expect(
      result.manifest.some((file) => file.startsWith('s/') && file.endsWith('/index.html')),
    ).toBe(true);
    expect(
      result.manifest.some((file) => /draft|source\.json|connections|studio\//.test(file)),
    ).toBe(false);
    const reader = await readReaderAssets(output);
    expect(reader.script).toMatch(new RegExp('^' + base + '/assets/bundles/'));
    const search = JSON.parse(
      await fs.readFile(path.join(output, 'assets/search-manifest.json'), 'utf8'),
    );
    expect(search.languages.every((item: any) => item.module.startsWith(base + '/assets/'))).toBe(
      true,
    );
    const manifest = JSON.parse(await fs.readFile(path.join(output, 'site.webmanifest'), 'utf8'));
    expect(manifest.start_url).toBe(base + '/');
    expect(manifest.icons[0].src).toContain(base + '/app-icon-');
    await validateGithubArtifact(
      output,
      publicDeployment('https://old.test', { target: 'github-pages', baseUrl }),
    );
    expect(await fs.readFile(path.join(root, 'content/site.json'), 'utf8')).toBe(original);
  },
  60000,
);

it('keeps the existing Cloudflare artifact and annotations adapter available', async () => {
  const model = await store.read();
  model.site.integrations.comments.enabled = true;
  const result = await buildSite(store, { assets, model });
  expect(result.manifest).toEqual(
    expect.arrayContaining(['_headers', '_redirects', '_worker.js', '_routes.json']),
  );
  expect(await fs.readFile(path.join(result.outputDir, 'index.html'), 'utf8')).not.toContain(
    'data-site-base',
  );
}, 60000);

it('fails safely for missing responsive assets and keeps accepted output after an unsafe SVG build', async () => {
  const baseUrl = 'https://owner.github.io/Glass/';
  const deployment = publicDeployment('https://old.test', { target: 'github-pages', baseUrl });
  const result = await buildSite(store, {
    assets,
    deployment: { target: 'github-pages', baseUrl },
  });
  const accepted = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  await fs.writeFile(
    path.join(result.outputDir, 'broken.html'),
    '<link rel="preload" as="image" imagesrcset="/Glass/media/missing-960.webp 960w">',
  );
  await expect(validateGithubArtifact(result.outputDir, deployment)).rejects.toThrow(
    'missing-960.webp',
  );
  const model = await store.read();
  model.entries.find((entry) => entry.status === 'published')!.cover = '/media/active.svg';
  await fs.writeFile(
    path.join(root, 'content/media/active.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
  );
  await expect(
    buildSite(store, { assets, model, deployment: { target: 'github-pages', baseUrl } }),
  ).rejects.toThrow('active SVG');
  expect(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8')).toBe(accepted);
}, 60000);

it('requires an explicit Pages destination at the CLI boundary', async () => {
  await expect(buildGithubPages(['--root', root], {})).rejects.toThrow('Pass --base-url');
});

it('requires repository opt-in and distinguishes missing setup from denied permissions without leaking credentials', async () => {
  const token = 'private-fixture-token';
  const disabled = await githubPagesSetup('example/site', token, async (_url, options) => {
    expect(options.method).toBe('GET');
    expect(options.redirect).toBe('manual');
    return new Response(null, { status: 404 });
  });
  expect(disabled.enabled).toBe(false);
  expect(disabled.message).toContain('Settings');
  expect(
    (
      await githubPagesSetup('example/site', token, async () =>
        Response.json({ build_type: 'workflow' }),
      )
    ).enabled,
  ).toBe(true);
  expect(
    (
      await githubPagesSetup('example/site', token, async () =>
        Response.json({ build_type: 'legacy' }),
      )
    ).enabled,
  ).toBe(false);
  await expect(
    githubPagesSetup('example/site', token, async () => new Response(token, { status: 403 })),
  ).rejects.toThrow('HTTP 403');
  await expect(
    githubPagesSetup('example/site', token, async () => {
      throw new Error(token);
    }),
  ).rejects.not.toThrow(token);
});

it('ships production-only deployment with minimal permissions, pinned actions and public-only uploads', async () => {
  const workflow = parse(
    await fs.readFile('distribution/base/github-pages.yml', 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return fs.readFile('.github/workflows/github-pages.yml', 'utf8');
    }),
  );
  expect(workflow.jobs.build.if).toContain('repository.default_branch');
  expect(workflow.jobs.deploy.needs).toBe('build');
  expect(workflow.jobs.deploy.if).toContain("outputs.enabled == 'true'");
  expect(workflow.jobs.deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
  const upload = workflow.jobs.build.steps.find((step: any) =>
    step.uses?.startsWith('actions/upload-pages-artifact@'),
  );
  expect(upload.with.path).toBe('dist');
  for (const job of Object.values(workflow.jobs) as any[])
    for (const step of job.steps) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
});
