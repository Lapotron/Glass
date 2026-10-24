import { prepaintUiLanguage } from './ui-prepaint.js';
import {
  applyReaderPreferences,
  readerDefaults,
  readReaderPreferences,
  restoreReaderWallpaper,
} from '../shared/reader-preferences.js';
import { syncBranding } from './branding.js';
const root = document.documentElement;
if (root.dataset.preview) {
  root.dataset.theme =
    root.dataset.appearance === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : root.dataset.appearance || 'light';
  root.dataset.articleFocus = String(readerDefaults()?.focusMode ?? false);
}
if (!root.dataset.preview) {
  const defaults = readerDefaults();
  if (defaults) {
    applyReaderPreferences(defaults, readReaderPreferences());
    void restoreReaderWallpaper(defaults);
  }
}
syncBranding();

if (!root.dataset.preview && !root.hasAttribute('data-studio')) prepaintUiLanguage();
