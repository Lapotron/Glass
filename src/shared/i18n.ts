/** Interface language is independent of authored content and public routes. */
export const uiLocales = ['en', 'zh-Hans', 'zh-Hant'] as const;
export type UiLocale = (typeof uiLocales)[number];
export type UiParams = Record<string, string | number | null | undefined>;
export type UiCatalog = Record<string, string>;
export type UiMessageKey = keyof typeof import('../locales/en.json');
export const isUiCatalog = (value: unknown): value is UiCatalog =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length <= 5000 &&
  Object.entries(value).every(
    ([key, text]) => key.length <= 1000 && typeof text === 'string' && text.length <= 4000,
  );
export const localeNames: Record<UiLocale, string> = {
  en: 'English',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
};
export const isUiLocale = (value: unknown): value is UiLocale =>
  typeof value === 'string' && (uiLocales as readonly string[]).includes(value);
let locale: UiLocale = 'en';
let catalog: UiCatalog = {};
const listeners = new Set<() => void>();
export const getUiLocale = () => locale;
export const subscribeUiLocale = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const uiPreferenceKey = (surface: 'reader' | 'studio') => `glass-${surface}-language-v1`;
export const uiCacheKey = (language: UiLocale, surface = 'reader') =>
  `glass-ui-${surface}-v1-${language}`;
export function t(message: string, params?: UiParams): string {
  const value =
    locale !== 'en' && typeof catalog[message] === 'string' ? catalog[message] : message;
  return params
    ? value.replace(/\{(\w+)\}/g, (match, key: string) => String(params[key] ?? match))
    : value;
}
/** Keep a changing UI leaf's marker current for subsequent language changes. */
export function setUiText(node: HTMLElement, message: string, params?: UiParams) {
  node.dataset.ui = message;
  if (params) node.dataset.uiParams = JSON.stringify(params);
  else delete node.dataset.uiParams;
  node.textContent = t(message, params);
}
export function uiNumber(value: number, options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function uiDate(value: string | number | Date, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(new Date(value));
}
export function uiCount(count: number, single: string, many: string) {
  return t(new Intl.PluralRules(locale).select(count) === 'one' ? single : many, {
    count: uiNumber(count),
  });
}
export function installUiLocale(next: UiLocale, values: UiCatalog) {
  locale = next;
  catalog = values;
  listeners.forEach((listener) => listener());
}
export const currentUiCatalog = () => catalog;
export const uiAttrs = (values: Record<string, string>, params?: UiParams) => ({
  'data-ui-attrs': JSON.stringify(values),
  ...(params ? { 'data-ui-params': JSON.stringify(params) } : {}),
  ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, t(value, params)])),
});
