import { t } from '../shared/i18n.js';
import './line-discussions.css';
import type { Conversation, ConversationService } from './discussions.js';
import { startAnnotationIndex } from './annotation-index.js';
import { annotationMarkers } from './annotation-markers.js';
import type { Annotation } from '../shared/annotations.js';
import { articleMargin, marginTop } from './article-margin.js';
import {
  indexTextBlocks,
  lineBlockSelector,
  lineFragment,
  lineFromReference,
  parseLineFragment,
  textLines,
  type TextBlock,
  type TextLine,
} from './line-anchors.js';

/** A reader's exact rendered line becomes a quoted, independently mapped conversation. */
export async function startLineDiscussions(service: ConversationService) {
  const article = document.querySelector<HTMLElement>('.article-body[data-entry-id]');
  const entry = document.querySelector<HTMLButtonElement>('[data-discuss-line]');
  const trigger = document.querySelector<HTMLButtonElement>('[data-line-trigger]');
  const tooltip = document.querySelector<HTMLElement>('#line-discussion-tooltip');
  const template = document.querySelector<HTMLTemplateElement>('[data-line-discussion-template]');
  const announcement = document.querySelector<HTMLElement>('[data-line-announcement]');
  if (!article || !entry || !trigger || !tooltip || !template || !announcement) return;
  const rail = articleMargin(article);
  let blocks: TextBlock[];
  try {
    await document.fonts.ready;
    blocks = await indexTextBlocks(article);
  } catch {
    entry.title = t('Annotations require a secure page. Reload to try again.');
    return;
  }
  if (!blocks.length || !article.isConnected) return;
  entry.disabled = false;
  const byElement = new Map(blocks.map((block) => [block.element, block]));
  const byKey = new Map(blocks.map((block) => [block.key, block]));
  const popup = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
  const hostTemplate = popup
    .querySelector<HTMLElement>('.line-conversation')!
    .cloneNode(true) as HTMLElement;
  document.body.append(popup);
  const nativePopover = typeof popup.showPopover === 'function';
  if (!nativePopover) popup.removeAttribute('popover');
  const quote = popup.querySelector<HTMLElement>('[data-line-quote]')!;
  const outdated = popup.querySelector<HTMLElement>('[data-line-outdated]')!;
  const close = popup.querySelector<HTMLButtonElement>('[data-close-line-thread]')!;
  const switcher = document.createElement('label');
  switcher.className = 'line-thread-switcher';
  switcher.hidden = true;
  switcher.append('Annotations on this line');
  const choice = document.createElement('select');
  choice.setAttribute('aria-label', t('Annotations on this line'));
  switcher.append(choice);
  quote.before(switcher);
  let choices: Annotation[] = [];
  let badgeOpener: HTMLButtonElement | null = null;
  let selected: TextLine | null = null,
    pinned: TextLine | null = null;
  let controller: Conversation | undefined,
    conversationKey = '';
  const knownNumbers = new Map<string, string>();
  let open = false,
    keyboard = false,
    previousHash = '';
  let animation = 0,
    hiding: ReturnType<typeof setTimeout> | undefined;
  let point: { x: number; y: number; target: EventTarget | null } | null = null;
  const referenceFor = (line: TextLine) => ({
    key: line.block.key,
    start: line.start,
    end: line.end,
  });
  const visible = (line: TextLine) => {
    const rect = line.range.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > marginTop() && rect.top < innerHeight - 12;
  };
  const positionPopup = () => {
    if (!open || innerWidth <= 700) return;
    const boundary = article.getBoundingClientRect();
    const anchor = pinned?.range.getBoundingClientRect();
    const width = popup.getBoundingClientRect().width;
    const height = Math.min(popup.scrollHeight, innerHeight - 130);
    const beside = innerWidth - boundary.right >= width + 24;
    const x = beside ? boundary.right + 12 : innerWidth - width - 16;
    const y = Math.max(
      marginTop(),
      Math.min(
        anchor ? (beside ? anchor.top : anchor.bottom + 12) : 120,
        innerHeight - height - 16,
      ),
    );
    popup.style.setProperty('--line-popup-x', `${Math.max(12, x)}px`);
    popup.style.setProperty('--line-popup-y', `${y}px`);
  };
  const place = () => {
    animation = 0;
    markers?.place(keyboard ? selected : null);
    if (selected && visible(selected) && (keyboard || !rail.isCollapsed())) {
      trigger.hidden = !keyboard && Boolean(markers?.at(selected));
      if (trigger.hidden) tooltip.hidden = true;
      rail.update(
        'cursor',
        trigger.hidden
          ? []
          : [
              {
                key: 'annotation-cursor',
                kind: 'annotation',
                button: trigger,
                priority: keyboard,
                rect: () => selected?.range.getBoundingClientRect() || null,
                placed: (x, y) => {
                  tooltip.style.left = `${x - 8}px`;
                  tooltip.style.top = `${y + 4}px`;
                },
              },
            ],
      );
    } else {
      trigger.hidden = true;
      tooltip.hidden = true;
      rail.update('cursor', []);
    }
    positionPopup();
  };
  const schedule = () => {
    if (!animation) animation = requestAnimationFrame(place);
  };
  const choose = (line: TextLine) => {
    selected = line;
    clearTimeout(hiding);
    place();
    tooltip.hidden = trigger.hidden;
    trigger.dataset.lineReference = lineFragment(referenceFor(line));
  };
  const hideTrigger = () => {
    if (document.activeElement === trigger) return;
    trigger.hidden = true;
    tooltip.hidden = true;
    rail.update('cursor', []);
    if (!open) selected = null;
  };
  const railElement = article.closest('.article-shell')!.querySelector('.article-margin-rail')!;
  const onFold = () => {
    keyboard = false;
    point = null;
    clearTimeout(hiding);
    hideTrigger();
  };
  railElement.addEventListener('glass:notes-fold', onFold);
  const leave = (event?: PointerEvent) => {
    // Touch dispatches pointerleave on release; keep the selected action available for the next tap.
    if (event?.pointerType === 'touch') return;
    clearTimeout(hiding);
    hiding = setTimeout(hideTrigger, 180);
  };
  const pointLine = () => {
    if (!point || rail.isCollapsed()) return;
    const element = point.target instanceof Element ? point.target : null;
    if (
      !element ||
      element.closest('button,input,textarea,select,[data-interactive],.diagram,.code-toolbar')
    ) {
      leave();
      return;
    }
    const owner = element.closest<HTMLElement>(lineBlockSelector);
    const block = owner && byElement.get(owner);
    if (!block) {
      leave();
      return;
    }
    const line = textLines(block).find((line) =>
      [...line.range.getClientRects()].some(
        (rect) => point!.y >= rect.top - 2 && point!.y <= rect.bottom + 2,
      ),
    );
    if (line) choose(line);
    else leave();
  };
  let pointFrame = 0;
  const move = (event: PointerEvent) => {
    if (open || rail.isCollapsed() || event.pointerType === 'touch') return;
    if (keyboard && !event.movementX && !event.movementY) return;
    keyboard = false;
    point = { x: event.clientX, y: event.clientY, target: event.target };
    if (!pointFrame)
      pointFrame = requestAnimationFrame(() => {
        pointFrame = 0;
        pointLine();
      });
  };
  let touchStart = { x: 0, y: 0, scroll: 0 };
  const touchDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch')
      touchStart = { x: event.clientX, y: event.clientY, scroll: scrollY };
  };
  const touchUp = (event: PointerEvent) => {
    if (
      open ||
      event.pointerType !== 'touch' ||
      Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) > 6 ||
      Math.abs(scrollY - touchStart.scroll) > 5 ||
      !getSelection()?.isCollapsed
    )
      return;
    point = { x: event.clientX, y: event.clientY, target: event.target };
    pointLine();
  };
  const restoreHash = () => {
    if (parseLineFragment(location.hash))
      history.replaceState(null, '', `${location.pathname}${location.search}${previousHash}`);
  };
  const focusOpener = () => {
    rail.reveal();
    const badge =
      badgeOpener?.isConnected && !badgeOpener.hidden
        ? badgeOpener
        : selected && markers?.at(selected);
    if (badge && !badge.hidden && !keyboard) badge.focus({ preventScroll: true });
    else if (selected && visible(selected)) {
      place();
      rail.flush();
      trigger.focus({ preventScroll: true });
    } else entry.focus({ preventScroll: true });
  };
  const closePopup = (restore = false, updateURL = true) => {
    if (updateURL) restoreHash();
    open = false;
    markers?.active('');
    trigger.setAttribute('aria-expanded', 'false');
    if (nativePopover && popup.matches(':popover-open')) popup.hidePopover();
    else popup.removeAttribute('data-open');
    if (restore) focusOpener();
    schedule();
  };
  const onToggle = () => {
    open = nativePopover ? popup.matches(':popover-open') : popup.hasAttribute('data-open');
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) {
      markers?.active('');
      restoreHash();
      schedule();
    }
  };
  popup.addEventListener('toggle', onToggle);
  const show = () => {
    if (nativePopover) {
      if (!popup.matches(':popover-open')) popup.showPopover();
    } else popup.dataset.open = 'true';
    open = true;
    markers?.active(pinned ? lineFragment(referenceFor(pinned)) : '');
    schedule();
    trigger.setAttribute('aria-expanded', 'true');
    positionPopup();
    close.focus({ preventScroll: true });
  };
  const openLine = (line: TextLine, updateURL = true, group: Annotation[] = []) => {
    const reference = referenceFor(line),
      fragment = lineFragment(reference);
    const number = knownNumbers.get(fragment) || '';
    choices = group;
    switcher.hidden = group.length < 2;
    choice.replaceChildren(
      ...group.map((item, index) => {
        const option = document.createElement('option');
        option.value = item.fragment;
        option.textContent = t('{value0}. {value1}{value2}', {
          value0: index + 1,
          value1: item.quote.slice(0, 90) || 'Annotation',
          value2: item.comments !== undefined ? ` · ${item.comments} comments` : '',
        });
        option.selected = item.fragment === fragment;
        return option;
      }),
    );
    pinned = line;
    choose(line);
    if (updateURL && location.hash !== `#${fragment}`) {
      if (!parseLineFragment(location.hash)) previousHash = location.hash;
      history.pushState(null, '', `${location.pathname}${location.search}#${fragment}`);
    }
    quote.textContent = line.quote;
    quote.hidden = false;
    outdated.hidden = true;
    popup.querySelector<HTMLElement>('.line-conversation')!.hidden = false;
    if (conversationKey !== `${fragment}:${number}`) {
      controller?.destroy();
      const old = popup.querySelector('.line-conversation')!;
      const host = hostTemplate.cloneNode(true) as HTMLElement;
      host.id = `panel-${fragment}`;
      host.dataset.lineThread = '';
      host.dataset.commentAnchor = fragment;
      if (number) host.dataset.commentNumber = number;
      host.dataset.commentQuote = line.quote;
      host.dataset.commentTerm = `entry/${article.dataset.entryId}/line/${reference.key}/${reference.start}-${reference.end}`;
      old.replaceWith(host);
      conversationKey = `${fragment}:${number}`;
      controller = service.mount(host);
      controller.load();
    }
    show();
  };
  const fromLocation = () => {
    const reference = parseLineFragment(location.hash);
    if (!reference) {
      if (open) closePopup(false, false);
      return;
    }
    const block = byKey.get(reference.key),
      line = block && lineFromReference(block, reference);
    if (!line) {
      const message =
        'This line has changed in the current article. Find its original discussion on GitHub.';
      announcement.textContent = message;
      outdated.textContent = message;
      outdated.hidden = false;
      quote.hidden = true;
      pinned = null;
      selected = null;
      hideTrigger();
      popup.querySelector<HTMLElement>('.line-conversation')!.hidden = true;
      show();
      return;
    }
    badgeOpener = null;
    line.block.element.closest<HTMLDetailsElement>('details')?.setAttribute('open', '');
    line.block.element.closest('.ec-section')?.querySelector('details')?.setAttribute('open', '');
    const panel = line.block.element.closest<HTMLElement>('[role="tabpanel"]');
    if (panel?.hidden)
      document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(panel.id)}"]`)?.click();
    const rect = line.range.getBoundingClientRect();
    scrollTo({ top: scrollY + rect.top - 145, behavior: 'instant' });
    openLine(line, false);
  };
  const beginKeyboard = () => {
    keyboard = true;
    let line = selected && visible(selected) ? selected : null;
    if (!line) {
      const block =
        blocks.find((block) => {
          const rect = block.element.getBoundingClientRect();
          return rect.height > 0 && rect.bottom > 125 && rect.top < innerHeight - 80;
        }) || blocks[0];
      line =
        textLines(block).find((line) => line.range.getBoundingClientRect().bottom > 125) ||
        textLines(block)[0];
    }
    if (!line) return;
    if (!visible(line)) {
      const rect = line.range.getBoundingClientRect();
      scrollBy({ top: rect.top - 145, behavior: 'instant' });
    }
    choose(line);
    rail.flush();
    trigger.focus({ preventScroll: true });
    announcement.textContent = t(
      'Use Up and Down to choose a line, then Enter to annotate. {value0}',
      { value0: line.quote },
    );
  };
  const step = (direction: number) => {
    if (!selected) return;
    const rows = textLines(selected.block);
    let index = rows.findIndex((row) => row.start <= selected!.start && row.end > selected!.start);
    let line = rows[index + direction];
    if (!line) {
      for (
        index = blocks.indexOf(selected.block) + direction;
        index >= 0 && index < blocks.length;
        index += direction
      ) {
        const next = textLines(blocks[index]);
        if (next.length) {
          line = direction > 0 ? next[0] : next[next.length - 1];
          break;
        }
      }
    }
    if (!line) return;
    const rect = line.range.getBoundingClientRect();
    if (rect.top < 125 || rect.bottom > innerHeight - 65)
      scrollBy({ top: rect.top - 145, behavior: 'instant' });
    choose(line);
    announcement.textContent = line.quote;
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        closePopup(true);
      } else if (keyboard || document.activeElement === trigger) {
        event.preventDefault();
        keyboard = false;
        entry.focus({ preventScroll: true });
        hideTrigger();
      }
    }
    if (document.activeElement === trigger && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      keyboard = true;
      step(event.key === 'ArrowDown' ? 1 : -1);
    }
  };
  entry.addEventListener('click', beginKeyboard);
  trigger.addEventListener('click', () => {
    badgeOpener = null;
    if (selected) openLine(selected);
  });
  choice.addEventListener('change', () => {
    const reference = parseLineFragment(choice.value);
    const block = reference && byKey.get(reference.key);
    const line = block && reference && lineFromReference(block, reference);
    if (line) openLine(line, true, choices);
  });
  trigger.addEventListener('pointerenter', () => {
    clearTimeout(hiding);
    tooltip.hidden = rail.isCollapsed();
  });
  trigger.addEventListener('pointerleave', leave);
  trigger.addEventListener('focus', () => {
    clearTimeout(hiding);
    tooltip.hidden = rail.isCollapsed();
  });
  trigger.addEventListener('blur', () => {
    if (!open) leave();
  });
  close.addEventListener('click', () => closePopup(true));
  article.addEventListener('pointermove', move, { passive: true });
  article.addEventListener('pointerleave', leave);
  article.addEventListener('pointerdown', touchDown, { passive: true });
  article.addEventListener('pointerup', touchUp, { passive: true });
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', schedule, { passive: true });
  article.addEventListener('click', schedule);
  article.addEventListener('toggle', schedule, true);
  const markers = annotationMarkers(
    article,
    blocks,
    (items, button) => {
      const reference = parseLineFragment(items[0].fragment)!;
      const block = byKey.get(reference.key);
      const line = block && lineFromReference(block, reference);
      if (!line) return;
      keyboard = false;
      badgeOpener = button;
      openLine(line, true, items);
    },
    schedule,
  );
  const index = startAnnotationIndex(
    blocks,
    service.config.repo,
    (fragment, url) => {
      const number = url?.match(/\/(\d+)$/)?.[1];
      if (number) knownNumbers.set(fragment, number);
      if (location.hash === `#${fragment}`) fromLocation();
      else location.hash = fragment;
    },
    beginKeyboard,
    (items) => {
      for (const item of items) {
        const number = item.url.match(/\/(\d+)$/)?.[1];
        if (number) knownNumbers.set(item.fragment, number);
      }
      markers?.update(items);
      schedule();
    },
  );
  const resize = () => {
    blocks.forEach((block) => {
      block.lines = undefined;
    });
    schedule();
    index.resize();
  };
  document.addEventListener('fieldnotes:reader-preferences', resize);
  window.addEventListener('resize', resize);
  window.addEventListener('hashchange', fromLocation);
  window.addEventListener('popstate', fromLocation);
  const onPageShow = () => {
    fromLocation();
    schedule();
  };
  window.addEventListener('pageshow', onPageShow);
  const observer = new ResizeObserver(schedule);
  observer.observe(popup);
  observer.observe(article);
  fromLocation();
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    cancelAnimationFrame(animation);
    cancelAnimationFrame(pointFrame);
    clearTimeout(hiding);
    observer.disconnect();
    controller?.destroy();
    index.destroy();
    markers?.destroy();
    railElement.removeEventListener('glass:notes-fold', onFold);
    article.removeEventListener('click', schedule);
    article.removeEventListener('toggle', schedule, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', schedule);
    document.removeEventListener('fieldnotes:reader-preferences', resize);
    window.removeEventListener('resize', resize);
    window.removeEventListener('hashchange', fromLocation);
    window.removeEventListener('popstate', fromLocation);
    window.removeEventListener('pageshow', onPageShow);
    popup.remove();
  });
}
