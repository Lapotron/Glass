/** Keep storage/reader tools intent-loaded; no server dependency for ordinary reading. */
export function startReadingTools() {
  const load = () => import('./reading.js');
  document.querySelectorAll<HTMLButtonElement>('[data-reading-list]').forEach((button) => {
    button.disabled = false;
    button.addEventListener('click', () => {
      void load().then((m) => m.openReadingList(button));
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-reading-bookmark]').forEach((button) => {
    button.disabled = false;
    button.addEventListener('click', () => {
      void load()
        .then((m) => {
          m.toggleBookmark();
          m.startReadingProgress();
        })
        .catch((e) => {
          button.title = e.message;
        });
    });
  });
  if (document.querySelector('meta[name=reading-entry]')) {
    addEventListener(
      'scroll',
      () => {
        void load().then((m) => m.startReadingProgress());
      },
      { once: true, passive: true },
    );
    try {
      if (scrollY > 0 || localStorage.getItem('glass-reading-v1'))
        void load().then((m) => m.startReadingProgress());
    } catch {
      /* Storage is optional. */
    }
  }
}
