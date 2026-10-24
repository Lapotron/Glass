import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState } from 'react';
import { Button, Icon, EmptyState } from '../shared/ui.js';
import type { SelectedItem, TrashItem } from '../shared/operations.js';
import { openImageViewer } from '../shared/image-viewer.js';
import { api, send } from './api.js';
import { PageHeading, ErrorBox } from './components.js';
import {
  BatchDialog,
  SelectionToolbar,
  SelectionCheck,
  PageSelection,
  Pagination,
  useSelection,
} from './Selection.js';
type TrashReview = {
  action: 'restore' | 'purge';
  items: SelectedItem[];
  names: string[];
  photos: number;
  libraryRevision: string;
};
export function TrashList({
  onRestored,
  collections,
  initialKind = 'all',
  libraryRevision,
}: {
  onRestored: () => void | Promise<void>;
  collections: import('../shared/collections.js').CollectionsConfig;
  initialKind?: string;
  libraryRevision: string;
}) {
  const [items, setItems] = useState<TrashItem[]>([]),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState(initialKind),
    [sort, setSort] = useState('newest'),
    [page, setPage] = useState(1),
    [reviewState, setReviewState] = useState<TrashReview | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const request = useRef(0);
  const load = async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const next = await api<TrashItem[]>('trash');
      if (current === request.current) {
        setItems(next);
        setError('');
      }
    } catch (failure) {
      if (current === request.current) setError((failure as Error).message);
      throw failure;
    } finally {
      if (current === request.current) setLoading(false);
    }
  };
  useEffect(() => {
    const refresh = () => void load().catch(() => {});
    refresh();
    window.addEventListener('studio-filesystem', refresh);
    return () => {
      request.current++;
      window.removeEventListener('studio-filesystem', refresh);
    };
  }, []);
  const resetKey = query + '|' + kind,
    selection = useSelection(items, resetKey);
  const review = (action: 'restore' | 'purge', selected = selection.items) => {
    setReviewState({
      action,
      items: selected.map(({ id, revision }) => ({ id, revision })),
      names: selected.map(
        (record) => items.find((item) => item.id === record.id)?.title || record.id,
      ),
      photos: selected.filter((record) =>
        items.some((item) => item.id === record.id && item.kind === 'photos'),
      ).length,
      libraryRevision,
    });
  };
  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  const visible = items
    .filter(
      (item) =>
        (kind === 'all' || item.kind === kind) &&
        `${item.title} ${item.kind === 'photos' ? item.photo.alt + ' ' + item.photo.album : ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'oldest'
          ? a.deletedAt.localeCompare(b.deletedAt)
          : b.deletedAt.localeCompare(a.deletedAt),
    );
  const current = Math.min(page, Math.max(1, Math.ceil(visible.length / 25))),
    shown = visible.slice((current - 1) * 25, current * 25);
  const photoCount = reviewState?.photos || 0,
    action = reviewState?.action,
    noun =
      photoCount === reviewState?.items.length && photoCount
        ? 'photos'
        : photoCount
          ? 'items'
          : 'entries';
  return (
    <div className="studio-page">
      <PageHeading
        eyebrow={t("Keep a way back")}
        title={t("A second chance.")}
        description={t("Restore entries and photo moments, or review what to remove permanently. Media files stay in your library.")}
      >
        <Button
          icon="Trash2"
          disabled={loading || !!error || !items.length || items.length > 500}
          onClick={() => {
            selection.clear();
            selection.select(items);
            review('purge', items);
          }}
        >
          <UiText message={"Empty Trash"}/></Button>
      </PageHeading>
      <div className="managed-filters">
        <div className="search-field">
          <Icon name="Search" size={15} />
          <input
            type="search"
            aria-label={t("Search Trash")}
            placeholder={t("Find an entry, photo or album…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
           data-ui-attrs={"{\"aria-label\":\"Search Trash\",\"placeholder\":\"Find an entry, photo or album…\"}"} />
        </div>
        <select
          aria-label={t("Filter Trash collection")}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
         data-ui-attrs={"{\"aria-label\":\"Filter Trash collection\"}"} >
          <option value="all" data-ui={"All items"}>{t("All items")}</option>
          <option value="posts">{collections.posts.name}</option>
          <option value="lab">{collections.lab.name}</option>
          <option value="photos"><UiText message={"Photos · "}/>{collections.life.name}</option>
        </select>
        <select
          aria-label={t("Sort Trash")}
          value={sort}
          onChange={(event) => setSort(event.target.value)}
         data-ui-attrs={"{\"aria-label\":\"Sort Trash\"}"} >
          <option value="newest" data-ui={"Newest deletion first"}>{t("Newest deletion first")}</option>
          <option value="oldest" data-ui={"Oldest deletion first"}>{t("Oldest deletion first")}</option>
          <option value="title" data-ui={"Title A–Z"}>{t("Title A–Z")}</option>
        </select>
      </div>
      <ErrorBox error={error} />
      {error && (
        <Button
          className="small"
          icon="RotateCcw"
          onClick={() => {
            void load().catch(() => {});
          }}
        >
          <UiText message={"Retry loading Trash"}/></Button>
      )}
      {message && (
        <p className="operation-message" role="status">
          {message}
        </p>
      )}
      <SelectionToolbar selection={selection} matching={visible}>
        <Button
          className="small"
          icon="RotateCcw"
          disabled={loading || !!error}
          onClick={() => review('restore')}
        >
          <UiText message={"Restore selected"}/></Button>
        <Button
          className="small"
          icon="Trash2"
          disabled={loading || !!error}
          onClick={() => review('purge')}
        >
          <UiText message={"Delete permanently"}/></Button>
      </SelectionToolbar>
      <section className="managed-list glass-panel" aria-label={t("Trash items")} aria-busy={loading} data-ui-attrs={"{\"aria-label\":\"Trash items\"}"} >
        <div className="managed-list-head">
          <PageSelection selection={selection} items={shown} />
          <span>
            {visible.length} {kind === 'photos' ? t("photos") : t("items")}
          </span>
        </div>
        {shown.map((item) => (
          <div
            className={
              'managed-entry-row trash-entry-row' + (selection.has(item.id) ? ' is-selected' : '')
            }
            key={item.id}
          >
            <SelectionCheck
              label={'Select ' + item.title}
              checked={selection.has(item.id)}
              onChange={() => selection.toggle(item)}
            />
            <div className="managed-entry-open">
              {item.kind === 'photos' ? (
                <button
                  className="trash-photo-preview"
                  aria-label={'View photo ' + item.title}
                  onClick={(event) => {
                    void openImageViewer([item.photo], 0, event.currentTarget);
                  }}
                >
                  <img src={item.photo.src} alt="" loading="lazy" />
                </button>
              ) : (
                <Icon name={item.kind === 'lab' ? 'FlaskConical' : 'FileText'} />
              )}
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.kind === 'photos' ? item.photo.album : collections[item.kind].singular} <UiText message={" · Deleted "}/>{new Date(item.deletedAt).toLocaleDateString()}
                </small>
                {item.kind === 'photos' && <small><UiText message={"Taken "}/>{item.photo.takenAt}</small>}
              </span>
            </div>
            <Button
              className="small trash-entry-restore"
              icon="RotateCcw"
              disabled={loading || !!error}
              onClick={() => {
                selection.clear();
                selection.select([item]);
                review('restore', [item]);
              }}
            >
              {item.kind === 'photos' ? t("Restore photo") : t("Restore entry")}
            </Button>
          </div>
        ))}
        {loading && !items.length ? (
          <p className="operation-message" role="status" data-ui={"Loading Trash…"}>
            {t("Loading Trash…")}</p>
        ) : (
          !visible.length &&
          !error && (
            <EmptyState icon="Trash2" title={items.length ? t("No matching items") : t("A clean slate")}>
              {kind === 'photos'
                ? t("Photos moved to Trash wait here until you restore or remove them.")
                : t("Entries and photos moved to Trash wait here until you restore or remove them.")}
            </EmptyState>
          )
        )}
        <Pagination page={current} total={visible.length} size={25} onPage={setPage} />
      </section>
      {reviewState && (
        <BatchDialog
          title={
            action === 'restore'
              ? t("Restore selected {value0}?", {value0: noun})
              : t("Delete selected {value0} permanently?", {value0: noun})
          }
          names={reviewState.names}
          destructive={action === 'purge'}
          confirmLabel={action === 'restore' ? `Restore ${noun}` : 'Delete permanently'}
          onClose={() => setReviewState(null)}
          onConfirm={async () => {
            const count = reviewState.items.length;
            await send('trash/batch', 'POST', {
              action,
              items: reviewState.items,
              libraryRevision: reviewState.libraryRevision,
            });
            selection.clear();
            await load().catch(() => {});
            await onRestored();
            setMessage(
              action === 'restore'
                ? count +
                    ' ' +
                    (count === 1 ? (photoCount ? 'photo' : 'entry') : noun) +
                    ' restored.'
                : count +
                    ' ' +
                    (count === 1 ? (photoCount ? 'photo' : 'entry') : noun) +
                    ' permanently removed from Trash.',
            );
          }}
        >
          {photoCount > 0 && (
            <p className="help">
              {action === 'restore'
                ? t("Photos return to their original albums with their captions, descriptions and dates.")
                : t("Photo records are removed from Trash. Image files stay in the media library.")}
            </p>
          )}
          {action === 'purge' && (
            <p className="help">
              {reviewState.items.length > photoCount
                ? t("Selected Markdown files and their retained revisions are removed. ")
                : ''}
              <UiText message={"Existing notebook backup archives remain available."}/></p>
          )}
        </BatchDialog>
      )}
    </div>
  );
}
