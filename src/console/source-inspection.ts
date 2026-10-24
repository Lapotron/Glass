import { visit } from 'unist-util-visit';
import type { MarkdownDiagnostic } from '../shared/markdown-analysis.js';
import { markdownText } from '../shared/markdown-analysis.js';
import { splitTableRow } from '../shared/tabular-data.js';
import { upperBound } from '../shared/algorithms.js';
export type SourceImage = {
  from: number;
  to: number;
  url: string;
  alt: string;
  block: boolean;
  reference?: string;
};
export type InspectionContext = { links?: { url: string; status: string }[]; media?: string[] };
export function inspectSource(tree: any, source: string, context: InspectionContext = {}) {
  const diagnostics: MarkdownDiagnostic[] = [],
    images: SourceImage[] = [],
    definitions = new Map<string, string>(),
    excluded: { from: number; to: number }[] = [];
  const key = (s: string = '') => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const lines = [0];
  for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1))
    lines.push(at + 1);
  const media = context.media && new Set(context.media);
  const links = context.links && new Map<string, string>();
  for (const item of context.links || [])
    if (!links!.has(item.url)) links!.set(item.url, item.status);
  const report = (
    from: number,
    to: number,
    code: string,
    message: string,
    category: MarkdownDiagnostic['category'],
    fix?: MarkdownDiagnostic['fix'],
  ) => {
    const line = upperBound(lines, from);
    diagnostics.push({
      from,
      to,
      code,
      message,
      severity: 'warning',
      category,
      line,
      column: from - lines[line - 1] + 1,
      ...(fix ? { fix } : {}),
    });
  };
  visit(tree, (node: any) => {
    if (node.type === 'definition') definitions.set(key(node.identifier), node.url);
    if (['code', 'inlineCode', 'math', 'inlineMath', 'html'].includes(node.type))
      excluded.push({ from: node.position.start.offset, to: node.position.end.offset });
  });
  const intervals: { from: number; to: number }[] = [];
  for (const range of excluded.sort((a, b) => a.from - b.from)) {
    const previous = intervals.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else intervals.push({ ...range });
  }
  const ends = intervals.map((range) => range.to);
  const ignored = (from: number, to = from + 1) => {
    const range = intervals[upperBound(ends, from)];
    return !!range && range.from < to;
  };
  let headingLevel = 0;
  visit(tree, (node: any, _index: number | undefined, parent: any) => {
    const from = node.position?.start.offset || 0,
      to = node.position?.end.offset || from;
    if (node.type === 'heading') {
      if (headingLevel && node.depth > headingLevel + 1)
        report(
          from,
          to,
          'heading-order',
          `Heading skips from H${headingLevel} to H${node.depth}.`,
          'structure',
        );
      headingLevel = node.depth;
      if (!markdownText(node).trim())
        report(from, to, 'empty-heading', 'Give this heading descriptive text.', 'structure');
    }
    if (node.type === 'image' || node.type === 'imageReference') {
      const url = node.url ?? definitions.get(key(node.identifier)) ?? '';
      const lineStart = source.lastIndexOf('\n', from - 1) + 1,
        lineEnd = source.indexOf('\n', to);
      const block =
        parent?.type === 'paragraph' &&
        parent.children.length === 1 &&
        !source.slice(lineStart, from).trim() &&
        !source.slice(to, lineEnd < 0 ? source.length : lineEnd).trim();
      if (url)
        images.push({
          from,
          to,
          url,
          alt: node.alt || '',
          block,
          ...(node.identifier ? { reference: node.identifier } : {}),
        });
      if (
        !node.alt?.trim() ||
        /^(?:image|photo|picture|describe this image|alt(?: text)?)$/i.test(node.alt.trim())
      )
        report(
          from,
          to,
          'image-alt',
          'Add a useful image description for readers using assistive technology.',
          'accessibility',
        );
      if (url.startsWith('/media/') && media && !media.has(url.split(/[?#]/)[0]))
        report(from, to, 'missing-media', `Local image is missing: ${url}`, 'links');
    }
    if (node.type === 'link' || node.type === 'linkReference') {
      const url = node.url ?? definitions.get(key(node.identifier)) ?? '';
      if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/media/') && links) {
        const path = url.split(/[?#]/)[0];
        const status = links.get(path);
        if (status === undefined)
          report(from, to, 'broken-local-link', `Local page was not found: ${path}`, 'links');
        else if (status !== 'published')
          report(
            from,
            to,
            'unpublished-link',
            'This link points to an unpublished entry and will not work on the public site.',
            'links',
          );
      }
    }
    if (node.type === 'table') {
      const rows = source.slice(from, to).split('\n'),
        expected = node.children[0]?.children.length || 0;
      let at = from;
      rows.forEach((row: string, index: number) => {
        if (index !== 1 && row.includes('|') && splitTableRow(row).length !== expected)
          report(
            at,
            at + row.length,
            'table-columns',
            `Table row has ${splitTableRow(row).length} cells; expected ${expected}.`,
            'structure',
          );
        at += row.length + 1;
      });
    }
  });
  // Unresolved reference syntax stays plain text in CommonMark's tree.
  for (const match of source.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    if (
      !ignored(match.index, match.index + match[0].length) &&
      !definitions.has(key(match[2] || match[1]))
    )
      report(
        match.index,
        match.index + match[0].length,
        'missing-link-reference',
        `Missing link definition: ${match[2] || match[1]}`,
        'links',
      );
  }
  let at = 0;
  for (const line of source.split('\n')) {
    const trailing = /[\t ]+$/.exec(line);
    if (trailing && !ignored(at, at + line.length) && trailing[0] !== '  ') {
      const start = at + trailing.index,
        hardBreak = /^ {2,}$/.test(trailing[0]);
      report(
        start,
        at + line.length,
        'trailing-whitespace',
        hardBreak ? 'Use two spaces for this hard line break.' : 'Remove trailing whitespace.',
        'style',
        {
          label: hardBreak ? 'Keep two-space hard break' : 'Remove trailing whitespace',
          changes: [{ from: start, to: at + line.length, insert: hardBreak ? '  ' : '' }],
        },
      );
    }
    at += line.length + 1;
  }
  return { diagnostics, images };
}
