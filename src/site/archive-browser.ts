import { publicPath, logicalPath, readerBasePath } from '../shared/public-path.js';
import { watchArchivePosition } from '../shared/archive-position.js';
import {
  archiveHref as logicalArchiveHref,
  archivePageNumber as logicalArchivePageNumber,
  archiveState,
  type ArchiveCatalog,
  type ArchiveState,
  type ArchiveYear,
} from '../shared/archive.js';
import { archivePaginationHtml, archiveTimelineHtml } from '../shared/archive-html.js';
import { translateUi } from '../shared/ui-locale.js';
import { subscribeUiLocale, t, uiDate, setUiText } from '../shared/i18n.js';
import {
  archiveDataSource,
  type ArchiveReply,
  type ArchiveRequest,
  type ArchiveResult,
} from './archive-data.js';

const archiveHref = (...args: Parameters<typeof logicalArchiveHref>) => publicPath(logicalArchiveHref(...args));
const archivePageNumber = (path: string) => logicalArchivePageNumber(logicalPath(path));

export function startArchive(browser: HTMLElement) {
  const search = browser.querySelector<HTMLInputElement>('[data-timeline-search]')!;
  const topicSearch = browser.querySelector<HTMLInputElement>('[data-topic-search]')!;
  const topicPicker = browser.querySelector<HTMLDetailsElement>('[data-topic-picker]')!;
  const options = browser.querySelector<HTMLElement>('[data-topic-options]')!;
  const status = browser.querySelector<HTMLElement>('[data-archive-status]')!;
  const retry = browser.querySelector<HTMLButtonElement>('[data-archive-retry]')!;
  const results = browser.querySelector<HTMLElement>('[data-archive-results]')!;
  const pagination = browser.querySelector<HTMLElement>('[data-archive-pagination]')!;
  const position = watchArchivePosition(browser);
  let state: ArchiveState = archiveState(new URLSearchParams(location.search));
  let page = archivePageNumber(location.pathname),
    requestId = 0,
    worker: Worker | undefined;
  let fallback: ReturnType<typeof archiveDataSource> | undefined,
    lastResult: ArchiveResult | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<
    number,
    {
      resolve: (result: ArchiveResult) => void;
      reject: () => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  let filterFailed = false;
  let embedded: ArchiveCatalog | undefined;
  const inline = browser.querySelector('[data-archive-embedded]');
  if (inline) {
    try {
      embedded = JSON.parse(inline.textContent || '');
    } catch {
      /* Retain native pages. */
    }
  }
  let workerTried = false,
    workerCatalogSent = false;
  function disableWorker() {
    worker?.terminate();
    worker = undefined;
    for (const item of pending.values()) {
      clearTimeout(item.timeout);
      item.reject();
    }
    pending.clear();
  }
  async function query(request: ArchiveRequest) {
    if (!workerTried) {
      workerTried = true;
      if (browser.dataset.archiveWorker) {
        try {
          worker = new Worker(browser.dataset.archiveWorker, { type: 'module' });
          worker.addEventListener('message', (event: MessageEvent<ArchiveReply>) => {
            const item = pending.get(event.data.id);
            if (!item) return;
            pending.delete(event.data.id);
            clearTimeout(item.timeout);
            if (event.data.result) item.resolve(event.data.result);
            else item.reject();
          });
          worker.addEventListener('error', disableWorker);
        } catch {
          disableWorker();
        }
      }
    }
    if (worker) {
      try {
        return await new Promise<ArchiveResult>((resolve, reject) => {
          pending.set(request.id, { resolve, reject, timeout: setTimeout(disableWorker, 12000) });
          worker!.postMessage({
            ...request,
            embedded: workerCatalogSent ? undefined : request.embedded,
          });
          workerCatalogSent = true;
        });
      } catch {
        disableWorker();
      }
    }
    fallback ||= archiveDataSource();
    return fallback(request);
  }
  const syncControls = () => {
    search.value = state.q;
    browser.querySelectorAll<HTMLButtonElement>('[data-timeline-filter]').forEach((button) => {
      const active = button.dataset.timelineFilter === state.kind;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    browser.querySelector('[data-topic-label]')!.textContent = state.tag || t('All topics');
  };
  function render(result: ArchiveResult, topicsOnly = false) {
    options.replaceChildren();
    for (const topic of [{ tag: '', count: 0 }, ...result.topics]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.timelineTag = topic.tag;
      button.setAttribute('aria-pressed', String(state.tag === topic.tag));
      const label = document.createElement('span');
      label.textContent = topic.tag || t('All topics');
      button.append(label);
      if (topic.tag) {
        const count = document.createElement('small');
        count.textContent = String(topic.count);
        button.append(count);
      }
      options.append(button);
    }
    if (topicsOnly) return;
    lastResult = result;
    page = result.page.page;
    results.innerHTML = archiveTimelineHtml(result.page, result.labels, state, false, readerBasePath());
    pagination.innerHTML = archivePaginationHtml(result.page, state, readerBasePath());
    setUiText(
      browser.querySelector<HTMLElement>('[data-timeline-count]')!,
      result.page.total === 1 ? '{value0} published entry' : '{value0} published entries',
      { value0: result.page.total },
    );
    translateUi(browser);
    browser.querySelector<HTMLElement>('[data-timeline-empty]')!.hidden = result.page.total > 0;
    position.update();
    dispatchEvent(new Event('fieldnotes:archive-updated'));
  }
  async function run({ write = true, topicsOnly = false, hash = '' } = {}) {
    clearTimeout(pendingTimer);
    const id = ++requestId;
    if (write && !topicsOnly) {
      const next = archiveHref(page, state) + hash;
      if (next !== location.pathname + location.search + location.hash)
        history.pushState(null, '', next);
    }
    syncControls();
    retry.hidden = true;
    status.textContent = t('Loading archive…');
    results.setAttribute('aria-busy', 'true');
    try {
      const result = await query({
        id,
        url: browser.dataset.archiveCatalog,
        embedded,
        state: { ...state },
        page,
        topicQuery: topicSearch.value,
      });
      if (id !== requestId) return;
      filterFailed = false;
      render(result, topicsOnly);
      status.textContent = '';
      if (!topicsOnly && page !== archivePageNumber(location.pathname))
        history.replaceState(null, '', archiveHref(page, state) + hash);
      if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
    } catch {
      if (id !== requestId) return;
      filterFailed = true;
      status.textContent = t('Could not filter the archive. Your current page is still available.');
      retry.hidden = false;
    } finally {
      if (id === requestId) results.removeAttribute('aria-busy');
    }
  }
  const change = () => {
    page = 1;
    void run();
  };
  search.addEventListener('input', () => {
    state.q = search.value;
    ++requestId;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(change, 120);
  });
  topicSearch.addEventListener('input', () => {
    ++requestId;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => void run({ topicsOnly: true, write: false }), 100);
  });
  retry.addEventListener('click', () => void run({ write: false }));
  browser.addEventListener('click', (event) => {
    const target = (event.target as Element).closest<HTMLElement>(
      '[data-timeline-filter],[data-timeline-tag]',
    );
    if (target?.hasAttribute('data-timeline-filter')) {
      state.kind = target.dataset.timelineFilter as ArchiveState['kind'];
      change();
    }
    if (target?.hasAttribute('data-timeline-tag')) {
      state.tag = target.dataset.timelineTag || '';
      topicPicker.open = false;
      change();
    }
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      '.archive-pagination a,[data-year-link]',
    );
    if (
      !link ||
      (event as MouseEvent).metaKey ||
      (event as MouseEvent).ctrlKey ||
      (event as MouseEvent).shiftKey ||
      (event as MouseEvent).altKey
    )
      return;
    const url = new URL(link.href);
    if (!filterFailed && (embedded || lastResult || state.q || state.tag || state.kind !== 'all')) {
      event.preventDefault();
      page = archivePageNumber(url.pathname);
      void run({ hash: url.hash });
      if (!url.hash) browser.scrollIntoView({ block: 'start' });
    }
  });
  document.addEventListener('click', (event) => {
    if (!topicPicker.contains(event.target as Node)) topicPicker.open = false;
  });
  topicPicker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      topicPicker.open = false;
      topicPicker.querySelector('summary')?.focus();
    }
  });
  topicPicker.addEventListener('toggle', () => {
    if (topicPicker.open) topicSearch.focus();
  });
  addEventListener('popstate', () => {
    state = archiveState(new URLSearchParams(location.search));
    page = archivePageNumber(location.pathname);
    void run({ write: false, hash: location.hash });
  });
  subscribeUiLocale(() => {
    syncControls();
    if (lastResult) render(lastResult);
    else localizeDates();
  });
  function localizeDates() {
    results.querySelectorAll<HTMLElement>('[data-archive-date]').forEach((node) => {
      node.textContent = uiDate(node.dataset.archiveDate!, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    });
    results.querySelectorAll<HTMLElement>('[data-archive-month]').forEach((node) => {
      node.textContent = uiDate(`${node.dataset.archiveMonth}-01T12:00:00Z`, { month: 'long' });
    });
  }
  localizeDates();
  syncControls();
  browser.dataset.archiveReady = 'true';
  const legacyYear = location.hash.match(/^#archive-year-(\d{4})$/)?.[1];
  const year = (JSON.parse(browser.dataset.archiveYears || '[]') as ArchiveYear[]).find(
    (year) => year.year === legacyYear,
  );
  if (
    year &&
    !state.q &&
    !state.tag &&
    state.kind === 'all' &&
    !document.getElementById(`archive-year-${year.year}`)
  ) {
    location.replace(archiveHref(year.page, state, year.year));
    return;
  }
  if (state.q || state.tag || state.kind !== 'all') void run({ write: false, hash: location.hash });
}
