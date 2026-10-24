import { t } from '../shared/i18n.js';
/** Tiny bootstrap. Dialog and export logic loads only after a reader action. */
export function startArticleTools() {
  const footer = document.querySelector<HTMLElement>('[data-article-footer]');
  if (!footer || footer.dataset.private) return;
  footer.querySelectorAll<HTMLButtonElement>('[data-article-action]').forEach((button) => {
    button.disabled = false;
  });
  footer.addEventListener('click', (event) => {
    const target = (event.target as Element).closest<HTMLElement>(
      '[data-article-action], [data-article-dialog] > summary',
    );
    if (
      !target ||
      event.defaultPrevented ||
      (event instanceof MouseEvent &&
        (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0))
    )
      return;
    event.preventDefault();
    void import('./article-actions.js')
      .then(({ handleArticleAction }) => handleArticleAction(footer, target))
      .catch(() => {
        const details = target.closest<HTMLDetailsElement>('details');
        if (details) details.open = true;
        const status = footer.querySelector('[data-article-status]');
        if (status)
          status.textContent =
            t("Article tools could not load. Use the link and citation text below, or try again.");
      });
  });
}
