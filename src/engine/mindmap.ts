import {
  mapNodes,
  renderMindmapSvg,
  validateMindmap,
  type MindmapDocument,
} from '../shared/mindmap.js';
import { escapeHtml } from '../shared/utils.js';
import { renderIcon } from './icons.js';
export function renderMindmap(document: MindmapDocument, namespace: string) {
  validateMindmap(document);
  const button = (
    action: string,
    label: string,
    icon?: Parameters<typeof renderIcon>[0],
    compact = false,
  ) =>
    `<button type="button" class="button small secondary${compact ? ' mindmap-icon' : ''}" data-map-action="${action}" aria-label="${label}" title="${label}" disabled>${icon ? renderIcon(icon, 15) : ''}<span${compact ? ' class="sr-only"' : ''}>${label}</span></button>`;
  return `<div class="mindmap-stage" data-map-document="${escapeHtml(JSON.stringify(document))}" data-map-namespace="${namespace}">
    <div class="mindmap-toolbar"><div class="mindmap-views" role="group" aria-label="Mindmap layout"><button type="button" data-map-layout="map" aria-pressed="${document.layout === 'map'}" disabled>${renderIcon('Workflow', 15)}Map</button><button type="button" data-map-layout="tree" aria-pressed="${document.layout === 'tree'}" disabled>${renderIcon('ListTree', 15)}Tree</button></div><div class="mindmap-search"><input type="search" aria-label="Find mindmap nodes" placeholder="Find a node…" disabled />${button('previous-match', 'Previous node match', 'ChevronLeft', true)}${button('next-match', 'Next node match', 'ChevronRight', true)}<span data-map-matches role="status"></span></div></div>
    <div class="mindmap-canvas" tabindex="0" role="tree" aria-label="${escapeHtml(document.title)}. Arrow keys navigate nodes; Space collapses a branch. Use Explore for touch gestures."><div class="mindmap-transform"><div data-diagram-variant="light">${renderMindmapSvg(document, 'light', namespace)}</div><div data-diagram-variant="dark">${renderMindmapSvg(document, 'dark', namespace)}</div></div></div>
    <div class="mindmap-tools" role="toolbar" aria-label="Mindmap controls"><div class="mindmap-zoom">${button('out', 'Zoom out', 'ZoomOut', true)}<output data-map-zoom>Fit</output>${button('in', 'Zoom in', 'ZoomIn', true)}${button('reset', 'Fit map', 'Expand')}${button('actual', '100%')}</div><div class="mindmap-view-actions">${button('explore', 'Explore map', 'MoveHorizontal')}${button('expand', 'Expand mindmap', 'Maximize2')}<details class="mindmap-more"><summary>More</summary><div class="mindmap-more-actions">${button('collapse-all', 'Collapse branches', 'PanelLeftClose')}${button('expand-all', 'Expand all branches', 'ListTree')}<label>Show depth<select data-map-depth disabled aria-label="Mindmap depth"><option value="all">All levels</option><option value="1">First level</option><option value="2">Two levels</option><option value="3">Three levels</option></select></label>${button('export-svg', 'Download SVG', 'Download')}${button('export-png', 'Download PNG', 'Image')}${button('copy', 'Copy Markdown outline', 'Copy')}</div></details></div></div>
    <p class="mindmap-status" data-map-status role="status">${mapNodes(document.root).length} nodes · View the text outline below for a readable alternative.</p></div>`;
}
