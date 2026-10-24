import { getUiLocale, setUiText, t } from '../shared/i18n.js';
import { translateUi } from '../shared/ui-locale.js';
export function startReaderSpecimen() {
  const root = document.querySelector<HTMLElement>('[data-reader-specimen]');
  if (!root) return;
  const source = new Map<string, HTMLTemplateElement>();
  root.querySelectorAll<HTMLTemplateElement>('[data-specimen-locale]').forEach((template) => source.set(template.dataset.specimenLocale!,template));
  const updateContent = () => {
    const locale = getUiLocale();
    if (root.dataset.specimenLanguage === locale) return;
    const template = source.get(locale);
    if (!template) return;
    for (const [selector, content] of [['[data-preview-panel="reading"] .article-body','[data-specimen-reading]'],['[data-material-content]','[data-specimen-materials]']]) {
      const node = root.querySelector<HTMLElement>(selector);
      const html = template.content.querySelector<HTMLElement>(content)?.innerHTML;
      if (!node || !html) continue;
      const scroll = node.scrollTop;
      node.innerHTML = html; node.lang = locale; node.scrollTop = scroll;
    }
    root.dataset.specimenLanguage = locale;
    translateUi(root);
    void import('./code-tools.js').then(({startCodeTools}) => startCodeTools(root));
  };
  updateContent();
  addEventListener('glass:language',updateContent);

  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-preview-tab]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[data-preview-panel]')];
  const positions = new Map<string, number>();
  const activate = (tab: HTMLButtonElement) => {
    for (const panel of panels) {
      const scroll = panel.querySelector<HTMLElement>('[data-preview-scroll]');
      if (!panel.hidden && scroll) positions.set(panel.dataset.previewPanel!, scroll.scrollTop);
      panel.hidden = panel.dataset.previewPanel !== tab.dataset.previewTab;
      if (!panel.hidden && scroll)
        scroll.scrollTop = positions.get(panel.dataset.previewPanel!) || 0;
    }
    for (const button of tabs) {
      button.setAttribute('aria-selected', String(button === tab));
      button.tabIndex = button === tab ? 0 : -1;
    }
  };
  for (const tab of tabs) {
    tab.disabled = false;
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (event) => {
      const index = tabs.indexOf(tab);
      const next = {
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        ArrowRight: (index + 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      activate(tabs[next]);
      tabs[next].focus();
    });
  }
  const expand = root.querySelector<HTMLButtonElement>('[data-preview-expand]')!;
  expand.disabled = false;
  expand.addEventListener('click', () => {
    const expanded = root.dataset.expanded !== 'true';
    root.dataset.expanded = String(expanded);
    expand.setAttribute('aria-expanded', String(expanded));
    setUiText(expand.querySelector('span')!, expanded ? 'Collapse preview' : 'Expand preview');
  });
  const range = root.querySelector<HTMLInputElement>('[data-demo-range]')!;
  range.addEventListener('input', () => {
    root.querySelector<HTMLOutputElement>('[data-demo-range-output]')!.value = range.value + '%';
  });
  root.querySelector('[data-demo-save]')!.addEventListener('click', () => {
    root.querySelector('[data-demo-status]')!.textContent =
      t('A little feedback, right where you expect it.');
  });
  root.querySelector('[data-demo-bookmark]')!.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const saved = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', t(saved ? 'Unsave demo note' : 'Save demo note'));
  });
}
