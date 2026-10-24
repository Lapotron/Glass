import { cameraLabels, formatBytes, type ImageDetails } from './media-details.js';
import type { ViewerImage } from './image-viewer.js';
import { publicImageDetails } from './public-media-details.js';
import { publicImageUrl as safeUrl, type ViewerImageSources } from './viewer-image-source.js';
import { t } from './i18n.js';
import { diagramSvgBlob, diagramFilename } from './diagram-svg.js';
export type ViewerTools = { change(): void; ready(): void; escape(): boolean; destroy(): void };
export function installViewerTools(
  dialog: HTMLDialogElement,
  toolbar: HTMLElement,
  images: ViewerImage[],
  current: () => number,
  layout: () => void,
  sources: ViewerImageSources,
): ViewerTools {
  const surface = dialog.querySelector<HTMLElement>('.viewer-viewport') || dialog;
  const diagrams = !!images[current()]?.diagram;
  const imageDetails = async (
    image: ViewerImage,
    signal: AbortSignal,
  ): Promise<Partial<ImageDetails>> =>
    image.diagram
      ? {
          name: diagramFilename(image.diagram),
          displayName: image.diagram.name,
          url: image.src,
          width: image.width,
          height: image.height,
          format: 'SVG',
          bytes: diagramSvgBlob(image.diagram).size,
          camera: {},
        }
      : image.loadDetails
        ? image.loadDetails(signal)
        : publicImageDetails(image);
  let generation = 0,
    controller: AbortController | undefined,
    downloading = false,
    destroyed = false;
  let ownsFullscreen = false;
  const panel = document.createElement('aside');
  panel.className = 'viewer-information glass-panel';
  panel.hidden = true;
  panel.dataset.viewerInfo = '';
  panel.id = 'viewer-image-information';
  panel.setAttribute('aria-label', diagrams ? t('Diagram information') : 'Image information');
  const heading = document.createElement('div');
  heading.className = 'viewer-information-heading';
  const title = document.createElement('h2');
  title.textContent = diagrams ? t('Diagram information') : 'Image information';
  heading.append(title);
  const content = document.createElement('div');
  content.className = 'viewer-information-body';
  content.tabIndex = 0;
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', diagrams ? t('Diagram details') : 'Image details');
  const notice = document.createElement('p');
  notice.className = 'viewer-action-status';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  const more = document.createElement('div');
  more.className = 'viewer-more glass';
  more.hidden = true;
  more.dataset.viewerMore = '';
  more.id = 'viewer-more-actions';
  more.setAttribute('role', 'group');
  more.setAttribute('aria-label', diagrams ? t('More diagram actions') : 'More image actions');
  const makeButton = (label: string, path: string, action: () => void, parent: HTMLElement) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      path +
      '</svg>';
    button.addEventListener('click', action);
    parent.append(button);
    return button;
  };
  const say = (message: string) => {
    notice.textContent = message;
    notice.hidden = !message;
  };
  const setMore = (open: boolean) => {
    more.hidden = !open;
    overflow.setAttribute('aria-expanded', String(open));
  };
  const closeInfo = () => {
    panel.hidden = true;
    info.setAttribute('aria-expanded', 'false');
    delete dialog.dataset.infoOpen;
    layout();
  };
  const renderDetails = async () => {
    controller?.abort();
    controller = new AbortController();
    const ticket = ++generation,
      image = images[current()];
    content.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'help';
    loading.setAttribute('role', 'status');
    loading.textContent = diagrams
      ? t('Loading diagram information…')
      : 'Loading image information…';
    content.append(loading);
    try {
      const details = await imageDetails(image, controller.signal);
      if (destroyed || ticket !== generation) return;
      const dl = document.createElement('dl');
      dl.className = 'viewer-facts';
      const row = (label: string, value: string) => {
        const dt = document.createElement('dt'),
          dd = document.createElement('dd');
        dt.textContent = label;
        dd.textContent = value;
        dl.append(dt, dd);
      };
      if (details.displayName) row('Name', details.displayName);
      if (details.name) row('File', details.name);
      if (details.width || image.width)
        row(
          'Dimensions',
          (details.width || image.width) +
            ' × ' +
            (details.height || image.height) +
            (image.diagram ? ' ' + t('SVG units') : ' px'),
        );
      if (details.format) row('Format', details.format);
      if (details.bytes) row('File size', formatBytes(details.bytes));
      for (const [key, label] of Object.entries(cameraLabels)) {
        const value = details.camera?.[key as keyof typeof cameraLabels];
        if (typeof value === 'string') row(label, value);
      }
      content.replaceChildren(dl);
      if (image.caption || image.alt) {
        const caption = document.createElement('p');
        caption.className = 'viewer-information-caption';
        caption.textContent = image.caption || image.alt || '';
        content.append(caption);
      }
      if (!image.diagram && !Object.keys(details.camera || {}).length) {
        const empty = document.createElement('p');
        empty.className = 'help';
        empty.textContent = 'No camera information shared for this image.';
        content.append(empty);
      }
      if (image.originalSrc) {
        const original = document.createElement('a');
        original.className = 'button secondary small';
        original.textContent = 'Download original';
        original.href = safeUrl(image.originalSrc).href;
        content.append(original);
      }
    } catch (error) {
      if (destroyed || ticket !== generation || controller.signal.aborted) return;
      const message = document.createElement('p');
      message.className = 'help';
      message.textContent = (error as Error).message;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'button secondary small';
      retry.textContent = 'Retry information';
      retry.addEventListener('click', () => void renderDetails());
      content.replaceChildren(message, retry);
    } finally {
      if (!destroyed && ticket === generation) layout();
    }
  };
  const extras = document.createElement('span');
  extras.className = 'viewer-extra-controls';
  const info = makeButton(
    diagrams ? t('Diagram information') : 'Image information',
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    () => {
      if (!panel.hidden) closeInfo();
      else {
        setMore(false);
        panel.hidden = false;
        dialog.dataset.infoOpen = 'true';
        info.setAttribute('aria-expanded', 'true');
        layout();
        void renderDetails();
      }
    },
    extras,
  );
  info.setAttribute('aria-expanded', 'false');
  info.setAttribute('aria-controls', panel.id);
  const download = makeButton(
    diagrams ? t('Download SVG') : 'Download image',
    '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    () => {
      if (downloading) return;
      const image = images[current()];
      const imageIndex = current();
      downloading = true;
      download.disabled = true;
      say('Preparing download…');
      const task = async () => {
        if (image.diagram) {
          const blobUrl = URL.createObjectURL(diagramSvgBlob(image.diagram));
          const anchor = document.createElement('a');
          anchor.href = blobUrl;
          anchor.download = diagramFilename(image.diagram);
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
          return;
        }
        const url = safeUrl(image.src);
        const details = await (
          image.loadDetails
            ? image.loadDetails(new AbortController().signal)
            : publicImageDetails(image)
        ).catch(() => ({}) as Partial<import('./media-details.js').ImageDetails>);
        if (destroyed) return;
        if (url.origin === location.origin && /\.svg$/i.test(url.pathname)) {
          const anchor = document.createElement('a');
          anchor.href = url.href;
          anchor.download =
            details.downloadName ||
            decodeURIComponent(url.pathname.split('/').at(-1) || 'image.svg');
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          return;
        }
        const lease = sources.acquire(image);
        try {
          const resource = await lease.value;
          if (destroyed) return;
          // A separate URL lets a download finish if the viewer closes immediately.
          const blobUrl = URL.createObjectURL(resource.blob);
          const anchor = document.createElement('a');
          anchor.href = blobUrl;
          anchor.download = details.downloadName || resource.name;
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        } finally {
          lease.release();
        }
      };
      void task()
        .then(() => {
          if (!destroyed && current() === imageIndex) say('Download started.');
        })
        .catch((error) => {
          if (destroyed || current() !== imageIndex) return;
          say((error as Error).message);
          try {
            const link = document.createElement('a');
            link.href = safeUrl(image.src).href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'Open image';
            notice.append(' ', link);
          } catch {}
        })
        .finally(() => {
          downloading = false;
          if (!destroyed) download.disabled = false;
        });
    },
    extras,
  );
  const copy = makeButton(
    diagrams ? t('Copy diagram link') : 'Copy image link',
    '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    () => {
      void (async () => {
        try {
          const image = images[current()];
          if (image.diagram) {
            if (!image.diagram.permalink) throw new Error('No public diagram link.');
            await navigator.clipboard.writeText(safeUrl(image.diagram.permalink).href);
            say(t('Diagram link copied.'));
            return;
          }
          const details = await (
            image.loadDetails
              ? image.loadDetails(new AbortController().signal)
              : publicImageDetails(image)
          ).catch(() => ({}) as Partial<import('./media-details.js').ImageDetails>);
          await navigator.clipboard.writeText(
            safeUrl((!image.loadDetails && details.shortUrl) || image.src).href,
          );
          say('Image link copied.');
        } catch {
          say('The link could not be copied in this browser.');
        }
      })();
    },
    more,
  );
  const fullscreen = makeButton(
    'Enter fullscreen',
    '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    () => {
      setMore(false);
      const task = document.fullscreenElement
        ? document.exitFullscreen()
        : surface.requestFullscreen();
      void task
        .then(() => {
          ownsFullscreen = !!document.fullscreenElement;
        })
        .catch(() => say('Fullscreen is unavailable in this browser.'));
    },
    more,
  );
  fullscreen.hidden = !document.fullscreenEnabled;
  const overflow = makeButton(
    diagrams ? t('More diagram actions') : 'More image actions',
    '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    () => setMore(!!more.hidden),
    extras,
  );
  overflow.setAttribute('aria-expanded', 'false');
  overflow.setAttribute('aria-controls', more.id);
  toolbar.insertBefore(extras, toolbar.lastElementChild);
  const close = makeButton(
    diagrams ? t('Close diagram information') : 'Close image information',
    '<path d="m6 6 12 12M6 18 18 6"/>',
    () => {
      closeInfo();
      info.focus();
    },
    heading,
  );
  close.classList.add('viewer-info-close');
  panel.append(heading, content);
  surface.append(panel, more, notice);
  const compactActions = toolbar.querySelectorAll<HTMLButtonElement>(':scope > button');
  compactActions.forEach((button) => {
    if (
      button.getAttribute('aria-label') === 'Close image viewer' ||
      button.getAttribute('aria-label') === t('Close diagram viewer')
    )
      return;
    const duplicate = document.createElement('button');
    duplicate.type = 'button';
    duplicate.className = 'viewer-menu-action';
    duplicate.textContent = button.getAttribute('aria-label');
    duplicate.addEventListener('click', () => {
      button.click();
      setMore(false);
      overflow.focus();
    });
    more.append(duplicate);
    button.classList.add('viewer-zoom-control');
  });
  [copy, fullscreen].forEach((button) => {
    const text = document.createElement('span');
    text.textContent = button.getAttribute('aria-label');
    button.append(text);
    button.classList.add('viewer-menu-action');
  });
  const fullscreenChanged = () => {
    const label = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreen.title = label;
    fullscreen.setAttribute('aria-label', label);
    fullscreen.querySelector('span')!.textContent = label;
    layout();
  };
  document.addEventListener('fullscreenchange', fullscreenChanged);
  const resize = new ResizeObserver(() => {
    if (!panel.hidden) layout();
  });
  resize.observe(panel);
  return {
    change() {
      copy.hidden = diagrams && !images[current()]?.diagram?.permalink;
      controller?.abort();
      ++generation;
      say('');
      setMore(false);
      if (!panel.hidden) void renderDetails();
    },
    ready() {
      [info, download, overflow, copy, fullscreen].forEach((button) => (button.disabled = false));
    },
    escape() {
      if (!more.hidden) {
        setMore(false);
        overflow.focus();
        return true;
      }
      if (!panel.hidden) {
        closeInfo();
        info.focus();
        return true;
      }
      return false;
    },
    destroy() {
      destroyed = true;
      ++generation;
      controller?.abort();
      resize.disconnect();
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      panel.remove();
      more.remove();
      notice.remove();
      if (ownsFullscreen && document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
    },
  };
}
