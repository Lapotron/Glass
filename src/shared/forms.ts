export function rangeFill(value: number, min: number, max: number) {
  return `${Math.max(0, Math.min(100, ((value - min) / (max - min || 1)) * 100))}%`;
}
export function updateRange(input: HTMLInputElement) {
  input.style.setProperty(
    '--range-fill',
    rangeFill(input.valueAsNumber, Number(input.min || 0), Number(input.max || 100)),
  );
}
/** Keep native controls and their keyboard behavior; enhance only their visual value track. */
export function startFormControls() {
  const scan = (node: Element) => {
    if (node instanceof HTMLInputElement && node.type === 'range') updateRange(node);
    node.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(updateRange);
    node.querySelectorAll<HTMLInputElement>('input[data-mixed-checkbox]').forEach((input) => {
      input.indeterminate = true;
      input.removeAttribute('data-mixed-checkbox');
    });
  };
  scan(document.documentElement);
  document.addEventListener(
    'input',
    (event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'range')
        updateRange(event.target);
    },
    true,
  );
  document.addEventListener('reset', (event) => {
    if (event.target instanceof HTMLFormElement)
      requestAnimationFrame(() => scan(event.target as HTMLFormElement));
  });
  new MutationObserver((records) => {
    for (const record of records) {
      if (
        record.type === 'attributes' &&
        record.target instanceof HTMLInputElement &&
        record.target.type === 'range'
      )
        updateRange(record.target);
      for (const node of record.addedNodes) if (node instanceof Element) scan(node);
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['value', 'min', 'max', 'type'],
  });
}
