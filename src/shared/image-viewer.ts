import { t } from './i18n.js';
import type { ImageDetails } from './media-details.js';
import type { ViewerDiagram } from './diagram-svg.js';
import './image-viewer.css';
export type ViewerImage = {
  src: string;
  canonicalSrc?: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
  srcset?: string;
  loadDetails?: (signal: AbortSignal) => Promise<ImageDetails>;
  originalSrc?: string;
  diagram?: ViewerDiagram;
};
let opening = false;
export async function openImageViewer(images: ViewerImage[], index = 0, trigger?: HTMLElement) {
  if (!images.length || opening || document.querySelector('dialog.media-viewer[open]')) return;
  opening = true;
  const focus = trigger || (document.activeElement as HTMLElement | null);
  const dialog = document.createElement('dialog');
  dialog.className = 'media-viewer';
  dialog.dataset.viewerKind = images[index]?.diagram ? 'diagram' : 'image';
  dialog.setAttribute(
    'aria-label',
    images[index]?.diagram ? t('Diagram viewer') : t('Image viewer'),
  );
  dialog.setAttribute('aria-busy', 'true');
  const loading = document.createElement('p');
  loading.className = 'viewer-loading';
  loading.setAttribute('role', 'status');
  loading.textContent = images[index]?.diagram ? t('Opening diagram…') : t('Opening image…');
  dialog.append(loading);
  const close = () => {
    opening = false;
    dialog.close();
    dialog.remove();
    focus?.focus({ preventScroll: true });
  };
  const cancel = (event: Event) => {
    event.preventDefault();
    close();
  };
  let queued = 0;
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      queued += event.key === 'ArrowRight' ? 1 : -1;
    }
  };
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('keydown', keydown);
  document.body.append(dialog);
  dialog.showModal();
  try {
    const viewer = await import('./image-viewer-dialog.js');
    if (!dialog.isConnected) return;
    dialog.removeEventListener('cancel', cancel);
    dialog.removeEventListener('keydown', keydown);
    await viewer.openImageViewer(images, index, focus || undefined, dialog, queued);
  } catch {
    if (dialog.isConnected) {
      dialog.removeAttribute('aria-busy');
      dialog.innerHTML =
        '<div class="viewer-error"><p></p><button type="button" class="button secondary">Close viewer</button></div>';
      dialog.querySelector('p')!.textContent = images[index]?.diagram
        ? t('This diagram could not open. Close the viewer to return to its inline drawing.')
        : 'This image could not load.';
      const button = dialog.querySelector('button')!;
      button.addEventListener('click', close);
      button.focus();
    }
  } finally {
    opening = false;
  }
}
export function startImageViewers() {
  const nodes = [
    ...document.querySelectorAll<HTMLElement>('[data-photo], [data-view-image], .article-body img'),
  ].filter(
    (el) =>
      !el.closest('[data-interactive], .diagram') && !(el.tagName === 'IMG' && el.closest('a')),
  );
  const groups = new Map<string, { node: HTMLElement; image: ViewerImage }[]>();
  nodes.forEach((node) => {
    const photo = node.dataset.photo ? JSON.parse(node.dataset.photo) : null;
    const img = node.tagName === 'IMG' ? (node as HTMLImageElement) : node.querySelector('img');
    const group = node.closest('.article-body') ? 'article' : photo ? 'life' : 'chapters';
    const image = {
      src: photo?.src || node.dataset.viewImage || img?.src || '',
      canonicalSrc: node.dataset.mediaSource || img?.dataset.mediaSource,
      alt: photo?.alt || img?.alt || '',
      caption:
        photo?.caption ||
        node.dataset.viewCaption ||
        node.closest('figure')?.querySelector('figcaption')?.textContent ||
        img?.alt ||
        '',
      width: Number(img?.getAttribute('width')) || img?.naturalWidth,
      height: Number(img?.getAttribute('height')) || img?.naturalHeight,
      srcset: img?.srcset,
    };
    const list = groups.get(group) || [];
    list.push({ node, image });
    groups.set(group, list);
    if (node.tagName === 'IMG') {
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute(
        'aria-label',
        t('View image: {value0}', { value0: image.alt || 'article image' }),
      );
    }
    const open = (event?: Event) => {
      if (
        event instanceof MouseEvent &&
        (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      )
        return;
      event?.preventDefault();
      void openImageViewer(
        list.map((v) => v.image),
        list.findIndex((v) => v.node === node),
        node,
      );
    };
    node.addEventListener('click', open);
    node.addEventListener('keydown', (event) => {
      if (node.tagName === 'IMG' && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        open();
      }
    });
  });
}
