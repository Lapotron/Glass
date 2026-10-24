import { t } from '../shared/i18n.js';
export function startMarkdownComponents() {
  document.querySelectorAll<HTMLElement>('.md-mindmap').forEach((node) => {
    let request: Promise<void> | undefined;
    const load = () =>
      (request ||= import('./mindmap.js')
        .then(({ enhanceMindmap }) => enhanceMindmap(node))
        .catch(() => {
          request = undefined;
        }));
    node.addEventListener('pointerenter', () => void load());
    node.addEventListener('focusin', () => void load());
    node.addEventListener('pointerdown', () => void load(), { passive: true });
  });
  document.querySelectorAll<HTMLElement>('.md-tabs').forEach((host, group) => {
    if (host.dataset.tabsReady) return;
    const panels = [...host.children].filter((el) =>
      el.classList.contains('md-tab'),
    ) as HTMLElement[];
    if (!panels.length) return;
    host.dataset.tabsReady = 'true';
    const list = document.createElement('div');
    list.className = 'md-tab-buttons';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', t('Content tabs'));
    const buttons = panels.map((panel, index) => {
      const label = panel.querySelector(':scope > .md-component-title');
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `markdown-tab-${group}-${index}`;
      button.textContent = label?.textContent || `Tab ${index + 1}`;
      label?.setAttribute('hidden', '');
      panel.id = `${button.id}-panel`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      panel.tabIndex = 0;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panel.id);
      list.append(button);
      return button;
    });
    const select = (selected: number, focus = false) =>
      buttons.forEach((b, index) => {
        b.setAttribute('aria-selected', String(selected === index));
        b.tabIndex = selected === index ? 0 : -1;
        panels[index].hidden = selected !== index;
        if (focus && selected === index) b.focus();
      });
    buttons.forEach((b, index) => {
      b.addEventListener('click', () => select(index));
      b.addEventListener('keydown', (event) => {
        let next: number;
        if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else return;
        event.preventDefault();
        select(next, true);
      });
    });
    host.prepend(list);
    select(0);
    const revealAnchor = () => {
      let id: string;
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch {
        return;
      }
      if (!id) return;
      const target = document.getElementById(id);
      const index = panels.findIndex((panel) => !!target && panel.contains(target));
      if (index < 0) return;
      select(index);
      requestAnimationFrame(() => target?.scrollIntoView({ block: 'start' }));
    };
    addEventListener('hashchange', revealAnchor);
    revealAnchor();
  });
}
