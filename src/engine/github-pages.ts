import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';
import type { Repository } from '../shared/contracts.js';
import { routeFor } from '../shared/contracts.js';
import { publicPath, publicUrl, logicalPath } from '../shared/public-path.js';
import { collectionAliasRoutes } from '../shared/collections.js';
import { entryAliasRoutes } from '../shared/entry-routes.js';
import { albumAliasRoutes } from '../shared/albums.js';
import { validateShortLinks } from '../shared/shortlinks.js';
import { contentSecurityPolicy } from '../shared/security.js';
import { escapeHtml, scriptJson } from '../shared/utils.js';
import { digest } from './store.js';
import { deploymentHtml, assertStaticSvg, visitHtml } from './deployment-html.js';
import type { PublicDeployment } from './deployment.js';

export async function artifactFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('Static artifacts cannot contain symbolic links.');
    if (item.isDirectory())
      files.push(
        ...(await artifactFiles(path.join(root, item.name))).map((file) => item.name + '/' + file),
      );
    else files.push(item.name);
  }
  return files.sort();
}

export function githubRedirects(model: Repository, mediaLinks: Map<string, string>) {
  validateShortLinks(model.entries);
  const redirects = new Map<string, string>([
    ['/news/', '/archive/'],
    ...collectionAliasRoutes(model.entries, model.site.collections),
    ...entryAliasRoutes(model.entries, model.site.collections),
    ...albumAliasRoutes(model.library, model.site.collections),
    ...mediaLinks,
  ]);
  for (const entry of model.entries.filter((entry) => entry.status === 'published'))
    for (const code of [entry.shortCode, ...entry.shortAliases])
      redirects.set('/s/' + code + '/', routeFor(entry, model.site.collections));
  return redirects;
}

