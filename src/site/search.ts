import { t, setUiText } from '../shared/i18n.js';
import { escapeHtml } from '../shared/utils.js';
import { languageOptionLabel } from '../shared/content-languages.js';
import { publicPath, publicAsset } from '../shared/public-path.js';
type Manifest = {
  version: 1;
  revision: string;
  languages: { language: string; module: string }[];
  filters: Record<string, string[]>;
  records: number;
};
type Hit = {
  url: string;
  excerpt: string;
  meta: Record<string, string>;
  sub_results?: { url: string; title: string; excerpt: string }[];
};
type Pagefind = {
  options: (options: Record<string, unknown>) => Promise<void>;
  search: (
    query: string,
    options: Record<string, unknown>,
  ) => Promise<{ results: { id: string; score: number; data: () => Promise<Hit> }[] }>;
};
const initialized = new WeakSet<HTMLElement>();
const modules = new Map<string, Promise<Pagefind>>();
const moduleAttempts = new Map<string, number>();
const searchFilterLabels = [
  ['type', 'Content', 'Filter by content'],
  ['topic', 'Topic', 'Filter by topic'],
  ['language', 'Language', 'Filter by language'],
] as const;
let manifestRequest: Promise<Manifest> | undefined;
function manifest() {
  return (manifestRequest ??= fetch(publicPath('/assets/search-manifest.json'), { cache: 'no-cache' })
    .then(async (response) => {
      if (!response.ok) throw new Error(t('Build the site to create its public search index.'));
      const value = (await response.json()) as Manifest;
      if (
        value.version !== 1 ||
        !Array.isArray(value.languages) ||
        value.languages.some(
          (item) => !publicAsset(item.module, /^\/assets\/search\/[a-f0-9]{20}\/[a-z]+\/pagefind\.js$/),
        )
      )
        throw new Error(t('The search index changed. Retry to refresh it.'));
      return value;
    })
    .catch((error) => {
      manifestRequest = undefined;
      throw error;
    }));
}
async function loadModule(url: string) {
  if (!modules.has(url))
    modules.set(
      url,
      import(
        /* @vite-ignore */ moduleAttempts.get(url) ? `${url}?retry=${moduleAttempts.get(url)}` : url
      )
        .then(async (module: Pagefind) => {
          await module.options({ baseUrl: publicPath('/'), highlightParam: 'highlight' });
          return module;
        })
        .catch((error) => {
          modules.delete(url);
          moduleAttempts.set(url, (moduleAttempts.get(url) || 0) + 1);
          throw error;
        }),
    );
  return modules.get(url)!;
}
/** Escape all index text; only Pagefind's generated <mark> tags are admitted. */
const excerpt = (value: string) =>
  escapeHtml(value).replaceAll('&lt;mark&gt;', '<mark>').replaceAll('&lt;/mark&gt;', '</mark>');
