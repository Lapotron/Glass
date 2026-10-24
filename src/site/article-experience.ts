import { t } from '../shared/i18n.js';
import type { ReaderSession } from './reader-session.js';
import { upperBound } from '../shared/algorithms.js';
import { startArticleFootnotes } from './article-footnotes.js';
import { articleMargin } from './article-margin.js';

/** Article-local navigation; author settings never receive reader preferences. */
export function startArticleExperience(reader: ReaderSession | undefined) {
  const article = document.querySelector<HTMLElement>('.article-shell');
  const body = article?.querySelector<HTMLElement>('.article-body');
  if (!article || !body) return;
  articleMargin(body);
  startArticleFootnotes(body);
  const root = document.documentElement;
  const outline = article.querySelector<HTMLDetailsElement>('.outline-card');
  const links = [...article.querySelectorAll<HTMLAnchorElement>('[data-outline-link]')];
  const headings = links.map((link) =>
    document.getElementById(decodeURIComponent(link.hash.slice(1))),
  );
  const output = article.querySelector<HTMLOutputElement>('[data-outline-progress]');
  const progress = document.querySelector<HTMLElement>('.article-progress');
  const compact = matchMedia('(max-width: 1100px)');
  const steps = [...article.querySelectorAll<HTMLButtonElement>('[data-outline-step]')];
  const exit = article.querySelector<HTMLButtonElement>('[data-article-focus-exit]');
  let active = 0,
    scheduled = false,
    last = -1,
    marked = -1;
  let previousOpen = outline?.open;
  let dirty = true,
    positions: number[] = [],
    visibleIndices: number[] = [],
    geometry = { start: 0, end: 0, bottom: 0 };
  const invalidate = () => {
    dirty = true;
    schedule();
  };
  const canFocus = !!reader || root.dataset.preview === 'true';
  const focusOn = () => canFocus && root.dataset.articleFocus === 'true';
  const syncFocus = () => {
    const enabled = focusOn();
    article.querySelectorAll<HTMLButtonElement>('[data-article-focus-toggle]').forEach((button) => {
      button.disabled = !canFocus;
      button.setAttribute('aria-pressed', String(enabled));
      button.title = enabled ? t('Exit article focus mode') : t('Article focus mode');
    });
    if (exit) exit.hidden = !enabled;
    if (outline && enabled && !compact.matches) outline.open = true;
  };
  const setFocus = (enabled: boolean) => {
    if (!canFocus) return;
    const anchor = [...body.children].find(
      (element) => element.getBoundingClientRect().bottom > 100,
    );
    const top = anchor?.getBoundingClientRect().top;
    if (enabled) previousOpen = outline?.open;
    if (reader) {
      reader.preferences.focusMode = enabled;
      reader.apply(true);
    } else {
      root.dataset.articleFocus = String(enabled);
      syncFocus();
    }
    if (!enabled && outline && previousOpen !== undefined) outline.open = previousOpen;
    requestAnimationFrame(() => {
      if (anchor && top !== undefined)
        scrollBy({ top: anchor.getBoundingClientRect().top - top, behavior: 'instant' });
      invalidate();
    });
  };
  article
    .querySelectorAll<HTMLButtonElement>('[data-article-focus-toggle]')
    .forEach((button) => button.addEventListener('click', () => setFocus(!focusOn())));
  exit?.addEventListener('click', () => {
    setFocus(false);
    article
      .querySelector<HTMLButtonElement>('[data-article-focus-toggle]')
      ?.focus({ preventScroll: true });
  });
  addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !focusOn()) return;
    if (
      document.querySelector('dialog[open], [popover]:popover-open') ||
      (document.activeElement as Element | null)?.closest(
        'input,textarea,select,[contenteditable=true]',
      )
    )
      return;
    setFocus(false);
    article
      .querySelector<HTMLButtonElement>('[data-article-focus-toggle]')
      ?.focus({ preventScroll: true });
  });
  const adapt = () => {
    if (outline) outline.open = !compact.matches;
    syncFocus();
  };
  compact.addEventListener('change', adapt);
  links.forEach((link) =>
    link.addEventListener('click', () => {
      if (outline && compact.matches) outline.open = false;
    }),
  );
  function update() {
    if (dirty) {
      const rect = body!.getBoundingClientRect();
      geometry = {
        start: rect.top + scrollY - 120,
        end: rect.bottom + scrollY - innerHeight + 32,
        bottom: rect.bottom + scrollY,
      };
      // Hidden headings retain their place in the navigation but never become active.
      positions = [];
      visibleIndices = [];
      headings.forEach((heading, index) => {
        if (heading?.getClientRects().length) {
          positions.push(heading.getBoundingClientRect().top + scrollY);
          visibleIndices.push(index);
        }
      });
      dirty = false;
    }
    const { start, end } = geometry;
    const percentage =
      end <= start
        ? geometry.bottom - scrollY <= innerHeight
          ? 100
          : 0
        : Math.max(0, Math.min(100, ((scrollY - start) / (end - start)) * 100));
    if (progress) progress.style.width = `${percentage}%`;
    if (output) output.value = `${Math.round(percentage)}%`;
    active = visibleIndices[Math.max(0, upperBound(positions, scrollY + 145) - 1)] || 0;
    if (percentage >= 99.5) active = Math.max(0, links.length - 1);
    if (active !== marked) {
      if (marked >= 0) links[marked]?.removeAttribute('aria-current');
      links[active]?.setAttribute('aria-current', 'location');
      marked = active;
    }
    steps.forEach((button) => {
      const index = active + Number(button.dataset.outlineStep);
      button.disabled = !links.length || index < 0 || index >= links.length;
    });
    const link = links[active],
      nav = outline?.querySelector('nav');
    if (
      outline?.open &&
      nav &&
      link &&
      !link.hidden &&
      active !== last &&
      !nav.closest('[hidden]')
    ) {
      const a = link.getBoundingClientRect(),
        b = nav.getBoundingClientRect();
      if (a.top < b.top) nav.scrollTop += a.top - b.top - 6;
      else if (a.bottom > b.bottom) nav.scrollTop += a.bottom - b.bottom + 6;
    }
    last = outline?.open ? active : -1;
    scheduled = false;
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(update);
    }
  }
  steps.forEach((button) =>
    button.addEventListener('click', () =>
      links[active + Number(button.dataset.outlineStep)]?.click(),
    ),
  );
  article.querySelector('[data-outline-reading]')?.removeAttribute('hidden');
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', invalidate);
  document.addEventListener('fieldnotes:reader-preferences', () => {
    syncFocus();
    invalidate();
  });
  outline?.addEventListener('toggle', schedule);
  new ResizeObserver(invalidate).observe(body);
  body.addEventListener('load', invalidate, true);
  body.addEventListener('toggle', invalidate, true);
  new MutationObserver(invalidate).observe(body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'open'],
  });
  void document.fonts.ready.then(invalidate);
  document.fonts.addEventListener('loadingdone', invalidate);
  let closed: HTMLDetailsElement[] = [];
  addEventListener('beforeprint', () => {
    if (closed.length) return;
    closed = [...body.querySelectorAll<HTMLDetailsElement>('details:not([open])')].filter(
      (detail) => !detail.matches('.diagram-source,.chart-data'),
    );
    closed.forEach((detail) => {
      detail.open = true;
    });
  });
  addEventListener('afterprint', () => {
    closed.forEach((detail) => {
      detail.open = false;
    });
    closed = [];
    invalidate();
  });
  adapt();
  update();
}
