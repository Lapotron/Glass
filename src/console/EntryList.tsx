import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useState } from 'react';
import { Button, Icon, EmptyState } from '../shared/ui.js';
import { formatDate, type PublicEntry } from '../shared/contracts.js';
import type { ContentBatch, TrashItem } from '../shared/operations.js';
import { shortLinkPath } from '../shared/shortlinks.js';
import { api, send } from './api.js';
import { Field, Modal, PageHeading, ErrorBox, CopyButton } from './components.js';
import {
  BatchDialog,
  PageSelection,
  Pagination,
  SelectionCheck,
  SelectionToolbar,
  useSelection,
  exportSelection,
  downloadUrl,
} from './Selection.js';
import type { MarkdownImportReview } from '../engine/operations.js';
import { defaultCollections, routeFor, type CollectionsConfig } from '../shared/collections.js';
import { ConversionDialog } from './ConversionDialog.js';

function ImportMarkdown({
  kind,
  collections,
  onClose,
  onImported,
}: {
  kind: 'posts' | 'lab';
  collections: CollectionsConfig;
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [review, setReview] = useState<MarkdownImportReview>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function inspect(chosen: File[]) {
    setFiles(chosen);
    setReview(undefined);
    setBusy(true);
    setError('');
    try {
      const data = new FormData();
      data.set('kind', kind);
      chosen.forEach((file) => data.append('files', file));
      setReview(
        await api<MarkdownImportReview>('content/import/review', { method: 'POST', body: data }),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('Import Markdown')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            <UiText message={'Cancel'} />
          </Button>
          <Button
            variant="primary"
            icon="Import"
            disabled={busy || !review}
            onClick={() => {
              setBusy(true);
              setError('');
              void send('content/import/' + review!.id + '/commit', 'POST', {
                sourceRevision: review!.sourceRevision,
              })
                .then(onImported)
                .then(onClose)
                .catch((error) => setError(error.message))
                .finally(() => setBusy(false));
            }}
          >
            <UiText message={'Import '} />
            {review?.entries.length || ''} <UiText message={' drafts'} />
          </Button>
        </>
      }
    >
      <p className="modal-intro">
        <UiText message={'Bring Markdown into '} />
        {collections[kind].name}{' '}
        <UiText message={' as new drafts. Existing files stay in place.'} />
      </p>
      <Field label={t('Markdown files')} help={t('Up to 100 files, 1 MB each, totaling 20 MiB.')}>
        <input
          type="file"
          accept=".md,text/markdown"
          multiple
          disabled={busy}
          onChange={(event) => {
            if (event.target.files?.length) void inspect(Array.from(event.target.files));
          }}
        />
      </Field>
      {busy && (
        <p role="status" data-ui={'Preparing the import…'}>
          {t('Preparing the import…')}
        </p>
      )}
      <ErrorBox error={error} />
      {!!files.length && error && (
        <Button icon="RotateCcw" onClick={() => void inspect(files)} disabled={busy}>
          <UiText message={'Review again'} />
        </Button>
      )}
      {review && (
        <ul className="import-review">
          {review.entries.map((entry, index) => (
            <li key={index}>
              <strong>{entry.title}</strong>
              <code>{routeFor({ kind, slug: entry.slug }, collections)}</code>
              {entry.warnings.map((warning) => (
                <small key={warning}>{warning}</small>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
export function EntryList({
  entries,
  kind,
  siteUrl,
  collections,
  onOpen,
  onCreate,
  onChanged,
}: {
  entries: PublicEntry[];
  kind: 'posts' | 'lab';
  siteUrl: string;
  collections: CollectionsConfig;
  onOpen: (entry: PublicEntry) => void;
  onCreate: () => void;
  onChanged: () => Promise<void>;
}) {
  const [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [tag, setTag] = useState(''),
    [sort, setSort] = useState('newest'),
    [page, setPage] = useState(1);
  const [action, setAction] = useState(''),
    [status, setStatus] = useState('draft'),
    [publishAt, setPublishAt] = useState(''),
    [tags, setTags] = useState(''),
    [tagMode, setTagMode] = useState('add'),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [undo, setUndo] = useState<TrashItem[]>([]),
    [importing, setImporting] = useState(false),
    [exporting, setExporting] = useState(false);
  const source = entries.filter((entry) => entry.kind === kind),
    resetKey = JSON.stringify([kind, query, filter, tag]);
  const selection = useSelection(source, resetKey);
  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  const visible = source
    .filter(
      (entry) =>
        (filter === 'all' || entry.status === filter) &&
        (!tag || entry.tags.includes(tag)) &&
        `${entry.title} ${entry.summary} ${entry.tags.join(' ')} ${entry.body}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'oldest'
          ? a.publishedAt.localeCompare(b.publishedAt)
          : b.publishedAt.localeCompare(a.publishedAt),
    );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(visible.length / 25))),
    shown = visible.slice((currentPage - 1) * 25, currentPage * 25);
  const names = selection.items.map(
    (item) => source.find((entry) => entry.id === item.id)?.title || item.id,
  );
  async function apply() {
    const input: ContentBatch = {
      action: action.split(':')[0] as ContentBatch['action'],
      items: selection.items,
    };
    if (action === 'status') {
      input.status = status as ContentBatch['status'];
      input.publishAt =
        status === 'scheduled' && publishAt ? new Date(publishAt).toISOString() : '';
    }
    if (action === 'tags') {
      input.tags = tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      input.tagMode = tagMode as 'add' | 'remove';
    }
    if (action.includes(':')) input.enabled = action.endsWith(':on');
    const result = await send<{ entries: PublicEntry[]; trashed: TrashItem[] }>(
      'content/batch',
      'POST',
      input,
    );
    setUndo(result.trashed);
    setMessage(
      `${selection.count} ${action === 'trash' ? 'entries moved to Trash' : action === 'duplicate' ? 'new drafts created' : 'entries updated'}.`,
    );
    selection.clear();
    await onChanged();
  }
  const headings: Record<string, string> = {
    trash: 'Move selected entries to Trash?',
    duplicate: 'Duplicate selected entries?',
    status: 'Change publication status',
    tags: 'Edit selected tags',
    comments: 'Change article discussion',
  };
  return (
    <div className="studio-page">
      <PageHeading
        eyebrow={t('Your {value0}', { value0: collections[kind].name })}
        title={
          collections[kind].name === defaultCollections[kind].name
            ? kind === 'posts'
              ? t('Thoughts taking shape.')
              : t('Curiosity, made tangible.')
            : collections[kind].name
        }
        description={t('Manage your Markdown, organize drafts, and prepare the next publication.')}
      >
        <Button icon="Import" onClick={() => setImporting(true)}>
          <UiText message={'Import Markdown'} />
        </Button>
        <Button variant="primary" icon="Plus" onClick={onCreate}>
          <UiText message={'New '} />
          {collections[kind].singular.toLocaleLowerCase()}
        </Button>
      </PageHeading>
      <div className="managed-filters">
        <div className="search-field">
          <Icon name="Search" size={16} />
          <input
            type="search"
            aria-label={t('Search entries')}
            placeholder={t('Search titles, tags and Markdown…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            data-ui-attrs={
              '{"aria-label":"Search entries","placeholder":"Search titles, tags and Markdown…"}'
            }
          />
        </div>
        <select
          aria-label={t('Filter entry status')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          data-ui-attrs={'{"aria-label":"Filter entry status"}'}
        >
          <option value="all">
            <UiText message={'All entries ('} />
            {source.length})
          </option>
          {['published', 'draft', 'scheduled'].map((status) => (
            <option key={status} value={status}>
              {status[0].toUpperCase() + status.slice(1)} (
              {source.filter((entry) => entry.status === status).length})
            </option>
          ))}
        </select>
        <select
          aria-label={t('Filter entry tag')}
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          data-ui-attrs={'{"aria-label":"Filter entry tag"}'}
        >
          <option value="" data-ui={'All tags'}>
            {t('All tags')}
          </option>
          {[...new Set(source.flatMap((entry) => entry.tags))].sort().map((tag) => (
            <option key={tag}>{tag}</option>
          ))}
        </select>
        <select
          aria-label={t('Sort entries')}
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          data-ui-attrs={'{"aria-label":"Sort entries"}'}
        >
          <option value="newest" data-ui={'Newest first'}>
            {t('Newest first')}
          </option>
          <option value="oldest" data-ui={'Oldest first'}>
            {t('Oldest first')}
          </option>
          <option value="title" data-ui={'Title A–Z'}>
            {t('Title A–Z')}
          </option>
        </select>
      </div>
      <ErrorBox error={error} />
      {message && (
        <div className="operation-message" role="status">
          {message}
          {!!undo.length && (
            <Button
              className="small"
              icon="Undo2"
              onClick={() => {
                void send('trash/batch', 'POST', {
                  action: 'restore',
                  items: undo.map(({ id, revision }) => ({ id, revision })),
                })
                  .then(onChanged)
                  .then(() => {
                    setUndo([]);
                    setMessage('Entries restored.');
                  })
                  .catch((error) => setError(error.message));
              }}
            >
              <UiText message={'Undo'} />
            </Button>
          )}
        </div>
      )}
      <SelectionToolbar selection={selection} matching={visible}>
        <Button className="small" icon="Trash2" onClick={() => setAction('trash')}>
          <UiText message={'Move to Trash'} />
        </Button>
        <Button className="small" icon="Copy" onClick={() => setAction('duplicate')}>
          <UiText message={'Duplicate'} />
        </Button>
        <Button className="small" icon="SlidersHorizontal" onClick={() => setAction('status')}>
          <UiText message={'Status'} />
        </Button>
        <Button className="small" icon="Tags" onClick={() => setAction('tags')}>
          <UiText message={'Tags'} />
        </Button>
        <Button
          className="small"
          icon="Download"
          disabled={exporting}
          onClick={() => {
            setExporting(true);
            void (
              selection.count === 1
                ? Promise.resolve(
                    downloadUrl('/api/content/' + selection.items[0].id + '/download'),
                  )
                : exportSelection('content', selection.items)
            )
              .catch((error) => setError(error.message))
              .finally(() => setExporting(false));
          }}
        >
          {exporting ? t('Preparing…') : t('Export Markdown')}
        </Button>
        <select
          aria-label={t('More batch actions')}
          value=""
          onChange={(event) => setAction(event.target.value)}
          data-ui-attrs={'{"aria-label":"More batch actions"}'}
        >
          <option value="" data-ui={'More actions…'}>
            {t('More actions…')}
          </option>
          <option value="comments:on" data-ui={'Allow discussions'}>
            {t('Allow discussions')}
          </option>
          <option value="comments:off" data-ui={'Disable discussions'}>
            {t('Disable discussions')}
          </option>
          <option value="convert">{t('Move between collections')}</option>
        </select>
      </SelectionToolbar>
      <section
        className="managed-list glass-panel"
        aria-label={t('{value0} entries', { value0: collections[kind].name })}
      >
        <div className="managed-list-head">
          <PageSelection selection={selection} items={shown} />
          <span data-ui={'Status · Publication date'}>{t('Status · Publication date')}</span>
        </div>
        {shown.map((entry) => (
          <div
            key={entry.id}
            className={`managed-entry-row content-entry-row${selection.has(entry.id) ? ' is-selected' : ''}`}
          >
            <SelectionCheck
              label={'Select ' + entry.title}
              checked={selection.has(entry.id)}
              disabled={!selection.has(entry.id) && selection.count >= 500}
              onChange={() => selection.toggle(entry)}
            />
            <button className="managed-entry-open" onClick={() => onOpen(entry)}>
              <span className="content-type-icon">
                <Icon name={kind === 'posts' ? 'FileText' : 'FlaskConical'} size={19} />
              </span>
              <span>
                <strong lang={entry.lang}>{entry.title}</strong>
                <small>{entry.tags.join(' · ') || t('No tags')}</small>
              </span>
            </button>
            <span className={'badge ' + entry.status}>{entry.status}</span>
            <time dateTime={entry.publishedAt}>{formatDate(entry.publishedAt, true)}</time>
            <CopyButton
              label={t('Copy link')}
              iconOnly
              ariaLabel={'Copy short link for ' + entry.title}
              value={new URL(shortLinkPath(entry), siteUrl).href}
            />
          </div>
        ))}
        {!visible.length && (
          <EmptyState icon="BookOpen" title={t('No matching entries')}>
            <UiText message={'Change the filters or create a new entry.'} />
          </EmptyState>
        )}
        <Pagination page={currentPage} total={visible.length} size={25} onPage={setPage} />
      </section>
      <p className="quiet-tip">
        <Icon name="CircleHelp" size={15} />
        <UiText
          message={
            'Published entries appear on the next build. Draft short links activate after publication.'
          }
        />
      </p>
      {action === 'convert' && (
        <ConversionDialog
          entries={selection.items
            .map((item) => ({
              ...source.find((entry) => entry.id === item.id)!,
              revision: item.revision,
            }))
            .filter((entry) => entry.id)}
          collections={collections}
          onClose={() => setAction('')}
          onConverted={async () => {
            selection.clear();
            setAction('');
            await onChanged();
          }}
        />
      )}
      {action && action !== 'convert' && (
        <BatchDialog
          title={headings[action.split(':')[0]] || t('Update selected entries')}
          names={names}
          destructive={action === 'trash'}
          confirmLabel={
            action === 'trash'
              ? 'Move to Trash'
              : action === 'duplicate'
                ? 'Create draft copies'
                : 'Apply changes'
          }
          onClose={() => setAction('')}
          onConfirm={apply}
        >
          {action === 'status' && (
            <>
              <Field label={t('Publication status')}>
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="draft" data-ui={'Draft'}>
                    {t('Draft')}
                  </option>
                  <option value="published" data-ui={'Published'}>
                    {t('Published')}
                  </option>
                  <option value="scheduled" data-ui={'Scheduled'}>
                    {t('Scheduled')}
                  </option>
                </select>
              </Field>
              {status === 'scheduled' && (
                <Field
                  label={t('Publication time')}
                  help={t('Uses your local time and saves UTC.')}
                >
                  <input
                    type="datetime-local"
                    value={publishAt}
                    onChange={(event) => setPublishAt(event.target.value)}
                  />
                </Field>
              )}
              <p
                className="help"
                data-ui={'This changes saved entries. Build & Publish updates the live site.'}
              >
                {t('This changes saved entries. Build & Publish updates the live site.')}
              </p>
            </>
          )}
          {action === 'tags' && (
            <>
              <Field label={t('Tag operation')}>
                <select value={tagMode} onChange={(event) => setTagMode(event.target.value)}>
                  <option value="add" data-ui={'Add tags'}>
                    {t('Add tags')}
                  </option>
                  <option value="remove" data-ui={'Remove tags'}>
                    {t('Remove tags')}
                  </option>
                </select>
              </Field>
              <Field label={t('Tags')} help={t('Separate tags with commas.')}>
                <input value={tags} onChange={(event) => setTags(event.target.value)} />
              </Field>
            </>
          )}
        </BatchDialog>
      )}
      {importing && (
        <ImportMarkdown
          kind={kind}
          collections={collections}
          onClose={() => setImporting(false)}
          onImported={onChanged}
        />
      )}
    </div>
  );
}
