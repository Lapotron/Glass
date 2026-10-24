import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../shared/ui.js';
import {
  getUiLocale,
  subscribeUiLocale,
  uiLocales,
  localeNames,
  t,
  type UiLocale,
} from '../shared/i18n.js';
import { setUiLocale } from '../shared/ui-locale.js';
export function useUiLocale() {
  return useSyncExternalStore<UiLocale>(subscribeUiLocale, getUiLocale, () => 'en');
}
export function LanguageControl() {
  const locale = useUiLocale(),
    id = useId();
  const button = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false);
  const close = () => {
    menu.current?.hidePopover();
    button.current?.focus({ preventScroll: true });
  };
  return (
    <div className="studio-language-control">
      <button
        type="button"
        className="studio-language-button"
        ref={button}
        popoverTarget={id}
        popoverTargetAction="toggle"
        aria-label={t('Interface language: {language}', { language: localeNames[locale] })}
        aria-haspopup="menu"
        aria-controls={id}
        aria-expanded={open}
        aria-busy={busy}
        title={t('Interface language')}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            menu.current?.showPopover();
            menu.current
              ?.querySelector<HTMLElement>('[aria-checked="true"]')
              ?.focus({ preventScroll: true });
          }
        }}
      >
        <Icon
          name={busy ? 'LoaderCircle' : 'Languages'}
          size={15}
          className={busy ? 'spin' : undefined}
        />
        <span lang={locale}>{localeNames[locale]}</span>
        <Icon name="ChevronDown" className="studio-language-chevron" size={12} />
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="menu"
        aria-label={t('Interface language')}
        className="studio-language-menu glass-panel"
        data-liquid="surface"
        onToggle={(event) => {
          const panel = event.currentTarget,
            visible = panel.matches(':popover-open');
          setOpen(visible);
          if (!visible) return;
          const rect = button.current!.getBoundingClientRect();
          panel.style.left =
            Math.max(
              12,
              Math.min(rect.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 12),
            ) + 'px';
          panel.style.top =
            Math.max(12, Math.min(rect.bottom + 10, innerHeight - panel.offsetHeight - 12)) + 'px';
          if (!panel.contains(document.activeElement))
            panel
              .querySelector<HTMLElement>('[aria-checked="true"]')
              ?.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => {
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
          ];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
      >
        <p className="studio-language-menu-title">{t('Interface language')}</p>
        {uiLocales.map((value) => (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={locale === value}
            disabled={busy}
            key={value}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await setUiLocale(value);
                close();
              } catch (failure) {
                setError((failure as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <span lang={value}>{localeNames[value]}</span>
            <Icon name="Check" size={15} />
          </button>
        ))}
        {error && (
          <p className="help" role="alert">
            {t(error)}
          </p>
        )}
      </div>
    </div>
  );
}
