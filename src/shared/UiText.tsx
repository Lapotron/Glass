import { useSyncExternalStore } from 'react';
import { getUiLocale, subscribeUiLocale, t, type UiParams } from './i18n.js';
/** Static pages receive explicit translation leaves; Studio updates without remounting. */
export function UiText({ message, params }: { message: string; params?: UiParams }) {
  useSyncExternalStore(subscribeUiLocale, getUiLocale, () => 'en');
  return <span lang={getUiLocale()} data-ui={message} data-ui-params={params ? JSON.stringify(params) : undefined}>{t(message, params)}</span>;
}
