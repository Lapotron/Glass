import { t } from '../shared/i18n.js';
function download(value: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type })),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function citationTools(scope: HTMLElement) {
  scope.querySelectorAll<HTMLButtonElement>('[data-article-action]').forEach((b) => {
    b.disabled = false;
  });
  const label = scope.querySelector<HTMLElement>('.article-citation-select'),
    select = scope.querySelector<HTMLSelectElement>('[data-citation-select]');
  if (!label || !select || select.dataset.ready) return;
  label.hidden = false;
  select.dataset.ready = 'true';
  const update = () =>
    scope.querySelectorAll<HTMLElement>('[data-citation]').forEach((el) => {
      el.hidden = el.dataset.citation !== select.value;
    });
  select.addEventListener('change', update);
  update();
}
function openArticleDialog(footer: HTMLElement, details: HTMLDetailsElement, trigger: HTMLElement) {
  if (document.querySelector('.article-action-dialog[open]')) return;
  const type = details.dataset.articleDialog!,
    dialog = document.createElement('dialog');
  dialog.className = 'article-action-dialog glass-panel';
  dialog.setAttribute('aria-label', type === 'qr' ? t("Article QR code") : t("Cite this article"));
  const content = details
    .querySelector<HTMLElement>('.article-aux-body')!
    .cloneNode(true) as HTMLElement;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button';
  close.setAttribute('aria-label', t("Close article tools"));
  close.textContent = '×';
  close.onclick = () => dialog.close();
  const status = document.createElement('p');
  status.className = 'article-action-status';
  status.dataset.articleStatus = '';
  status.setAttribute('role', 'status');
  dialog.append(close, content, status);
  citationTools(dialog);
  dialog.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-article-action]');
    if (button) void handleArticleAction(footer, button, dialog);
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
  dialog.addEventListener(
    'close',
    () => {
      dialog.remove();
      trigger.focus({ preventScroll: true });
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}
export async function handleArticleAction(
  footer: HTMLElement,
  trigger: HTMLElement,
  scope: HTMLElement = footer,
) {
  const action = trigger.dataset.articleAction,
    status =
      scope.querySelector<HTMLElement>('[data-article-status]') ||
      footer.querySelector<HTMLElement>('[data-article-status]');
  const say = (message: string) => {
    if (status) status.textContent = message;
  };
  if (footer.dataset.private || trigger.getAttribute('aria-busy') === 'true') return;
  if (trigger.tagName === 'SUMMARY') {
    const details = trigger.closest<HTMLDetailsElement>('[data-article-dialog]');
    if (details) openArticleDialog(footer, details, trigger);
    return;
  }
  const canonical = footer.dataset.canonical || '',
    title = footer.dataset.articleTitle || document.title,
    slug = (footer.dataset.articleSlug || 'article').replace(/[^a-z\d_-]/gi, '-');
  const copy = async (text: string) => {
    try {
      if (!navigator.clipboard) throw new Error(t("Clipboard unavailable"));
      await navigator.clipboard.writeText(text);
      say('Copied.');
    } catch {
      const more = footer.querySelector<HTMLDetailsElement>('.article-share-more');
      if (scope === footer && more) more.open = true;
      const details = footer.querySelector<HTMLDetailsElement>('.article-link-details');
      if (scope === footer && details) {
        details.open = true;
        const input = details.querySelector<HTMLInputElement>(
          action === 'short' ? '[aria-label="Short article link"]' : 'input',
        );
        input?.focus();
        input?.select();
      } else {
        const pre = scope.querySelector<HTMLElement>('[data-citation]:not([hidden]) pre');
        if (pre) {
          pre.focus();
          const range = document.createRange();
          range.selectNodeContents(pre);
          getSelection()?.removeAllRanges();
          getSelection()?.addRange(range);
        }
      }
      say('Clipboard is unavailable. Select and copy the text shown.');
    }
  };
  try {
    if (action === 'copy' || action === 'short')
      await copy(action === 'short' ? footer.dataset.shortlink || canonical : canonical);
    else if (action === 'share') {
      if (navigator.share) {
        try {
          await navigator.share({ title, url: canonical });
          say('Article shared.');
        } catch (e) {
          if ((e as Error).name !== 'AbortError') await copy(canonical);
        }
      } else {
        await copy(canonical);
        if (status?.textContent === 'Copied.')
          say('Sharing is unavailable on this device. Article link copied.');
      }
    } else if (action === 'print') {
      trigger.setAttribute('aria-busy', 'true');
      const images = [
        ...document.querySelectorAll<HTMLImageElement>(
          '.article-body img, .article-cover-figure img',
        ),
      ];
      images.forEach((image) => {
        image.loading = 'eager';
      });
      try {
        await Promise.race([
          Promise.allSettled([document.fonts.ready, ...images.map((image) => image.decode())]),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
        window.print();
      } finally {
        trigger.removeAttribute('aria-busy');
      }
    } else if (action === 'annotations') {
      const tab = document.getElementById('article-annotations-tab') as HTMLButtonElement | null;
      if (tab && !tab.disabled) tab.click();
      const panel = document.getElementById('article-annotations');
      if (panel) {
        panel.hidden = false;
        panel.scrollIntoView({ block: 'start' });
      }
    } else if (action === 'download-qr') {
      const svg = scope.querySelector<SVGElement>('.article-qr svg');
      if (svg)
        download(
          new XMLSerializer().serializeToString(svg),
          `${slug}-qr.svg`,
          'image/svg+xml;charset=utf-8',
        );
    } else if (action === 'copy-cite' || action === 'download-cite') {
      const format =
        scope.querySelector<HTMLSelectElement>('[data-citation-select]')?.value || 'plain';
      const text =
        scope.querySelector<HTMLElement>(`[data-citation="${format}"] pre`)?.textContent || '';
      if (action === 'copy-cite') await copy(text);
      else
        download(
          text + '\n',
          `${slug}.${format === 'bibtex' ? 'bib' : format === 'ris' ? 'ris' : 'txt'}`,
          format === 'ris'
            ? 'application/x-research-info-systems;charset=utf-8'
            : 'text/plain;charset=utf-8',
        );
    }
  } catch {
    say('This action could not finish. The article link and citation text remain available below.');
  }
}
