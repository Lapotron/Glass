import { t } from '../shared/i18n.js';
export function startVisualPages() {
  const chapters = [...document.querySelectorAll<HTMLElement>('[data-chapter]')];
  const chapterLinks = [...document.querySelectorAll<HTMLAnchorElement>('[data-chapter-link]')];
  const browser = document.querySelector<HTMLElement>('[data-timeline-browser]');
  const years = [...(browser?.querySelectorAll<HTMLElement>('[data-timeline-year]') || [])];
  const rail = [...(browser?.querySelectorAll<HTMLElement>('[data-year-link]') || [])];
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
    if (years.length) {
      let active = years.findIndex((y) => !y.hidden);
      years.forEach((year, i) => {
        if (!year.hidden && year.getBoundingClientRect().top <= 210) active = i;
      });
      current(rail, active);
      const region = browser!.getBoundingClientRect();
      browser!.style.setProperty(
        '--archive-progress',
        String(Math.min(1, Math.max(0, -region.top / Math.max(1, region.height - innerHeight)))),
      );
    }
  };
  if (chapters.length || years.length) {
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
  if (!browser) return;
  const buttons = [...browser.querySelectorAll<HTMLButtonElement>('[data-timeline-filter]')];
  const search = browser.querySelector<HTMLInputElement>('[data-timeline-search]')!;
  const tag = browser.querySelector<HTMLSelectElement>('[data-timeline-tag]')!;
  const items = [...browser.querySelectorAll<HTMLElement>('[data-timeline-entry]')];
  const months = [...browser.querySelectorAll<HTMLElement>('[data-timeline-month]')];
  const records = items.map((node) => ({
    node,
    kind: node.dataset.kind,
    text: node.dataset.search || '',
    tags: new Set<string>(JSON.parse(node.dataset.tags || '[]')),
    month: node.closest<HTMLElement>('[data-timeline-month]'),
    year: node.closest<HTMLElement>('[data-timeline-year]'),
  }));
  const labels = years.map((year, i) => ({
    year,
    rail: rail[i],
    label: year.querySelector('.timeline-year-label > span')!,
    count: rail[i].querySelector('[data-year-count]')!,
  }));
  let kind = 'all';
  const filter = (write = true) => {
    const query = search.value.trim().toLowerCase();
    buttons.forEach((button) => {
      const active = button.dataset.timelineFilter === kind;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    let count = 0;
    const monthCounts = new Map<HTMLElement, number>(),
      yearCounts = new Map<HTMLElement, number>();
    records.forEach((record) => {
      const visible =
        (kind === 'all' || record.kind === kind) &&
        record.text.includes(query) &&
        (!tag.value || record.tags.has(tag.value));
      if (record.node.hidden === visible) record.node.hidden = !visible;
      if (visible) {
        count++;
        if (record.month) monthCounts.set(record.month, (monthCounts.get(record.month) || 0) + 1);
        if (record.year) yearCounts.set(record.year, (yearCounts.get(record.year) || 0) + 1);
      }
    });
    months.forEach((month) => {
      month.hidden = !monthCounts.has(month);
    });
    labels.forEach(({ year, rail, label, count }) => {
      const visible = yearCounts.get(year) || 0;
      year.hidden = !visible;
      rail.hidden = !visible;
      label.textContent = t("{value0} {value1}", {value0: visible, value1: visible === 1 ? 'entry' : 'entries'});
      count.textContent = String(visible);
    });
    browser.querySelector('[data-timeline-count]')!.textContent =
      t("{value0} published {value1}", {value0: count, value1: count === 1 ? 'entry' : 'entries'});
    browser.querySelector<HTMLElement>('[data-timeline-empty]')!.hidden =
      count > 0 || !items.length;
    if (write) {
      const url = new URL(location.href);
      for (const [key, value] of [
        ['q', search.value],
        ['kind', kind === 'all' ? '' : kind],
        ['tag', tag.value],
      ]) {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      history.replaceState(history.state, '', url);
    }
    update();
  };
  const fromUrl = () => {
    const p = new URLSearchParams(location.search);
    search.value = p.get('q') || '';
    kind = ['posts', 'lab'].includes(p.get('kind') || '') ? p.get('kind')! : 'all';
    tag.value = p.get('tag') || '';
    filter(false);
  };
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      kind = button.dataset.timelineFilter || 'all';
      filter();
    }),
  );
  search.addEventListener('input', () => filter());
  tag.addEventListener('change', () => filter());
  addEventListener('popstate', fromUrl);
  fromUrl();
}
