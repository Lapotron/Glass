import { buildSearch } from './search.js';
import { codeStyles } from './code.js';
import { MediaService } from './media.js';
import { ArtifactCache, countWork, mapConcurrent } from './work-cache.js';
import { canonicalMediaUrl, type MediaDetailsManifest } from '../shared/media-details.js';
import { siteRedirects } from './shortlinks.js';
import { mediaLinkMap, resolveMediaLink } from './media-links.js';
import { resolveMediaHtml } from './media-delivery.js';
import { collectionAliasRoutes, routesForEntry } from '../shared/collections.js';
import { entryAliasRoutes } from '../shared/entry-routes.js';
import { albumAliasRoutes } from '../shared/albums.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { entryMedia, resolveEntrySettings } from '../shared/entry-settings.js';
import { randomUUID } from 'node:crypto';
import { build as bundle, type Plugin } from 'vite';
import sharp from 'sharp';
import { createRenderer } from '../site/pages.js';
import { escapeHtml, responsiveWidths } from '../shared/utils.js';
import { routeFor, type BuildResult, type Repository } from '../shared/contracts.js';
import { atomicWrite, contained, digest, Store } from './store.js';
import { contentSecurityPolicy } from '../shared/security.js';
import { discussionThemeCss, discussionThemePrefix } from './integrations.js';
import { stageReaderAssets } from './reader-assets.js';
import { resolveResponsiveImages } from './responsive-images.js';
import { writeBranding } from './branding.js';
import { writeFeeds } from './feeds.js';
import { publicDeployment, deploymentModel, type DeploymentInput } from './deployment.js';
import { artifactFiles, prepareGithubArtifact } from './github-pages.js';

