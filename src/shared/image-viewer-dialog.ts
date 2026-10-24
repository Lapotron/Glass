import { t } from './i18n.js';
import PhotoSwipe from 'photoswipe';
import { installViewerTools, type ViewerTools } from './viewer-tools.js';
import type { ViewerImage } from './image-viewer.js';
import { ViewerImageSources } from './viewer-image-source.js';
import { diagramSvgElement } from './diagram-svg.js';
const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
let opening = false;
export async function openImageViewer(
  images: ViewerImage[],
  index = 0,
  trigger?: HTMLElement,
  shell?: HTMLDialogElement,
  initialQueued = 0,
) {
  if (!images.length || opening || (document.querySelector('dialog.media-viewer[open]') && !shell))
    return;
  opening = true;
  // Safari does not focus buttons on pointer activation. Keep the explicit opener.
  const focus = trigger || (document.activeElement as HTMLElement | null);
  const restoreFocus = () => {
    if (focus?.isConnected) focus.focus({ preventScroll: true });
  };
  const dialog = shell || document.createElement('dialog');
  const diagramSession = !!images[index]?.diagram;
  const closeLabel = diagramSession ? t('Close diagram viewer') : 'Close image viewer';
  const sources = new ViewerImageSources();
  let dimensionLease: ReturnType<ViewerImageSources['acquire']> | undefined;
  dialog.className = 'media-viewer';
  dialog.dataset.viewerKind = diagramSession ? 'diagram' : 'image';
  dialog.setAttribute('aria-label', diagramSession ? t('Diagram viewer') : t('Image viewer'));
  let tools: ViewerTools | undefined;
  let navigate: ((delta: number) => void) | undefined;
  let queued = initialQueued,
    cancelled = false;
  let dismiss = () => {
    cancelled = true;
    sources.destroy();
    dialog.close();
    dialog.remove();
    restoreFocus();
  };
  dialog.setAttribute('aria-busy', 'true');
  const loading = document.createElement('p');
  loading.className = 'viewer-loading';
  loading.setAttribute('role', 'status');
  loading.textContent = diagramSession ? t('Opening diagram…') : t('Opening image…');
  dialog.replaceChildren(loading);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (tools?.escape()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (
      (event.target instanceof Element &&
        !!event.target.closest(
          '[data-viewer-info], [data-viewer-more], input, textarea, select',
        )) ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      !['ArrowLeft', 'ArrowRight'].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    if (navigate) navigate(delta);
    else queued += delta;
  });
  if (!dialog.isConnected) document.body.append(dialog);
  if (!dialog.open) dialog.showModal();
  try {
    if (cancelled) return;
    const active = images[index];
    if (!active.diagram && (!active.width || !active.height)) {
      const img = new Image();
      try {
        dimensionLease = sources.acquire(active);
      } catch {}
      img.src = dimensionLease
        ? await dimensionLease.value.then((value) => value.url).catch(() => active.src)
        : active.src;
      if (cancelled) return;
      await img.decode();
      active.width = img.naturalWidth;
      active.height = img.naturalHeight;
    }
    if (cancelled) return;
    const surface = document.createElement('div');
    surface.className = 'viewer-viewport';
    dialog.replaceChildren(surface);
    const reduced =
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.reduceMotion === 'true';
    const pswp = new PhotoSwipe({
      dataSource: images.map((i) => ({
        ...i,
        type: i.diagram ? 'diagram' : 'image',
        srcset:
          i.srcset && i.width
            ? [
                ...i.srcset
                  .split(',')
                  .map((candidate) => candidate.trim())
                  .filter((candidate) => Number(candidate.match(/ (\d+)w$/)?.[1]) < i.width!),
                `${i.src} ${i.width}w`,
              ].join(', ')
            : undefined,
        width: i.width || 1600,
        height: i.height || 1000,
      })),
      index,
      appendToEl: surface,
      bgOpacity: 0.96,
      trapFocus: false,
      returnFocus: false,
      escKey: false,
      close: false,
      zoom: false,
      counter: false,
      arrowPrev: false,
      arrowNext: false,
      showAnimationDuration: reduced ? 0 : 280,
      hideAnimationDuration: reduced ? 0 : 220,
      zoomAnimationDuration: reduced ? 0 : 220,
      preload: [1, 1],
      ...(diagramSession
        ? {
            maxZoomLevel: (level: { fit: number }) => Math.max(2, level.fit * 8),
            secondaryZoomLevel: (level: { fit: number }) => Math.max(1, level.fit * 2.5),
          }
        : {}),
      padding: { top: 86, bottom: 100, left: 16, right: 16 },
      errorMsg: 'The image could not load. Close the viewer and try again.',
    });
    let toolbar: HTMLElement;
    let caption: HTMLElement;
    const button = (label: string, paths: string, action: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-button';
      b.disabled = label !== closeLabel;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.innerHTML = icon(paths);
      b.addEventListener('click', action);
      return b;
    };
    pswp.on('uiRegister', () => {
      pswp.ui!.registerElement({
        name: 'blog-toolbar',
        appendTo: 'root',
        onInit: (el) => {
          toolbar = el;
          el.className = 'viewer-toolbar glass';
          el.setAttribute('role', 'toolbar');
          el.setAttribute(
            'aria-label',
            diagramSession ? t('Diagram controls') : t('Image controls'),
          );
          const count = document.createElement('span');
          count.className = 'viewer-count';
          el.append(count);
          el.append(
            button('Zoom out', '<path d="M5 12h14"/>', () => {
              if (pswp.currSlide)
                pswp.zoomTo(
                  Math.max(pswp.currSlide.zoomLevels.fit, pswp.currSlide.currZoomLevel / 1.5),
                  undefined,
                  reduced ? 0 : 200,
                );
            }),
          );
          el.append(
            button('Zoom in', '<path d="M5 12h14M12 5v14"/>', () => {
              if (pswp.currSlide)
                pswp.zoomTo(
                  Math.min(pswp.currSlide.zoomLevels.max, pswp.currSlide.currZoomLevel * 1.5),
                  undefined,
                  reduced ? 0 : 200,
                );
            }),
          );
          el.append(
            button(
              diagramSession ? t('Fit diagram') : 'Fit image',
              '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
              () => {
                if (pswp.currSlide)
                  pswp.zoomTo(pswp.currSlide.zoomLevels.fit, undefined, reduced ? 0 : 200);
              },
            ),
          );
          el.append(
            button(
              'Actual size',
              '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 9h1v6m3-6h1v6"/>',
              () => pswp.zoomTo(1, undefined, reduced ? 0 : 200),
            ),
          );
          el.append(button(closeLabel, '<path d="m6 6 12 12M6 18 18 6"/>', () => dismiss()));
          tools = installViewerTools(
            dialog,
            el,
            images,
            () => pswp.currIndex,
            () => {
              requestAnimationFrame(() => {
                if (!dialog.isConnected) return;
                const panel = dialog.querySelector<HTMLElement>('.viewer-information');
                const open = panel && !panel.hidden;
                pswp.options.padding = {
                  top: 86,
                  bottom:
                    open && matchMedia('(max-width: 600px)').matches
                      ? panel.getBoundingClientRect().height + 100
                      : 100,
                  left: 16,
                  right:
                    open && !matchMedia('(max-width: 600px)').matches
                      ? panel.getBoundingClientRect().width + 32
                      : 16,
                };
                pswp.updateSize(true);
              });
            },
            sources,
          );
        },
      });
      pswp.ui!.registerElement({
        name: 'blog-caption',
        appendTo: 'root',
        onInit: (el) => {
          caption = el;
          el.className = 'viewer-caption';
          el.setAttribute('aria-live', 'polite');
        },
      });
      pswp.ui!.registerElement({
        name: 'blog-navigation',
        appendTo: 'root',
        onInit: (el) => {
          el.className = 'viewer-navigation glass';
          el.setAttribute('role', 'group');
          el.setAttribute(
            'aria-label',
            diagramSession ? t('Diagram navigation') : t('Image navigation'),
          );
          el.append(
            button(
              diagramSession ? t('Previous diagram') : 'Previous image',
              '<path d="m14 6-6 6 6 6"/>',
              () => pswp.prev(),
            ),
            button(
              diagramSession ? t('Next diagram') : 'Next image',
              '<path d="m10 6 6 6-6 6"/>',
              () => pswp.next(),
            ),
          );
          el.hidden = images.length < 2;
        },
      });
    });
    const update = () => {
      if (toolbar)
        toolbar.querySelector('.viewer-count')!.textContent = t('{value0} / {value1}', {
          value0: pswp.currIndex + 1,
          value1: images.length,
        });
      tools?.change();
      if (caption)
        caption.textContent = images[pswp.currIndex].caption || images[pswp.currIndex].alt || '';
    };
    let ready = false,
      closing = false;
    const step = (delta: number) =>
      pswp.goTo((pswp.currIndex + delta + images.length) % images.length);
    pswp.on('openingAnimationEnd', () => {
      ready = true;
      dialog.setAttribute('aria-busy', 'false');
      if (queued) {
        step(queued);
        queued = 0;
      }
      dialog.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        b.disabled = false;
      });
      tools?.ready();
      if (closing) queueMicrotask(() => pswp.close());
    });
    navigate = (delta) => {
      if (ready) step(delta);
      else queued += delta;
    };
    pswp.on('keydown', (event) => {
      if (['Tab', 'Escape'].includes(event.originalEvent.key)) event.preventDefault();
    });
    pswp.on('change', update);
    type Content = NonNullable<PhotoSwipe['currSlide']>['content'];
    const loading = new Map<Content, ReturnType<ViewerImageSources['acquire']>>();
    const resolved = new WeakSet<Content>();
    pswp.addFilter(
      'isContentZoomable',
      (zoomable, content) => content.type === 'diagram' || zoomable,
    );
    pswp.on('contentLoad', (event) => {
      const diagram = images[event.content.index]?.diagram;
      if (!diagram) return;
      event.preventDefault();
      try {
        const host = document.createElement('div');
        host.className = 'pswp__img viewer-diagram';
        host.dataset.diagramIndex = String(event.content.index);
        for (const mode of ['light', 'dark'] as const) {
          const variant = document.createElement('div');
          variant.dataset.diagramVariant = mode;
          const svg = diagramSvgElement(diagram, mode);
          svg.style.width = '100%';
          svg.style.height = '100%';
          svg.style.maxWidth = 'none';
          variant.append(svg);
          host.append(variant);
        }
        event.content.element = host;
        event.content.onLoaded();
      } catch {
        event.content.onError();
      }
    });
    pswp.on('contentLoadImage', (event) => {
      const { content, isLazy } = event;
      if (images[content.index]?.diagram) return;
      if (resolved.has(content)) return;
      if (loading.has(content)) {
        event.preventDefault();
        return;
      }
      let lease: ReturnType<ViewerImageSources['acquire']>;
      try {
        lease = sources.acquire(images[content.index]);
      } catch {
        return;
      }
      event.preventDefault();
      loading.set(content, lease);
      content.state = 'loading';
      void lease.value
        .then((resource) => {
          if (!loading.has(content) || !dialog.isConnected) return;
          content.data.src = resource.url;
          content.data.srcset = undefined;
        })
        .catch(() => {
          // External images without CORS can still display through the native loader.
          content.data.src = images[content.index].src;
          content.data.srcset = undefined;
        })
        .finally(() => {
          if (!loading.has(content) || !dialog.isConnected) return;
          resolved.add(content);
          content.loadImage(isLazy);
        });
    });
    pswp.on('contentDestroy', ({ content }) => {
      loading.get(content)?.release();
      loading.delete(content);
    });
    pswp.on('loadComplete', ({ content }) => {
      const img = content.element as HTMLImageElement | undefined;
      const data = content.data;
      if (img?.naturalWidth && !images[content.index]?.width) {
        images[content.index].width = data.width = img.naturalWidth;
        images[content.index].height = data.height = img.naturalHeight;
        pswp.refreshSlideContent(content.index);
      }
    });
    const close = () => {
      if (ready) pswp.close();
      else closing = true;
    };
    dismiss = close;
    dialog.addEventListener('close', close);
    pswp.on('destroy', () => {
      tools?.destroy();
      sources.destroy();
      dialog.removeEventListener('close', close);
      dialog.close();
      dialog.remove();
      restoreFocus();
    });
    pswp.init();
    pswp.element?.setAttribute('role', 'presentation');
    pswp.element?.removeAttribute('aria-modal');
    pswp.element?.removeAttribute('aria-label');
    update();
    toolbar!.querySelector<HTMLButtonElement>(':scope > button:last-child')?.focus();
  } catch {
    tools?.destroy();
    sources.destroy();
    dialog.innerHTML =
      '<div class="viewer-error"><p></p><button class="button secondary" type="button">Close viewer</button></div>';
    dialog.querySelector('p')!.textContent = diagramSession
      ? t('This diagram could not open. Close the viewer to return to its inline drawing.')
      : 'This image could not load.';
    const close = () => {
      dialog.close();
      dialog.remove();
      restoreFocus();
    };
    dialog.querySelector('button')!.addEventListener('click', close);
    dialog.addEventListener('cancel', close, { once: true });
  } finally {
    dimensionLease?.release();
    opening = false;
  }
}
