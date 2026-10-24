import type { Annotation } from '../shared/annotations.js';
import { articleMargin, marginTop } from './article-margin.js';
import {
  lineFromReference,
  parseLineFragment,
  type TextBlock,
  type TextLine,
} from './line-anchors.js';

/** A quiet right-edge rail, positioned from the original quoted ranges. */
export function annotationMarkers(
  article: HTMLElement,
  blocks: TextBlock[],
  open: (items: Annotation[], button: HTMLButtonElement) => void,
  invalidate: () => void = () => {},
) {
  const template = document.querySelector<HTMLTemplateElement>('[data-annotation-badge-template]')!;
  const rail = articleMargin(article);
  const byKey = new Map(blocks.map((block) => [block.key, block]));
  const buttons = new Map<string, HTMLButtonElement>();
  const itemsByBlock = new Map<
    TextBlock,
    { item: Annotation; reference: NonNullable<ReturnType<typeof parseLineFragment>> }[]
  >();
  const visible = new Set(blocks);
  const visibility = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const block = byElement.get(entry.target);
      if (block) {
        if (entry.isIntersecting) visible.add(block);
        else visible.delete(block);
      }
    }
    invalidate();
  });
  const byElement = new Map<Element, TextBlock>(blocks.map((block) => [block.element, block]));
  for (const block of blocks) visibility.observe(block.element);
  let rows: {
    items: Annotation[];
    top: number;
    bottom: number;
    block: TextBlock;
    range: Range;
    button: HTMLButtonElement;
  }[] = [];
  let active = '';
  const sameRow = (line: TextLine, row: { top: number; bottom: number; block: TextBlock }) => {
    const rect = [...line.range.getClientRects()].find((rect) => rect.width > 0 && rect.height > 0);
    return (
      line.block === row.block && rect && rect.top < row.bottom - 2 && rect.bottom > row.top + 2
    );
  };
  const place = (keyboardLine?: TextLine | null) => {
    const groups: { items: Annotation[]; rect: DOMRect; block: TextBlock; range: Range }[] = [];
    for (const block of visible) {
      const records = itemsByBlock.get(block);
      if (!records?.length) continue;
      const boundary = block.element.getBoundingClientRect();
      if (!boundary.width || boundary.bottom <= marginTop() || boundary.top >= innerHeight - 12)
        continue;
      const blockGroups: typeof groups = [];
      for (const { item, reference } of records) {
        const line = block && lineFromReference(block, reference);
        const rect =
          line &&
          [...line.range.getClientRects()].find((rect) => rect.width > 0 && rect.height > 0);
        if (!rect || rect.bottom <= marginTop() || rect.top >= innerHeight - 12) continue;
        const group = blockGroups.find(
          (group) =>
            group.block === block &&
            rect.top < group.rect.bottom - 2 &&
            rect.bottom > group.rect.top + 2,
        );
        if (group) group.items.push(item);
        else blockGroups.push({ items: [item], rect, block, range: line!.range });
      }
      groups.push(...blockGroups);
    }
    const retained = new Set<string>();
    rows = [];
    for (const group of groups) {
      const key = group.items[0].fragment;
      retained.add(key);
      let button = buttons.get(key);
      if (!button) {
        button = template.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
        buttons.set(key, button);
        button.addEventListener('click', () => {
          const row = rows.find((row) => row.button === button);
          if (row) open(row.items, rail.opener(button!));
        });
      }
      const commentsKnown = group.items.every((item) => item.comments !== undefined);
      const repliesKnown = group.items.every((item) => item.replies !== undefined);
      const comments = group.items.reduce((total, item) => total + (item.comments || 0), 0);
      const replies = group.items.reduce((total, item) => total + (item.replies || 0), 0);
      const complete = commentsKnown && repliesKnown;
      const total = comments + replies;
      const display = complete ? String(total) : total ? `${total}+` : '…';
      const counter = button.querySelector<HTMLElement>('[data-line-annotation-count]')!;
      if (counter.textContent !== display) counter.textContent = display;
      const counts = commentsKnown
        ? `${comments} ${comments === 1 ? 'comment' : 'comments'}${repliesKnown ? ` and ${replies} ${replies === 1 ? 'reply' : 'replies'}` : '; reply count unavailable'}`
        : 'count unavailable';
      const label = `Open ${group.items.length > 1 ? `${group.items.length} annotations` : 'annotation'}: ${display} total (${counts}). ${group.items[0].quote.slice(0, 100)}`;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.dataset.lineAnnotationBadge = key;
      button.dataset.annotationThreads = String(group.items.length);
      button.dataset.annotationTotal = complete ? String(total) : '';
      button.setAttribute(
        'aria-expanded',
        String(group.items.some((item) => item.fragment === active)),
      );
      const row = {
        items: group.items,
        top: group.rect.top,
        bottom: group.rect.bottom,
        block: group.block,
        range: group.range,
        button,
      };
      rows.push(row);
      button.hidden =
        group.rect.bottom <= marginTop() ||
        group.rect.top >= innerHeight - 12 ||
        Boolean(keyboardLine && sameRow(keyboardLine, row));
    }
    rail.update(
      'annotations',
      rows
        .filter((row) => !row.button.hidden)
        .map((row) => ({
          key: row.items[0].fragment,
          kind: 'annotation',
          button: row.button,
          rect: () =>
            [...row.range.getClientRects()].find((rect) => rect.width > 0 && rect.height > 0) ||
            null,
        })),
    );
    for (const [key, button] of buttons) {
      if (!retained.has(key)) {
        button.remove();
        buttons.delete(key);
      }
    }
  };
  return {
    place,
    update(value: Annotation[]) {
      itemsByBlock.clear();
      for (const item of value) {
        const reference = parseLineFragment(item.fragment);
        const block = reference && byKey.get(reference.key);
        if (!block || !reference) continue;
        const group = itemsByBlock.get(block) || [];
        group.push({ item, reference });
        itemsByBlock.set(block, group);
      }
    },
    at(line: TextLine) {
      return rows.find((row) => sameRow(line, row))?.button;
    },
    active(fragment: string) {
      active = fragment;
    },
    destroy() {
      visibility.disconnect();
      rail.update('annotations', []);
    },
  };
}
