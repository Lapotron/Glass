/** Fluid navigation over real static-page links; navigation and history stay browser-owned. */
export function startNavigation() {
  const root = document.documentElement;
  const nav = document.querySelector<HTMLElement>('.site-nav');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (nav) {
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('a')];
    const lens = document.createElement('span');
    lens.className = 'nav-lens';
    lens.setAttribute('aria-hidden', 'true');
    nav.prepend(lens);
    let pointerLink: HTMLAnchorElement | null = null;
    let focusLink: HTMLAnchorElement | null = null;
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    const current = () => links.find((link) => link.getAttribute('aria-current') === 'page');
    const update = () => {
      frame = 0;
      const target = focusLink || pointerLink || current();
      if (!target || !nav.clientWidth || !nav.clientHeight) {
        nav.removeAttribute('data-nav-target');
        if (!nav.clientWidth || !nav.clientHeight) nav.removeAttribute('data-nav-enhanced');
        return;
      }
      const item = target.getBoundingClientRect();
      let driftX = 0,
        driftY = 0;
      if (
        target === pointerLink &&
        pointer &&
        !reducedMotion.matches &&
        root.dataset.reduceMotion !== 'true'
      ) {
        driftX = Math.max(-1, Math.min(1, ((pointer.x - item.left) / item.width - 0.5) * 2));
        driftY = Math.max(-1, Math.min(1, ((pointer.y - item.top) / item.height - 0.5) * 2));
      }
      // Layout coordinates stay correct while the mobile sheet itself animates.
      lens.style.setProperty('--nav-x', `${target.offsetLeft + driftX * 3}px`);
      lens.style.setProperty('--nav-y', `${target.offsetTop + driftY * 2}px`);
      lens.style.setProperty('--nav-width', `${target.offsetWidth}px`);
      lens.style.setProperty('--nav-height', `${target.offsetHeight}px`);
      lens.style.setProperty('--nav-light-x', `${50 + driftX * 32}%`);
      lens.style.setProperty('--nav-light-y', `${35 + driftY * 25}%`);
      nav.dataset.navTarget = target.getAttribute('href') || '';
      nav.dataset.navHover = String(Boolean(pointerLink || focusLink));
      // First geometry is immediate; later changes travel between links with a soft spring.
      if (!nav.hasAttribute('data-nav-enhanced'))
        requestAnimationFrame(() => (nav.dataset.navEnhanced = 'true'));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const linkAt = (target: EventTarget | null) => {
      const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a') : null;
      return link && nav.contains(link) ? link : null;
    };
    nav.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      pointerLink = linkAt(event.target);
      pointer = { x: event.clientX, y: event.clientY };
      focusLink = null;
      schedule();
    });
    nav.addEventListener('pointerleave', () => {
      pointerLink = null;
      pointer = null;
      focusLink = linkAt(document.activeElement);
      schedule();
    });
    nav.addEventListener('focusin', (event) => {
      focusLink = linkAt(event.target);
      schedule();
    });
    nav.addEventListener('focusout', (event) => {
      focusLink = linkAt(event.relatedTarget);
      schedule();
    });
    nav.addEventListener('pointerdown', () => (nav.dataset.navPress = 'true'));
    const release = () => nav.removeAttribute('data-nav-press');
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    addEventListener('blur', release);
    new ResizeObserver(schedule).observe(nav);
    reducedMotion.addEventListener('change', schedule);
    document.fonts.ready.then(schedule);
    addEventListener('pageshow', () => {
      pointerLink = null;
      focusLink = null;
      pointer = null;
      release();
      schedule();
    });
    schedule();
  }

  let pending: ReturnType<typeof setTimeout> | undefined;
  let recovery: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    clearTimeout(pending);
    clearTimeout(recovery);
    root.removeAttribute('data-navigating');
  };
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
      event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href, location.href);
    if (
      url.origin !== location.origin ||
      (url.pathname === location.pathname && url.search === location.search)
    )
      return;
    reset();
    pending = setTimeout(() => (root.dataset.navigating = 'true'), 140);
    recovery = setTimeout(reset, 15000);
  });
  addEventListener('pageshow', reset);
  addEventListener('pageswap', reset);
}
