/** Shared scroll tracking for public pages and Studio's nested scroll surface. */
export function watchArchivePosition(root: HTMLElement) {
  let frame = 0;
  function update() {
    frame = 0;
    const years = [...root.querySelectorAll<HTMLElement>('[data-timeline-year]')];
    let active = years[0]?.dataset.year;
    for (const year of years)
      if (year.getBoundingClientRect().top <= 240) active = year.dataset.year;
    root.querySelectorAll<HTMLElement>('[data-year-link]').forEach((link) => {
      if (link.dataset.yearLink === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    const region = root.getBoundingClientRect();
    root.style.setProperty(
      '--archive-progress',
      String(Math.min(1, Math.max(0, -region.top / Math.max(1, region.height - innerHeight)))),
    );
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  document.addEventListener('scroll', schedule, { passive: true, capture: true });
  addEventListener('resize', schedule);
  const observer = new ResizeObserver(schedule);
  observer.observe(root);
  update();
  return {
    update,
    stop() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('scroll', schedule, true);
      removeEventListener('resize', schedule);
    },
  };
}
