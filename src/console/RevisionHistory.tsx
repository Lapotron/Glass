import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState } from 'react';
import { Button, Icon, EmptyState } from '../shared/ui.js';
import type { EntryRevision, PublicEntry } from '../shared/contracts.js';
import { api, send, metadataOf } from './api.js';
import { Modal, ErrorBox, Field } from './components.js';
import { MarkdownDiff } from './MarkdownDiff.js';

const reasons = {
  edit: 'Edited',
  restore: 'Restored',
  schedule: 'Scheduled publication',
  batch: 'Batch operation',
};
const readable = (value: unknown) =>
  value === undefined || value === ''
    ? 'Not set'
    : typeof value === 'object'
      ? JSON.stringify(value, null, 2)
      : String(value);
function MetadataChanges({ earlier, current }: { earlier: PublicEntry; current: PublicEntry }) {
  const a = metadataOf(earlier),
    b = metadataOf(current);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])] as (keyof typeof a)[];
  const changes = keys.filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
  return changes.length ? (
    <details className="revision-metadata">
      <summary><UiText message={"Details changed · "}/>{changes.length}</summary>
      <dl>
        {changes.map((key) => (
          <div key={key}>
            <dt>{key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}</dt>
            <dd>
              <del>{readable(a[key])}</del>
              <ins>{readable(b[key])}</ins>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  ) : (
    <p className="help" data-ui={"Article details are unchanged."}>{t("Article details are unchanged.")}</p>
  );
}
export function RevisionHistory({
  entry,
  active,
  onClose,
  onRestored,
}: {
  entry: PublicEntry;
  active: boolean;
  onClose: () => void;
  onRestored: (entry: PublicEntry) => void;
}) {
  const [items, setItems] = useState<EntryRevision[]>([]),
    [selected, setSelected] = useState(''),
    [compare, setCompare] = useState('current');
  const [record, setRecord] = useState<PublicEntry | null>(null),
    [other, setOther] = useState<PublicEntry | null>(null);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [confirm, setConfirm] = useState<PublicEntry | null>(null);
  const [query, setQuery] = useState(''),
    [reason, setReason] = useState(''),
    [from, setFrom] = useState(''),
    [until, setUntil] = useState(''),
    [order, setOrder] = useState('newest'),
    [page, setPage] = useState(0);
  const restorePending = useRef(false),
    cache = useRef(new Map<string, PublicEntry>());
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api<EntryRevision[]>(`content/${entry.id}/revisions`, { signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted) return;
        setItems(items);
        setSelected((value) =>
          items.some((i) => i.revision === value)
            ? value
            : items.find((i) => i.revision !== entry.revision)?.revision ||
              items[0]?.revision ||
              '',
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, entry.id, entry.revision, retry]);
  useEffect(() => {
    if (!active || !selected) return;
    const controller = new AbortController();
    setRecord(null);
    setOther(null);
    setError('');
    const load = async (revision: string) => {
      const cached = cache.current.get(revision);
      if (cached) return cached;
      const result = await api<{ entry: PublicEntry }>(
        `content/${entry.id}/revisions/${revision}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) cache.current.set(revision, result.entry);
      return result.entry;
    };
    void Promise.all([
      load(selected),
      compare === 'current' ? Promise.resolve(null) : load(compare),
    ])
      .then(([a, b]) => {
        if (!controller.signal.aborted) {
          setRecord(a);
          setOther(b);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [active, selected, compare, entry.id, retry]);
  useEffect(() => {
    setPage(0);
  }, [query, reason, from, until, order]);
  const filtered = items
    .filter(
      (item) =>
        (!query ||
          `${item.title} ${item.status} ${reasons[item.reason]} ${item.revision}`
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (!reason || item.reason === reason) &&
        (!from || item.savedAt.slice(0, 10) >= from) &&
        (!until || item.savedAt.slice(0, 10) <= until),
    )
    .sort((a, b) => (order === 'newest' ? -1 : 1) * a.savedAt.localeCompare(b.savedAt));
  const pages = Math.max(1, Math.ceil(filtered.length / 25)),
    currentPage = Math.min(page, pages - 1),
    target = compare === 'current' ? entry : other;
  async function restore() {
    if (restorePending.current || !record || !confirm || confirm.revision !== entry.revision)
      return;
    restorePending.current = true;
    setBusy(true);
    setError('');
    try {
      const restored = await send<PublicEntry>(
        `content/${entry.id}/revisions/${record.revision}/restore`,
        'POST',
        { revision: confirm.revision },
      );
      onRestored(restored);
      setConfirm(null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      restorePending.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      hidden={!active}
      className="revision-workspace"
      role="region"
      aria-label={t("Revision history")}
     data-ui-attrs={"{\"aria-label\":\"Revision history\"}"} >
      <header className="revision-workspace-head">
        <div>
          <h2>
            <Icon name="History" size={19} /> <UiText message={" Revision history"}/></h2>
          <p className="help" data-ui={"Compare saved versions. Restoring keeps the version it replaces."}>{t("Compare saved versions. Restoring keeps the version it replaces.")}</p>
        </div>
        <Button icon="ChevronLeft" className="small" onClick={onClose}>
          <UiText message={"Return to editor"}/></Button>
      </header>
      <ErrorBox error={error} />
      {error && !confirm && (
        <Button className="small" icon="RotateCcw" onClick={() => setRetry((n) => n + 1)}>
          <UiText message={"Retry history"}/></Button>
      )}
      {loading && !items.length ? (
        <p role="status" className="help" data-ui={"Loading saved revisions…"}>
          {t("Loading saved revisions…")}</p>
      ) : !items.length && !error ? (
        <EmptyState icon="History" title={t("Your next edit starts the history")}>
          <UiText message={"Earlier versions are saved automatically when you edit this entry."}/></EmptyState>
      ) : (
        <div className="revision-layout">
          <aside className="revision-catalog" aria-label={t("Revision catalog")} data-ui-attrs={"{\"aria-label\":\"Revision catalog\"}"} >
            <div className="revision-filters">
              <label className="search-field">
                <Icon name="Search" size={15} />
                <input
                  type="search"
                  aria-label={t("Search revisions")}
                  placeholder={t("Search revisions…")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                 data-ui-attrs={"{\"aria-label\":\"Search revisions\",\"placeholder\":\"Search revisions…\"}"} />
              </label>
              <div className="revision-filter-row">
                <select
                  aria-label={t("Revision reason")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                 data-ui-attrs={"{\"aria-label\":\"Revision reason\"}"} >
                  <option value="" data-ui={"All reasons"}>{t("All reasons")}</option>
                  {Object.entries(reasons).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t("Revision order")}
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                 data-ui-attrs={"{\"aria-label\":\"Revision order\"}"} >
                  <option value="newest" data-ui={"Newest first"}>{t("Newest first")}</option>
                  <option value="oldest" data-ui={"Oldest first"}>{t("Oldest first")}</option>
                </select>
              </div>
              <details>
                <summary data-ui={"Filter dates"}>{t("Filter dates")}</summary>
                <Field label={t("From date")}>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label={t("Through date")}>
                  <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                </Field>
              </details>
            </div>
            <p className="help" role="status">
              {filtered.length} <UiText message={" saved "}/>{filtered.length === 1 ? t("version") : t("versions")}
            </p>
            <div className="revision-list" role="group" aria-label={t("Saved revisions")} data-ui-attrs={"{\"aria-label\":\"Saved revisions\"}"} >
              {filtered.slice(currentPage * 25, (currentPage + 1) * 25).map((item) => (
                <button
                  type="button"
                  key={item.revision}
                  className={selected === item.revision ? 'selected' : ''}
                  aria-pressed={selected === item.revision}
                  onClick={() => setSelected(item.revision)}
                >
                  <Icon name={item.reason === 'restore' ? 'RotateCcw' : 'History'} size={15} />
                  <span>
                    <strong>{item.title}</strong>
                    <time dateTime={item.savedAt}>{new Date(item.savedAt).toLocaleString()}</time>
                    <small>
                      {reasons[item.reason]} · {item.words.toLocaleString()} <UiText message={" words · "}/>{item.status}
                      {item.revision === entry.revision ? t(" · Current") : ''}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            {!filtered.length && <p className="help" data-ui={"No revisions match these filters."}>{t("No revisions match these filters.")}</p>}
            {pages > 1 && (
              <nav className="revision-pagination" aria-label={t("Revision pages")} data-ui-attrs={"{\"aria-label\":\"Revision pages\"}"} >
                <Button
                  className="small"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <UiText message={"Previous page"}/></Button>
                <span>
                  {currentPage + 1} / {pages}
                </span>
                <Button
                  className="small"
                  disabled={currentPage === pages - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <UiText message={"Next page"}/></Button>
              </nav>
            )}
          </aside>
          <section className="revision-comparison" aria-label={t("Revision comparison")} data-ui-attrs={"{\"aria-label\":\"Revision comparison\"}"} >
            <div className="revision-compare-controls">
              <Field label={t("Compare selected version with")}>
                <select value={compare} onChange={(e) => setCompare(e.target.value)}>
                  <option value="current" data-ui={"Current saved version"}>{t("Current saved version")}</option>
                  {items
                    .filter((item) => item.revision !== selected)
                    .map((item) => (
                      <option key={item.revision} value={item.revision}>
                        {new Date(item.savedAt).toLocaleString()} · {reasons[item.reason]}
                      </option>
                    ))}
                </select>
              </Field>
              <Button
                className="small"
                variant="primary"
                icon="RotateCcw"
                disabled={!record || busy || selected === entry.revision}
                onClick={() => setConfirm(entry)}
              >
                <UiText message={"Review restore"}/></Button>
            </div>
            <div className="diff-key">
              <span className="diff-removed" data-ui={"Selected version"}>{t("Selected version")}</span>
              <Icon name="ArrowRight" size={14} />
              <span className="diff-added">
                {compare === 'current' ? t("Current saved version") : t("Comparison version")}
              </span>
            </div>
            {record && target ? (
              <>
                <MetadataChanges earlier={record} current={target} />
                <MarkdownDiff earlier={record.body} current={target.body} />
              </>
            ) : (
              <p className="help" role="status">
                {selected ? t("Loading comparison…") : t("Choose a saved version.")}
              </p>
            )}
          </section>
        </div>
      )}
      {confirm && record && (
        <Modal
          title={t("Restore this revision?")}
          wide
          className="revision-restore"
          dismissible={!busy}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <span className="history-footnote" data-ui={"The current saved version stays in history."}>{t("The current saved version stays in history.")}</span>
              <Button data-modal-focus disabled={busy} onClick={() => setConfirm(null)}>
                <UiText message={"Cancel"}/></Button>
              <Button
                variant="primary"
                icon="RotateCcw"
                disabled={busy || confirm.revision !== entry.revision}
                onClick={() => void restore()}
              >
                {busy ? t("Restoring…") : t("Restore this revision")}
              </Button>
            </>
          }
        >
          <p data-ui={"This restores the complete selected version, including article details. This review always compares against your current saved article."}>
            {t("This restores the complete selected version, including article details. This review always compares against your current saved article.")}</p>
          <ErrorBox error={error} />
          {confirm.revision !== entry.revision && (
            <div role="alert">
              <p data-ui={"The saved article changed after this review opened. Review the latest version before restoring."}>
                {t("The saved article changed after this review opened. Review the latest version before restoring.")}</p>
              <Button className="small" onClick={() => setConfirm(entry)}>
                <UiText message={"Review latest version"}/></Button>
            </div>
          )}
          <MetadataChanges earlier={confirm} current={record} />
          <MarkdownDiff earlier={confirm.body} current={record.body} />
        </Modal>
      )}
    </section>
  );
}
