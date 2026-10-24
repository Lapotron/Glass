import { parseMarkdown } from '../shared/markdown-analysis.js';
import {
  sourceComponents,
  componentPreviewLimits,
  type ComponentPreviewResult,
} from '../shared/source-components.js';
import { renderMarkdown } from './markdown.js';
import { createDiagramRenderer } from './diagrams.js';
import { digest } from './store.js';
import path from 'node:path';
import type { MathSettings } from '../shared/math-authoring.js';
import { defaultDiagramPresentation, type DiagramPresentation } from '../shared/diagram-presentation.js';

const cache = new Map<string, { result: ComponentPreviewResult; bytes: number }>();
let cacheBytes = 0;
export async function renderComponentPreviews(
  source: string,
  ranges: { from: number; to: number }[],
  root: string,
  signal?: AbortSignal,
  math?: MathSettings,
  presentation: DiagramPresentation = defaultDiagramPresentation,
) {
  if (
    Buffer.byteLength(source) > componentPreviewLimits.source ||
    ranges.length > componentPreviewLimits.count
  )
    throw new Error('Component preview input is too large. Source remains editable.');
  const components = sourceComponents(source, parseMarkdown(source));
  const diagrams = createDiagramRenderer({
    cacheDir: path.join(root, '.studio/render-cache/mermaid'),
  });
  const results: ComponentPreviewResult[] = [];
  let output = 0;
  try {
    for (const range of ranges) {
      signal?.throwIfAborted();
      const block = components.find((b) => b.from === range.from && b.to === range.to);
      let result: ComponentPreviewResult;
      try {
        if (!block) throw new Error('The component changed. Edit or reopen its preview.');
        if (Buffer.byteLength(block.source) > componentPreviewLimits.block)
          throw new Error('This component exceeds the 64 KiB preview limit.');
        const key = digest(root + block.source + block.context + JSON.stringify([math || {}, presentation]));
        const cached = cache.get(key);
        if (cached) {
          cache.delete(key);
          cache.set(key, cached);
          result = cached.result;
        } else {
          const [definitions, maths] = JSON.parse(block.context) as [string[], string[]];
          if (Buffer.byteLength(maths.join('')) > 2 * 1024 * 1024)
            throw new Error('Math context exceeds the source-preview limit.');
          const rendered = await renderMarkdown(block.source + '\n\n' + definitions.join('\n\n'), {
            documentId: 'component-' + key,
            diagrams,
            diagramPresentation: presentation,
            mathContext: maths.map((text) => ({ source: text, display: false })),
            math,
            chartCacheDir: path.join(root, '.studio/render-cache/charts'),
          });
          result = { html: rendered.html };
          const bytes = Buffer.byteLength(rendered.html);
          if (bytes <= componentPreviewLimits.output) {
            cache.set(key, { result, bytes });
            cacheBytes += bytes;
            while (cache.size > 48 || cacheBytes > 8 * 1024 * 1024) {
              const first = cache.keys().next().value!;
              cacheBytes -= cache.get(first)!.bytes;
              cache.delete(first);
            }
          }
        }
        output += Buffer.byteLength(result.html || '');
        if (output > componentPreviewLimits.output)
          result = { error: 'Preview output limit reached. Expand fewer components at once.' };
      } catch (error) {
        result = { error: (error as Error).message };
      }
      results.push(result);
    }
    return results;
  } finally {
    await diagrams.close();
  }
}