export async function prepareGithubArtifact(
  output: string,
  model: Repository,
  deployment: PublicDeployment,
  mediaLinks: Map<string, string>,
  archivePath: string,
) {
  const base = deployment.basePath;
  const url = (value: string) => publicPath(value, base);
  const absolute = (value: string) => {
    if (value.startsWith(deployment.origin + '/')) value = value.slice(deployment.origin.length);
    return publicUrl(value, deployment.origin, base);
  };
  const write = (file: string, value: unknown) =>
    fs.writeFile(path.join(output, file), JSON.stringify(value));
  const read = async (file: string) =>
    JSON.parse(await fs.readFile(path.join(output, file), 'utf8'));
  const assets = await read('assets/reader-assets.json');
  for (const [key, value] of Object.entries(assets))
    if (typeof value === 'string') assets[key] = url(value);
  if (assets.chartModules)
    for (const key of Object.keys(assets.chartModules))
      assets.chartModules[key] = url(assets.chartModules[key]);
  assets.basePath = base;
  await write('assets/reader-assets.json', assets);
  const details = await read('assets/media-details.json');
  for (const image of Object.values(details.images) as any[]) {
    image.url = url(image.url);
    if (image.shortUrl) image.shortUrl = absolute(image.shortUrl);
  }
  await write('assets/media-details.json', details);
  for (const file of ['search.json', 'assets/reading-catalog.json']) {
    const records = await read(file);
    for (const record of records) record.url = url(record.url);
    await write(file, records);
  }
  const search = await read('assets/search-manifest.json');
  for (const language of search.languages) language.module = url(language.module);
  await write('assets/search-manifest.json', search);
  const manifest = await read('site.webmanifest');
  for (const key of ['id', 'start_url', 'scope']) manifest[key] = url(manifest[key]);
  for (const icon of manifest.icons) icon.src = url(icon.src);
  await write('site.webmanifest', manifest);
  const archive = await read(archivePath.slice(1));
  for (const record of archive.records) {
    record.url = url(record.url);
    if (record.cover) record.cover = url(record.cover);
  }
  const data = scriptJson(archive);
  const nextArchivePath = `/assets/archive/catalog-${digest(data).slice(0, 20)}.json`;
  await fs.writeFile(path.join(output, nextArchivePath.slice(1)), data);
  if (nextArchivePath !== archivePath) await fs.rm(path.join(output, archivePath.slice(1)));
  const replacements = new Map([[archivePath, nextArchivePath]]);
  const policy = contentSecurityPolicy(model.site).replace(/; frame-ancestors [^;]+/, '');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}"><meta name="referrer" content="strict-origin-when-cross-origin">`;
  for (const file of await artifactFiles(output)) {
    if (file.endsWith('.svg'))
      assertStaticSvg(await fs.readFile(path.join(output, file), 'utf8'), file);
    if (!file.endsWith('.html')) continue;
    const html = deploymentHtml(
      await fs.readFile(path.join(output, file), 'utf8'),
      deployment,
      replacements,
    ).replace('<head>', '<head>' + meta);
    await fs.writeFile(path.join(output, file), html);
  }
  let redirectCount = 0;
  for (const [source, target] of githubRedirects(model, mediaLinks)) {
    const decoded = decodeURIComponent(source).replace(/\/$/, '');
    if (
      !/^\/(?!\/)/.test(decoded) ||
      decoded.split('/').some((part) => part === '..' || part === '.') ||
      /[\\\0]/.test(decoded)
    )
      throw new Error('A static redirect has an invalid source path.');
    const file = path.join(output, decoded.slice(1), 'index.html');
    try {
      await fs.access(file);
      continue;
    } catch {}
    const destination = url(target);
    const html = `<!doctype html><html lang="en" data-site-base="${escapeHtml(base)}"><head><meta charset="utf-8">${meta}<meta http-equiv="refresh" content="0;url=${escapeHtml(destination)}"><meta name="robots" content="noindex"><link rel="canonical" href="${escapeHtml(absolute(target))}"><title>Continue to this page</title></head><body><p>This page has moved. <a href="${escapeHtml(destination)}">Continue to the page</a>.</p></body></html>`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, html);
    redirectCount++;
  }
  await fs.writeFile(path.join(output, '.nojekyll'), '');
  await validateGithubArtifact(output, deployment);
  return redirectCount;
}

/** Use filesystem truth, not Cloudflare routing, to verify the finished static artifact. */
export async function validateGithubArtifact(output: string, deployment: PublicDeployment) {
  const files = new Set(await artifactFiles(output));
  for (const file of files) {
    if (
      /^(?:_worker\.js|_routes\.json|_headers|_redirects|studio\/|api\/|content\/|\.studio\/)/.test(
        file,
      )
    )
      throw new Error(`Unsupported or private file in GitHub Pages artifact: ${file}`);
    if (!file.endsWith('.html')) continue;
    const references: string[] = [];
    visitHtml(parse(await fs.readFile(path.join(output, file), 'utf8')), (node) => {
      for (const attr of node.attrs) {
        if (['href', 'src', 'poster'].includes(attr.name)) references.push(attr.value);
        if (['srcset', 'imagesrcset'].includes(attr.name))
          for (const candidate of attr.value.split(','))
            references.push(candidate.trim().split(/\s+/)[0]);
      }
    });
    for (const reference of references) {
      if (!/^\/(?!\/)/.test(reference)) continue;
      const pathname = reference.split(/[?#]/)[0];
      if (deployment.basePath && !pathname.startsWith(deployment.basePath + '/'))
        throw new Error(`${file} has a link outside the deployment base path: ${reference}`);
      const target = decodeURIComponent(logicalPath(pathname, deployment.basePath)).slice(1);
      if (
        !files.has(target) &&
        !files.has(target.replace(/\/$/, '') + '/index.html') &&
        !(target === '' && files.has('index.html'))
      )
        throw new Error(`Broken static link in ${file}: ${reference}`);
    }
  }
}
