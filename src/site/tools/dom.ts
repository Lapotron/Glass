import { setUiText, uiAttrs } from '../../shared/i18n.js';
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) setUiText(node, text);
  return node;
}
export function icon(name: string) {
  const template = document.querySelector<HTMLTemplateElement>(
    `template[data-tools-icon="${name}"]`,
  );
  return template?.content.cloneNode(true) || document.createTextNode('');
}
export function button(
  label: string,
  click: () => void,
  iconName?: string,
  className = 'button secondary',
) {
  const node = element('button', className);
  node.type = 'button';
  if (iconName) node.append(icon(iconName));
  node.append(element('span', '', label));
  node.addEventListener('click', click);
  return node;
}
export function field(label: string, input: HTMLElement) {
  const node = element('label', 'tools-field');
  node.append(element('span', '', label), input);
  return node;
}
export function select(
  label: string,
  rows: readonly (readonly [string, string])[],
  change?: () => void,
) {
  const node = element('select');
  Object.entries(uiAttrs({ 'aria-label': label })).forEach(([key, value]) =>
    node.setAttribute(key, value),
  );
  for (const [value, label] of rows) {
    const option = element('option', '', label);
    option.value = value;
    node.append(option);
  }
  if (change) node.addEventListener('change', change);
  return node;
}
export function input(label: string, value = '', type = 'text') {
  const node = element('input');
  node.type = type;
  node.value = value;
  node.autocomplete = 'off';
  node.spellcheck = false;
  Object.entries(uiAttrs({ 'aria-label': label })).forEach(([key, value]) =>
    node.setAttribute(key, value),
  );
  return node;
}
export async function copyText(source: string, status: HTMLElement) {
  try {
    await navigator.clipboard.writeText(source);
    setUiText(status, 'Copied.');
  } catch {
    setUiText(status, 'Copy is unavailable. Select the output and copy it manually.');
  }
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = [...filename]
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || /[\\/]/.test(c) ? '_' : c))
    .join('');
  // Workspace exports are local blobs and never go through reader download analytics.
  link.dataset.toolsDownload = '';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The operation could not finish.';
}
