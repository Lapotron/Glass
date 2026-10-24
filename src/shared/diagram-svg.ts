/** Only compiler-produced, sanitized inline Mermaid drawings enter this payload. Never fetch SVG URLs. */
import { diagramTitle } from './diagram-title.js';
export { diagramTitle } from './diagram-title.js';
export type ViewerDiagram = {
  variants: { light: string; dark: string };
  width: number;
  height: number;
  name: string;
  permalink?: string;
};
let sequence = 0;
const namespace = () => `diagram-view-${++sequence}-${crypto.randomUUID().slice(0, 8)}`;

/** A clone needs fresh IDs even when the underlying compiler result came from the same cache. */
function cloneNamespaced<T extends Element>(source: T, prefix = namespace()): T {
  const svg = source.cloneNode(true) as T;
  const elements = [svg, ...svg.querySelectorAll<Element>('*')];
  const ids = new Map(
    elements.filter((node) => node.id).map((node, index) => [node.id, `${prefix}-${index}`]),
  );
  const references = (text: string) =>
    text.replace(/#([\w-]+)/g, (match, id: string) => (ids.has(id) ? '#' + ids.get(id) : match));
  for (const node of elements) {
    for (const attribute of [...node.attributes]) {
      if (attribute.name === 'id') node.id = ids.get(attribute.value)!;
      else if (/^aria-(?:labelledby|describedby|controls|activedescendant)$/.test(attribute.name))
        node.setAttribute(
          attribute.name,
          attribute.value
            .split(/\s+/)
            .map((id) => ids.get(id) || id)
            .join(' '),
        );
      else node.setAttribute(attribute.name, references(attribute.value));
    }
    if (node.localName === 'style') node.textContent = references(node.textContent || '');
  }
  return svg;
}

export function cloneDiagramSvg(source: SVGSVGElement, prefix = namespace()) {
  return cloneNamespaced(source, prefix);
}

export function namespaceDiagramPreviews(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('figure[data-mermaid]').forEach((figure) => {
    // The highlighted source disclosure has IDs too; namespace the complete cached occurrence.
    figure.replaceWith(cloneNamespaced(figure));
  });
}

export function diagramFromFigure(figure: HTMLElement, permalink?: string): ViewerDiagram {
  const variants = {} as ViewerDiagram['variants'];
  let width = 0,
    height = 0,
    name = '';
  for (const mode of ['light', 'dark'] as const) {
    const source = figure.querySelector<SVGSVGElement>(`[data-diagram-variant="${mode}"] svg`);
    if (!source) throw new Error('This diagram is not ready. Retry its preview.');
    const box = source.viewBox.baseVal;
    if (![box.width, box.height].every((n) => Number.isFinite(n) && n > 0 && n <= 1e6))
      throw new Error('This diagram has invalid dimensions.');
    width = Math.max(width, Math.ceil(box.width));
    height = Math.max(height, Math.ceil(box.height));
    name ||= diagramTitle(source);
    // Serialize only slides being opened/preloaded, rather than cloning an entire article gallery.
    Object.defineProperty(variants, mode, {
      enumerable: true,
      get: () => {
        const serialized = new XMLSerializer().serializeToString(source);
        if (serialized.length > 1024 * 1024)
          throw new Error(
            'This diagram is too large to expand. Its inline drawing remains available.',
          );
        return serialized;
      },
    });
  }
  return { variants, width, height, name: name || 'Diagram', permalink };
}

export const diagramMode = () =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

export function diagramSvgElement(diagram: ViewerDiagram, mode: 'light' | 'dark') {
  const doc = new DOMParser().parseFromString(diagram.variants[mode], 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg')
    throw new Error('The diagram could not open.');
  return cloneDiagramSvg(doc.documentElement as unknown as SVGSVGElement);
}

export function diagramSvgBlob(diagram: ViewerDiagram) {
  const svg = diagramSvgElement(diagram, diagramMode());
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(diagram.width));
  svg.setAttribute('height', String(diagram.height));
  svg.style.maxWidth = 'none';
  svg.style.background = 'transparent';
  return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
}

export function diagramFilename(diagram: ViewerDiagram) {
  return (
    (diagram.name
      .replace(/[^\p{L}\p{N}._ -]/gu, '')
      .trim()
      .slice(0, 80) || 'diagram') + '.svg'
  );
}
