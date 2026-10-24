import type { SiteConfig } from './contracts.js';
import { appearanceRanges, textScaleRange } from './appearance-ranges.js';
import { themeVariables } from './theme.js';
import { mergeContrast, parseContrastOverrides, type ContrastOverrides } from './contrast.js';

export type ReaderTheme = SiteConfig['theme'];
export type ReaderPreferences = {
  version: 1;
  theme: Partial<Omit<ReaderTheme, 'backgroundImage' | 'contrast' | 'textScale' | 'focusMode'>> & {
    contrast?: ContrastOverrides;
  };
  textScale?: number;
  focusMode?: boolean;
  wallpaper?: 'site' | 'none' | 'local';
  wallpaperPreview?: string;
};
export const readerStorageKey = 'fieldnotes-reader-v1';
export const readerRanges = appearanceRanges;
export const readerChoices = {
  appearance: ['system', 'light', 'dark'],
  background: ['sky', 'sand', 'mist'],
  fontFamily: ['system', 'serif', 'humanist'],
  wallpaperPosition: ['center', 'top', 'bottom'],
  wallpaperWash: ['auto', 'light', 'dark'],
} as const;

/** Storage is untrusted input. Keep only the small, bounded presentation vocabulary. */
export function parseReaderPreferences(input: unknown): ReaderPreferences {
  const result: ReaderPreferences = { version: 1, theme: {} };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  const value = input as Record<string, unknown>;
  if (value.version !== 1) return result;
  const theme =
    value.theme && typeof value.theme === 'object' ? (value.theme as Record<string, unknown>) : {};
  const output = result.theme as Record<string, unknown>;
  for (const [key, [min, max]] of Object.entries(readerRanges)) {
    const n = theme[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max) output[key] = n;
  }
  for (const [key, choices] of Object.entries(readerChoices))
    if ((choices as readonly unknown[]).includes(theme[key])) output[key] = theme[key];
  for (const key of ['reduceMotion', 'reduceTransparency'])
    if (typeof theme[key] === 'boolean') output[key] = theme[key];
  if (typeof theme.accent === 'string' && /^#[a-f\d]{6}$/i.test(theme.accent))
    output.accent = theme.accent;
  if (theme.contrast && typeof theme.contrast === 'object')
    output.contrast = parseContrastOverrides(theme.contrast);
  if (
    typeof value.textScale === 'number' &&
    value.textScale >= textScaleRange[0] &&
    value.textScale <= textScaleRange[1]
  )
    result.textScale = value.textScale;
  if (typeof value.focusMode === 'boolean') result.focusMode = value.focusMode;
  if (['site', 'none', 'local'].includes(value.wallpaper as string))
    result.wallpaper = value.wallpaper as ReaderPreferences['wallpaper'];
  if (
    typeof value.wallpaperPreview === 'string' &&
    value.wallpaperPreview.length < 24000 &&
    /^data:image\/(?:webp|png);base64,[a-z\d+/=]+$/i.test(value.wallpaperPreview)
  )
    result.wallpaperPreview = value.wallpaperPreview;
  return result;
}
export function readReaderPreferences(): ReaderPreferences {
  try {
    const stored = localStorage.getItem(readerStorageKey);
    if (stored) return parseReaderPreferences(JSON.parse(stored));
    const theme: ReaderPreferences['theme'] = {};
    const appearance = localStorage.getItem('fieldnotes-appearance');
    if (appearance && ['system', 'light', 'dark'].includes(appearance))
      theme.appearance = appearance as ReaderTheme['appearance'];
    if (localStorage.getItem('fieldnotes-transparency') === 'reduced')
      theme.reduceTransparency = true;
    const prefs: ReaderPreferences = { version: 1, theme };
    if (Object.keys(theme).length) saveReaderPreferences(prefs);
    return prefs;
  } catch {
    return { version: 1, theme: {} };
  }
}
export function saveReaderPreferences(prefs: ReaderPreferences) {
  try {
    localStorage.setItem(readerStorageKey, JSON.stringify(parseReaderPreferences(prefs)));
    // The legacy appearance key also belongs to Studio; retain its independent choice.
    localStorage.removeItem('fieldnotes-transparency');
    return true;
  } catch {
    return false;
  }
}
export function readerDefaults(): ReaderTheme | null {
  try {
    return JSON.parse(document.getElementById('reader-defaults')?.textContent || 'null');
  } catch {
    return null;
  }
}
export function applyReaderPreferences(defaults: ReaderTheme, prefs: ReaderPreferences) {
  if (document.documentElement.dataset.preview) return;
  const root = document.documentElement;
  const theme = {
    ...defaults,
    ...prefs.theme,
    contrast: mergeContrast(defaults.contrast, prefs.theme.contrast),
  };
  if (prefs.wallpaper === 'none') theme.backgroundImage = '';
  if (prefs.wallpaper === 'local')
    theme.backgroundImage = root.dataset.readerWallpaper || prefs.wallpaperPreview || '';
  const variables = themeVariables(theme);
  for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, String(value));
  root.style.setProperty('--reader-text-scale', String(prefs.textScale ?? defaults.textScale ?? 1));
  root.dataset.articleFocus = String(prefs.focusMode ?? defaults.focusMode ?? false);
  root.dataset.theme =
    theme.appearance === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme.appearance;
  root.dataset.background = theme.background;
  root.dataset.wallpaper = String(!!theme.backgroundImage);
  root.dataset.wallpaperWash = theme.wallpaperWash || 'auto';
  root.dataset.reduceMotion = String(theme.reduceMotion);
  root.dataset.reduceTransparency = String(theme.reduceTransparency);
  document.dispatchEvent(new CustomEvent('fieldnotes:reader-preferences'));
}
function wallpaperDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fieldnotes-reader', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('wallpaper');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Browser picture storage is unavailable.'));
    request.onblocked = () => reject(new Error('Close other settings tabs and try again.'));
  });
}
export async function storedWallpaper(
  action: 'read' | 'write' | 'clear',
  blob?: Blob,
): Promise<Blob | undefined> {
  const binary =
    action === 'write' && blob ? { bytes: await blob.arrayBuffer(), type: blob.type } : undefined;
  const database = await wallpaperDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      'wallpaper',
      action === 'read' ? 'readonly' : 'readwrite',
    );
    const store = transaction.objectStore('wallpaper');
    const request =
      action === 'read'
        ? store.get('current')
        : action === 'write'
          ? store.put(binary, 'current')
          : store.delete('current');
    transaction.oncomplete = () => {
      database.close();
      const value = request.result;
      resolve(
        action !== 'read'
          ? undefined
          : value instanceof Blob
            ? value
            : value?.bytes instanceof ArrayBuffer &&
                ['image/webp', 'image/png'].includes(value.type) &&
                value.bytes.byteLength <= 20 * 1024 * 1024
              ? new Blob([value.bytes], { type: value.type })
              : undefined,
      );
    };
    transaction.onerror = transaction.onabort = () => {
      database.close();
      reject(new Error('The picture could not be saved in this browser.'));
    };
  });
}
export function setReaderWallpaper(blob?: Blob) {
  const root = document.documentElement;
  const previous = root.dataset.readerWallpaper;
  if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
  if (blob) root.dataset.readerWallpaper = URL.createObjectURL(blob);
  else delete root.dataset.readerWallpaper;
}
export async function restoreReaderWallpaper(defaults: ReaderTheme) {
  try {
    const prefs = readReaderPreferences();
    if (prefs.wallpaper !== 'local') return;
    const blob = await storedWallpaper('read');
    // A slower database read must never replace a newer settings choice.
    if (readReaderPreferences().wallpaper !== 'local') return;
    if (blob) setReaderWallpaper(blob);
    applyReaderPreferences(defaults, readReaderPreferences());
  } catch {
    /* A saved thumbnail remains a harmless, bounded fallback. */
  }
}
