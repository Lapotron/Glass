import type { TabsConfig } from '../../shared/interactives.js';
export function enhance(node: HTMLElement, config: TabsConfig) {
  const value = config as TabsConfig,
    list = node.querySelector<HTMLElement>('[role="tablist"]')!,
    buttons = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')],
    panels = [...node.querySelectorAll<HTMLElement>('.widget-tab-panel')];
  list.hidden = false;
  const select = (index: number, focus = false) => {
    buttons.forEach((button, i) => {
      button.tabIndex = i === index ? 0 : -1;
      button.setAttribute('aria-selected', String(i === index));
      panels[i].hidden = i !== index;
      panels[i].setAttribute('role', 'tabpanel');
      panels[i].setAttribute('aria-labelledby', button.id);
      panels[i].removeAttribute('aria-label');
      panels[i].tabIndex = 0;
    });
    if (focus) buttons[index].focus();
  };
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(index));
    button.addEventListener('keydown', (event) => {
      const next = {
        ArrowLeft: (index - 1 + buttons.length) % buttons.length,
        ArrowRight: (index + 1) % buttons.length,
        Home: 0,
        End: buttons.length - 1,
      }[event.key];
      if (next !== undefined) {
        event.preventDefault();
        select(next, true);
      }
    });
  });
  select(value.active);
}
