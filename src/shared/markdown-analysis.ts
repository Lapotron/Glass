import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import { visit } from 'unist-util-visit';
import { componentByName, authoringVersion } from './markdown-catalog.js';
import { interactiveSchema } from './interactives.js';
import { imageLayout } from './image-layout.js';
import { pseudocodeLanguages, pseudocodeOptions, pseudocodeLines } from './pseudocode.js';
import { remarkInlineHighlight } from './inline-highlight.js';
export type MarkdownDiagnostic = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  from: number;
  to: number;
  line: number;
  column: number;
  path?: string;
  category?: 'syntax' | 'structure' | 'accessibility' | 'links' | 'style';
  fix?: { label: string; changes: { from: number; to: number; insert: string }[] };
};
export type DocumentLabel = { id: string; kind: string; number: number; text: string };
export const markdownText = (node: any): string =>
  typeof node.value === 'string' ? node.value : (node.children || []).map(markdownText).join('');
export function parseMarkdown(source: string) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkInlineHighlight)
    .use(remarkDirective)
    .parse(source);
}
export function analyzeMarkdownTree(tree: any, source = '') {
  const diagnostics: MarkdownDiagnostic[] = [],
    labels = new Map<string, DocumentLabel>(),
    counters = new Map<string, number>(),
    discussionKeys = new Set<string>();
  const report = (
    node: any,
    code: string,
    message: string,
    severity: 'error' | 'warning' = 'error',
    path?: string,
  ) =>
    diagnostics.push({
      severity,
      code,
      message,
      from: node.position?.start.offset || 0,
      to: node.position?.end.offset || 0,
      line: node.position?.start.line || 1,
      column: node.position?.start.column || 1,
      ...(path ? { path } : {}),
    });
  visit(tree, (node: any, _i, parent: any) => {
    if(node.type==='code' && pseudocodeLanguages.includes(node.lang)) {
      try {pseudocodeOptions(node.meta || '');pseudocodeLines(node.value);}
      catch(error){report(node,'pseudocode-config',(error as Error).message);}
    }
    if (node.type === 'code' && node.lang === 'interactive') {
      try {
        const config = JSON.parse(node.value);
        const result = interactiveSchema.safeParse(config);
        if (!result.success)
          for (const issue of result.error.issues)
            report(node, 'interactive-config', issue.message, 'error', issue.path.join('.'));
      } catch (e) {
        report(node, 'interactive-json', `Invalid interactive JSON: ${(e as Error).message}`);
      }
    }
    if (!['containerDirective', 'leafDirective', 'textDirective'].includes(node.type)) return;
    const definition = componentByName.get(node.name);
    if (!definition) {
      report(
        node,
        'unknown-component',
        `Unknown Markdown component “${node.name}”. See the authoring guide.`,
      );
      return;
    }
    const expected =
      definition.kind === 'container'
        ? 'containerDirective'
        : definition.kind === 'leaf'
          ? 'leafDirective'
          : 'textDirective';
    if (node.type !== expected)
      report(
        node,
        'component-kind',
        `${node.name} ${definition.kind === 'inline' ? 'is an inline component.' : definition.kind === 'leaf' ? 'needs a :: leaf directive.' : 'needs a ::: container.'}`,
      );
    const attributes = node.attributes || {};
    if (node.name === 'figure') {
      try {
        imageLayout(attributes);
      } catch (error) {
        report(node, 'image-layout', (error as Error).message);
      }
    }
    for (const key of Object.keys(attributes))
      if (!definition.attributes[key])
        report(
          node,
          'unknown-attribute',
          `Unknown attribute “${key}” on ${node.name}; it will be ignored.`,
          'warning',
        );
    const body = (node.children || []).filter((n: any) => !n.data?.directiveLabel);
    if (node.type === 'containerDirective' && source) {
      const last = source
        .slice(node.position.start.offset, node.position.end.offset)
        .trimEnd()
        .split('\n')
        .at(-1)!;
      if (!/^\s*:{3,}\s*$/.test(last))
        report(node, 'unclosed-component', `Close ${node.name} with a matching ::: delimiter.`);
    }
    if (definition.children) {
      const children = body.filter(
        (n: any) => n.type === 'containerDirective' && definition.children!.includes(n.name),
      );
      if (children.length !== body.length || !children.length)
        report(
          node,
          'component-children',
          `${node.name} may contain only ${definition.children.join(', ')} containers.`,
        );
      if (node.name === 'comparison' && (children.length < 2 || children.length > 4))
        report(node, 'comparison-count', 'Comparisons need two to four options.');
    }
    const parents: Record<string, string> = {
      tab: 'tabs',
      option: 'comparison',
      reference: 'references',
    };
    if (parents[node.name] && parent?.name !== parents[node.name])
      report(
        node,
        'component-parent',
        `${node.name} belongs directly inside ${parents[node.name]}.`,
      );
    if (
      node.name === 'table' &&
      (body.filter((n: any) => n.type === 'table').length !== 1 ||
        body.some((n: any) => !['table', 'paragraph', 'list'].includes(n.type)))
    )
      report(
        node,
        'table-body',
        'A table component needs exactly one GFM table and optional Markdown notes.',
      );
    if (node.name === 'equation' && (body.length !== 1 || body[0].type !== 'math'))
      report(node, 'equation-body', 'An equation component needs exactly one display equation.');
    if (node.name === 'equation' && attributes.id && /\\(?:tag|label)\b/.test(body[0]?.value || ''))
      report(
        node,
        'equation-numbering',
        'Labeled equation components own numbering. Remove the TeX tag or label.',
      );
    if (
      ['mindmap', 'timeline'].includes(node.name) &&
      (body.length !== 1 || body[0].type !== 'list')
    )
      report(node, 'list-body', `${node.name} needs one Markdown list.`);
    if (node.name === 'mindmap' && body[0]?.type === 'list') {
      if (attributes.layout && !['map', 'tree'].includes(attributes.layout))
        report(node, 'mindmap-layout', 'Mindmap layout must be map or tree.');
      let count = 0;
      const walk = (list: any, depth: number) => {
        if (depth > 10) {
          report(node, 'mindmap-depth', 'Mind maps are limited to ten levels.');
          return;
        }
        for (const item of list.children) {
          count++;
          if (item.children.some((n: any) => !['paragraph', 'list'].includes(n.type)))
            report(item, 'mindmap-content', 'Mind map nodes contain text and nested lists.');
          if (item.children.filter((n: any) => n.type === 'paragraph').length !== 1)
            report(item, 'mindmap-label', 'Each mind map node needs one text paragraph.');
          else if (!markdownText(item.children.find((n: any) => n.type === 'paragraph')).trim())
            report(item, 'mindmap-label', 'Each mind map node needs nonempty text.');
          for (const sub of item.children.filter((n: any) => n.type === 'list'))
            walk(sub, depth + 1);
        }
      };
      walk(body[0], 1);
      if (count > 200) report(node, 'mindmap-size', 'Mind maps are limited to 200 nodes.');
    }
    if (
      node.name === 'algorithm' &&
      !body.some((n: any) => n.type === 'code' || (n.type === 'list' && n.ordered))
    )
      report(node, 'algorithm-body', 'Algorithms need ordered steps or a pseudocode fence.');
    if (node.name === 'link-card' && !/^(https:\/\/|\/(?!\/))/.test(attributes.href || ''))
      report(node, 'link-card-url', 'Link cards need a local or HTTPS href.');
    if (node.name === 'discussion') {
      if (attributes.comments && !['true', 'false'].includes(attributes.comments))
        report(node, 'discussion-comments', 'Discussion comments must be true or false.');
      if (attributes.comments === 'true' && !attributes.id)
        report(node, 'discussion-key', 'Reader discussions need a stable #key.');
      if (attributes.id) {
        if (!/^[a-zA-Z][\w-]{0,79}$/.test(attributes.id) || discussionKeys.has(attributes.id))
          report(node, 'discussion-key', `Invalid or duplicate discussion key: ${attributes.id}`);
        discussionKeys.add(attributes.id);
      }
    }
    if (attributes.id && definition.attributes.id && node.name !== 'discussion') {
      if (
        !/^[a-zA-Z][\w-]{0,79}$/.test(attributes.id) ||
        labels.has(attributes.id) ||
        discussionKeys.has(attributes.id)
      )
        report(node, 'duplicate-label', `Invalid or duplicate document label: ${attributes.id}`);
      else {
        const counter = definition.counter || node.name;
        const number = (counters.get(counter) || 0) + 1;
        counters.set(counter, number);
        labels.set(attributes.id, {
          id: attributes.id,
          kind: node.name,
          number,
          text: `${definition.label} ${number}`,
        });
      }
    }
    if (node.name === 'reference' && !attributes.id)
      report(node, 'reference-label', 'Bibliography entries need a stable #id.');
  });
  visit(tree, (node: any) => {
    if (node.type !== 'textDirective' || !['ref', 'cite'].includes(node.name)) return;
    const key = markdownText(node).trim();
    const label = labels.get(key);
    if (!label) report(node, 'unresolved-reference', `Unknown document reference: ${key}`);
    else if ((node.name === 'cite') !== (label.kind === 'reference'))
      report(
        node,
        'reference-kind',
        node.name === 'cite'
          ? 'Citations must target a reference entry.'
          : 'Use :cite for bibliography entries.',
      );
  });
  return { version: authoringVersion, diagnostics, labels: [...labels.values()] };
}
export function inspectMarkdown(source: string) {
  return analyzeMarkdownTree(parseMarkdown(source), source);
}
export class MarkdownValidationError extends Error {
  constructor(public diagnostics: MarkdownDiagnostic[]) {
    const first = diagnostics.find((d) => d.severity === 'error')!;
    super(`${first.message} (line ${first.line}, column ${first.column})`);
    this.name = 'MarkdownValidationError';
  }
}
