import { t, setUiText } from '../shared/i18n.js';
import { parseReadingRecords, readingStorageKey, type ReadingRecord } from '../shared/reading.js';
import { indexTextBlocks, lineFragment } from './line-anchors.js';
import { publicPath } from '../shared/public-path.js';
type Entry = { id: string; title: string; url: string; revision: string };
function read() {
  try {
    return parseReadingRecords(JSON.parse(localStorage.getItem(readingStorageKey) || '[]'));
  } catch {
    return [];
  }
}
function write(records: ReadingRecord[]) {
  try {
    localStorage.setItem(readingStorageKey, JSON.stringify(parseReadingRecords(records)));
  } catch {
    throw new Error(
      t(
        'Browser storage is unavailable or full. Export your reading list before clearing storage.',
      ),
    );
  }
}
function current(): Entry | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name=reading-entry]');
  return meta ? JSON.parse(meta.content) : null;
}
function record(entry: Entry): ReadingRecord {
  return (
    read().find((r) => r.id === entry.id) || {
      ...entry,
      bookmarked: false,
      progress: 0,
      anchor: '',
      quote: '',
      updatedAt: new Date().toISOString(),
    }
  );
}
function save(item: ReadingRecord) {
  const records = read().filter((r) => r.id !== item.id);
  records.unshift({ ...item, updatedAt: new Date().toISOString() });
  if (records.length > 500) {
    let removable = records.length - 1;
    while (removable >= 0 && records[removable].bookmarked) removable--;
    if (removable < 0) throw new Error(t('Reading list is full. Remove an item first.'));
    records.splice(removable, 1);
  }
  write(records);
}
function updateButtons() {
  const entry = current();
  if (!entry) return;
  const saved = record(entry).bookmarked;
  document.querySelectorAll<HTMLButtonElement>('[data-reading-bookmark]').forEach((b) => {
    b.setAttribute('aria-pressed', String(saved));
    setUiText(b, saved ? 'Saved to reading list' : 'Save to reading list');
  });
}
export function toggleBookmark() {
  const entry = current();
  if (!entry) return;
  const item = record(entry);
  save({ ...item, ...entry, bookmarked: !item.bookmarked });
  updateButtons();
}
export async function openReadingList(trigger: HTMLElement) {
  const dialog = document.createElement('dialog');
  dialog.className = 'reader-privacy-dialog';
  dialog.setAttribute('aria-label', t('Reading list'));
  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = document.createElement('h2');
  title.textContent = t('Reading list');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button';
  close.textContent = '×';
  close.setAttribute('aria-label', t('Close'));
  close.onclick = () => dialog.close();
  head.append(title, close);
  const body = document.createElement('div');
  body.className = 'modal-body';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const list = document.createElement('div');
  list.className = 'reading-list-items';
  let catalog: Entry[] | undefined;
  const draw = () => {
    list.replaceChildren();
    const records = read();
    if (!records.length) {
      const p = document.createElement('p');
      p.textContent = t('No saved reading yet. Save an article or scroll to remember your place.');
      list.append(p);
    }
    for (const item of records) {
      const published = catalog?.find((e) => e.id === item.id);
      const row = document.createElement('div');
      row.className = 'reading-list-item';
      const link = document.createElement('a');
      link.textContent =
        (published?.title || item.title) + (item.bookmarked ? ' · ' + t('Saved') : '');
      link.href = (published?.url || item.url) + (item.anchor ? '#' + item.anchor : '');
      const note = document.createElement('span');
      note.className = 'help';
      note.textContent =
        Math.round(item.progress) +
        '% · ' +
        (catalog && !published
          ? t('No longer published')
          : published && published.revision !== item.revision
            ? t('Article changed; position may be approximate')
            : t('Saved in this browser'));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text-link';
      remove.textContent = t('Remove');
      remove.setAttribute('aria-label', t('Remove {name}', { name: item.title }));
      remove.onclick = () => {
        try {
          write(read().filter((r) => r.id !== item.id));
          draw();
          updateButtons();
        } catch (e) {
          status.textContent = (e as Error).message;
        }
      };
      row.append(link, note, remove);
      list.append(row);
    }
  };
  const tools = document.createElement('div');
  tools.className = 'reading-list-tools';
  const button = (text: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'button small';
    b.textContent = t(text);
    b.onclick = fn;
    tools.append(b);
  };
  button('Export reading list', () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, entries: read() }, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'glass-reading-list.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.hidden = true;
  input.onchange = async () => {
    try {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 500000) throw new Error(t('Reading list file is too large.'));
      const data = JSON.parse(await file.text());
      if (data.version !== 1) throw new Error(t('Unsupported reading list version.'));
      const imported = parseReadingRecords(data.entries);
      const merged = new Map(read().map((r) => [r.id, r]));
      for (const r of imported) {
        const old = merged.get(r.id);
        if (!old || old.updatedAt < r.updatedAt) merged.set(r.id, r);
      }
      write([...merged.values()]);
      draw();
      updateButtons();
      status.textContent = t('Reading list imported.');
    } catch (e) {
      status.textContent = (e as Error).message;
    } finally {
      input.value = '';
    }
  };
  button('Import reading list', () => input.click());
  button('Clear reading list', () => {
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'button small';
    confirm.textContent = t('Confirm clear');
    confirm.onclick = () => {
      try {
        write([]);
        confirm.remove();
        draw();
        updateButtons();
      } catch (e) {
        status.textContent = (e as Error).message;
      }
    };
    status.replaceChildren(
      document.createTextNode(t('Clear bookmarks and reading positions in this browser?') + ' '),
      confirm,
    );
  });
  body.append(list, status, tools, input);
  dialog.append(head, body);
  document.body.append(dialog);
  dialog.addEventListener(
    'close',
    () => {
      dialog.remove();
      trigger.focus();
    },
    { once: true },
  );
  dialog.showModal();
  draw();
  try {
    const response = await fetch(publicPath('/assets/reading-catalog.json'), {
      credentials: 'omit',
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      catalog = await response.json();
      if (dialog.isConnected) draw();
    }
  } catch {
    /* Saved native links remain available offline. */
  }
}
export function startReadingProgress() {
  const entry = current(),
    article = document.querySelector<HTMLElement>('.article-body');
  if (!entry || !article || article.dataset.readingTracking) return;
  article.dataset.readingTracking = 'true';
  updateButtons();
  let blocks: ReturnType<typeof indexTextBlocks> | undefined,
    last = 0,
    restored = false;
  const index = () => (blocks ||= indexTextBlocks(article));
  const saved = record(entry);
  if (saved.progress > 3 && saved.progress < 98 && !location.hash) {
    const prompt = document.createElement('div');
    prompt.className = 'reading-resume glass-panel';
    prompt.setAttribute('role', 'region');
    prompt.setAttribute('aria-label', t('Resume reading'));
    const label = document.createElement('span');
    label.textContent = t('Continue where you stopped') + ' · ' + Math.round(saved.progress) + '%';
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'button small';
    resume.textContent = t('Resume reading');
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'text-link';
    dismiss.textContent = t('Dismiss');
    dismiss.onclick = () => prompt.remove();
    resume.onclick = async () => {
      const all = await index();
      const key = saved.anchor.match(/^line-([a-f\d]{20}-\d+)-/)?.[1];
      const block =
        all.find((b) => b.key === key) ||
        all.find((b) => saved.quote && b.text.startsWith(saved.quote));
      restored = true;
      prompt.remove();
      if (block)
        block.element.scrollIntoView({
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          block: 'center',
        });
      else {
        const top =
          article.getBoundingClientRect().top +
          scrollY +
          (article.offsetHeight * saved.progress) / 100 -
          innerHeight / 2;
        scrollTo({
          top,
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
      }
    };
    prompt.append(label, resume, dismiss);
    article.before(prompt);
  }
  const capture = async () => {
    if (document.hidden) return;
    const rect = article.getBoundingClientRect();
    if (rect.top > innerHeight * 0.8 || rect.bottom < 0) return;
    last = Date.now();
    const all = await index();
    const block = all.find((b) => b.element.getBoundingClientRect().bottom > innerHeight * 0.3);
    if (!block) return;
    const position = Math.max(
      0,
      Math.min(100, ((innerHeight * 0.3 - rect.top) / rect.height) * 100),
    );
    const old = record(entry);
    try {
      save({
        ...old,
        ...entry,
        progress: position,
        anchor: lineFragment({ key: block.key, start: 0, end: Math.min(100, block.text.length) }),
        quote: block.text.slice(0, 140),
      });
    } catch {
      /* Keep reading usable when persistence is blocked. */
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    const remaining = 1500 - (Date.now() - last);
    if (remaining <= 0) void capture();
    else timer = setTimeout(() => void capture(), remaining);
  };
  if (scrollY > 0) schedule();
  addEventListener(
    'scroll',
    () => {
      schedule();
    },
    { passive: true },
  );
  addEventListener('pagehide', () => {
    clearTimeout(timer);
    if (restored || scrollY > 0) {
      last = 0;
      void capture();
    }
  });
}
