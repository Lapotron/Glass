/** Keep fragment URLs, keyboard navigation and browser Back while animating only
 * same-document reading destinations. Other links remain browser-owned. */
export function startHeadingNavigation() {
  document.addEventListener('click', (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>(
            '.article-body a[href], .post-outline a[href], .article-bottom a[href="#main"]',
          )
        : null;
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href, location.href);
    if (
      url.origin !== location.origin ||
      url.pathname !== location.pathname ||
      url.search !== location.search ||
      !url.hash
    )
      return;
    let target: HTMLElement | null;
    try {
      target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    } catch {
      return;
    }
    if (
      !target ||
      !(target.matches('h1,h2,h3,h4,h5,h6') || ['main', 'article-end'].includes(target.id))
    )
      return;
    event.preventDefault();
    if (location.hash !== url.hash) {
      const oldURL = location.href;
      history.pushState(null, '', url);
      // Tabs containing a heading already listen for fragment changes.
      dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: url.href }));
    }
    const destination = target;
    if (!destination.hasAttribute('tabindex')) {
      destination.tabIndex = -1;
      destination.addEventListener('blur', () => destination.removeAttribute('tabindex'), {
        once: true,
      });
    }
    // Set the navigation focus in this event, so a later frame cannot steal a
    // reader's next keyboard action after they return to the outline.
    destination.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      const reduce =
        matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.documentElement.dataset.reduceMotion === 'true';
      destination.scrollIntoView({ behavior: reduce ? 'instant' : 'smooth', block: 'start' });
    });
  });
}