export function startSearch(container: HTMLElement) {
  if (initialized.has(container)) return;
  initialized.add(container);
  if (
    container.dataset.searchStyle &&
    ![...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')].some(
      (link) => new URL(link.href).pathname === container.dataset.searchStyle,
    )
  ) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = container.dataset.searchStyle;
    document.head.append(link);
  }
  const input = container.querySelector<HTMLInputElement>('input[type=search]')!,
    results = container.querySelector<HTMLElement>('.search-results')!;
  const page = container.hasAttribute('data-search-page'),
    params = new URLSearchParams(location.search);
  const filterBar = document.createElement('div');
  filterBar.className = 'search-filters';
  const filters = new Map<string, HTMLSelectElement>();
  for (const [key, title, description] of searchFilterLabels) {
    const label = document.createElement('label');
    const caption = document.createElement('span');
    setUiText(caption, title);
    label.append(caption);
    const select = document.createElement('select');
    select.setAttribute('aria-label', t(description));
    select.dataset.uiAttrs = JSON.stringify({ 'aria-label': description });
    const all = new Option('', '');
    setUiText(all, 'All');
    select.append(all);
    label.append(select);
    filterBar.append(label);
    filters.set(key, select);
  }
  results.before(filterBar);
  const status = document.createElement('p');
  status.className = 'search-summary';
  status.setAttribute('role', 'status');
  results.before(status);
  const pagination = document.createElement('div');
  pagination.className = 'search-pagination';
  results.after(pagination);
  let sequence = 0,
    timer: ReturnType<typeof setTimeout>,
    offset = 0;
  let hits: { data: () => Promise<Hit> }[] = [];
  let filterRevision = '';
  function populateFilters(index: Manifest) {
    if (filterRevision === index.revision) return;
    for (const [key, select] of filters) {
      const selected = filterRevision ? select.value : page ? params.get(key) || '' : '';
      select.innerHTML =
        '<option value="" data-ui="All">' +
        escapeHtml(t('All')) +
        '</option>' +
        (index.filters[key] || [])
          .map(
            (v) =>
              `<option value="${escapeHtml(v)}"${key === 'type' && v === 'Tool' ? ' data-ui="Tool"' : ''}>${escapeHtml(key === 'language' ? languageOptionLabel(v) : key === 'type' && v === 'Tool' ? t('Tool') : v)}</option>`,
          )
          .join('');
      select.value = selected;
    }
    filterRevision = index.revision;
  }
  addEventListener('glass:language', () => {
    for (const option of filters.get('language')!.options)
      if (option.value) option.textContent = languageOptionLabel(option.value);
  });
  const urlFor = () => {
    const query = new URLSearchParams();
    if (input.value.trim()) query.set('q', input.value.trim());
    for (const [key, select] of filters) if (select.value) query.set(key, select.value);
    return `/search/${query.size ? '?' + query : ''}`;
  };
  async function render(id: number) {
    const visible = await Promise.all(hits.slice(offset, offset + 12).map((hit) => hit.data()));
    if (sequence !== id) return;
    results.innerHTML = visible.length
      ? visible
          .filter((hit) => /^\/(?!\/)/.test(hit.url))
          .map(
            (hit, i) =>
              `<a class="search-result" data-aca-item="${escapeHtml(hit.meta.contentId || `page:${hit.url.split('#')[0]}`)}" data-aca-surface="search" data-aca-rank="${offset + i + 1}" href="${escapeHtml(hit.url)}"><span class="eyebrow">${escapeHtml(hit.meta.type || '')}</span><h3>${escapeHtml(hit.meta.title || hit.url)}</h3><p>${excerpt(hit.excerpt || hit.meta.summary || '')}</p></a>${(
                hit.sub_results || []
              )
                .filter((sub) => sub.url !== hit.url && sub.title && /^\/(?!\/)/.test(sub.url))
                .slice(0, 2)
                .map(
                  (sub) =>
                    `<a class="search-section" href="${escapeHtml(sub.url)}">↳ ${escapeHtml(sub.title)}</a>`,
                )
                .join('')}`,
          )
          .join('')
      : '<p class="no-results"></p>';
    if (!visible.length)
      setUiText(
        results.querySelector<HTMLElement>('.no-results')!,
        'No matches. Try another word or fewer filters.',
      );
    setUiText(status, hits.length === 1 ? '{count} result{range}' : '{count} results{range}', {
      count: hits.length,
      range: hits.length ? ` · ${offset + 1}–${offset + visible.length}` : '',
    });
    pagination.replaceChildren();
    for (const [text, delta, disabled] of [
      ['Previous', -12, offset === 0],
      ['Next', 12, offset + 12 >= hits.length],
    ] as const) {
      const button = document.createElement('button');
      button.className = 'text-link';
      setUiText(button, text);
      button.disabled = disabled;
      button.onclick = () => {
        offset += delta;
        void render(id);
      };
      pagination.append(button);
    }
    const link = document.createElement('a');
    link.href = urlFor();
    link.className = 'text-link';
    setUiText(link, page ? 'Link to these results' : 'Open full search');
    pagination.append(link);
    if (page) history.replaceState(null, '', urlFor());
    dispatchEvent(new CustomEvent('fieldnotes:search-results'));
  }
  async function run() {
    const id = ++sequence,
      query = input.value.trim().slice(0, 300);
    offset = 0;
    if (!query) {
      results.innerHTML = '<p class="no-results"></p>';
      setUiText(
        results.querySelector<HTMLElement>('.no-results')!,
        'Search writing, projects, albums, and code.',
      );
      delete status.dataset.ui;
      delete status.dataset.uiParams;
      status.textContent = '';
      pagination.replaceChildren();
      return;
    }
    setUiText(status, 'Searching…');
    try {
      const index = await manifest();
      populateFilters(index);
      const selected = [...filters]
        .filter(([key, select]) => key !== 'language' && select.value)
        .map(([key, select]) => [key, select.value]);
      const languages = index.languages.filter(
        (lang) =>
          !filters.get('language')!.value || lang.language === filters.get('language')!.value,
      );
      const sets = await Promise.all(
        languages.map(
          async (lang) =>
            (
              await (
                await loadModule(lang.module)
              ).search(query, { filters: Object.fromEntries(selected) })
            ).results,
        ),
      );
      if (id !== sequence) return;
      // Rank positions are comparable across native language indexes; their raw scores are not.
      hits = sets
        .flatMap((set, language) => set.map((hit, rank) => ({ ...hit, rank, language })))
        .sort((a, b) => a.rank - b.rank || a.language - b.language);
      await render(id);
      dispatchEvent(
        new CustomEvent('fieldnotes:analytics', {
          detail: { action: 'search', count: hits.length },
        }),
      );
    } catch (error) {
      if (sequence !== id) return;
      manifestRequest = undefined;
      setUiText(status, 'Search could not load. Your query is preserved.');
      status.title = (error as Error).message;
      results.innerHTML =
        '<p class="no-results"><button type="button" class="text-link"></button></p>';
      setUiText(results.querySelector<HTMLButtonElement>('button')!, 'Retry');
      results.querySelector('button')!.onclick = () => {
        void run();
      };
    }
  }
  void manifest()
    .then((index) => {
      populateFilters(index);
      if (page && input.value) void run();
    })
    .catch(() => {});
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void run();
    }, 120);
  });
  filters.forEach((select) =>
    select.addEventListener('change', () => {
      void run();
    }),
  );
  container.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const links = [...results.querySelectorAll<HTMLAnchorElement>('a')];
    if (!links.length) return;
    event.preventDefault();
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    links[(index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length].focus();
  });
  if (page) input.value = params.get('q') || '';
  void run();
}
