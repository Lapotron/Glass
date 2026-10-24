import { isUiCatalog, isUiLocale, installUiLocale, uiCacheKey, uiPreferenceKey } from '../shared/i18n.js';
import { translateUi } from '../shared/ui-locale.js';
/** Cached public catalogs apply while HTML is parsed; prose is never hidden. */
export function prepaintUiLanguage() {
  if (document.documentElement.dataset.uiLanguageEnabled === 'false') return;
  try {
    const value=localStorage.getItem(uiPreferenceKey('reader'));
    if(!isUiLocale(value) || value === 'en')return;
    const values=JSON.parse(localStorage.getItem(uiCacheKey(value)) || '{}');
    if(!isUiCatalog(values))return;
    installUiLocale(value,values);
    document.documentElement.lang=value;
    document.documentElement.dataset.uiLocale=value;
    const update=() => translateUi();
    const observer=new MutationObserver(update);
    observer.observe(document.documentElement,{childList:true,subtree:true});
    addEventListener('DOMContentLoaded',() => {observer.disconnect();update();},{once:true});
  } catch { /* English stays readable if storage is unavailable. */ }
}
