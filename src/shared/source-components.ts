import { visit, SKIP } from 'unist-util-visit';
import { parseMarkdown } from './markdown-analysis.js';

export const componentPreviewKinds = [
  'table',
  'mermaid',
  'mindmap',
  'chart',
  'function-plot',
  'image-compare',
  'pseudocode',
] as const;
export type ComponentPreviewKind = (typeof componentPreviewKinds)[number];
export type SourceComponent = {
  kind: ComponentPreviewKind;
  from: number;
  to: number;
  source: string;
  context: string;
};
export type ComponentPreviewResult =
  { html: string; error?: never } | { error: string; html?: never };
export const componentPreviewLimits = {
  source: 2 * 1024 * 1024,
  block: 64 * 1024,
  count: 12,
  output: 2 * 1024 * 1024,
} as const;
export const componentLabels: Record<ComponentPreviewKind, string> = {
  table: 'Table',
  mermaid: 'Mermaid diagram',
  mindmap: 'Mindmap',
  chart: 'Chart',
  'function-plot': 'Function plot',
  'image-compare': 'Image comparison',
  pseudocode: 'Pseudocode',
};

/** Positions come from the same Markdown tree as diagnostics, never a fence regex. */
export function sourceComponents(source: string, tree = parseMarkdown(source)): SourceComponent[] {
  const blocks: SourceComponent[] = [],
    definitions: string[] = [],
    maths: { to: number; source: string }[] = [];
  visit(tree, (node: any) => {
    if (['definition', 'footnoteDefinition'].includes(node.type))
      definitions.push(source.slice(node.position.start.offset, node.position.end.offset));
    if (['math', 'inlineMath'].includes(node.type))
      maths.push({ to: node.position.end.offset, source: node.value });
  });
  visit(tree, (node: any, _index, parent: any) => {
    let kind: ComponentPreviewKind | undefined;
    if (node.type === 'table' && !['blockquote', 'listItem'].includes(parent?.type)) kind = 'table';
    if (node.type === 'containerDirective' && node.name === 'mindmap') kind = 'mindmap';
    if (node.type === 'code') {
      if (['pseudocode','pseudo','algorithm'].includes(node.lang)) kind = 'pseudocode';
      if (node.lang === 'mermaid') kind = 'mermaid';
      if (node.lang === 'interactive') {
        try {
          const type = JSON.parse(node.value).type;
          if (['chart', 'function-plot', 'image-compare'].includes(type)) kind = type;
        } catch {
          const type = /"type"\s*:\s*"(chart|function-plot|image-compare)"/.exec(node.value)?.[1];
          if (type) kind = type as ComponentPreviewKind;
        }
      }
    }
    if (!kind || !node.position) return;
    const from = node.position.start.offset,
      to = node.position.end.offset;
    // Container indentation cannot safely be rewritten by a root-block operation.
    if (source.slice(source.lastIndexOf('\n', from - 1) + 1, from).trim()) return SKIP;
    blocks.push({
      kind,
      from,
      to,
      source: source.slice(from, to),
      context: JSON.stringify([
        definitions,
        maths.filter((m) => m.to <= from).map((m) => m.source),
      ]),
    });
    return SKIP;
  });
  return blocks;
}
