import { mathCommandCatalog, mathCommandSource } from './math-authoring.js';
import { markdownPresets } from './markdown-presets.js';
import { quicksortAlgorithm } from './pseudocode-authoring.js';
import type { IconName } from './ui.js';
export const authoringVersion = 'fieldnotes-markdown/1';
export type ComponentSpec = {
  name: string;
  label: string;
  kind: 'container' | 'inline' | 'leaf';
  group: 'Reading' | 'Academic' | 'Visual' | 'Inline';
  description: string;
  icon: IconName;
  example: string;
  attributes: Record<string, { description: string; values?: string[] }>;
  children?: string[];
  counter?: string;
};
const id = {
  description: 'Stable document label, starting with a letter; enables numbering where supported.',
};
const simple = (
  name: string,
  description: string,
  example: string,
  extra: Partial<ComponentSpec> = {},
): ComponentSpec => ({
  name,
  label: name[0].toUpperCase() + name.slice(1),
  kind: 'container',
  group: 'Reading',
  icon: 'BookOpen',
  attributes: {},
  description,
  example,
  ...extra,
});
const preset = (type: string) => markdownPresets.find((s) => s.type === type)!.value;
const statement = ['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'example'];
export const markdownCatalog: ComponentSpec[] = [
  ...['note', 'tip', 'important', 'warning', 'caution'].map((name) =>
    simple(
      name,
      'An explicit callout containing ordinary Markdown.',
      `:::${name}[A useful detail]\nKeep the explanation close to its context.\n:::\n`,
      { icon: 'AlertCircle' },
    ),
  ),
  simple('details', 'A native disclosure, useful without JavaScript.', preset('details'), {
    icon: 'ChevronDown',
  }),
  simple(
    'discussion',
    'An authored discussion section, optionally connected to Giscus.',
    preset('discussion'),
    {
      icon: 'MessageCircle',
      attributes: {
        id,
        comments: {
          description: 'Request a reader discussion; true requires a stable #id.',
          values: ['true', 'false'],
        },
      },
    },
  ),
  simple(
    'question',
    'A question with rich Markdown.',
    ':::question[Why does this work?]\nState the question.\n:::\n',
    { icon: 'CircleHelp' },
  ),
  simple(
    'answer',
    'A corresponding explanation.',
    ':::answer[An explanation]\nDevelop the reasoning with $x^2$.\n:::\n',
    { icon: 'CircleHelp' },
  ),
  simple(
    'tabs',
    'A group of rich Markdown tabs. All panels are readable without JavaScript.',
    preset('rich-tabs'),
    { children: ['tab'], icon: 'Columns2' },
  ),
  simple(
    'tab',
    'A labeled panel, nested directly inside tabs.',
    ':::tab[Explanation]\nA little **context**.\n:::\n',
    { icon: 'Columns2' },
  ),
  simple('steps', 'An ordered explanation in the reading flow.', preset('steps'), {
    icon: 'ListTree',
  }),
  simple(
    'figure',
    'A captioned image or diagram; an explicit #id enables figure numbering.',
    ':::figure[A descriptive caption]{#fig-observation}\n![Describe the observation](/media/your-image.webp)\n:::\n',
    {
      attributes: {
        id,
        width: {
          description:
            'Responsive display cap: 64–2400 pixels (480 or 480px), or 10–100% of the prose column.',
        },
        'max-height': {
          description:
            'Optional 64–2400 pixel height cap. Keeps the complete image and aspect ratio.',
        },
        align: {
          description: 'Position a sized figure without floating surrounding prose.',
          values: ['left', 'center', 'right'],
        },
      },
      counter: 'figure',
      group: 'Visual',
      icon: 'Image',
    },
  ),
  simple(
    'gallery',
    'A responsive collection of images using the shared viewer.',
    preset('gallery'),
    { group: 'Visual', icon: 'Layers' },
  ),
  simple(
    'link-card',
    'A labeled local or HTTPS link with an optional description.',
    preset('link-card'),
    {
      kind: 'leaf',
      icon: 'LinkIcon',
      attributes: {
        href: { description: 'A local absolute path or HTTPS URL.' },
        description: { description: 'Optional plain-text description.' },
      },
    },
  ),
  ...['mark', 'kbd', 'abbr', 'sub', 'sup'].map((name) =>
    simple(
      name,
      'Inline semantic notation.',
      `:${name}[${name === 'sub' ? '2' : name === 'sup' ? '2' : 'text'}]${name === 'abbr' ? '{title="Expanded term"}' : ''}`,
      {
        kind: 'inline',
        group: 'Inline',
        icon: 'Code2',
        attributes: name === 'abbr' ? { title: { description: 'Expanded term.' } } : {},
      },
    ),
  ),
  ...statement.map((name) =>
    simple(
      name,
      'An academic statement. Labeled statements share a document-local counter.',
      `:::${name}[A useful result]{#${name}-result}\nFor $x>0$, explain the statement precisely.\n:::\n`,
      { attributes: { id }, counter: 'statement', group: 'Academic', icon: 'BookOpen' },
    ),
  ),
  simple(
    'proof',
    'A proof with a closing proof mark.',
    ':::proof[Proof]\nDevelop the argument step by step.\n:::\n',
    { group: 'Academic', icon: 'Check' },
  ),
  simple(
    'algorithm',
    'An algorithm containing an ordered list or pseudocode fence.',
    quicksortAlgorithm,
    { attributes: { id }, counter: 'algorithm', group: 'Academic', icon: 'ListTree' },
  ),
  simple(
    'equation',
    'Exactly one display equation, numbered when labeled. Use aligned for a derivation.',
    ':::equation[Energy]{#eq-energy}\n$$\nE = mc^2\n$$\n:::\n',
    {
      attributes: { id },
      counter: 'equation',
      group: 'Academic',
      icon: 'FunctionSquare',
    },
  ),
  simple(
    'table',
    'One GFM table with a caption and optional Markdown notes.',
    ':::table[An experiment]{#tab-results}\n| Method | Error |\n| :--- | ---: |\n| Baseline | $0.12$ |\n| Refined | $0.04$ |\n\nValues are measured under identical conditions.\n:::\n',
    { attributes: { id }, counter: 'table', group: 'Academic', icon: 'Table2' },
  ),
  simple('ref', 'A forward or backward reference to a labeled component.', ':ref[eq-energy]', {
    kind: 'inline',
    group: 'Inline',
    icon: 'LinkIcon',
  }),
  simple(
    'cite',
    'A numeric citation to a manually authored reference entry.',
    ':cite[reference-key]',
    { kind: 'inline', group: 'Inline', icon: 'BookOpen' },
  ),
  simple(
    'references',
    'A bibliography containing reference entries in display order.',
    '::::references[References]\n:::reference[Author, year]{#reference-key}\nAuthor. *Title*. Publisher, year. [Source](https://example.org/).\n:::\n::::\n',
    { children: ['reference'], group: 'Academic', icon: 'BookOpen' },
  ),
  simple(
    'reference',
    'A manually authored bibliography item. Cite its stable #id.',
    ':::reference[Author, year]{#reference-key}\nAuthor. *Title*. Publisher, year.\n:::\n',
    { attributes: { id }, counter: 'reference', group: 'Academic', icon: 'BookOpen' },
  ),
  simple(
    'mindmap',
    'A concept map authored as one nested Markdown list. No scripts or remote resources.',
    ':::mindmap[Learning by making]\n- Learning\n  - Observe\n    - Ask a question\n    - Collect evidence\n  - Make\n    - Try an experiment\n    - Reflect\n:::\n',
    {
      group: 'Visual',
      icon: 'Workflow',
      attributes: {
        layout: {
          description: 'Initial mindmap presentation; readers can switch views.',
          values: ['map', 'tree'],
        },
      },
    },
  ),
  simple(
    'timeline',
    'A sequence of events authored as an ordered or unordered list.',
    ':::timeline[An idea takes shape]\n- **2024** — A first observation.\n- **2025** — A small experiment.\n- **2026** — A clearer explanation.\n:::\n',
    { group: 'Visual', icon: 'CalendarDays' },
  ),
  simple(
    'comparison',
    'Two to four labeled options, stacked on narrow screens.',
    '::::comparison[Two approaches]\n:::option[Analytical]\nWork from a model and derive a result.\n:::\n:::option[Experimental]\nMeasure the system and compare observations.\n:::\n::::\n',
    { children: ['option'], group: 'Visual', icon: 'Columns2' },
  ),
  simple(
    'option',
    'A labeled comparison column nested directly in comparison.',
    ':::option[Approach]\nDiscuss its strengths and limitations.\n:::\n',
    { group: 'Visual', icon: 'Columns2' },
  ),
];
export const componentByName = new Map(markdownCatalog.map((s) => [s.name, s]));
export const mathCompletions = mathCommandCatalog.map(command => mathCommandSource(command).slice(1));

/** Shared by Studio completions and external authoring capabilities. */
export const codeMetadata = [
  {label:'project',apply:'project="demo"',detail:'Share JS/TS virtual files within this article'},
  {label:'check',apply:'check="off"',detail:'Disable diagnostics for an intentionally incomplete snippet'},
  {label:'style',apply:'style="algorithm"',detail:'Pseudocode presentation: algorithm or code'},
  { label: 'title', apply: 'title="filename.ts"', detail: 'File or terminal caption' },
  { label: 'wrap', apply: 'wrap', detail: 'Wrap long visual lines without changing copied source' },
  { label: 'frame', apply: 'frame="terminal"', detail: 'Editor or terminal frame' },
  { label: 'highlight', apply: '{2,4-6}', detail: 'Highlight source line numbers' },
  { label: 'ins', apply: 'ins={2-3}', detail: 'Inserted line emphasis' },
  { label: 'del', apply: 'del={4-5}', detail: 'Deleted line emphasis' },
  { label: 'mark', apply: 'mark="important"', detail: 'Emphasize matching text' },
  {
    label: 'collapse',
    apply: 'collapse={4-12}',
    detail: 'Fold inclusive line ranges; use n-n for one line',
  },
  {
    label: 'showLineNumbers',
    apply: 'showLineNumbers=false',
    detail: 'Hide numbers for this block',
  },
];
