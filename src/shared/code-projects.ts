import { visit } from 'unist-util-visit';
import { parseMarkdown } from './markdown-analysis.js';

export type SourceCodeBlock = {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  language: string;
  filename: string;
  project: string;
  check: boolean;
  text: string;
};
export type VirtualCodeFile = { name: string; group: string; text: string; check: boolean };
export function fenceOption(meta: string, name: string) {
  return new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)'|([^\\s]+))`)
    .exec(meta)
    ?.slice(1)
    .find((value) => value !== undefined);
}
export function sourceCodeBlocks(source: string, tree = parseMarkdown(source)): SourceCodeBlock[] {
  const blocks: SourceCodeBlock[] = [];
  visit(tree, 'code', (node: any, _index, parent: any) => {
    const language = String(node.lang || '').toLowerCase();
    if (!/^(?:javascript|js|jsx|typescript|ts|tsx)$/.test(language) || parent?.type !== 'root')
      return;
    const from = node.position.start.offset,
      to = node.position.end.offset;
    const bodyFrom = source.indexOf('\n', from) + 1;
    if (!bodyFrom) return;
    const closing = source.lastIndexOf('\n', to - 1);
    const bodyTo =
      closing >= bodyFrom && /^\s*(?:`{3,}|~{3,})\s*$/.test(source.slice(closing + 1, to))
        ? closing
        : to;
    const extension = /^(?:ts|typescript)$/.test(language)
      ? 'ts'
      : language === 'tsx'
        ? 'tsx'
        : language === 'jsx'
          ? 'jsx'
          : 'js';
    const title = fenceOption(node.meta || '', 'title');
    const filename =
      title &&
      /^[\w.-]+(?:\/[\w.-]+)*\.(?:[cm]?[jt]sx?)$/.test(title) &&
      !title.split('/').includes('..')
        ? title
        : `block-${blocks.length + 1}.${extension}`;
    const project = fenceOption(node.meta || '', 'project');
    blocks.push({
      from,
      to,
      bodyFrom,
      bodyTo,
      language,
      filename,
      project:
        project && /^[\w-]{1,64}$/.test(project)
          ? `project-${project}`
          : `block-${blocks.length + 1}`,
      check: fenceOption(node.meta || '', 'check') !== 'off',
      text: source.slice(bodyFrom, bodyTo),
    });
  });
  return blocks;
}
export function virtualCodeFiles(blocks: SourceCodeBlock[]): VirtualCodeFile[] {
  return blocks.map((block) => ({
    name: `/project/${block.project}/${block.filename}`,
    group: block.project,
    text: block.text,
    check: block.check,
  }));
}
