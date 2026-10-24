import { t, isUiCatalog, isUiLocale, getUiLocale, installUiLocale, uiCacheKey, uiPreferenceKey, type UiLocale, type UiCatalog, type UiParams } from './i18n.js';
let loader: ((locale: UiLocale) => Promise<UiCatalog>) | undefined;
let scope: 'reader'|'studio' = 'reader';
let sequence = 0;
/** Only deliberate UI leaves and a small allowlist of text attributes are changed. */
export function translateUi(root: ParentNode = document) {
  for (const node of root.querySelectorAll<HTMLElement>('[data-ui]')) {
    if (node.closest('[data-no-ui]')) continue;
    let params: UiParams | undefined;
    try { params = JSON.parse(node.dataset.uiParams || 'null') || undefined; } catch { /* English fallback. */ }
    const value = t(node.dataset.ui!, params);
    if (node.textContent !== value) node.textContent = value;
    node.lang = getUiLocale();
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-ui-attrs]')) {
    try {
      const values = JSON.parse(node.dataset.uiAttrs!) as Record<string, string>;
      const params = JSON.parse(node.dataset.uiParams || 'null') as UiParams | undefined;
      for (const [attribute, key] of Object.entries(values))
        if (['aria-label', 'aria-description', 'title', 'placeholder', 'alt'].includes(attribute))
          node.setAttribute(attribute, t(key,params));
    } catch { /* Invalid optional metadata must not break a page. */ }
  }
  let labels: Record<string, Record<string, {name?: string; singular?: string}>> = {};
  try { labels = JSON.parse(document.getElementById('ui-collection-labels')?.textContent || '{}'); } catch { /* No overrides. */ }
  for (const node of root.querySelectorAll<HTMLElement>('[data-ui-collection]')) {
    const form = node.dataset.uiForm === 'singular' ? 'singular' : 'name';
    const value = labels[getUiLocale()]?.[node.dataset.uiCollection!]?.[form] || node.dataset.uiSource || '';
    if (node.textContent !== value) node.textContent = value;
  }
  for (const select of root.querySelectorAll<HTMLSelectElement>('select[data-ui-language]')) select.value = getUiLocale();
}
export async function setUiLocale(next: UiLocale) {
  if (!isUiLocale(next)) return;
  const request = ++sequence;
  let nextCatalog: UiCatalog = {};
  if (next !== 'en') {
    try { const cached: unknown = JSON.parse(localStorage.getItem(uiCacheKey(next, scope)) || '{}'); if (isUiCatalog(cached)) nextCatalog = cached; } catch { /* Storage is optional. */ }
    if (loader) {
      try { nextCatalog = await loader(next); }
      catch { if (!Object.keys(nextCatalog).length) throw new Error('Language tools could not load. Please retry.'); }
    }
  }
  if (request !== sequence) return;
  installUiLocale(next,nextCatalog);
  try {
    localStorage.setItem(uiPreferenceKey(scope), next);
    if (next !== 'en') localStorage.setItem(uiCacheKey(next, scope), JSON.stringify(nextCatalog));
  } catch { /* The selected language still works for this page. */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.documentElement.dataset.uiLocale = next;
    if (scope === 'reader') translateUi();
    dispatchEvent(new CustomEvent('glass:language', { detail: next }));
  }

}
export async function startUiLocale(surface: 'reader' | 'studio', load: (locale: UiLocale) => Promise<UiCatalog>) {
  scope = surface;
  loader = load;
  let saved: UiLocale = 'en';
  try { const value = localStorage.getItem(uiPreferenceKey(surface)); if (isUiLocale(value)) saved = value; } catch { /* English by default. */ }
  await setUiLocale(saved).catch(() => undefined);
  addEventListener('storage', (event) => {
    if (event.key === uiPreferenceKey(surface) && isUiLocale(event.newValue)) void setUiLocale(event.newValue).catch(() => undefined);
  });
}
