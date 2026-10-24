/** Keep browser chrome and alternate logos in step with the reader's theme. */
export function syncBranding() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.querySelectorAll<HTMLSourceElement>('source[data-brand-dark]').forEach((source) => {
    source.media = dark ? 'all' : 'not all';
  });
  document.querySelectorAll<HTMLMetaElement>('meta[data-theme-color]').forEach((meta) => {
    meta.media = (meta.dataset.themeColor === 'dark') === dark ? 'all' : 'not all';
  });
}
