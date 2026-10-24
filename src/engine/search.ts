import { createIndex } from 'pagefind';
import type { Repository } from '../shared/contracts.js';
import { routeFor } from '../shared/contracts.js';
import { resolveAlbums, albumRoute } from '../shared/albums.js';
import { escapeHtml } from '../shared/utils.js';
import { digest } from './store.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { developerTools } from '../shared/tools-catalog.js';
import type { createRenderer } from '../site/pages.js';
const indexImplementation = Promise.all([
  fs.readFile(new URL(import.meta.url)),
  fs.readFile(new URL('../../package-lock.json', import.meta.url)),
]).then((files) => digest(Buffer.concat(files)));
export type SearchManifest = {
  version: 1;
  revision: string;
  languages: { language: string; module: string }[];
  filters: Record<string, string[]>;
  records: number;
};
/** Each language owns a native tokenizer/WASM bundle. The browser merges results, not indexes. */
export async function buildSearch(
  output: string,
  model: Repository,
  renderer: Awaited<ReturnType<typeof createRenderer>>,
) {
  const language = (value: string) =>
    value
      .toLowerCase()
      .split(/[-_]/)[0]
      .replace(/[^a-z]/g, '') || 'en';
  const defaultLanguage = language(model.site.language);
  const records: {
    contentId: string;
    url: string;
    title: string;
    html: string;
    lang: string;
    type: string;
    topics: string[];
    summary: string;
  }[] = renderer.entries.map((entry) => ({
    contentId: entry.id,
    url: routeFor(entry, model.site.collections),
    title: entry.title,
    html: entry.rendered.html,
    lang: language(entry.lang),
    type: model.site.collections[entry.kind].singular,
    topics: entry.tags,
    summary: entry.summary,
  }));
  records.push({
    contentId: 'page:/about/',
    url: '/about/',
    title: 'About',
    html: renderer.about.html,
    lang: defaultLanguage,
    type: 'About',
    topics: [],
    summary: model.site.description,
  });
  for (const project of model.projects?.projects || [])
    if (project.visibility === 'public')
      records.push({
        contentId: `project:${project.id}`,
        url: '/projects/#' + project.id,
        title: project.title,
        html: `<p>${escapeHtml(project.description)}</p><p>${project.technologies.map(escapeHtml).join(' ')}</p>`,
        lang: defaultLanguage,
        type: 'Project',
        topics: project.technologies,
        summary: project.description,
      });
  for (const tool of developerTools) records.push({ contentId: `tool:${tool.id}`, url: `/tools/#developer/${tool.id}`, title: tool.label, html: `<p>${escapeHtml(tool.description)}</p>`, lang: defaultLanguage, type: 'Tool', topics: [], summary: tool.description });
  records.push({ contentId: 'tool:equation', url: '/tools/#equation', title: 'Equation editor', html: '<p>LaTeX, MathJax, physics, chemistry, SVG, PNG and MathML.</p>', lang: defaultLanguage, type: 'Tool', topics: [], summary: 'Browser-local LaTeX equation editor and exports.' });
  for (const album of resolveAlbums(model.library).filter((a) => a.photos.length))
    records.push({
      contentId: `page:${albumRoute(album, model.site.collections)}`,
      url: albumRoute(album, model.site.collections),
      title: album.name,
      html: `<p>${escapeHtml(album.description)}</p>${album.photos.map((photo) => `<p>${escapeHtml(photo.caption)} ${escapeHtml(photo.alt)}</p>`).join('')}`,
      lang: defaultLanguage,
      type: 'Album',
      topics: [],
      summary: album.description,
    });
  const revision = digest(JSON.stringify([await indexImplementation, records])).slice(0, 20),
    base = `/assets/search/${revision}`;
  const manifest: SearchManifest = {
    version: 1,
    revision,
    languages: [],
    records: records.length,
    filters: {
      type: [...new Set(records.map((r) => r.type))].sort(),
      topic: [...new Set(records.flatMap((r) => r.topics))].sort(),
      language: [...new Set(records.map((r) => r.lang))].sort(),
    },
  };
  for (const lang of manifest.filters.language) {
    const { index, errors } = await createIndex({
      forceLanguage: lang,
      excludeSelectors: [
        'svg',
        'script',
        'style',
        'noscript',
        '[aria-hidden=true]',
        '[hidden]',
        '.gutter',
        '.code-toolbar',
        '.frame > figcaption',
        '.section-thread',
        '.md-component-title',
      ],
    });
    if (!index || errors.length)
      throw new Error('Search index could not start: ' + errors.join('; '));
    try {
      for (const record of records.filter((r) => r.lang === lang)) {
        const response = await index.addHTMLFile({
          url: record.url,
          content: `<html lang="${lang}"><head><title>${escapeHtml(record.title)}</title></head><body><main data-pagefind-body><h1 data-pagefind-meta="title">${escapeHtml(record.title)}</h1><span data-pagefind-meta="contentId" data-pagefind-ignore>${escapeHtml(record.contentId)}</span><span data-pagefind-filter="type" data-pagefind-meta="type" data-pagefind-ignore>${escapeHtml(record.type)}</span><span data-pagefind-filter="language" data-pagefind-ignore>${lang}</span>${record.topics.map((topic) => `<span data-pagefind-filter="topic" data-pagefind-ignore>${escapeHtml(topic)}</span>`).join('')}<span data-pagefind-meta="summary" data-pagefind-ignore>${escapeHtml(record.summary)}</span>${record.html}</main></body></html>`,
        });
        if (response.errors.length)
          throw new Error('Search indexing failed: ' + response.errors.join('; '));
      }
      const result = await index.writeFiles({ outputPath: path.join(output, base, lang) });
      if (result.errors.length)
        throw new Error('Search output failed: ' + result.errors.join('; '));
      manifest.languages.push({ language: lang, module: `${base}/${lang}/pagefind.js` });
    } finally {
      await index.deleteIndex();
    }
  }
  await fs.writeFile(path.join(output, 'assets/search-manifest.json'), JSON.stringify(manifest));
  return manifest;
}
