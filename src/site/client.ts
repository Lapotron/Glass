import { startReadingTools } from './reading-bootstrap.js';
import { t } from '../shared/i18n.js';
import { startArticleTools } from './article-tools.js';
import { startHeadingNavigation } from './heading-navigation.js';
import { syncBranding } from './branding.js';
import { startReaderPreferences } from './reader-session.js';
import './site.css';
import { startLiquidGlass } from '../shared/liquid-glass.js';
import { startNavigation } from './navigation.js';
import { startFormControls } from '../shared/forms.js';
import { startImageViewers } from '../shared/image-viewer.js';
import { startVisualPages } from './visual-pages.js';
import { startMarkdownComponents } from './markdown-components.js';

syncBranding();
const brandingObserver = new MutationObserver(syncBranding);
brandingObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});
window.addEventListener('pagehide', () => brandingObserver.disconnect());
window.addEventListener('pageshow', () => {
  brandingObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  syncBranding();
});
startLiquidGlass();
startNavigation();
startHeadingNavigation();
startFormControls();
if (
  document.querySelector(
    '[data-comments],[data-analytics],[data-google-analytics],meta[name="aca-config"],[data-aca-controls],[data-aca-privacy]',
  )
)
  void import('./integrations.js')
    .then(({ startIntegrations }) => startIntegrations())
    .catch(() => {
      document.querySelectorAll<HTMLElement>('[data-comments-status]').forEach((node) => {
        node.textContent = t(
          'Discussion tools could not load. Reload this page or open the conversation on GitHub.',
        );
      });
    });
startImageViewers();
if (document.querySelector('.article-body figure[data-mermaid]'))
  void import('../shared/diagram-viewer.js')
    .then(({ registerDiagramViewers }) => {
      document
        .querySelectorAll('.article-body')
        .forEach((root) => registerDiagramViewers(root, { publicLinks: true }));
    })
    .catch(() => {
      /* The inline SVG and its source remain readable. */
    });
startVisualPages();
startArticleTools();
startMarkdownComponents();
document.querySelectorAll<HTMLButtonElement>('[data-email-token]').forEach((button) => {
  button.disabled = false;
});
document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-email-token]');
  if (button)
    void import('./email-contact.js')
      .then(({ revealEmail }) => revealEmail(button))
      .catch(() => {
        button.title = t('Email could not open. Try again.');
      });
});

const reader = startReaderPreferences();
if (reader && document.querySelector('[data-reader-settings]'))
  void import('./reader-settings.js')
    .then(({ startReaderSettings }) => startReaderSettings(reader))
    .catch(() => {
      const status = document.querySelector('[data-reader-status]');
      if (status) status.textContent = t('Settings could not load. Reload to try again.');
    });
const menu = document.querySelector<HTMLButtonElement>('[data-menu]');
const headerMaterial = () =>
  document
    .querySelector('.header-navigation')
    ?.classList.toggle(
      'glass-panel',
      matchMedia('(max-width:680px)').matches && menu?.getAttribute('aria-expanded') === 'true',
    );
addEventListener('resize', headerMaterial);
menu?.addEventListener('click', () => {
  const expanded = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(expanded));
  menu.setAttribute('aria-label', expanded ? t('Close navigation') : t('Open navigation'));
  document.querySelector('.site-nav')?.classList.toggle('mobile-open', expanded);
  headerMaterial();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
    menu.click();
    menu.focus();
  }
});
document.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) => {
  dialog.querySelector('[data-dialog-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const dialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
  if (dialog && !dialog.matches('.media-viewer')) {
    event.preventDefault();
    dialog.close();
  }
});
const search = document.querySelector<HTMLDialogElement>('#search-dialog');
const searchInput = search?.querySelector<HTMLInputElement>('input');
let searchInitialization: Promise<void> | undefined;
let searchAttempts = 0;
if (document.querySelector<HTMLElement>('[data-search-page]'))
  void import('./search.js').then(({ startSearch }) =>
    startSearch(document.querySelector<HTMLElement>('[data-search-page]')!),
  );
