import { t } from '../shared/i18n.js';
import { visit } from 'unist-util-visit';
import { parseMarkdown, markdownText } from '../shared/markdown-analysis.js';
import { routeFor } from '../shared/contracts.js';
import { collectionIndexRoute } from '../shared/collections.js';
import { albumRoute, resolveAlbums } from '../shared/albums.js';
import { headingSlug } from '../shared/utils.js';
import type { Bootstrap } from './api.js';
import type { SourceEdit } from './source-format.js';
export type LinkTarget = {
  id: string;
  title: string;
  url: string;
  status: string;
  group: string;
  body?: string;
  author?: string;
  date?: string;
};
export const markdownLabel = (s: string) =>
  s.replace(/[\\`*_[\]{}<>!]/g, '\\$&').replace(/[\r\n]+/g, ' ');
export function safeLinkDestination(value: string) {
  const url = value.trim();
  if (
    !url ||
    [...url].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127 || c === '\\') ||
    url.startsWith('//')
  )
    throw new Error(t("Enter a public URL, a root-relative page path, or a heading fragment."));
  if (url.startsWith('/')) {
    let path: string;
    try {
      path = decodeURIComponent(new URL(url, 'https://example.invalid').pathname);
    } catch {
      throw new Error(t("This page path is invalid."));
    }
    if (/^\/(?:api|studio|\.studio)(?:\/|$)/i.test(path))
      throw new Error(t("Private Studio and API paths cannot be inserted."));
  } else if (!url.startsWith('#')) {
    const parsed = new URL(url);
    if (['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
      throw new Error(t("Private local Studio URLs cannot be inserted."));
    if (
      !['https:', 'http:', 'mailto:', 'tel:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error(t("Use HTTP, HTTPS, email, telephone, or a local page link."));
  }
  return url.replace(/[()<>]/g, (s) => '%' + s.charCodeAt(0).toString(16).toUpperCase());
}
export function citationKey(identity: string) {
  if (identity.length <= 80) return identity;
  let hash = 2166136261;
  for (const c of identity) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `${identity.slice(0, 70)}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
export function localLinkTargets(notebook: Bootstrap): LinkTarget[] {
  const { site, entries, library } = notebook;
  return [
    ...entries.map((e) => ({
      id: `entry-${e.id}`,
      title: e.title,
      url: routeFor(e, site.collections),
      status: e.status,
      group: site.collections[e.kind].name,
      body: e.body,
      author: site.profile.name,
      date: e.publishedAt,
    })),
    { id: 'page-home', title: 'Home', url: '/', status: 'published', group: 'Pages' },
    { id: 'page-archive', title: 'Archive', url: '/archive/', status: 'published', group: 'Pages' },
    {
      id: 'page-about',
      title: 'About',
      url: '/about/',
      status: 'published',
      group: 'Pages',
      body: notebook.about.body,
      author: site.profile.name,
    },
    {
      id: 'page-life',
      title: site.collections.life.name,
      url: collectionIndexRoute('life', site.collections),
      status: 'published',
      group: 'Pages',
    },
    ...(['posts', 'lab'] as const).map((kind) => ({
      id: `collection-${kind}`,
      title: site.collections[kind].name,
      url: collectionIndexRoute(kind, site.collections),
      status: 'published',
      group: 'Collections',
    })),
    ...resolveAlbums(library)
      .filter((a) => a.photos.length)
      .map((a) => ({
        id: `album-${a.id}`,
        title: a.name,
        url: albumRoute(a, site.collections),
        status: 'published',
        group: 'Albums',
      })),
  ];
}
export function linkHeadings(source: string) {
  const headings: { label: string; fragment: string }[] = [],
    slugs = new Map<string, number>();
  visit(parseMarkdown(source), 'heading', (node: any) => {
    const label = markdownText(node),
      base = headingSlug(label),
      count = slugs.get(base) || 0;
    slugs.set(base, count + 1);
    headings.push({ label, fragment: `${base}${count ? `-${count + 1}` : ''}` });
  });
  return headings;
}
export function existingLink(source: string, from: number, to = from) {
  let result:
    { from: number; to: number; label: string; url: string; reference?: string } | undefined;
  const tree = parseMarkdown(source),
    definitions = new Map<string, string>();
  visit(tree, 'definition', (n: any) => {
    definitions.set(n.identifier.toLowerCase(), n.url);
  });
  visit(tree, (n: any) => {
    if (
      ['link', 'linkReference'].includes(n.type) &&
      n.position.start.offset <= from &&
      n.position.end.offset >= to
    )
      result = {
        from: n.position.start.offset,
        to: n.position.end.offset,
        label: markdownText(n),
        url: n.url ?? definitions.get(String(n.identifier || '').toLowerCase()) ?? '',
        ...(n.identifier ? { reference: n.identifier } : {}),
      };
  });
  return result;
}
export function composeLink(
  source: string,
  range: { from: number; to: number },
  input: {
    label: string;
    url: string;
    style: 'inline' | 'reference' | 'citation';
    key?: string;
    target?: LinkTarget;
    siteUrl?: string;
  },
): SourceEdit[] {
  const url = safeLinkDestination(input.url),
    label = markdownLabel(input.label || input.target?.title || url),
    tree = parseMarkdown(source);
  const edits: SourceEdit[] = [],
    ids = new Map<string, any>(),
    definitions = new Map<string, any>();
  let bibliography: any;
  visit(tree, (n: any) => {
    if (n.attributes?.id) ids.set(n.attributes.id, n);
    if (n.type === 'definition') definitions.set(n.identifier.toLowerCase(), n);
    if (n.name === 'references' && !bibliography) bibliography = n;
  });
  let inserted: string;
  const append = (text: string) => {
    const end = range.to === source.length ? source.slice(0, range.from) + inserted : source;
    edits.push({
      from: source.length,
      to: source.length,
      insert: `${end.endsWith('\n\n') || !end ? '' : end.endsWith('\n') ? '\n' : '\n\n'}${text}\n`,
    });
  };
  const unique = (base: string, used: Map<string, any>) => {
    let key = base,
      suffix = 2;
    while (used.has(key)) {
      const postfix = `-${suffix++}`;
      key = base.slice(0, 80 - postfix.length) + postfix;
    }
    return key;
  };
  if (input.style === 'inline') inserted = `[${label}](${url})`;
  else if (input.style === 'reference') {
    const base =
      (input.key || headingSlug(input.label || input.target?.title || 'link'))
        .replace(/[^a-z\d_-]/gi, '-')
        .slice(0, 90) || 'link';
    const existing = [...definitions.values()].find((d) => d.url === url);
    const key = existing?.identifier || unique(base.toLowerCase(), definitions);
    inserted = `[${label}][${key}]`;
    if (!existing) append(`[${key}]: ${url}`);
  } else {
    if (!input.target || !input.siteUrl) throw new Error(t("Choose a local entry or page to cite."));
    const canonical = new URL(url, input.siteUrl).href;
    const stableKey = citationKey(input.target.id);
    let existing = ids.get(stableKey);
    // Reuse manually authored references pointing at this canonical source.
    if (!existing || existing.name !== 'reference')
      existing = [...ids.values()].find(
        (n) =>
          n.name === 'reference' &&
          n.children?.some((p: any) =>
            p.children?.some((link: any) => link.type === 'link' && link.url === canonical),
          ),
      );
    const key = existing?.attributes.id || unique(stableKey, ids);
    inserted = `:cite[${key}]`;
    if (!existing) {
      const author = markdownLabel(input.target.author || ''),
        year = input.target.date?.slice(0, 4),
        title = markdownLabel(input.target.title);
      const reference = `:::reference[${author || title}${year ? `, ${year}` : ''}]{#${key}}\n${author ? author + '. ' : ''}*${title}*.${year ? ` ${year}.` : ''} [Read source](${safeLinkDestination(canonical)}).\n:::`;
      if (bibliography) {
        const start = bibliography.position.start.offset,
          end = bibliography.position.end.offset;
        const raw = source.slice(start, end),
          opening = /^(:{3,})/.exec(raw),
          closing = /(?:^|\n)(:{3,})[\t ]*$/.exec(raw);
        if (!opening || !closing || closing[1].length < opening[1].length)
          throw new Error(t("Close the existing references container before adding a citation."));
        if (opening[1].length < 4) {
          // A root container can safely grow its fences; nested containers need
          // author review rather than silently closing an ancestor component.
          if (!tree.children.includes(bibliography))
            throw new Error(
              t("Use at least four colons for a nested references container before inserting citations."),
            );
          edits.push({ from: start, to: start + opening[1].length, insert: '::::' });
          const closeStart = start + closing.index + (closing[0].startsWith('\n') ? 1 : 0);
          edits.push({ from: closeStart, to: end, insert: `${reference}\n::::` });
        } else {
          const closeStart = start + closing.index + (closing[0].startsWith('\n') ? 1 : 0);
          edits.push({ from: closeStart, to: closeStart, insert: reference + '\n' });
        }
      } else append(`::::references[References]\n${reference}\n::::`);
    }
  }
  edits.unshift({ from: range.from, to: range.to, insert: inserted });
  // Adjacent inserts at EOF must be deterministic: the citation comes before
  // the new bibliography. Every change is applied as one undoable transaction.
  return edits.sort((a, b) => a.from - b.from);
}
