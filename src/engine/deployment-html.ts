import { parse, parseFragment, type DefaultTreeAdapterTypes as Tree } from 'parse5';
import { escapeHtml, scriptJson } from '../shared/utils.js';
import { publicPath } from '../shared/public-path.js';
import type { PublicDeployment } from './deployment.js';

export function visitHtml(node: Tree.Node, visit: (element: Tree.Element) => void) {
  if ('tagName' in node) {
    visit(node);
    if (node.tagName === 'template' && 'content' in node) visitHtml(node.content, visit);
  }
  if ('childNodes' in node) for (const child of node.childNodes) visitHtml(child, visit);
}

const urlAttributes = new Set([
  'href',
  'src',
  'poster',
  'action',
  'data-view-image',
  'data-search-module',
  'data-search-style',
  'data-archive-worker',
  'data-archive-catalog',
  'data-comment-theme',
]);
export const deployedPath = (value: string, deployment: PublicDeployment) =>
  publicPath(value, deployment.basePath);

/** Source-location edits touch real attributes, never code examples, prose or SVG geometry. */
export function deploymentHtml(
  html: string,
  deployment: PublicDeployment,
  replacements = new Map<string, string>(),
) {
  const tree = parse(html, { sourceCodeLocationInfo: true });
  const edits: { start: number; end: number; text: string }[] = [];
  const url = (value: string) => deployedPath(replacements.get(value) || value, deployment);
  const css = (value: string) =>
    value.replace(
      /url\((['"]?)(\/[^)'"\s]+)\1\)/g,
      (_all, quote: string, value: string) => `url(${quote}${url(value)}${quote})`,
    );
  const json = (value: string, keys: string[]) => {
    const result = JSON.parse(value);
    for (const key of keys) if (typeof result[key] === 'string') result[key] = url(result[key]);
    return result;
  };
  visitHtml(tree, (node) => {
    const attrs = Object.fromEntries(node.attrs.map((a) => [a.name, a.value]));
    for (const attr of node.attrs) {
      let value = attr.value;
      if (urlAttributes.has(attr.name)) value = url(value);
      else if (['srcset', 'imagesrcset'].includes(attr.name))
        value = value
          .replace(
            /(^|,)\s*(\/(?!\/)[^\s,]+)/g,
            (_all, before: string, path: string) => before + ' ' + url(path),
          )
          .trimStart();
      else if (attr.name === 'style') value = css(value);
      else if (attr.name === 'data-photo') value = JSON.stringify(json(value, ['image']));
      else if (attr.name === 'data-config' && attrs['data-interactive'] === 'image-compare')
        value = JSON.stringify(json(value, ['before', 'after']));
      else if (node.tagName === 'meta' && attr.name === 'content') {
        if (attrs.name === 'discussion-theme-prefix') value = url(value);
        else if (attrs.name === 'reading-entry') value = scriptJson(json(value, ['url']));
      }
      const name = attr.prefix ? attr.prefix + ':' + attr.name : attr.name;
      const location = node.sourceCodeLocation?.attrs?.[name];
      if (value !== attr.value && location)
        edits.push({
          start: location.startOffset,
          end: location.endOffset,
          text: `${name}="${escapeHtml(value)}"`,
        });
    }
    if (node.tagName === 'style' || (node.tagName === 'script' && attrs.id === 'reader-defaults')) {
      for (const child of node.childNodes)
        if (child.nodeName === '#text' && 'value' in child && child.sourceCodeLocation) {
          const value =
            node.tagName === 'style'
              ? css(child.value)
              : scriptJson(json(child.value, ['backgroundImage']));
          if (value !== child.value)
            edits.push({
              start: child.sourceCodeLocation.startOffset,
              end: child.sourceCodeLocation.endOffset,
              text: value,
            });
        }
    }
  });
  for (const edit of edits.sort((a, b) => b.start - a.start))
    html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  return html;
}

/** GitHub cannot supply the per-file sandbox used for raw SVG on Cloudflare. */
export function assertStaticSvg(source: string, filename: string) {
  let unsafe = /<!\s*(?:doctype|entity)\b/i.test(source);
  visitHtml(parseFragment(source), (node) => {
    if (
      [
        'script',
        'foreignobject',
        'iframe',
        'object',
        'embed',
        'set',
        'animate',
        'animatemotion',
        'animatetransform',
      ].includes(node.tagName.toLowerCase())
    )
      unsafe = true;
    for (const attr of node.attrs)
      if (
        /^on/i.test(attr.name) ||
        (['href', 'src'].includes(attr.name) &&
          /^(?:javascript|vbscript|data:text\/html):?/i.test(
            [...attr.value]
              .filter((c) => c.charCodeAt(0) > 32)
              .join('')
              .replace(/\s/g, ''),
          ))
      )
        unsafe = true;
  });
  if (unsafe)
    throw new Error(
      `${filename} contains active SVG content unsupported by GitHub Pages. Use a static SVG or a raster image.`,
    );
}
