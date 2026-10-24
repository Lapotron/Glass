import { z } from 'zod';
import {
  authoringVersion,
  markdownCatalog,
  mathCompletions,
  codeMetadata,
} from './markdown-catalog.js';
import { interactiveSchema, interactiveRegistry } from './interactives.js';
import { chartSchema, chartStyles } from './chart-schema.js';
import { chartExample } from './chart-examples.js';
import { entrySchema } from './contracts.js';
import { effectiveMathPackages, mathExtensions, mathCommandCatalog, mathEnvironments } from './math-authoring.js';
import { pseudocodeKeywords, pseudocodeOperatorSymbols } from './pseudocode.js';
import { mermaidVersion, mermaidExamples } from './mermaid-authoring.js';
import { pseudocodeBuiltins, pseudocodeOperators, pseudocodeSnippets } from './pseudocode-authoring.js';
export function authoringCapabilities() {
  return {
    version: authoringVersion,
    markdown: [
      'CommonMark',
      'GFM tables and tasks',
      'footnotes',
      'definition lists',
      'sanitized HTML',
      'inline ==highlight== and :mark[text]',
      'MathJax 4',
      'Mermaid',
    ],
    code: {
      engine: 'Expressive Code',
      rendering: 'build-time HTML and themed CSS',
      metadata: codeMetadata,
      intelligence: {languages:['javascript','typescript','jsx','tsx'],grouping:'project="name" title="file.ts"',checking:'check="off" disables semantic diagnostics; code is never executed'},
      pseudocode: {
        language:'pseudocode', aliases:['pseudo','algorithm'], styles:['algorithm','code'],
        defaultStyle:'algorithm', keywords:pseudocodeKeywords, builtins:pseudocodeBuiltins,
        operators:pseudocodeOperators,
        operatorSymbols:pseudocodeOperatorSymbols,
        operatorRendering:'Build-time inline MathJax SVG; isolated fixed TeX; exact source exports',
        typography:'Academic serif at reading scale; shared monospace in code mode',
        snippets:pseudocodeSnippets.map(({name,description,source}) => ({name,description,source:source.replaceAll('\t','  ')})),
        defaultAlgorithm:'quicksort', indexing:'zero-based; inclusive lo and hi; Lomuto partition',
        sourceEditing:'Source highlighting, completion, block folding and matching; no inline rendered preview. END statements are inserted only by accepted snippets.',
      },
    },
    diagrams:{engine:'Mermaid',version:mermaidVersion,rendering:'Build-time transparent light/dark SVG; native math labels; shared vector viewer',examples:mermaidExamples},
    components: markdownCatalog,
    entrySchema: z.toJSONSchema(entrySchema, { io: 'input', unrepresentable: 'any' }),
    interactives: interactiveRegistry.map(({ type, label, example }) => ({ type, label, example })),
    interactiveSchema: z.toJSONSchema(interactiveSchema, { io: 'input', unrepresentable: 'any' }),
    chartSchema: z.toJSONSchema(chartSchema, { io: 'input', unrepresentable: 'any' }),
    chartExamples: Object.fromEntries(chartStyles.map((s) => [s, chartExample(s)])),
    math: {
      version: 4,
      packages: effectiveMathPackages(),
      optionalPackages: mathExtensions,
      commands: mathCommandCatalog,
      environments: mathEnvironments,
      completions: mathCompletions,
      rendering: 'build-time SVG; document-scoped macros',
    },
    invariants: [
      'One continuous prose surface',
      'Configuration is data, never executable code',
      'Explicit labels are unique within a document',
      'Only published entries enter public builds',
      'Media uses canonical /media/ paths',
    ],
  };
}
