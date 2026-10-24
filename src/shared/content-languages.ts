import { getUiLocale } from './i18n.js';

/** Content codes remain independent of the three supported interface locales. */
export const contentLanguages = [
  'en',
  'zh',
  'zh-Hans',
  'zh-Hant',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'pt',
  'it',
  'ru',
  'uk',
  'ar',
  'hi',
  'bn',
  'id',
  'ms',
  'vi',
  'th',
  'tr',
  'nl',
  'pl',
  'sv',
  'da',
  'fi',
  'no',
  'cs',
  'el',
  'he',
  'fa',
  'ro',
  'hu',
] as const;
const names = new Map<string, Intl.DisplayNames>();
export function contentLanguageName(code: string, locale: string = getUiLocale()) {
  try {
    let display = names.get(locale);
    if (!display) {
      display = new Intl.DisplayNames([locale], { type: 'language' });
      names.set(locale, display);
    }
    return display.of(code) || code;
  } catch {
    return code;
  }
}
export function languageOptionLabel(code: string) {
  const native: Record<string, string> = {
    zh: '中文',
    'zh-Hans': '简体中文',
    'zh-CN': '简体中文',
    'zh-Hant': '繁體中文',
    'zh-TW': '繁體中文',
  };
  const endonym = native[code] || contentLanguageName(code, code);
  // ICU differs in capitalization between browser engines; keep visible choices uniform.
  return endonym.charAt(0).toUpperCase() + endonym.slice(1);
}
