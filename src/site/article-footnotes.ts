import { setUiText } from '../shared/i18n.js';
import { articleMargin, marginTop, noteLabel } from './article-margin.js';

/** Footnotes are local rendered content, independent of provider loading. */
export function startArticleFootnotes(article: HTMLElement) {
  const refs = [...article.querySelectorAll<HTMLAnchorElement>('a[data-footnote-ref]')];
  if (!refs.length) return;
  const rail = articleMargin(article);
  const popup = document.createElement('div');
  popup.className = 'article-footnote-popover glass';
  popup.id = 'article-footnote-preview';
  popup.setAttribute('popover', 'auto');
  popup.setAttribute('role', 'dialog');
  noteLabel(popup, 'Footnote preview');
  const header = document.createElement('div');
  header.className = 'article-footnote-heading';
  const title = document.createElement('strong');
  const close = document.createElement('button');
  close.className = 'article-note-close';
  close.type = 'button';
  close.textContent = '×';
  noteLabel(close, 'Close footnote');
  header.append(title, close);
  const content = document.createElement('div');
  content.className = 'article-footnote-content prose';
  const endnote = document.createElement('a');
  endnote.className = 'article-footnote-endnote';
  setUiText(endnote, 'Read endnote');
  popup.append(header, content, endnote);
  document.body.append(popup);
  const native = typeof popup.showPopover === 'function';
  if (!native) popup.removeAttribute('popover');
  let current: HTMLAnchorElement | undefined;
  let opener: HTMLElement | undefined;
  let pinned = false;
  let returningFocus = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  const open = () => (native ? popup.matches(':popover-open') : popup.hasAttribute('data-open'));
  const expanded = (value: boolean) => {
    current?.setAttribute('aria-expanded', String(value));
    opener?.setAttribute('aria-expanded', String(value));
  };
  const hide = (focus = false) => {
    clearTimeout(timer);
    returningFocus = true;
    expanded(false);
    if (native && open()) popup.hidePopover();
    else popup.removeAttribute('data-open');
    pinned = false;
    if (focus)
      (opener?.isConnected && !opener.hidden ? opener : current)?.focus({ preventScroll: true });
    queueMicrotask(() => {
      returningFocus = false;
    });
  };
  const leave = () => {
    clearTimeout(timer);
    if (!pinned) timer = setTimeout(() => hide(), 200);
  };
  const stay = () => clearTimeout(timer);
  article
    .closest('.article-shell')
    ?.querySelector('.article-margin-rail')
    ?.addEventListener('glass:notes-fold', () => hide());
  close.addEventListener('click', () => hide(true));
  popup.addEventListener('pointerenter', stay);
  popup.addEventListener('pointerleave', leave);
  popup.addEventListener('focusin', stay);
  popup.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Node) || !popup.contains(event.relatedTarget)) leave();
  });
  popup.addEventListener('toggle', () => {
    if (!open()) {
      expanded(false);
      pinned = false;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open()) {
      event.preventDefault();
      event.stopPropagation();
      hide(true);
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!native && open() && !popup.contains(event.target as Node) && event.target !== opener)
      hide();
  });
  endnote.addEventListener('click', () => hide());
  const position = () => {
    frame = 0;
    if (!open() || !current) return;
    const rect = current.getBoundingClientRect();
    if (!rect.height || rect.bottom < 0 || rect.top > innerHeight) {
      hide();
      return;
    }
    if (innerWidth <= 700) return;
    const bounds = popup.getBoundingClientRect();
    const edge = article.getBoundingClientRect().right + 62;
    const x = innerWidth - edge >= bounds.width + 12 ? edge : edge - bounds.width - 56;
    popup.style.left = `${Math.max(12, Math.min(x, innerWidth - bounds.width - 12))}px`;
    popup.style.top = `${Math.max(marginTop(), Math.min(rect.top - 12, innerHeight - bounds.height - 16))}px`;
  };
  const schedule = () => {
    if (!frame && open()) frame = requestAnimationFrame(position);
  };
  let sequence = 0;
  function show(ref: HTMLAnchorElement, source: HTMLElement, note: HTMLElement, pin = false) {
    stay();
    if (pinned && !pin && current !== ref) return;
    expanded(false);
    if (current !== ref) {
      const fragment = document.createDocumentFragment();
      for (const child of note.childNodes) fragment.append(child.cloneNode(true));
      fragment.querySelectorAll('[data-footnote-backref]').forEach((node) => node.remove());
      // Hover previews must not start media requests; the original endnote retains its full media.
      fragment.querySelectorAll('img,video,audio,iframe,svg image').forEach((node) => {
        const alt = document.createElement('span');
        alt.className = 'article-footnote-media';
        alt.textContent = node.getAttribute('alt') || node.getAttribute('aria-label') || '';
        node.replaceWith(alt);
      });
      // Scoped cloned IDs preserve SVG/fragment references without duplicating article IDs.
      const ids = new Map<string, string>();
      const prefix = `footnote-preview-${++sequence}-`;
      fragment.querySelectorAll<HTMLElement>('[id]').forEach((node) => {
        ids.set(node.id, prefix + node.id);
        node.id = prefix + node.id;
      });
      fragment.querySelectorAll('*').forEach((node) => {
        for (const attr of [...node.attributes]) {
          const value = attr.value.replace(/url\(#([^)]*)\)/g, (match, id: string) =>
            ids.has(id) ? `url(#${ids.get(id)})` : match,
          );
          if (
            ['href', 'xlink:href'].includes(attr.name) &&
            value.startsWith('#') &&
            ids.has(value.slice(1))
          )
            node.setAttribute(attr.name, '#' + ids.get(value.slice(1)));
          else if (['aria-labelledby', 'aria-describedby'].includes(attr.name))
            node.setAttribute(
              attr.name,
              value
                .split(' ')
                .map((id) => ids.get(id) || id)
                .join(' '),
            );
          else if (value !== attr.value) node.setAttribute(attr.name, value);
        }
      });
      content.replaceChildren(fragment);
    }
    current = ref;
    opener = source;
    pinned = pin || pinned;
    setUiText(title, 'Footnote {value0}', { value0: ref.textContent?.trim() || '' });
    endnote.href = ref.href;
    if (native && !open()) popup.showPopover();
    else if (!native) popup.dataset.open = 'true';
    expanded(true);
    position();
    if (pin) close.focus({ preventScroll: true });
  }
  const records = refs.flatMap((ref, index) => {
    let id: string;
    try {
      id = decodeURIComponent(ref.hash.slice(1));
    } catch {
      return [];
    }
    const note = document.getElementById(id);
    if (!note || !article.contains(note) || !note.closest('[data-footnotes]')) return [];
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'article-footnote-marker';
    marker.textContent = ref.textContent;
    const excerpt = note.textContent?.replace(/↩/g, '').trim().slice(0, 100) || '';
    noteLabel(marker, 'Footnote {value0}: {value1}', {
      value0: ref.textContent?.trim() || '',
      value1: excerpt,
    });
    marker.setAttribute('aria-haspopup', 'dialog');
    marker.setAttribute('aria-controls', popup.id);
    marker.setAttribute('aria-expanded', 'false');
    marker.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'touch') show(ref, marker, note);
    });
    marker.addEventListener('pointerleave', leave);
    marker.addEventListener('focusin', () => {
      if (!returningFocus) show(ref, marker, note);
    });
    marker.addEventListener('focusout', leave);
    marker.addEventListener('click', () => show(ref, rail.opener(marker), note, true));
    ref.setAttribute('aria-haspopup', 'dialog');
    ref.setAttribute('aria-controls', popup.id);
    ref.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'touch') show(ref, ref, note);
    });
    ref.addEventListener('pointerleave', leave);
    ref.addEventListener('focusin', () => {
      if (!returningFocus) show(ref, ref, note);
    });
    ref.addEventListener('focusout', leave);
    ref.addEventListener('click', (event) => {
      if (
        innerWidth <= 700 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        show(ref, ref, note, true);
      } else hide();
    });
    return [{ ref, marker, index }];
  });
  const visible = new Set<Element>();
  const update = () =>
    rail.update(
      'footnotes',
      records
        .filter(({ ref }) => visible.has(ref))
        .map(({ ref, marker, index }) => ({
          key: `footnote-${index}`,
          kind: 'footnote',
          button: marker,
          rect: () => (ref.getClientRects().length ? ref.getBoundingClientRect() : null),
        })),
    );
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    update();
  });
  records.forEach(({ ref }) => observer.observe(ref));
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  document.addEventListener('fieldnotes:reader-preferences', schedule);
  document.fonts.addEventListener('loadingdone', schedule);
  new ResizeObserver(schedule).observe(popup);
}
