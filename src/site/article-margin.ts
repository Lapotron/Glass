import { t, type UiParams } from '../shared/i18n.js';

export type MarginNote = {
  key: string;
  kind: 'footnote' | 'annotation';
  button: HTMLButtonElement;
  rect: () => DOMRect | null;
  placed?: (x: number, y: number) => void;
  priority?: boolean;
};
const rails = new WeakMap<HTMLElement, ReturnType<typeof createRail>>();
export const marginTop = () =>
  document.documentElement.dataset.articleFocus === 'true' ? 24 : 100;
export function noteLabel(node: HTMLElement, message: string, params?: UiParams) {
  node.setAttribute('aria-label', t(message, params));
  node.dataset.uiAttrs = JSON.stringify({ 'aria-label': message });
  if (params) node.dataset.uiParams = JSON.stringify(params);
}

/** One visible-range layout for footnotes, confirmed discussions and the line action. */
export function articleMargin(article: HTMLElement) {
  let rail = rails.get(article);
  if (!rail) {
    rail = createRail(article);
    rails.set(article, rail);
  }
  return rail;
}
function createRail(article: HTMLElement) {
  const root = document.createElement('aside');
  root.className = 'article-margin-rail line-annotation-rail glass-panel';
  noteLabel(root, 'Article notes');
  article.closest('.article-shell')!.append(root);
  const panel = document.createElement('div');
  panel.id = 'article-margin-content';
  root.append(panel);
  const template = document.querySelector<HTMLTemplateElement>('[data-article-margin-template]');
  const control = (selector: string, fallback: string) => {
    const original = template?.content.querySelector<HTMLButtonElement>(selector);
    const button = original
      ? (original.cloneNode(true) as HTMLButtonElement)
      : document.createElement('button');
    button.type = 'button';
    if (!original) {
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = fallback;
      button.append(icon);
    }
    return button;
  };
  const fold = control('[data-margin-fold]', '›');
  fold.dataset.marginFold = '';
  fold.className = 'article-margin-fold';
  fold.setAttribute('aria-controls', panel.id);
  root.append(fold);
  const endnotes = article.querySelector<HTMLElement>('[data-footnotes]');
  const noteCount = endnotes?.querySelectorAll(':scope > ol > li').length || 0;
  const overview = control('[data-margin-footnotes]', '∗');
  overview.className = 'article-margin-overview';
  overview.disabled = !noteCount;
  const count =
    overview.querySelector('[data-margin-footnote-count]') ||
    overview.appendChild(document.createElement('span'));
  count.textContent = String(noteCount);
  overview.addEventListener('click', () => {
    const target = endnotes?.querySelector<HTMLElement>('h2[id],li[id]');
    if (!target) return;
    location.hash = target.id;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  });
  const entry = document.querySelector<HTMLButtonElement>('[data-discuss-line]');
  const annotate = control('[data-margin-annotate]', '+');
  annotate.className = 'article-margin-annotate';
  annotate.hidden = !entry;
  annotate.disabled = !entry || entry.disabled;
  annotate.addEventListener('click', () => entry?.click());
  if (entry)
    new MutationObserver(() => {
      annotate.disabled = entry.disabled;
    }).observe(entry, { attributes: true, attributeFilter: ['disabled'] });
  panel.append(overview, annotate);
  let collapsed = innerWidth <= 700;
  const providers = new Map<string, MarginNote[]>();
  const grouped = new Map<HTMLButtonElement, HTMLButtonElement>();
  const groups = new Map<string, HTMLButtonElement>();
  const chooser = document.createElement('div');
  chooser.className = 'article-note-chooser glass';
  chooser.setAttribute('popover', 'auto');
  chooser.setAttribute('role', 'dialog');
  noteLabel(chooser, 'Notes on this line');
  const choices = document.createElement('div');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'article-note-close';
  close.textContent = '×';
  noteLabel(close, 'Close notes');
  chooser.append(close, choices);
  document.body.append(chooser);
  let chooserButton: HTMLButtonElement | undefined;
  let chosen: MarginNote[] = [];
  let frame = 0;
  const native = typeof chooser.showPopover === 'function';
  if (!native) chooser.removeAttribute('popover');
  const isOpen = () =>
    native ? chooser.matches(':popover-open') : chooser.hasAttribute('data-open');
  const hide = (focus = false) => {
    if (native && isOpen()) chooser.hidePopover();
    else chooser.removeAttribute('data-open');
    chooserButton?.setAttribute('aria-expanded', 'false');
    if (focus) chooserButton?.focus({ preventScroll: true });
  };
  const setCollapsed = (value: boolean) => {
    const folding = value && !collapsed;
    collapsed = value;
    if (folding) {
      hide();
      if (panel.contains(document.activeElement)) fold.focus({ preventScroll: true });
      root.dispatchEvent(new CustomEvent('glass:notes-fold'));
    }
    layout();
  };
  fold.addEventListener('click', () => setCollapsed(!collapsed));
  close.addEventListener('click', () => hide(true));
  chooser.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hide(true);
    }
  });
  chooser.addEventListener('toggle', () => {
    if (!isOpen()) chooserButton?.setAttribute('aria-expanded', 'false');
  });
  function show(button: HTMLButtonElement, notes: MarginNote[], focus: boolean) {
    chooserButton?.setAttribute('aria-expanded', 'false');
    chooserButton = button;
    chosen = notes;
    choices.replaceChildren(
      ...notes.map((note) => {
        const action = document.createElement('button');
        action.type = 'button';
        action.textContent = note.button.getAttribute('aria-label') || note.button.textContent;
        action.addEventListener('click', () => {
          hide();
          note.button.click();
        });
        return action;
      }),
    );
    if (native && !isOpen()) chooser.showPopover();
    else if (!native) chooser.dataset.open = 'true';
    button.setAttribute('aria-expanded', 'true');
    positionChooser();
    if (focus) choices.querySelector('button')?.focus({ preventScroll: true });
  }
  function positionChooser() {
    if (!isOpen() || !chooserButton?.isConnected) return;
    const rect = chooserButton.getBoundingClientRect();
    const bounds = chooser.getBoundingClientRect();
    chooser.style.left = `${Math.max(12, Math.min(rect.left - bounds.width - 12, innerWidth - bounds.width - 12))}px`;
    chooser.style.top = `${Math.max(12, Math.min(rect.top, innerHeight - bounds.height - 12))}px`;
  }
  function layout() {
    frame = 0;
    const boundary = article.getBoundingClientRect();
    const compact = innerWidth <= 700;
    const top = Math.max(marginTop(), boundary.top);
    const bottom = Math.min(innerHeight - 12, boundary.bottom);
    const railTop = Math.max(marginTop(), Math.min(top, innerHeight - 160));
    const railHeight = Math.max(120, bottom - railTop);
    const toolbarHeight = entry ? 116 : 80;
    const all = [...providers.values()].flat();
    let measured = all
      .flatMap((note) => {
        if (compact && note.kind === 'footnote') return [];
        const rect = note.rect();
        return rect?.width &&
          rect.height &&
          rect.bottom > top &&
          rect.top < Math.max(top, bottom - toolbarHeight)
          ? [{ note, y: rect.top + rect.height / 2 }]
          : [];
      })
      .sort((a, b) => a.y - b.y);
    // Keyboard line selection must keep its active button and focus, even beside a footnote.
    const selected = measured.find(({ note }) => note.priority);
    if (selected)
      measured = measured.filter((row) => row === selected || Math.abs(row.y - selected.y) >= 36);
    const rows: (typeof measured)[] = [];
    for (const value of measured) {
      const previous = rows.at(-1);
      const height = (note: MarginNote) =>
        note.button.matches('[data-line-trigger]') ? 32 : note.kind === 'annotation' ? 24 : 28;
      const previousHeight = previous && (previous.length > 1 ? 32 : height(previous[0].note));
      if (previous && value.y - previous[0].y < (previousHeight! + height(value.note)) / 2 + 2)
        previous.push(value);
      else rows.push([value]);
    }
    const x = Math.max(8, Math.min(innerWidth - 52, boundary.right + (compact ? -26 : 10)));
    root.style.left = `${x}px`;
    root.style.top = `${collapsed && compact ? innerHeight - 120 : railTop}px`;
    root.style.height = `${collapsed ? 44 : railHeight}px`;
    root.dataset.collapsed = String(collapsed);
    panel.hidden = collapsed;
    fold.setAttribute('aria-expanded', String(!collapsed));
    noteLabel(fold, collapsed ? 'Expand article notes' : 'Collapse article notes');
    noteLabel(overview, 'Footnotes: {value0}', { value0: noteCount });
    noteLabel(annotate, 'Add a line annotation');
    fold.style.position = overview.style.position = annotate.style.position = 'absolute';
    fold.style.left = '0';
    overview.style.left = annotate.style.left = '6px';
    fold.style.top = `${collapsed ? 0 : railHeight - 44}px`;
    overview.style.top = `${railHeight - (entry ? 112 : 76)}px`;
    annotate.style.top = `${railHeight - 76}px`;
    grouped.clear();
    const shown = new Set<HTMLButtonElement>();
    const retained = new Set<string>();
    for (const row of rows) {
      let button: HTMLButtonElement;
      if (row.length === 1) button = row[0].note.button;
      else {
        const key = row.map(({ note }) => note.key).join('|');
        retained.add(key);
        button = groups.get(key)!;
        if (!button) {
          button = document.createElement('button');
          button.type = 'button';
          button.className = 'article-margin-group';
          button.setAttribute('aria-haspopup', 'dialog');
          button.setAttribute('aria-expanded', 'false');
          const notes = row.map(({ note }) => note);
          button.addEventListener('pointerenter', (event) => {
            if (event.pointerType !== 'touch') show(button, notes, false);
          });
          button.addEventListener('click', () => show(button, notes, true));
          panel.append(button);
          groups.set(key, button);
        }
        button.textContent = String(row.length);
        noteLabel(button, '{value0} notes on this line', { value0: row.length });
        row.forEach(({ note }) => grouped.set(note.button, button));
      }
      const height =
        row.length > 1 || button.matches('[data-line-trigger]')
          ? 32
          : row[0].note.kind === 'annotation'
            ? 24
            : 28;
      const y = Math.max(2, Math.min(bottom - top - height - 2, row[0].y - top - height / 2));
      button.hidden = false;
      shown.add(button);
      button.style.position = 'absolute';
      button.style.height = `${height}px`;
      button.style.minHeight = `${height}px`;
      button.style.left = '6px';
      button.style.top = `${y}px`;
      row.forEach(({ note }) => note.placed?.(x + 6, top + y));
    }
    // Preserve focus on retained markers rather than toggling hidden during every frame.
    for (const note of all) note.button.hidden = !shown.has(note.button);
    for (const [key, button] of groups) {
      if (!retained.has(key)) {
        if (button === chooserButton) hide();
        button.remove();
        groups.delete(key);
      }
    }
    if (isOpen() && !chosen.some((note) => measured.some((value) => value.note.key === note.key)))
      hide();
    positionChooser();
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(layout);
  }
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  matchMedia('(max-width: 700px)').addEventListener('change', (event) => {
    setCollapsed(event.matches);
  });
  document.addEventListener('fieldnotes:reader-preferences', schedule);
  addEventListener('glass:language', () => {
    [...choices.children].forEach((node, index) => {
      node.textContent = chosen[index]?.button.getAttribute('aria-label') || '';
    });
    schedule();
  });
  article.addEventListener('load', schedule, true);
  article.addEventListener('toggle', schedule, true);
  new ResizeObserver(schedule).observe(article);
  void document.fonts.ready.then(schedule);
  document.fonts.addEventListener('loadingdone', schedule);
  return {
    isCollapsed: () => collapsed,
    update(provider: string, notes: MarginNote[]) {
      if (notes.some((note) => note.priority)) collapsed = false;
      const retained = new Set(notes.map((note) => note.button));
      for (const old of providers.get(provider) || [])
        if (!retained.has(old.button)) old.button.remove();
      for (const note of notes) {
        note.button.classList.remove('glass', 'glass-panel');
        note.button.classList.add('article-margin-marker');
        if (note.button.parentElement !== panel) panel.append(note.button);
      }
      providers.set(provider, notes);
      schedule();
    },
    opener(button: HTMLButtonElement) {
      return grouped.get(button) || button;
    },
    flush() {
      cancelAnimationFrame(frame);
      layout();
    },
    reveal() {
      collapsed = false;
      layout();
    },
    schedule,
  };
}
