/** Lightweight caption lookup; cloning and serialization load only when a viewer opens. */
export function diagramTitle(svg: SVGSVGElement) {
  const ids = (svg.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  return (
    ids
      .map((id) => svg.querySelector(`[id="${CSS.escape(id)}"]`)?.textContent?.trim())
      .filter(Boolean)
      .join(' ') ||
    svg.querySelector(':scope > title')?.textContent?.trim() ||
    ''
  );
}
