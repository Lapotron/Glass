import { inspectSource, type InspectionContext, type SourceImage } from './source-inspection.js';
import { visit } from 'unist-util-visit';
import { completionShortcutError, defaultCompletionShortcut } from './source-shortcuts.js';
import { mathMacros, type MathMacro } from '../shared/math-symbols.js';
import { sourceCodeBlocks, type SourceCodeBlock } from '../shared/code-projects.js';
import type { MathPreviewExpression } from '../shared/math-preview.js';
import {
  sourceComponents,
  type SourceComponent,
  type ComponentPreviewKind,
} from '../shared/source-components.js';
import {
  analyzeMarkdownTree,
  markdownText,
  parseMarkdown,
  type MarkdownDiagnostic,
} from '../shared/markdown-analysis.js';

export type SourceHeading = { level: number; text: string; from: number; to: number; line: number };
export type SourceMath = MathPreviewExpression & { from: number; to: number };
export type SourceAnalysis = {
  superseded?: boolean;
  headings: SourceHeading[];
  diagnostics: MarkdownDiagnostic[];
  words: number;
  characters: number;
  lines: number;
  images?: SourceImage[];
  maths?: SourceMath[];
  macros?: MathMacro[];
  codeBlocks?: SourceCodeBlock[];
  components?: SourceComponent[];
};
const wordSegmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null;
export function analyzeSource(source: string, context?: InspectionContext): SourceAnalysis {
  const tree = parseMarkdown(source),
    headings: SourceHeading[] = [],
    maths: SourceMath[] = [];
  visit(tree, (node: any) => {
    if (node.type === 'math' || node.type === 'inlineMath')
      maths.push({
        from: node.position.start.offset,
        to: node.position.end.offset,
        source: node.value,
        display: node.type === 'math',
      });
  });
  visit(tree, 'heading', (node: any) => {
    headings.push({
      level: node.depth,
      text: markdownText(node),
      from: node.position.start.offset,
      to: node.position.end.offset,
      line: node.position.start.line,
    });
  });
  let words = 0,
    characters = 0,
    lines = 1;
  if (wordSegmenter) {
    for (const segment of wordSegmenter.segment(source)) if (segment.isWordLike) words++;
  } else for (const _word of source.matchAll(/\S+/g)) words++;
  for (const character of source) {
    characters++;
    if (character === '\n') lines++;
  }
  const inspection = inspectSource(tree, source, context);
  return {
    images: inspection.images,
    components: sourceComponents(source, tree),
    maths,
    macros: maths.flatMap(math => mathMacros(math.source, source.indexOf(math.source,math.from))),
    codeBlocks: sourceCodeBlocks(source,tree),
    headings,
    diagnostics: [...analyzeMarkdownTree(tree, source).diagnostics, ...inspection.diagnostics].sort(
      (a, b) => a.from - b.from,
    ),
    words,
    characters,
    lines,
  };
}

export type SourcePreferences = {
  version: 1;
  navigator: boolean;
  minimap: boolean;
  wrap: boolean;
  numbers: boolean;
  whitespace: boolean;
  activeLine: boolean;
  formatOnSave: boolean;
  completeOnTyping: boolean;
  closeBrackets: boolean;
  completionShortcut: string;
  mathPreviews: boolean;
  inlineMathPreviews: boolean;
  imagePreviews: 'both' | 'thumbnails' | 'hover' | 'off';
  componentPreviews: Record<ComponentPreviewKind, boolean>;
  indent: number;
  scale: number;
};
export const sourceDefaults: SourcePreferences = {
  version: 1,
  navigator: true,
  minimap: true,
  wrap: true,
  numbers: true,
  whitespace: false,
  activeLine: true,
  formatOnSave: false,
  completeOnTyping: true,
  closeBrackets: true,
  completionShortcut: defaultCompletionShortcut,
  mathPreviews: true,
  inlineMathPreviews: true,
  imagePreviews: 'both',
  componentPreviews: {
    table: true,
    mermaid: true,
    mindmap: true,
    chart: true,
    'function-plot': true,
    'image-compare': true,
    pseudocode: false,
  },
  indent: 2,
  scale: 1,
};
export function readSourcePreferences(scope: string): SourcePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(`fieldnotes-editor:${scope}`) || '{}');
    if (value.version !== 1) return { ...sourceDefaults };
    const result = { ...sourceDefaults };
    result.componentPreviews = { ...sourceDefaults.componentPreviews };
    for (const key of Object.keys(result.componentPreviews) as ComponentPreviewKind[])
      if (key !== 'pseudocode' && typeof value.componentPreviews?.[key] === 'boolean')
        result.componentPreviews[key] = value.componentPreviews[key];
    for (const key of [
      'navigator',
      'minimap',
      'wrap',
      'numbers',
      'whitespace',
      'activeLine',
      'formatOnSave',
      'completeOnTyping',
      'closeBrackets',
      'mathPreviews',
      'inlineMathPreviews',
    ] as const)
      if (typeof value[key] === 'boolean') result[key] = value[key];
    if (['both', 'thumbnails', 'hover', 'off'].includes(value.imagePreviews))
      result.imagePreviews = value.imagePreviews;
    if (
      typeof value.completionShortcut === 'string' &&
      !completionShortcutError(value.completionShortcut)
    )
      result.completionShortcut = value.completionShortcut;
    if ([2, 4].includes(value.indent)) result.indent = value.indent;
    if (typeof value.scale === 'number' && value.scale >= 0.85 && value.scale <= 1.4)
      result.scale = value.scale;
    return result;
  } catch {
    return { ...sourceDefaults };
  }
}
