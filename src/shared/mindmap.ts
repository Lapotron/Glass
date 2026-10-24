import { escapeHtml } from './utils.js';

export type MindmapNode = { id: string; label: string; children: MindmapNode[] };
export type MindmapDocument = {
  version: 1;
  title: string;
  layout: 'map' | 'tree';
  root: MindmapNode;
};
export type MapPosition = {
  node: MindmapNode;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  side: number;
  branch: number;
  parent?: string;
  depth: number;
};
export function mapNodes(root: MindmapNode): MindmapNode[] {
  return [root, ...root.children.flatMap(mapNodes)];
}
export function validateMindmap(value: unknown): asserts value is MindmapDocument {
  const document = value as MindmapDocument,
    ids = new Set<string>();
  if (
    !document ||
    document.version !== 1 ||
    !['map', 'tree'].includes(document.layout) ||
    typeof document.title !== 'string'
  )
    throw new Error('Unsupported mindmap document.');
  const visit = (node: MindmapNode, depth: number) => {
    if (
      !node ||
      typeof node.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(node.id) ||
      ids.has(node.id) ||
      typeof node.label !== 'string' ||
      !node.label.trim() ||
      !Array.isArray(node.children) ||
      depth > 11 ||
      ids.size >= 201
    )
      throw new Error('Invalid mindmap tree.');
    ids.add(node.id);
    node.children.forEach((child) => visit(child, depth + 1));
  };
  visit(document.root, 1);
}
function labelLines(label: string) {
  const lines: string[] = [];
  let line = '',
    units = 0;
  for (const character of label.replace(/\s+/g, ' ')) {
    const size = /[\u2e80-\uffff]/u.test(character) ? 2 : 1;
    if (units + size > 25) {
      lines.push(line.trim());
      line = '';
      units = 0;
    }
    line += character;
    units += size;
    if (lines.length === 4) break;
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.join('').length < label.replace(/\s/g, '').length && lines.length >= 4)
    lines[3] = lines[3].slice(0, -1) + '…';
  return lines.slice(0, 4);
}
export function layoutMindmap(document: MindmapDocument, collapsed = new Set<string>()) {
  const positions: MapPosition[] = [],
    dimensions = new Map<
      string,
      { width: number; height: number; lines: string[]; span: number }
    >();
  const visibleChildren = (node: MindmapNode) => (collapsed.has(node.id) ? [] : node.children);
  const measure = (node: MindmapNode) => {
    const lines = labelLines(node.label),
      width = Math.max(
        node === document.root ? 130 : 94,
        Math.min(
          220,
          Math.max(
            ...lines.map((line) =>
              [...line].reduce((n, c) => n + (/[\u2e80-\uffff]/u.test(c) ? 14 : 7.4), 0),
            ),
          ) + 32,
        ),
      );
    const height = lines.length * 21 + 24;
    const children = visibleChildren(node);
    const span = Math.max(
      height + 26,
      children.reduce((sum, child) => sum + measure(child).span, 0),
    );
    const result = { width, height, lines, span };
    dimensions.set(node.id, result);
    return result;
  };
  measure(document.root);
  const place = (
    node: MindmapNode,
    x: number,
    y: number,
    side: number,
    branch: number,
    depth: number,
    parent?: string,
  ) => {
    const box = dimensions.get(node.id)!;
    positions.push({ node, x, y, side, branch, parent, depth, ...box });
    const children = visibleChildren(node),
      total = children.reduce((sum, child) => sum + dimensions.get(child.id)!.span, 0);
    let top = y - total / 2;
    for (const child of children) {
      const size = dimensions.get(child.id)!;
      place(
        child,
        x + side * (box.width / 2 + 64 + size.width / 2),
        top + size.span / 2,
        side,
        branch,
        depth + 1,
        node.id,
      );
      top += size.span;
    }
  };
  const rootBox = dimensions.get(document.root.id)!;
  positions.push({ node: document.root, x: 0, y: 0, side: 1, branch: 0, depth: 0, ...rootBox });
  const sides: { node: MindmapNode; branch: number }[][] = [[], []],
    spans = [0, 0];
  visibleChildren(document.root).forEach((node, branch) => {
    const index = document.layout === 'tree' ? 1 : spans[1] <= spans[0] ? 1 : 0;
    sides[index].push({ node, branch });
    spans[index] += dimensions.get(node.id)!.span;
  });
  sides.forEach((nodes, index) => {
    let top = -spans[index] / 2;
    const side = index ? 1 : -1;
    nodes.forEach(({ node, branch }) => {
      const box = dimensions.get(node.id)!;
      place(
        node,
        side * (rootBox.width / 2 + 64 + box.width / 2),
        top + box.span / 2,
        side,
        branch,
        1,
        document.root.id,
      );
      top += box.span;
    });
  });
  const left = Math.min(...positions.map((p) => p.x - p.width / 2)) - 42,
    top = Math.min(...positions.map((p) => p.y - p.height / 2)) - 32;
  const right = Math.max(...positions.map((p) => p.x + p.width / 2)) + 42,
    bottom = Math.max(...positions.map((p) => p.y + p.height / 2)) + 32;
  return { positions, x: left, y: top, width: right - left, height: bottom - top };
}
export function renderMindmapSvg(
  document: MindmapDocument,
  theme: 'light' | 'dark',
  namespace: string,
  collapsed = new Set<string>(),
  selected = '',
  matches = new Set<string>(),
) {
  const geometry = layoutMindmap(document, collapsed),
    byId = new Map(geometry.positions.map((p) => [p.node.id, p]));
  const colors =
    theme === 'dark'
      ? ['#8ca9f0', '#7ec8b6', '#b3a0df', '#ddbb7c', '#dba0b3']
      : ['#4775d1', '#2e8a77', '#8365b4', '#9a722f', '#af5e7d'];
  const ink = theme === 'dark' ? '#e8edf5' : '#162033',
    fill = theme === 'dark' ? '#23334c' : '#e1ebf8';
  const links = geometry.positions
    .filter((p) => p.parent)
    .map((p) => {
      const parent = byId.get(p.parent!)!,
        from = parent.x + (p.side * parent.width) / 2,
        to = p.x - (p.side * p.width) / 2,
        middle = (from + to) / 2;
      return `<path d="M${from},${parent.y} C${middle},${parent.y} ${middle},${p.y} ${to},${p.y}" fill="none" stroke="${colors[p.branch % colors.length]}" stroke-opacity=".55" stroke-width="1.6"/>`;
    })
    .join('');
  const nodes = geometry.positions
    .map((p) => {
      const color = colors[p.branch % colors.length],
        active = p.node.id === selected,
        match = matches.has(p.node.id),
        count = mapNodes(p.node).length - 1;
      return `<g id="${namespace}-${theme}-${p.node.id}" class="mindmap-node${active ? ' is-selected' : ''}${match ? ' is-match' : ''}" data-map-node="${p.node.id}" role="treeitem" aria-level="${p.depth + 1}" aria-label="${escapeHtml(p.node.label)}"${count ? ` aria-expanded="${!collapsed.has(p.node.id)}"` : ''} tabindex="-1" transform="translate(${p.x},${p.y})"><title>${escapeHtml(p.node.label)}</title><rect class="mindmap-node-fill" x="${-p.width / 2}" y="${-p.height / 2}" width="${p.width}" height="${p.height}" rx="${p.depth ? 12 : 18}" fill="${fill}" fill-opacity="${p.depth ? '.48' : '.85'}" stroke="${active || match ? color : color + '66'}" stroke-width="${active || match ? 2.5 : 1}"/><text text-anchor="middle" fill="${ink}" font-family="system-ui,sans-serif" font-size="14" font-weight="${p.depth ? 450 : 650}">${p.lines.map((line, index) => `<tspan x="0" y="${-(p.lines.length - 1) * 10.5 + index * 21 + 5}">${escapeHtml(line)}</tspan>`).join('')}</text>${count ? `<g class="mindmap-node-toggle" data-map-toggle="${p.node.id}" transform="translate(${(p.side * p.width) / 2},0)"><circle r="11" fill="${fill}" stroke="${color}"/><text text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="12" fill="${ink}">${collapsed.has(p.node.id) ? '+' : '−'}</text></g>` : ''}</g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="mindmap-drawing" width="${geometry.width}" height="${geometry.height}" viewBox="${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}" role="group" aria-label="${escapeHtml(document.title)}"><g class="mindmap-edges" aria-hidden="true">${links}</g>${nodes}</svg>`;
}
export function mindmapOutline(root: MindmapNode, depth = 0): string {
  return (
    `${'  '.repeat(depth)}- ${root.label.replace(/[\r\n]+/g, ' ')}\n` +
    root.children.map((child) => mindmapOutline(child, depth + 1)).join('')
  );
}
