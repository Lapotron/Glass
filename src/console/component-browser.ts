import { markdownSnippets } from '../shared/markdown-snippets.js';
import { markdownCatalog } from '../shared/markdown-catalog.js';
import { interactiveRegistry } from '../shared/interactives.js';
import type { IconName } from '../shared/ui.js';

export type ComponentCategory = 'writing' | 'academic' | 'media' | 'interactive' | 'diagrams';
export type BrowserComponent = {
  type: string;
  label: string;
  description: string;
  icon: IconName;
  category: ComponentCategory;
};
const interactiveDescriptions: Record<string, string> = {
  quiz: 'A question with answer choices and an explanation.',
  tabs: 'Interactive views with an accessible static fallback.',
  'function-plot': 'Explore a curve with adjustable parameters.',
  chart: 'Plot structured data with interactive controls.',
  'image-compare': 'Compare two images with a draggable divider.',
};
/** Presentation metadata comes from the same catalog as insertion and validation. */
export const componentBrowserItems: BrowserComponent[] = [
  ...markdownSnippets.map((item): BrowserComponent => {
    const spec = markdownCatalog.find(
      (spec) => spec.name === item.type || spec.example === item.value,
    );
    return {
      type: item.type,
      label: item.label,
      icon: item.icon,
      description: spec?.description || 'Insert an editable Markdown template.',
      category:
        item.type === 'mindmap'
          ? 'diagrams'
          : ['figure', 'gallery', 'link-card'].includes(item.type)
            ? 'media'
            : spec?.group === 'Academic'
              ? 'academic'
              : 'writing',
    };
  }),
  ...interactiveRegistry.map((item): BrowserComponent => ({
    type: item.type,
    label: item.label,
    icon: item.icon,
    category: item.type === 'image-compare' ? 'media' : 'interactive',
    description: interactiveDescriptions[item.type],
  })),
  {
    type: 'math',
    label: 'Equation',
    icon: 'FunctionSquare',
    category: 'diagrams',
    description: 'Inline or display mathematics rendered with MathJax.',
  },
  {
    type: 'mermaid',
    label: 'Diagram',
    icon: 'Workflow',
    category: 'diagrams',
    description: 'Describe a diagram using Mermaid syntax.',
  },
];
