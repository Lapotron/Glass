import './tools/tools.css';
import {
  developerTools,
  isToolId,
  toolGroups,
  canSaveToolDraft,
  type ToolId,
} from '../shared/tools-catalog.js';
import type { ToolMemory } from './tools/developer.js';
import { t, isUiLocale, installUiLocale } from '../shared/i18n.js';
import { translateUi } from '../shared/ui-locale.js';
import { readToolPreferences, saveToolPreferences, clearToolDrafts } from './tools/storage.js';
import { element, button, select, field } from './tools/dom.js';
const root = document.querySelector<HTMLElement>('[data-tools-page]');
if (root) void start(root);
async function start(root: HTMLElement) {
  root.querySelector<HTMLElement>('[data-tools-no-js]')!.hidden = true;
  const preferences = readToolPreferences();
  const workspace = root.querySelector<HTMLElement>('[data-tools-workspace]')!;
  const equationHost = root.querySelector<HTMLElement>('[data-tools-equation]')!;
  const directory = root.querySelector<HTMLElement>('.tools-directory')!;
  const query = root.querySelector<HTMLInputElement>('[data-tool-search]')!;
  const favoriteFilter = root.querySelector<HTMLButtonElement>('[data-tool-favorites]')!;
  const category = select(
    'Tool category',
    [['', 'All categories'], ...toolGroups.map((group) => [group, group] as const)],
    filter,
  );
  directory.querySelector('.tools-filter-row')!.after(field('Tool category', category));
  let favoritesOnly = false,
    currentId = '',
    sequence = 0,
    equationPromise: Promise<unknown> | undefined;
  const memory = new Map<ToolId, ToolMemory>();
  let current: { destroy: () => void; snapshot: () => ToolMemory } | undefined,
    equation: { destroy: () => void } | undefined;
  const locale = async () => {
    const value =
      document.documentElement.dataset.uiLanguageEnabled === 'false'
        ? 'en'
        : document.documentElement.dataset.uiLocale || 'en';
    if (!isUiLocale(value)) return;
    const values =
      value === 'en'
        ? {}
        : value === 'zh-Hans'
          ? (await import('../locales/zh-Hans.public.json')).default
          : (await import('../locales/zh-Hant.public.json')).default;
    installUiLocale(value, values);
    translateUi(root);
    dispatchEvent(new Event('glass:tools-locale'));
  };
  addEventListener('glass:language', () => {
    void locale().then(filter);
  });
  await locale();
  function filter() {
    const term = query.value.toLowerCase().trim();
    let count = 0;
    for (const link of directory.querySelectorAll<HTMLAnchorElement>('[data-tool-id]')) {
      const id = link.dataset.toolId as ToolId,
        tool = developerTools.find((tool) => tool.id === id)!;
      const favorite = preferences.favorites.includes(id);
      link.dataset.favorite = String(favorite);
      link.hidden =
        (favoritesOnly && !favorite) ||
        (!!category.value && tool.group !== category.value) ||
        !`${t(tool.label)} ${t(tool.description)} ${tool.label} ${tool.group}`
          .toLowerCase()
          .includes(term);
      if (!link.hidden) count++;
    }
    root.querySelector('[data-tool-count]')!.textContent = String(count);
    root.querySelector<HTMLElement>('[data-tools-empty]')!.hidden = count > 0;
  }
  query.addEventListener('input', filter);
  directory.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('[data-tool-id]');
    if (!link || event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
      return;
    event.preventDefault();
    history.pushState(null, '', link.hash);
    void navigate();
  });
  favoriteFilter.addEventListener('click', () => {
    favoritesOnly = !favoritesOnly;
    favoriteFilter.setAttribute('aria-pressed', String(favoritesOnly));
    filter();
  });
  async function navigate() {
    const equationTab = location.hash === '#equation';
    root.querySelector<HTMLElement>('#tools-developer')!.hidden = equationTab;
    equationHost.hidden = !equationTab;
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-tools-tab]')) {
      const active = (tab.dataset.toolsTab === 'equation') === equationTab;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    if (equationTab) {
      if (!equationPromise)
        equationPromise = (async () => {
          equationHost.append(element('p', 'tools-loading', 'Opening the equation editor…'));
          const module = await import('./tools/equation.js');
          equation = await module.openEquationEditor(equationHost);
          translateUi(equationHost);
        })().catch(() => {
          equationPromise = undefined;
          equationHost.replaceChildren(
            element('p', 'tools-loading', 'The tool could not load. Reload this page and retry.'),
            button('Retry', () => {
              void navigate();
            }),
          );
        });
      return;
    }
    const requested = location.hash.replace(/^#developer\/?/, ''),
      id = isToolId(requested) ? requested : 'json';
    if (currentId === id) return;
    if (current && isToolId(currentId) && canSaveToolDraft(currentId))
      memory.set(currentId, current.snapshot());
    currentId = id;
    const request = ++sequence;
    current?.destroy();
    current = undefined;
    for (const link of directory.querySelectorAll('[data-tool-id]')) {
      if ((link as HTMLElement).dataset.toolId === id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    const stage = element('div', 'tools-workspace-content');
    stage.append(element('p', 'tools-loading', 'Opening your toolbox…'));
    workspace.replaceChildren(stage);
    try {
      const module = await import('./tools/developer.js');
      const instance = await module.openDeveloperTool(
        stage,
        id,
        preferences.favorites.includes(id),
        () => {
          const index = preferences.favorites.indexOf(id);
          if (index >= 0) preferences.favorites.splice(index, 1);
          else preferences.favorites.push(id);
          saveToolPreferences(preferences);
          filter();
          return preferences.favorites.includes(id);
        },
        memory.get(id),
      );
      if (request !== sequence) {
        instance.destroy();
        return;
      }
      current = instance;
      workspace.setAttribute('aria-busy', 'false');
      translateUi(stage);
    } catch {
      if (request === sequence) {
        stage.replaceChildren(
          element('p', 'tools-loading', 'The tool could not load. Reload this page and retry.'),
          button('Retry', () => {
            currentId = '';
            void navigate();
          }),
        );
      }
    }
  }
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-tools-tab]')];
  for (const tab of tabs)
    tab.addEventListener('click', () => {
      history.pushState(
        null,
        '',
        '#' +
          (tab.dataset.toolsTab === 'equation' ? 'equation' : 'developer/' + (currentId || 'json')),
      );
      void navigate();
    });
  root.querySelector('[role="tablist"]')!.addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key.key)) return;
    key.preventDefault();
    const selected = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const next =
      key.key === 'Home'
        ? 0
        : key.key === 'End'
          ? tabs.length - 1
          : (selected + (key.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    tabs[next].click();
    tabs[next].focus();
  });
  addEventListener('hashchange', () => {
    void navigate();
  });
  addEventListener('popstate', () => {
    void navigate();
  });
  root.querySelector('[data-tools-clear-drafts]')!.addEventListener('click', () => {
    const dialog = element('dialog', 'tools-confirm glass-panel');
    dialog.append(
      element('h2', '', 'Delete saved drafts?'),
      element('p', '', 'Saved Tools drafts will be removed from this browser.'),
    );
    const actions = element('div', 'tools-action-row');
    actions.append(
      button('Cancel', () => dialog.close()),
      button(
        'Delete saved drafts',
        () => {
          for (const draft of memory.values()) draft.remember = false;
          dispatchEvent(new Event('glass:tools-clear-drafts'));
          void clearToolDrafts()
            .then(() => {
              root.querySelector('[data-tools-storage-status]')!.textContent =
                t('Saved drafts deleted.');
              dialog.close();
            })
            .catch(() => {
              root.querySelector('[data-tools-storage-status]')!.textContent = t(
                'Local draft storage is unavailable.',
              );
              dialog.close();
            });
        },
        'Trash2',
      ),
    );
    dialog.append(actions);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
  });
  addEventListener('pagehide', (event) => {
    if (!(event as PageTransitionEvent).persisted) {
      current?.destroy();
      equation?.destroy();
    }
  });
  filter();
  await navigate();
}
