/** Public rendered-text anchors; never expose private Markdown source positions. */
import type { LineReference } from '../shared/line-references.js';
export { lineFragment, parseLineFragment, type LineReference } from '../shared/line-references.js';
export const lineBlockSelector =
  'p,h1,h2,h3,h4,h5,h6,li,figcaption,td,th,dt,dd,.shiki .line,[data-code-line],.math-display';
const excluded =
  '[data-interactive],.diagram,.code-toolbar,.md-discussion,.gutter,button,input,select,textarea,script,style,svg,[aria-hidden="true"],.sr-only';
type Segment = { node: Text | HTMLElement; text: string; start: number; end: number };
export type TextBlock = {
  element: HTMLElement;
  text: string;
  segments: Segment[];
  key: string;
  lines?: TextLine[];
  width?: number;
  typography?: string;
};
export type TextLine = {
  block: TextBlock;
  start: number;
  end: number;
  range: Range;
  quote: string;
};
export async function textBlockKey(kind: string, text: string, occurrence: number) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}\0${text}`));
  return `${[...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 20)}-${occurrence}`;
}
function segmentsFor(element: HTMLElement) {
  const segments: Segment[] = [];
  let text = '';
  const add = (node: Text | HTMLElement, value: string) => {
    segments.push({ node, text: value, start: text.length, end: text.length + value.length });
    text += value;
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) add(node as Text, node.textContent);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.matches('.math-inline,.math-display')) {
      add(node, node.getAttribute('aria-label') || 'Equation');
      return;
    }
    if (node.matches(excluded)) return;
    if (node !== element && node.matches(lineBlockSelector)) return;
    node.childNodes.forEach(walk);
  };
  walk(element);
  return { text, segments };
}
export async function indexTextBlocks(article: HTMLElement): Promise<TextBlock[]> {
  const seen = new Map<string, number>();
  const elements = [...article.querySelectorAll<HTMLElement>(lineBlockSelector)].filter(
    (element) =>
      !element.closest('[data-interactive],.diagram,.code-toolbar,.md-discussion') &&
      !element.parentElement?.closest('.math-inline,.math-display'),
  );
  return Promise.all(
    elements.map(async (element) => {
      const { text, segments } = segmentsFor(element);
      const kind = element.matches('.shiki .line,[data-code-line]')
        ? 'code'
        : element.tagName.toLowerCase();
      const identity = `${kind}\0${text}`;
      const occurrence = (seen.get(identity) || 0) + 1;
      seen.set(identity, occurrence);
      return { element, text, segments, key: await textBlockKey(kind, text, occurrence) };
    }),
  ).then((blocks) => blocks.filter((block) => block.text.trim()));
}
export function rangeFor(block: TextBlock, start: number, end: number): Range | null {
  if (start < 0 || end <= start || end > block.text.length) return null;
  const first = block.segments.find((segment) => segment.end > start);
  const last = block.segments.find((segment) => segment.end >= end);
  if (!first || !last) return null;
  const range = document.createRange();
  if (first.node instanceof Text) range.setStart(first.node, start - first.start);
  else range.setStartBefore(first.node);
  if (last.node instanceof Text) range.setEnd(last.node, end - last.start);
  else range.setEndAfter(last.node);
  return range;
}
export function lineFromReference(block: TextBlock, reference: LineReference): TextLine | null {
  const range = rangeFor(block, reference.start, reference.end);
  return range
    ? { block, ...reference, range, quote: block.text.slice(reference.start, reference.end) }
    : null;
}
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function textLines(block: TextBlock): TextLine[] {
  const width = block.element.getBoundingClientRect().width;
  const style = getComputedStyle(block.element);
  const typography = [
    style.fontFamily,
    style.fontSize,
    style.fontWeight,
    style.lineHeight,
    style.letterSpacing,
  ].join('|');
  if (block.lines && block.typography === typography && Math.abs((block.width || 0) - width) < 0.5)
    return block.lines;
  block.typography = typography;
  if (!width || !block.element.getClientRects().length) return [];
  const rows: { start: number; end: number; top: number; bottom: number }[] = [];
  for (const segment of block.segments) {
    const parts =
      segment.node instanceof Text
        ? [...graphemes.segment(segment.text)]
        : [{ index: 0, segment: segment.text }];
    for (const part of parts) {
      const start = segment.start + part.index,
        end = start + part.segment.length;
      const range = rangeFor(block, start, end)!;
      const rect = range.getBoundingClientRect();
      if (rect.width < 0.1 || rect.height < 1) continue;
      const row = rows.at(-1);
      if (row && rect.top < row.bottom - 2 && rect.bottom > row.top + 2) row.end = end;
      else rows.push({ start, end, top: rect.top, bottom: rect.bottom });
    }
  }
  block.width = width;
  block.lines = rows.flatMap((row) => {
    let { start, end } = row;
    if (!block.element.matches('.shiki .line,[data-code-line]')) {
      while (start < end && /\s/.test(block.text[start])) start++;
      while (end > start && /\s/.test(block.text[end - 1])) end--;
    }
    const range = rangeFor(block, start, end);
    return range && end - start <= 2000
      ? [{ block, start, end, range, quote: block.text.slice(start, end) }]
      : [];
  });
  return block.lines;
}