const sourceRoot = path.resolve(import.meta.dirname, '../..');
const mediaImplementation = fs.readFile(new URL(import.meta.url)).then(digest);
const assetPromises = new Map<string, Promise<string>>();
function toolsModuleBoundary(): Plugin {
  return { name: 'tools-module-boundary', generateBundle(_options, result) {
    for (const item of Object.values(result)) if (item.type === 'chunk') {
      const forbidden = Object.keys(item.modules).find((id) => id.startsWith('node:') || id.includes('vite-browser-external') || /[\\/]src[\\/](?:engine|console|server|edge)[\\/]|[\\/]node_modules[\\/](?:react|react-dom|zod|@aws-sdk|sharp|playwright|playwright-core)[\\/]/.test(id));
      if (forbidden) throw new Error(`Private code entered the Tools bundle: ${forbidden}`);
    }
  }};
}
async function walk(folder: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const name = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(name)));
    else result.push(name);
  }
  return result;
}
export async function buildAssets(root: string) {
  const files = [
    ...(await walk(path.join(sourceRoot, 'src/site'))),
    ...(await walk(path.join(sourceRoot, 'src/shared'))),
    ...(await walk(path.join(sourceRoot, 'src/edge'))),
    path.join(sourceRoot, 'package-lock.json'),
    fileURLToPath(import.meta.url),
    path.join(sourceRoot, 'src/engine/code.ts'),
  ];
  const hash = digest(
    Buffer.concat([Buffer.from(buildAssets.toString() + toolsModuleBoundary.toString()), ...await Promise.all(files.map((file) => fs.readFile(file)))]),
  ).slice(0, 14);
  const output = path.join(root, '.studio/assets', hash);
  if (assetPromises.has(output)) return assetPromises.get(output)!;
  const promise = (async () => {
    try {
      await fs.access(path.join(output, '.complete'));
      await fs.access(path.join(output, 'tools.js'));
      await fs.access(path.join(output, 'tools.css'));
      return output;
    } catch {}
    await fs.mkdir(output, { recursive: true });
    await bundle({
      configFile: false,
      root: sourceRoot,
      base: './',
      logLevel: 'error',
      plugins: [
        {
          name: 'reader-module-boundary',
          generateBundle(_options, output) {
            for (const item of Object.values(output)) {
              if (item.type !== 'chunk') continue;
              const forbidden = Object.keys(item.modules).find((id) =>
                /[\\/]src[\\/](?:engine|console|server|edge)[\\/]|[\\/]node_modules[\\/](?:mermaid|@mathjax|katex|shiki|@shikijs|playwright|playwright-core|zod|react|react-dom|monaco-editor|codemirror|@codemirror|prettier|qrcode-generator|@aws-sdk|sharp)[\\/]/.test(
                  id,
                ),
              );
              if (forbidden)
                throw new Error(
                  `Authoring or rendering code entered the reader bundle: ${forbidden}`,
                );
            }
          },
        },
      ],
      build: {
        outDir: output,
        emptyOutDir: true,
        target: 'es2022',
        cssCodeSplit: false,
        minify: true,
        rollupOptions: {
          input: {
            site: path.join(sourceRoot, 'src/site/client.ts'),
          },
          output: {
            entryFileNames: '[name].js',
            chunkFileNames: 'chunks/[name]-[hash].js',
            assetFileNames: (asset) =>
              asset.names.some((n) => n.endsWith('.css')) ? 'site.css' : '[name]-[hash][extname]',
          },
        },
      },
    });
    // Page-linked CSS stays available without JavaScript and outside the initial reader styles.
    for (const [entry, name] of [
      ['content-style', 'content'],
      ['reader-settings-style', 'settings'],
      ['discovery-style', 'discovery'],
    ]) {
      await bundle({
        configFile: false,
        root: sourceRoot,
        logLevel: 'error',
        build: {
          outDir: output,
          emptyOutDir: false,
          minify: true,
          rollupOptions: {
            input: path.join(sourceRoot, `src/site/${entry}.ts`),
            output: { entryFileNames: `${entry}.js`, assetFileNames: `${name}.css` },
          },
        },
      });
    }
    await bundle({
      configFile: false,
      root: sourceRoot,
      logLevel: 'error',
      build: {
        outDir: output,
        emptyOutDir: false,
        target: 'es2022',
        minify: true,
        lib: {
          entry: path.join(sourceRoot, 'src/site/archive-worker.ts'),
          formats: ['es'],
          fileName: () => 'archive-worker.js',
        },
      },
    });
    // A classic, self-contained script applies reader choices before the first paint.
    await bundle({
      configFile: false,
      root: sourceRoot,
      logLevel: 'error',
      build: {
        outDir: output,
        emptyOutDir: false,
        target: 'es2022',
        minify: true,
        lib: {
          entry: path.join(sourceRoot, 'src/site/appearance.ts'),
          formats: ['iife'],
          name: 'GlassAppearance',
          fileName: () => 'appearance.js',
        },
      },
    });
    await bundle({
      configFile: false,
      root: sourceRoot,
      logLevel: 'error',
      build: {
        outDir: output,
        emptyOutDir: false,
        target: 'es2022',
        minify: true,
        lib: {
          entry: path.join(sourceRoot, 'src/edge/annotations.ts'),
          formats: ['es'],
          fileName: () => 'annotations-worker.js',
        },
      },
    });
    await fs.writeFile(
      path.join(output, 'code.css'),
      (await codeStyles()) +
        '\n' +
        (await fs.readFile(path.join(sourceRoot, 'src/site/code.css'), 'utf8')),
    );
    // Public utilities deliberately have a separate graph; compiler/editor modules stay out of readers.
    await bundle({
      configFile: false, root: sourceRoot, base: './', logLevel: 'error',
      plugins: [toolsModuleBoundary()],
      worker: { format: 'es', plugins: () => [toolsModuleBoundary()], rollupOptions: { output: { entryFileNames: 'tools/[name]-[hash].js', chunkFileNames: 'tools/[name]-[hash].js' } } },
      build: { outDir: output, emptyOutDir: false, target: 'es2022', minify: true,
        rollupOptions: { input: path.join(sourceRoot, 'src/site/tools.ts'), output: { entryFileNames: 'tools.js', chunkFileNames: 'tools/[name]-[hash].js', assetFileNames: (asset) => asset.names.some((name) => name.endsWith('.css')) ? 'tools.css' : 'tools/[name]-[hash][extname]' } },
      },
    });
    await fs.writeFile(path.join(output, '.complete'), hash);
    return output;
  })();
  assetPromises.set(output, promise);
  try {
    return await promise;
  } catch (error) {
    assetPromises.delete(output);
    throw error;
  }
}
export async function copyMedia(root: string, output: string, references: Iterable<string>) {
  const base = path.join(root, 'content/media');
  const names = new Set<string>();
  for (const reference of references) {
    if (!reference.startsWith('/media/')) continue;
    const name = decodeURIComponent(reference.split(/[?#]/)[0].slice('/media/'.length));
    const source = await contained(base, name);
    if (
      !(
        await fs.stat(source).catch(() => {
          throw new Error(`Missing media: ${reference}`);
        })
      ).isFile()
    )
      throw new Error(`Media is not a file: ${reference}`);
    names.add(name);
  }
  const dimensions = new Map<string, { width: number; height: number }>();
  const cache = new ArtifactCache<{ width?: number; height?: number; widths: number[] }>(
    path.join(root, '.studio/render-cache/images'),
  );
  const implementation = await mediaImplementation;
  await mapConcurrent([...names], 2, async (name) => {
    const source = await contained(base, name),
      destination = path.join(output, 'media', name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const bytes = await fs.readFile(source),
      extension = path.extname(name).toLowerCase();
    const key = digest(JSON.stringify([implementation, sharp.versions, extension, digest(bytes)]));
    const artifact = await cache.get(key, async () => {
      const metadata = await sharp(bytes, { limitInputPixels: 40000000 })
        .metadata()
        .catch(() => null);
      const files: Record<string, Buffer> = { source: bytes };
      if (
        metadata &&
        /\.(png|jpe?g|webp|avif|gif)$/i.test(name) &&
        (metadata.exif || metadata.xmp || metadata.iptc)
      ) {
        countWork('image.encode');
        const format = extension.slice(1).replace('jpg', 'jpeg') as
          'png' | 'jpeg' | 'webp' | 'avif' | 'gif';
        files.source = await sharp(bytes, { animated: true, limitInputPixels: 40000000 })
          .autoOrient()
          .keepIccProfile()
          .toFormat(format)
          .toBuffer();
      }
      const widths =
        metadata?.width && /\.(png|jpe?g|webp|avif)$/i.test(name)
          ? responsiveWidths(metadata.autoOrient.width)
          : [];
      for (const width of widths) {
        countWork('image.encode');
        files[`${width}.webp`] = await sharp(bytes, { animated: true, limitInputPixels: 40000000 })
          .autoOrient()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 84 })
          .toBuffer();
      }
      return {
        value: {
          width: metadata?.autoOrient.width,
          height: metadata?.pageHeight || metadata?.autoOrient.height,
          widths,
        },
        files,
      };
    });
    await fs.writeFile(destination, artifact.files.source);
    if (artifact.value.width && artifact.value.height)
      dimensions.set(`/media/${name}`, {
        width: artifact.value.width,
        height: artifact.value.height,
      });
    for (const width of artifact.value.widths) {
      const variant = destination.replace(/\.[^.]+$/, `-${width}.webp`);
      if (names.has(path.relative(path.join(output, 'media'), variant)))
        throw new Error(
          `Responsive image name conflicts with a canonical file: ${path.basename(variant)}`,
        );
      await fs.writeFile(variant, artifact.files[`${width}.webp`]);
    }
  });
  await cache.prune();
  return dimensions;
}
export async function buildSite(
  store: Store,
  options: {
    model?: Repository;
    id?: string;
    onLog?: (message: string) => void;
    updateDist?: boolean;
    assets?: string;
    artifactRoot?: string;
    deployment?: DeploymentInput;
  } = {},
): Promise<BuildResult> {
  const log = options.onLog || (() => undefined);
  const sourceModel = options.model || (await store.exclusive(() => store.read()));
  const deployment = publicDeployment(sourceModel.site.url, options.deployment);
  const github = deployment.target === 'github-pages';
  const model = deploymentModel(sourceModel, deployment);
  const id = options.id || `${Date.now()}-${randomUUID().slice(0, 8)}`;
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid build identity');
  const buildRoot = path.join(options.artifactRoot || path.join(store.root, '.studio/builds'), id),
    output = path.join(buildRoot, 'public');
  await fs.mkdir(output, { recursive: true });
  await atomicWrite(path.join(buildRoot, 'source.json'), JSON.stringify(sourceModel));
  log('Preparing reader styles and browser enhancements…');
  const assets = options.assets || (await buildAssets(store.root));
  const readerAssets = await stageReaderAssets(assets, output);
  log('Generating favicons and home-screen icons…');
  const brandingVersion = await writeBranding(store.root, output, model.site);
  log('Reading the notebook and rendering published content…');
  const mediaService = new MediaService(store),
    mediaFiles = await mediaService.list();
  const allMediaLinks = mediaLinkMap(
    mediaFiles.map((file) => file.url),
    model.library,
  );
  const resolveAlias = (url: string) => resolveMediaLink(url, allMediaLinks);
  const renderer = await createRenderer(model, {
    publicBasePath: deployment.basePath,
    staticOnly: github,
    diagramCacheDir: path.join(store.root, '.studio/render-cache/mermaid'),
    readerAssets,
    brandingVersion,
    archiveThumbnails: new Map(
      mediaFiles
        .filter((file) => file.width && /\.(png|jpe?g|webp|avif)$/i.test(file.url))
        .map((file) => {
          const width = responsiveWidths(file.width!)[0];
          return [
            file.url,
            {
              src: file.url.replace(/\.[^.]+$/, `-${width}.webp`),
              width,
              height: Math.max(1, Math.round((width * (file.height || file.width!)) / file.width!)),
            },
          ];
        }),
    ),
  });
  const normalized = renderer.routes.map((r) =>
    decodeURIComponent(r).normalize('NFC').toLowerCase(),
  );
  if (new Set(normalized).size !== normalized.length)
    throw new Error(
      'Two tags, albums, or entries produce the same route. Give them distinct names.',
    );
  const references = new Set<string>(
    [
      model.site.profile.portrait,
      model.site.theme.backgroundImage,
      model.site.metadata.socialImage,
      ...model.library.photos.map((p) => p.src),
      ...renderer.entries.flatMap((e) => [...entryMedia(e), ...e.rendered.media]),
      ...renderer.about.media,
      ...Object.entries(model.library.mediaDetails)
        .filter(([, value]) => value.publishForSharing)
        .map(([url]) => url),
    ].filter(Boolean),
  );
  const pages = new Map<string, string>();
  for (const route of renderer.routes)
    pages.set(route, resolveMediaHtml(renderer.render(route), resolveAlias));
  pages.set('/404.html', resolveMediaHtml(renderer.render('/404.html'), resolveAlias));
  for (const html of pages.values()) {
    for (const match of html.matchAll(/(?:src|href)="(\/media\/[^"?#]+)(?:[?#][^"]*)?"/g))
      references.add(match[1].replace(/&amp;/g, '&'));
  }
  const publicMediaUrls = new Set(
    [...references].filter((url) => url.startsWith('/media/')).map(canonicalMediaUrl),
  );
  log(
    `Validating ${renderer.entries.length} published entries and ${references.size} referenced assets…`,
  );
  const dimensions = await copyMedia(store.root, output, references);
  for (const [route, html] of pages) pages.set(route, resolveResponsiveImages(html, dimensions));
  const comments = model.site.integrations.comments;
  if (comments.enabled && !github) {
    await fs.copyFile(path.join(assets, 'annotations-worker.js'), path.join(output, '_worker.js'));
    await fs.writeFile(
      path.join(output, '_routes.json'),
      JSON.stringify({ version: 1, include: ['/api/annotations/*'], exclude: [] }),
    );
    await fs.writeFile(
      path.join(output, 'assets/annotation-config.json'),
      JSON.stringify({
        repo: comments.repo,
        category: comments.category,
        entries: renderer.entries
          .filter((entry) => resolveEntrySettings(model.site, entry).discussion.annotations)
          .map((entry) => entry.id),
      }),
    );
  }
  const mediaDetails: MediaDetailsManifest = { version: 1, images: {} };
  const mediaContext = { files: mediaFiles, model };
  const mediaByUrl = new Map(mediaContext.files.map((file) => [canonicalMediaUrl(file.url), file]));
  for (const reference of references) {
    if (!reference.startsWith('/media/') || !/\.(svg|png|jpe?g|webp|avif|gif)$/i.test(reference))
      continue;
    const url = canonicalMediaUrl(reference),
      file = mediaByUrl.get(url);
    if (!file) throw new Error(`Missing media: ${reference}`);
    const camera = model.library.mediaDetails[url]?.publishCameraExif
      ? (await mediaService.details(url, mediaContext)).camera
      : {};
    mediaDetails.images[url] = {
      name: file.name,
      displayName: file.displayName,
      downloadName: file.downloadName,
      shortUrl: '/m/' + file.shortCode,
      url,
      bytes: (await fs.stat(path.join(output, 'media', file.name))).size,
      width: dimensions.get(decodeURIComponent(url))?.width || file.width,
      height: dimensions.get(decodeURIComponent(url))?.height || file.height,
      format: path.extname(file.name).slice(1).toUpperCase(),
      camera,
    };
  }
  await fs.writeFile(path.join(output, 'assets/media-details.json'), JSON.stringify(mediaDetails));
  for (const [route, html] of pages) {
    const filename = route.endsWith('.html')
      ? route.slice(1)
      : path.join(decodeURIComponent(route).slice(1), 'index.html');
    const target = path.join(output, filename);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, html);
  }
  const url = deployment.baseUrl;
  await fs.mkdir(path.join(output, 'assets/archive'), { recursive: true });
  await fs.writeFile(
    path.join(output, renderer.archiveCatalog.path.slice(1)),
    renderer.archiveCatalog.data,
  );
  await fs.writeFile(path.join(output, 'search.json'), JSON.stringify(renderer.search));
  await fs.writeFile(
    path.join(output, 'assets/reading-catalog.json'),
    JSON.stringify(
      renderer.entries
        .filter((e) => e.status === 'published')
        .map((e) => ({
          id: e.id,
          title: e.title,
          url: routeFor(e, model.site.collections),
          revision: e.revision,
        })),
    ),
  );
  log('Indexing published content for full-text search…');
  await buildSearch(output, model, renderer);
  const noindexRoutes = new Set(
    renderer.entries
      .filter((entry) => entry.seo?.indexing === 'noindex')
      .map((entry) => routeFor(entry, model.site.collections)),
  );
  if (model.site.metadata.sitemap && model.site.metadata.indexing)
    await fs.writeFile(
      path.join(output, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${renderer.routes
        .filter((r) => r !== '/settings/' && r !== '/search/' && !noindexRoutes.has(r))
        .map((r) => `<url><loc>${escapeHtml(url + r)}</loc></url>`)
        .join('')}</urlset>`,
    );
  await writeFeeds(output, model.site, renderer.entries, brandingVersion, deployment.basePath);
  await fs.writeFile(
    path.join(output, 'robots.txt'),
    `User-agent: *\nAllow: /\n${model.site.metadata.sitemap && model.site.metadata.indexing ? `Sitemap: ${url}/sitemap.xml\n` : ''}`,
  );
  await fs.writeFile(
    path.join(output, 'assets/deployment.json'),
    JSON.stringify({ version: 1, id }),
  );
  if (!github) await fs.writeFile(
    path.join(output, '_headers'),
    `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: ${contentSecurityPolicy(model.site)}\n/assets/*\n  Access-Control-Allow-Origin: *\n${model.site.mediaProtection.discourageIndexing ? '  X-Robots-Tag: noindex\n' : ''}/assets/deployment.json\n  Cache-Control: no-store\n/assets/reader-assets.json\n  Cache-Control: public, max-age=0, must-revalidate\n/assets/reading-catalog.json\n  Cache-Control: public, max-age=0, must-revalidate\n/assets/search-manifest.json\n  Cache-Control: public, max-age=0, must-revalidate\n/assets/archive/*\n  Cache-Control: public, max-age=31536000, immutable\n/assets/search/*\n  Cache-Control: public, max-age=31536000, immutable\n/assets/media-details.json\n  Cache-Control: public, max-age=0, must-revalidate\n/assets/annotation-config.json\n  Cache-Control: public, max-age=0, must-revalidate\n/assets/discussion-:mode.css\n  Cache-Control: public, max-age=0, must-revalidate\n/assets/bundles/*\n  Cache-Control: public, max-age=31536000, immutable\n/assets/themes/*\n  Cache-Control: public, max-age=31536000, immutable\n/assets/chunks/*\n  Cache-Control: public, max-age=31536000, immutable\n${model.site.mediaProtection.discourageIndexing ? '/m/*\n  X-Robots-Tag: noindex\n' : ''}/media/*\n${model.site.mediaProtection.discourageIndexing ? '  X-Robots-Tag: noindex\n' : ''}  Cache-Control: public, max-age=3600\n  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox\n`,
  );
  if (model.site.integrations.comments.enabled) {
    const prefix = discussionThemePrefix(model.site).slice(1);
    await fs.mkdir(path.dirname(path.join(output, prefix)), { recursive: true });
    for (const mode of ['light', 'dark'] as const) {
      const css = discussionThemeCss(model.site, mode);
      await fs.writeFile(path.join(output, `${prefix}${mode}.css`), css);
      await fs.writeFile(path.join(output, `assets/discussion-${mode}.css`), css);
    }
  }
  if (!github) await fs.writeFile(
    path.join(output, '_redirects'),
    siteRedirects(
      model.entries,
      model.site.collections,
      model.library,
      new Map([...allMediaLinks].filter(([, target]) => publicMediaUrls.has(target))),
    ),
  );
  let manifest = (await walk(output))
    .map((file) => path.relative(output, file).split(path.sep).join('/'))
    .sort();
  const allowed = new Set([
    ...[...allMediaLinks]
      .filter(([, target]) => publicMediaUrls.has(target))
      .flatMap(([source]) => [source, source + '/']),
    ...renderer.routes,
    ...collectionAliasRoutes(model.entries, model.site.collections).keys(),
    ...entryAliasRoutes(model.entries, model.site.collections).keys(),
    ...albumAliasRoutes(model.library, model.site.collections).keys(),
    ...manifest.map((f) => '/' + f),
    ...model.entries
      .filter((entry) => entry.status === 'published')
      .flatMap((entry) =>
        [entry.shortCode, ...entry.shortAliases].flatMap((code) => [
          '/s/' + code,
          '/s/' + code + '/',
        ]),
      ),
  ]);
  // Include both literal Unicode links and their percent-encoded canonical paths.
  for (const target of [...allowed]) allowed.add(decodeURIComponent(target));
  for (const [route, html] of pages)
    for (const match of html.matchAll(/href="(\/(?!\/)[^"#?]*)(?:[?#][^"]*)?"/g)) {
      const link = match[1].replace(/&amp;/g, '&');
      if (!allowed.has(link) && !allowed.has(decodeURIComponent(link))) {
        const format = (
          { '/feed.xml': 'RSS', '/atom.xml': 'Atom', '/feed.json': 'JSON' } as Record<
            string,
            string
          >
        )[link];
        if (format)
          throw new Error(
            `${route} links to ${link}, but the ${format} feed is disabled. Enable it in Site settings → Feeds or update the source link.`,
          );
        const source = model.entries.find(
          (entry) => routeFor(entry, model.site.collections) === route,
        );
        const target = model.entries.find((entry) =>
          [...routesForEntry(entry, model.site.collections), ...entry.routeAliases].some(
            (path) => decodeURIComponent(path) === decodeURIComponent(link),
          ),
        );
        throw new Error(
          `Broken local link on ${route}: ${link}\n` +
            (source
              ? `Source: “${source.title}” (${source.kind}/${source.file}).\n`
              : `Source page: ${route}.\n`) +
            (target && target.status !== 'published'
              ? `The destination “${target.title}” is ${target.status}; only published entries generate public pages. Publish it when ready, or update/remove this link in the source. `
              : 'The destination is not in the published site. Restore it if it should remain public, or update/remove this link in the source. ') +
            'The previous local build is kept, and no Pages upload was attempted.',
        );
      }
    }
  const redirects = github ? await prepareGithubArtifact(output, model, deployment,
    new Map([...allMediaLinks].filter(([, target]) => publicMediaUrls.has(target))),
    renderer.archiveCatalog.path) : 0;
  if (github) manifest = await artifactFiles(output);
  let totalBytes = 0;
  for (const filename of manifest) {
    const stat = await fs.stat(path.join(output, filename));
    totalBytes += stat.size;
    if (!github && stat.size > 25 * 1024 * 1024)
      throw new Error(`${filename} exceeds the Pages 25 MiB per-file limit`);
  }
  if (github && totalBytes > 1_000_000_000)
    throw new Error('This build exceeds the GitHub Pages 1 GB published-site limit. Reduce or externally host large media.');
  if (!github && manifest.length > 20000)
    throw new Error('This build exceeds the 20,000 asset baseline for Cloudflare Pages');
  const result: BuildResult = {
    id,
    outputDir: output,
    pages: pages.size + redirects,
    entryRoutes: renderer.entries.map((entry) => routeFor(entry, model.site.collections)),
    collectionNames: {
      posts: model.site.collections.posts.name,
      lab: model.site.collections.lab.name,
    },
    manifest,
    diagnostics: github
      ? ['GitHub Pages static profile: annotations, ACA, Cloudflare-managed analytics and Cloudflare response-header rules are unavailable. General Giscus comments remain available when configured.']
      : model.site.url.includes('example.com') ? ['Set your canonical site URL in Studio before publishing.'] : [],
    sourceRevision: digest(JSON.stringify(sourceModel)),
    completedAt: new Date().toISOString(),
    totalBytes,
    contentCounts: {
      posts: renderer.entries.filter((entry) => entry.kind === 'posts').length,
      lab: renderer.entries.filter((entry) => entry.kind === 'lab').length,
      media: references.size,
    },
  };
  await atomicWrite(path.join(buildRoot, 'result.json'), JSON.stringify(result, null, 2));
  if (options.updateDist !== false) {
    const next = path.join(store.root, `.studio/dist-${id}`),
      dist = path.join(store.root, 'dist'),
      previous = path.join(store.root, '.studio/previous-dist');
    await fs.cp(output, next, { recursive: true });
    await fs.rm(previous, { recursive: true, force: true });
    let moved = false;
    try {
      await fs.rename(dist, previous);
      moved = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    try {
      await fs.rename(next, dist);
    } catch (e) {
      if (moved) await fs.rename(previous, dist);
      throw e;
    }
    await fs.rm(previous, { recursive: true, force: true });
  }
  log(`Build complete · ${result.pages} pages · ${manifest.length} files.`);
  await renderer.pruneCache().catch(() => {});
  return result;
}
