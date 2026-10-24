import {
  applyReaderPreferences,
  parseReaderPreferences,
  readReaderPreferences,
  readerDefaults,
  readerStorageKey,
  restoreReaderWallpaper,
  saveReaderPreferences,
} from '../shared/reader-preferences.js';

/** Small shared lifecycle; the Settings form and picture tools are loaded separately. */
export function startReaderPreferences() {
  if (document.documentElement.dataset.preview) return;
  const defaults = readerDefaults();
  if (!defaults) return;
  const listeners = new Set<(saved: boolean) => void>();
  const session = {
    defaults,
    preferences: readReaderPreferences(),
    generation: 0,
    subscribe(listener: (saved: boolean) => void) {
      listeners.add(listener);
    },
    notify(saved = true) {
      for (const listener of listeners) listener(saved);
    },
    apply(save = false) {
      session.preferences = parseReaderPreferences(session.preferences);
      applyReaderPreferences(defaults, session.preferences);
      const saved = !save || saveReaderPreferences(session.preferences);
      document
        .querySelector('[data-theme-toggle]')
        ?.setAttribute(
          'aria-label',
          'Switch to ' +
            (document.documentElement.dataset.theme === 'light' ? 'dark' : 'light') +
            ' appearance',
        );
      session.notify(saved);
    },
  };
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    session.preferences.theme.appearance =
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    session.apply(true);
  });
  for (const media of [
    '(prefers-color-scheme: dark)',
    '(prefers-reduced-motion: reduce)',
    '(prefers-reduced-transparency: reduce)',
  ])
    matchMedia(media).addEventListener('change', () => session.apply());
  const refresh = () => {
    session.generation++;
    session.preferences = readReaderPreferences();
    session.apply();
    void restoreReaderWallpaper(defaults).then(() => session.notify());
  };
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === readerStorageKey) refresh();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) refresh();
  });
  return session;
}
export type ReaderSession = NonNullable<ReturnType<typeof startReaderPreferences>>;
