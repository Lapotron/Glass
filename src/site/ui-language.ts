import { isUiLocale, getUiLocale, t } from '../shared/i18n.js';
import { setUiLocale, startUiLocale } from '../shared/ui-locale.js';
export async function startUiLanguage() {
  if (document.documentElement.dataset.preview || document.documentElement.dataset.uiLanguageEnabled === 'false') return;
  await startUiLocale('reader',async (locale) => locale === 'zh-Hans' ? (await import('../locales/zh-Hans.public.json')).default : (await import('../locales/zh-Hant.public.json')).default);
  const sync = () => {
    document.querySelectorAll<HTMLInputElement>('input[data-ui-language]').forEach((input) => {input.checked = input.value === getUiLocale();});
  };
  sync();
  addEventListener('glass:language',sync);
  document.addEventListener('change',async (event) => {
    const control=event.target;
    if(!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement) || !control.hasAttribute('data-ui-language') || !isUiLocale(control.value))return;
    control.disabled=true;
    try {
      await setUiLocale(control.value);
      document.querySelectorAll<HTMLDetailsElement>('[data-ui-menu]').forEach((menu) => {menu.open=false;menu.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});});
    } catch(failure) {
      const status=document.querySelector('[data-ui-language-status]');
      if(status)status.textContent=t((failure as Error).message);
      if(control instanceof HTMLSelectElement)control.value=getUiLocale();
    } finally {control.disabled=false;sync();}
  });
  document.addEventListener('click',(event) => document.querySelectorAll<HTMLDetailsElement>('[data-ui-menu][open]').forEach((menu) => {if(!menu.contains(event.target as Node))menu.open=false;}));
  document.addEventListener('keydown',(event) => {if(event.key === 'Escape')document.querySelectorAll<HTMLDetailsElement>('[data-ui-menu][open]').forEach((menu) => {menu.open=false;menu.querySelector<HTMLElement>('summary')?.focus();});});
}
