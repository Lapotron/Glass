import { t, setUiText, uiAttrs } from './i18n.js';
import { openImageViewer, type ViewerImage } from './image-viewer.js';
import { diagramTitle } from './diagram-title.js';

type DiagramOptions = { publicLinks?: boolean; control?: boolean; trigger?: HTMLElement };
export async function openDiagramViewer(
  figure: HTMLElement,
  options: DiagramOptions = {},
  figures = [figure],
) {
  const { diagramFromFigure } = await import('./diagram-svg.js');
  const images: ViewerImage[] = figures.map((node) => {
    let permalink: string | undefined;
    if (options.publicLinks && document.documentElement.dataset.preview !== 'true') {
      const url = new URL(
        document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || location.href,
      );
      url.hash = node.id;
      permalink = url.href;
    }
    const diagram = diagramFromFigure(node, permalink);
    return {
      src: permalink || '',
      diagram,
      width: diagram.width,
      height: diagram.height,
      alt: diagram.name,
      caption: diagram.name === 'Diagram' ? '' : diagram.name,
    };
  });
  return openImageViewer(
    images,
    Math.max(0, figures.indexOf(figure)),
    options.trigger || figure.querySelector<HTMLElement>('.diagram-view') || figure,
  );
}

/** Scope the gallery to its article; single source-preview roots intentionally contain one diagram. */
export function registerDiagramViewers(root: ParentNode, options: DiagramOptions = {}) {
  const disposers: (() => void)[] = [];
  const figures = [...root.querySelectorAll<HTMLElement>('figure[data-mermaid]')];
  for (const figure of figures) {
    if (figure.dataset.viewerReady) continue;
    const canvas = figure.querySelector<HTMLElement>('.mermaid-canvas');
    if (!canvas) continue;
    figure.dataset.viewerReady = 'true';
    const drawing = figure.querySelector<SVGSVGElement>('.mermaid-canvas svg');
    const title = drawing ? diagramTitle(drawing) : '';
    if (title && !figure.querySelector('figcaption')) {
      const caption = document.createElement('figcaption');
      caption.textContent = title;
      figure.insertBefore(caption, canvas.nextSibling);
      disposers.push(() => caption.remove());
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'diagram-view glass';
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
    const label = document.createElement('span');
    setUiText(label, 'View diagram');
    button.append(label);
    for (const [key, value] of Object.entries(
      uiAttrs({ 'aria-label': 'View diagram: {value0}' }, { value0: title || t('Diagram') }),
    ))
      button.setAttribute(key, value);
    const open = () => {
      void openDiagramViewer(
        figure,
        { ...options, trigger: options.trigger || button },
        figures,
      ).catch((error) => {
        button.title = (error as Error).message;
      });
    };
    const click = (event: MouseEvent) => {
      if (
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        (event.target as Element).closest('a,button') ||
        window.getSelection()?.toString()
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      open();
    };
    button.addEventListener('click', open);
    canvas.addEventListener('click', click);
    if (options.control !== false) figure.append(button);
    disposers.push(() => {
      delete figure.dataset.viewerReady;
      canvas.removeEventListener('click', click);
      button.remove();
    });
  }
  return () => disposers.forEach((dispose) => dispose());
}
