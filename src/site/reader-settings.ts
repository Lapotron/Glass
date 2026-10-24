import { t, setUiText } from '../shared/i18n.js';
import type { ReaderSession } from './reader-session.js';
import { startReaderSpecimen } from './reader-specimen.js';
import { appearanceLabels } from '../shared/appearance-ranges.js';
import { updateRange } from '../shared/forms.js';
import {
  contrastPreset,
  mergeContrast,
  type ColorMode,
  type TextRole,
  textRoles,
} from '../shared/contrast.js';
import { syncContrastControls } from '../shared/contrast-dom.js';
import {
  restoreReaderWallpaper,
  setReaderWallpaper,
  storedWallpaper,
  type ReaderPreferences,
} from '../shared/reader-preferences.js';

async function preparePicture(file: File) {
  if (
    !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error(t("Choose a JPEG, PNG, WebP or AVIF smaller than 20 MiB."));
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    image.src = url;
    await image.decode();
    const w = image.naturalWidth,
      h = image.naturalHeight;
    if (!w || !h || w * h > 40000000)
      throw new Error(t("Choose a picture smaller than 40 megapixels."));
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2400 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error(t("This picture could not be prepared.")))),
        'image/webp',
        0.86,
      ),
    );
    const thumb = document.createElement('canvas');
    thumb.width = 128;
    thumb.height = Math.max(1, Math.round((128 * h) / w));
    if (thumb.height > 256) {
      thumb.height = 256;
      thumb.width = Math.max(1, Math.round((256 * w) / h));
    }
    thumb.getContext('2d')!.drawImage(canvas, 0, 0, thumb.width, thumb.height);
    return { blob, preview: thumb.toDataURL('image/webp', 0.55) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function startReaderSettings(session: ReaderSession) {
  startReaderSpecimen();
  const form = document.querySelector<HTMLFormElement>('[data-reader-settings]');
  if (!form) return;
  const defaults = session.defaults;
  let prefs = session.preferences;
  const status = document.querySelector<HTMLElement>('[data-reader-status]');
  const controls = [
    ...(form?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-reader-control]') ||
      []),
  ];
  const sync = () => {
    const effective = { ...defaults, ...prefs.theme } as Record<string, unknown>;
    for (const control of controls) {
      const key = control.dataset.readerControl!;
      const value =
        key === 'focusMode'
          ? (prefs.focusMode ?? defaults.focusMode ?? false)
          : key === 'textScale'
            ? (prefs.textScale ?? defaults.textScale ?? 1)
            : key === 'wallpaper'
              ? prefs.wallpaper || 'site'
              : key === 'wallpaperWash'
                ? effective[key] || 'auto'
                : effective[key];
      if (control instanceof HTMLInputElement && control.type === 'checkbox')
        control.checked = !!value;
      else control.value = String(value);
      const output = form?.querySelector<HTMLOutputElement>('[data-reader-output="' + key + '"]');
      if (output)
        output.value =
          key === 'textScale' || key === 'fontScale'
            ? Math.round(Number(value) * 100) + '%'
            : value + (appearanceLabels[key as keyof typeof appearanceLabels]?.[1] || '');
      if (control.type === 'range') updateRange(control as HTMLInputElement);
    }
    const accent = form?.querySelector('[data-reader-accent]');
    if (form)
      syncContrastControls(form, {
        ...defaults,
        ...prefs.theme,
        contrast: mergeContrast(defaults.contrast, prefs.theme.contrast),
        backgroundImage:
          prefs.wallpaper === 'none'
            ? ''
            : prefs.wallpaper === 'local'
              ? 'local'
              : defaults.backgroundImage,
      });
    if (accent) accent.textContent = String(effective.accent);
    const picture = form?.querySelector<HTMLElement>('[data-reader-picture]');
    const pictureUrl = document.documentElement.dataset.readerWallpaper || prefs.wallpaperPreview;
    if (picture) {
      picture.hidden = !pictureUrl;
      if (pictureUrl) picture.querySelector('img')!.src = pictureUrl;
    }
    const local = form?.querySelector<HTMLOptionElement>(
      '[data-reader-control="wallpaper"] option[value="local"]',
    );
    if (local) local.disabled = !pictureUrl;
    const toggle = document.querySelector('[data-theme-toggle]');
    toggle?.setAttribute(
      'aria-label',
      'Switch to ' +
        (document.documentElement.dataset.theme === 'light' ? 'dark' : 'light') +
        ' appearance',
    );
  };
  const apply = (save = false) => {
    session.preferences = prefs;
    session.apply(save);
  };
  session.subscribe((saved) => {
    prefs = session.preferences;
    if (status)
      setUiText(status, saved ? "Saved in this browser" : "Applied for this page. Browser storage is unavailable.");
    sync();
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('input', (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
    const key = control.dataset.contrastControl;
    if (!key && !control.dataset.contrastRole) return;
    const contrast = {
      ...prefs.theme.contrast,
      colors: {
        light: { ...prefs.theme.contrast?.colors?.light },
        dark: { ...prefs.theme.contrast?.colors?.dark },
      },
    };
    if (control.dataset.contrastRole) {
      contrast.colors[control.dataset.contrastMode as ColorMode][
        control.dataset.contrastRole as TextRole
      ] = control.value;
      prefs.theme.contrast = contrast;
    } else if (key === 'preset')
      prefs.theme.contrast = {
        ...contrastPreset(control.value as 'balanced' | 'high'),
        colors: {
          light: Object.fromEntries(textRoles.map((role) => [role, null])),
          dark: Object.fromEntries(textRoles.map((role) => [role, null])),
        },
      };
    else {
      (contrast as Record<string, unknown>)[key!] =
        control instanceof HTMLInputElement && control.type === 'checkbox'
          ? control.checked
          : ['readingTarget', 'interfaceTarget', 'glassFloor', 'readingFloor'].includes(key!)
            ? Number(control.value)
            : control.value;
      prefs.theme.contrast = contrast;
    }
    apply(true);
  });
  form.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-contrast-clear]');
    if (!button) return;
    const [mode, role] = button.dataset.contrastClear!.split('.') as [ColorMode, TextRole];
    if (prefs.theme.contrast?.colors?.[mode]) delete prefs.theme.contrast.colors[mode]![role];
    apply(true);
  });
  form
    .querySelectorAll<HTMLFieldSetElement>('fieldset')
    .forEach((fieldset) => (fieldset.disabled = false));
  controls.forEach((control) =>
    control.addEventListener('input', () => {
      const key = control.dataset.readerControl!;
      if (key === 'wallpaper') {
        session.generation++;
        prefs.wallpaper = control.value as ReaderPreferences['wallpaper'];
      } else if (key === 'focusMode') prefs.focusMode = (control as HTMLInputElement).checked;
      else if (key === 'textScale') prefs.textScale = Number(control.value);
      else
        (prefs.theme as Record<string, unknown>)[key] =
          control instanceof HTMLInputElement && control.type === 'checkbox'
            ? control.checked
            : control.type === 'range'
              ? Number(control.value)
              : control.value;
      apply(true);
    }),
  );
  const removePicture = async () => {
    session.generation++;
    await storedWallpaper('clear');
    setReaderWallpaper();
    delete prefs.wallpaperPreview;
    prefs.wallpaper = 'site';
  };
  document.querySelectorAll<HTMLButtonElement>('[data-reader-reset]').forEach((button) =>
    button.addEventListener('click', () => {
      void (async () => {
        try {
          const section = button.dataset.readerReset!;
          if (section === 'all' || section === 'background') await removePicture();
          if (section === 'all') prefs = { version: 1, theme: {} };
          else if (section === 'contrast') delete prefs.theme.contrast;
          else
            form
              .querySelectorAll<HTMLElement>(
                '[data-reader-section="' + section + '"] [data-reader-control]',
              )
              .forEach((control) => {
                const key = control.dataset.readerControl!;
                if (key === 'focusMode') delete prefs.focusMode;
                else if (key === 'textScale') delete prefs.textScale;
                else delete (prefs.theme as Record<string, unknown>)[key];
              });
          apply(true);
        } catch (error) {
          if (status) setUiText(status, (error as Error).message);
        }
      })();
    }),
  );
  form.querySelector('[data-reader-remove-picture]')?.addEventListener('click', () => {
    void removePicture()
      .then(() => apply(true))
      .catch((error) => {
        if (status) setUiText(status, error.message);
      });
  });
  const file = form.querySelector<HTMLInputElement>('[data-reader-picture-input]')!;
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    if (!selected) return;
    const ticket = ++session.generation;
    file.disabled = true;
    if (status) setUiText(status, "Preparing your picture…");
    void preparePicture(selected)
      .then(async (picture) => {
        if (ticket !== session.generation) return;
        await storedWallpaper('write', picture.blob);
        if (ticket !== session.generation) return;
        setReaderWallpaper(picture.blob);
        prefs.wallpaper = 'local';
        prefs.wallpaperPreview = picture.preview;
        apply(true);
      })
      .catch((error) => {
        if (ticket === session.generation && status)
          setUiText(status, error.message || 'This picture could not be opened.');
      })
      .finally(() => {
        file.disabled = false;
        file.value = '';
      });
  });
  apply();
  void restoreReaderWallpaper(defaults).then(sync);
}
