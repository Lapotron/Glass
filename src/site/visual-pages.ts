import { t } from '../shared/i18n.js';
export function startVisualPages() {
  const chapters = [...document.querySelectorAll<HTMLElement>('[data-chapter]')];
  const chapterLinks = [...document.querySelectorAll<HTMLAnchorElement>('[data-chapter-link]')];
  const browser = document.querySelector<HTMLElement>('[data-timeline-browser]');
  if (browser)
    void import('./archive-browser.js')
      .then((module) => module.startArchive(browser))
      .catch(() => {
        const status = browser.querySelector<HTMLElement>('[data-archive-status]');
        if (status)
          status.textContent = t(
            'Could not filter the archive. Your current page is still available.',
          );
        const retry = browser.querySelector<HTMLButtonElement>('[data-archive-retry]');
        if (retry) {
          retry.hidden = false;
          retry.addEventListener('click', () => location.reload(), { once: true });
        }
      });
  const current = (links: HTMLElement[], index: number) =>
    links.forEach((link, i) => {
      if (i === index) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  let pending = false;
  const update = () => {
    pending = false;
    if (chapters.length) {
      let active = 0;
      chapters.forEach((chapter, i) => {
        if (chapter.getBoundingClientRect().top < innerHeight * 0.55) active = i;
      });
      current(chapterLinks, active);
    }
  };
  if (chapters.length) {
    addEventListener(
      'scroll',
      () => {
        if (!pending) {
          pending = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    addEventListener('resize', update);
    update();
  }
}
