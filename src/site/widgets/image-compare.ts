import type { CompareConfig } from '../../shared/interactives.js';
export function enhance(node: HTMLElement, config: CompareConfig) {
  const comparison = node.querySelector<HTMLElement>('.comparison')!;
  const divider = node.querySelector<HTMLElement>('.compare-handle')!;
  let position = 50;
  let pointer: number | null = null;
  divider.tabIndex = 0;
  divider.setAttribute('aria-disabled', 'false');
  function update(value: number) {
    position = Math.max(0, Math.min(100, Math.round(value)));
    comparison.style.setProperty('--position', `${position}%`);
    divider.setAttribute('aria-valuenow', String(position));
    divider.setAttribute(
      'aria-valuetext',
      `${position}% ${config.beforeLabel}, ${100 - position}% ${config.afterLabel}`,
    );
  }
  function move(event: PointerEvent) {
    const bounds = comparison.getBoundingClientRect();
    if (bounds.width) update(((event.clientX - bounds.left) / bounds.width) * 100);
  }
  function release() {
    pointer = null;
    comparison.removeAttribute('data-dragging');
  }
  comparison.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    pointer = event.pointerId;
    comparison.setPointerCapture(pointer);
    comparison.dataset.dragging = 'true';
    divider.focus({ preventScroll: true });
    move(event);
    if (event.pointerType !== 'touch') event.preventDefault();
  });
  comparison.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointer) move(event);
  });
  comparison.addEventListener('pointerup', release);
  comparison.addEventListener('pointercancel', release);
  comparison.addEventListener('lostpointercapture', release);
  divider.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 1;
    const next = {
      ArrowLeft: position - step,
      ArrowDown: position - step,
      ArrowRight: position + step,
      ArrowUp: position + step,
      PageDown: position - 10,
      PageUp: position + 10,
      Home: 0,
      End: 100,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      update(next);
    }
  });
  update(position);
}
