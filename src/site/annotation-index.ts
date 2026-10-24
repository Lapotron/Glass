import { t } from '../shared/i18n.js';
import { annotationLink, type Annotation, type AnnotationPage } from '../shared/annotations.js';
import { parseLineFragment } from '../shared/line-references.js';
import { lineFromReference, textLines, type TextBlock } from './line-anchors.js';

/** Both annotation tabs share public records, positions and provider updates. */
export function startAnnotationIndex(
  blocks: TextBlock[],
  repo: string,
  open: (fragment: string, url?: string) => void,
  begin: () => void,
  changed: (items: Annotation[]) => void = () => {},
) {
  const endpoint = document.querySelector<HTMLElement>('[data-annotation-endpoint]')?.dataset
    .annotationEndpoint;
  const views = [...document.querySelectorAll<HTMLElement>('[data-annotation-index]')];
  const groups = [...document.querySelectorAll<HTMLElement>('[data-annotation-tabs]')];
  const remote = new Map<string, Annotation>(),
    local = new Map<string, Annotation>();
  const byKey = new Map(blocks.map((block, index) => [block.key, { block, index }]));
  let loaded = false,
    busy = false,
    error = '',
    nextPage: number | null = 1,
    controller: AbortController | undefined,
    generation = 0,
    frame = 0;
  const clean = (item: Annotation): Annotation | null => {
    if (!item || !parseLineFragment(item.fragment) || !annotationLink(item.url, repo)) return null;
    return {
      fragment: item.fragment,
      url: annotationLink(item.url, repo),
      quote: typeof item.quote === 'string' ? item.quote.slice(0, 2000) : '',
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
      comments:
        Number.isSafeInteger(item.comments) && item.comments! >= 0 ? item.comments : undefined,
      replies: Number.isSafeInteger(item.replies) && item.replies! >= 0 ? item.replies : undefined,
    };
  };
  const records = () =>
    [...new Map([...remote, ...local]).values()].sort((a, b) => {
      const first = parseLineFragment(a.fragment)!,
        second = parseLineFragment(b.fragment)!;
      return (
        (byKey.get(first.key)?.index ?? Infinity) - (byKey.get(second.key)?.index ?? Infinity) ||
        first.start - second.start ||
        a.fragment.localeCompare(b.fragment)
      );
    });
  const render = () => {
    frame = 0;
    const items = records();
    changed(items);
    const positions = new Map<string, { start: number; rows: ReturnType<typeof textLines> }>();
    let number = 1;
    if (items.length)
      for (const block of blocks) {
        const rows = textLines(block);
        positions.set(block.key, { start: number, rows });
        number += rows.length;
      }
    for (const badge of document.querySelectorAll<HTMLElement>('[data-annotation-count]')) {
      badge.hidden = !items.length;
      badge.textContent = t("{value0}{value1}", {value0: items.length, value1: loaded && nextPage !== null ? '+' : ''});
      badge.setAttribute('aria-hidden', 'true');
    }
    for (const view of views) {
      view.setAttribute('aria-busy', String(busy));
      const status = view.querySelector<HTMLElement>('[data-annotation-status]')!;
      status.textContent =
        error ||
        (busy
          ? 'Loading annotations…'
          : !loaded && !items.length
            ? 'Open Annotations to find notes on specific lines.'
            : !items.length
              ? 'No annotations yet. Add a note to a line to start one.'
              : `${items.length} ${items.length === 1 ? 'annotation' : 'annotations'} · ordered by passage`);
      const list = view.querySelector<HTMLOListElement>('[data-annotation-items]')!;
      const focused = list.contains(document.activeElement)
        ? (document.activeElement as HTMLAnchorElement).hash
        : '';
      list.replaceChildren(
        ...items.map((item) => {
          const reference = parseLineFragment(item.fragment)!,
            block = byKey.get(reference.key)?.block;
          const line = block && lineFromReference(block, reference),
            position = positions.get(reference.key);
          const first = position?.rows.findIndex((row) => row.end > reference.start) ?? -1;
          const last = position?.rows.findIndex((row) => row.end >= reference.end) ?? -1;
          const label =
            line && position && first >= 0
              ? `${last > first ? 'Lines' : 'Line'} ${position.start + first}${last > first ? `–${position.start + last}` : ''}`
              : line
                ? 'Passage in a tab'
                : 'Changed passage';
          let heading = 'Introduction';
          if (block)
            for (const candidate of document.querySelectorAll<HTMLElement>(
              '.article-body h2,.article-body h3',
            )) {
              if (
                candidate === block.element ||
                candidate.compareDocumentPosition(block.element) & Node.DOCUMENT_POSITION_FOLLOWING
              )
                heading = candidate.textContent || heading;
              else break;
            }
          const li = document.createElement('li'),
            link = document.createElement('a');
          link.href = `#${item.fragment}`;
          link.className = 'annotation-index-link';
          link.dataset.annotationReference = item.fragment;
          link.dataset.annotationUrl = item.url;
          if (!line) {
            link.href = item.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = t("Open the original annotation on GitHub");
          }
          if (location.hash === link.hash) link.setAttribute('aria-current', 'location');
          const meta = document.createElement('span');
          meta.className = 'annotation-position';
          meta.textContent = t("{value0} · {value1}", {value0: label, value1: heading});
          const quote = document.createElement('span');
          quote.className = 'annotation-excerpt';
          quote.textContent = line?.quote || item.quote || 'Open the original annotation';
          link.append(meta, quote);
          if (item.comments !== undefined) {
            const count = document.createElement('span');
            count.className = 'annotation-replies';
            count.textContent = t("{value0} {value1}{value2}", {value0: item.comments, value1: item.comments === 1 ? 'comment' : 'comments', value2: item.replies ? ` · ${item.replies} ${item.replies === 1 ? 'reply' : 'replies'}` : ''});
            link.append(count);
          }
          li.append(link);
          return li;
        }),
      );
      if (focused)
        [...list.querySelectorAll('a')]
          .find((link) => link.hash === focused)
          ?.focus({ preventScroll: true });
      const more = view.querySelector<HTMLButtonElement>('[data-more-annotations]')!;
      more.hidden = !loaded || nextPage === null;
      more.disabled = busy;
      view.querySelector<HTMLButtonElement>('[data-refresh-annotations]')!.disabled = busy;
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };
  const load = async (page = 1) => {
    if (!endpoint || busy) return;
    clearTimeout(background);
    controller?.abort();
    controller = new AbortController();
    const current = ++generation,
      timeout = setTimeout(() => controller?.abort(), 16000);
    busy = true;
    error = '';
    render();
    try {
      const response = await fetch(`${endpoint}?page=${page}`, {
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-cache',
      });
      if (!response.ok) throw new Error(t("Annotations could not load."));
      const result = (await response.json()) as AnnotationPage;
      if (
        !Array.isArray(result.items) ||
        result.items.length > 100 ||
        (result.nextPage !== null && result.nextPage !== page + 1)
      )
        throw new Error(t("Invalid annotations."));
      if (current !== generation) return;
      if (page === 1) remote.clear();
      for (const raw of result.items) {
        const item = clean(raw);
        if (item) remote.set(item.fragment, item);
      }
      nextPage = result.nextPage;
      loaded = true;
    } catch {
      if (current === generation)
        error = 'Annotations could not load. Refresh to try again, or browse on GitHub.';
    } finally {
      clearTimeout(timeout);
      if (current === generation) {
        busy = false;
        render();
        if (!error && nextPage !== null) queueBackground();
      }
    }
  };
  const select = (group: HTMLElement, active: HTMLButtonElement, focus = false) => {
    for (const button of group.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      const selected = button === active;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(button.getAttribute('aria-controls')!);
      if (panel) panel.hidden = !selected;
    }
    if (focus) active.focus();
    if (active.dataset.annotationView === 'annotations') {
      if (!loaded && !busy) void load();
      else schedule();
    }
  };
  const click = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest<HTMLButtonElement>('[data-annotation-tabs] [role="tab"]');
    if (tab) {
      select(tab.closest('[data-annotation-tabs]')!, tab);
      return;
    }
    const link = target?.closest<HTMLAnchorElement>('[data-annotation-reference]');
    if (link) {
      if (link.target === '_blank') return;
      if (
        event instanceof MouseEvent &&
        (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      )
        return;
      event.preventDefault();
      const outline = link.closest<HTMLDetailsElement>('.outline-card');
      if (outline && matchMedia('(max-width:1100px)').matches) outline.open = false;
      open(link.dataset.annotationReference!, link.dataset.annotationUrl);
      schedule();
      return;
    }
    if (target?.closest('[data-refresh-annotations]')) void load();
    else if (target?.closest('[data-more-annotations]') && nextPage) void load(nextPage);
    else if (target?.closest('[data-new-annotation]')) begin();
  };
  const key = (event: KeyboardEvent) => {
    const group = (event.target as Element)?.closest<HTMLElement>('[data-annotation-tabs]');
    if (!group || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...group.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    select(group, buttons[next], true);
  };
  const update = (event: Event) => {
    const item = clean((event as CustomEvent<Annotation>).detail);
    if (item) {
      local.set(item.fragment, item);
      render();
    }
  };
  const hash = () => {
    if (location.hash === '#discussion')
      for (const group of groups) {
        const main = group.querySelector<HTMLButtonElement>('[data-annotation-view="discussion"]');
        if (main) select(group, main);
      }
    schedule();
  };
  groups.forEach((group) =>
    group.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((button) => {
      button.disabled = false;
    }),
  );
  document.addEventListener('click', click);
  document.addEventListener('keydown', key);
  document.addEventListener('fieldnotes:annotation', update);
  window.addEventListener('hashchange', hash);
  window.addEventListener('popstate', hash);
  let background: ReturnType<typeof setTimeout> | undefined;
  const queueBackground = () => {
    clearTimeout(background);
    if (document.hidden || busy || error || (loaded && nextPage === null)) return;
    background = setTimeout(
      () => {
        void load(loaded ? nextPage! : 1);
      },
      loaded ? 500 : 0,
    );
  };
  document.addEventListener('visibilitychange', queueBackground);
  queueBackground();
  return {
    resize: schedule,
    destroy() {
      generation++;
      clearTimeout(background);
      controller?.abort();
      cancelAnimationFrame(frame);
      document.removeEventListener('click', click);
      document.removeEventListener('keydown', key);
      document.removeEventListener('fieldnotes:annotation', update);
      window.removeEventListener('hashchange', hash);
      window.removeEventListener('popstate', hash);
      document.removeEventListener('visibilitychange', queueBackground);
    },
  };
}