const openSearch = () => {
  if (!search) return;
  search.showModal();
  searchInput?.focus();
  searchInitialization ??= (
    searchAttempts && search.dataset.searchModule
      ? import(/* @vite-ignore */ `${search.dataset.searchModule}?retry=${searchAttempts}`)
      : import('./search.js')
  )
    .then(({ startSearch }) => startSearch(search))
    .catch(() => {
      searchAttempts++;
      searchInitialization = undefined;
      const results = search.querySelector('.search-results');
      if (results) {
        results.innerHTML =
          'Search couldn’t load. <button type="button" class="text-link">Retry</button>';
        results.querySelector('button')!.addEventListener('click', openSearch, { once: true });
      }
    });
};
document.querySelector('[data-search-open]')?.addEventListener('click', openSearch);
document.addEventListener('keydown', (event) => {
  if (search && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (search?.open) search.close();
    else openSearch();
  }
});
document.querySelectorAll<HTMLElement>('[data-listing-browser]').forEach((listing) => {
  let activeTag = '';
  const records = [...listing.querySelectorAll<HTMLElement>('[data-entry]')].map((node) => ({
    node,
    tags: new Set<string>(JSON.parse(node.dataset.tags || '[]')),
    title: node.dataset.title || '',
  }));
  function filterArchive() {
    const query =
      listing
        .querySelector<HTMLInputElement>('[data-archive-search]')
        ?.value.toLocaleLowerCase()
        .trim() || '';
    let count = 0;
    records.forEach(({ node, tags, title }) => {
      const visible = (!activeTag || tags.has(activeTag)) && (!query || title.includes(query));
      if (node.hidden === visible) node.hidden = !visible;
      if (visible) count++;
    });
    const label = listing.querySelector<HTMLElement>('[data-archive-count]');
    if (label)
      label.textContent = t('{value0} {value1} {value2}', {
        value0: count,
        value1: count === 1 ? label.dataset.countSingular : label.dataset.countPlural,
        value2: label.dataset.countContext,
      });
    const empty = listing.querySelector<HTMLElement>('[data-archive-empty]');
    if (empty) empty.hidden = count > 0;
  }
  listing.querySelector('[data-archive-search]')?.addEventListener('input', filterArchive);
  listing.querySelectorAll<HTMLButtonElement>('[data-tag-filter]').forEach((button) =>
    button.addEventListener('click', () => {
      activeTag = button.dataset.tagFilter || '';
      listing.querySelectorAll<HTMLElement>('[data-tag-filter]').forEach((b) => {
        b.classList.toggle('active', b === button);
        b.setAttribute('aria-pressed', String(b === button));
      });
      filterArchive();
    }),
  );
});
if (document.querySelector('.code-enhanced'))
  void import('./code-tools.js').then(({ startCodeTools }) => startCodeTools());
if (document.querySelector('.article-shell'))
  void import('./article-experience.js')
    .then(({ startArticleExperience }) => startArticleExperience(reader))
    .catch(() => {
      document.documentElement.dataset.articleFocus = 'false';
    });
const interactiveNodes = document.querySelectorAll<HTMLElement>('[data-interactive]');
if (interactiveNodes.length) {
  const hydrate = async (node: HTMLElement) => {
    try {
      const { enhanceWidget } = await import('./widgets.js');
      await enhanceWidget(node);
    } catch {
      node.dataset.enhancementError = 'true';
    }
  };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            void hydrate(entry.target as HTMLElement);
          }
        }),
      { rootMargin: '300px' },
    );
    interactiveNodes.forEach((node) => observer.observe(node));
  } else interactiveNodes.forEach((node) => void hydrate(node));
}

void import('./ui-language.js')
  .then(({ startUiLanguage }) => startUiLanguage())
  .catch(() => undefined);
if (document.querySelector('[data-album-browser]'))
  void import('./albums.js').then(({ startAlbums }) => startAlbums());

startReadingTools();
