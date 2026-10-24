import mermaid from 'mermaid';
import '../../engine/diagram-browser.js';
import { defaultDiagramPresentation } from '../../shared/diagram-presentation.js';
(globalThis as any).mermaid = mermaid;
export function createDiagramRenderer(_options?: unknown) {
  return {
    render: (source: string, namespace: string, presentation = defaultDiagramPresentation) =>
      (globalThis as any).renderBlogDiagram({ source, prefix: namespace + '-', presentation }),
    close: async () => {},
  };
}
