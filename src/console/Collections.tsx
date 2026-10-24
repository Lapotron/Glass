import { MediaNaming } from './MediaNaming.js';
import { MissingMedia } from './MissingMedia.js';
import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { attachmentFile, imageFile } from '../shared/attachments.js';
import { defaultCollections, type CollectionsConfig } from '../shared/collections.js';
import { MediaInformation } from './MediaInformation.js';
import { MediaUsageDetails, mediaUsageSummary, mediaUsageLocations } from './MediaUsage.js';
import type { MediaReference } from '../shared/operations.js';
import { useEffect, useRef, useState, useMemo, lazy, Suspense } from 'react';
const CloudMedia = lazy(() => import('./CloudMedia.js').then((m) => ({ default: m.CloudMedia })));
import { Button, Icon, EmptyState } from '../shared/ui.js';
import { formatDate, librarySchema, type Library } from '../shared/contracts.js';
import { api, send, isCloudStudio, type MediaFile } from './api.js';
import { ImagePreparation } from './ImagePreparation.js';
import { openImageViewer } from '../shared/image-viewer.js';
import { Field, Modal, PageHeading, MediaPicker, ErrorBox, CopyButton } from './components.js';
import {
  BatchDialog,
  useSelection,
  SelectionToolbar,
  PageSelection,
  SelectionCheck,
  Pagination,
  exportSelection,
} from './Selection.js';
import type { MediaAudit, CleanupReview } from '../engine/media-maintenance.js';
import { PhotoAlbums } from './PhotoAlbums.js';
import { resolveAlbums } from '../shared/albums.js';

export function PhotoJournal({
  collections = defaultCollections,
  library,
  revision,
  onSaved,
  onOpenTrash,
}: {
  library: Library;
  revision: string;
  onSaved: (library: Library, revision: string) => void;
  collections?: CollectionsConfig;
  onOpenTrash: () => void;
}) {
  const naming = collections.life;
  const [editing, setEditing] = useState<any | null>(null),
    [picker, setPicker] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [album, setAlbum] = useState(''),
    [notice, setNotice] = useState('');
  async function persist(next: Library, expectedRevision = revision) {
    setBusy(true);
    setError('');
    try {
      const validation = librarySchema.safeParse(next);
      if (!validation.success) {
        const labels: Record<string, string> = {
          alt: 'Image description',
          src: 'Image URL',
          caption: 'Caption',
          album: 'Album',
          takenAt: 'Date',
        };
        throw new Error(
          validation.error.issues
            .map((issue) => `${labels[String(issue.path.at(-1))] || 'Photo'}: ${issue.message}`)
            .join('\n'),
        );
      }
      const parsed = validation.data;
      const saved = await send<{ value: Library; revision: string }>('library', 'PUT', {
        value: parsed,
        revision: expectedRevision,
      });
      onSaved(saved.value, saved.revision);
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function saveItem() {
    const photo = {
      ...editing,
      alt: editing.alt.trim() || editing.caption.trim(),
      album: editing.album.trim(),
    };
    if (!photo.alt) {
      setError('Add an image description or caption before saving.');
      document.getElementById('journal-image-description')?.focus();
      return;
    }
    if (!photo.src.startsWith('/media/')) {
      setError('Choose a photo from the media library before saving.');
      return;
    }
    if (!photo.album) {
      setError('Enter an album name before saving.');
      return;
    }
    const items: any[] = library.photos;
    const exists = items.some((item) => item.id === photo.id);
    const list = exists
      ? items.map((item) => (item.id === photo.id ? photo : item))
      : [photo, ...items];
    await persist({ ...library, photos: list });
    setNotice('Your collection is saved. Build to update the public site.');
  }
  async function remove(id: string) {
    setBusy(true);
    setError('');
    try {
      const result = await send<{ value: Library; revision: string }>('photos/batch', 'POST', {
        action: 'remove',
        ids: [id],
        revision,
      });
      onSaved(result.value, result.revision);
      setNotice('Moved to Trash. Restore this moment from Photo Trash at any time.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function undo() {
    try {
      const result = await send<{ value: Library; revision: string }>('library/undo', 'POST', {
        revision,
      });
      onSaved(result.value, result.revision);
      setNotice('The previous collection has been restored.');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const albums = resolveAlbums(library).map((a) => a.name);
  const [query, setQuery] = useState(''),
    [sort, setSort] = useState('newest'),
    [page, setPage] = useState(1),
    [batch, setBatch] = useState(''),
    [batchAlbum, setBatchAlbum] = useState('');
  const photoRecords = library.photos.map((photo) => ({ ...photo, revision }));
  const selection = useSelection(photoRecords, album + '|' + query);
  useEffect(() => {
    setPage(1);
  }, [album, query]);
  const matching = photoRecords
    .filter(
      (photo) =>
        (!album || photo.album === album) &&
        `${photo.caption} ${photo.alt} ${photo.album}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'oldest' ? a.takenAt.localeCompare(b.takenAt) : b.takenAt.localeCompare(a.takenAt),
    );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(matching.length / 25))),
    shown = matching.slice((currentPage - 1) * 25, currentPage * 25);
  return (
    <div className="studio-page">
      <PageHeading
        eyebrow={naming.name}
        title={t('Moments worth keeping.')}
        description={t('A collection of places, light, and the things that make you pause.')}
      >
        <Button className="small" icon="Trash2" onClick={onOpenTrash} disabled={busy}>
          <UiText message={'Photo Trash'} />
        </Button>
        <Button
          className="small"
          icon="RotateCcw"
          onClick={() => {
            void undo();
          }}
        >
          <UiText message={'Undo last change'} />
        </Button>
        <Button
          variant="primary"
          icon="Plus"
          onClick={() => {
            setError('');
            setEditing({
              id: crypto.randomUUID(),
              src: '',
              alt: '',
              caption: '',
              album: album || library.albums?.[0]?.name || 'My journal',
              takenAt: new Date().toISOString().slice(0, 10),
              demo: false,
            });
          }}
        >
          {' '}
          <UiText message={'Add a '} />
          {naming.singular.toLocaleLowerCase()}
        </Button>
      </PageHeading>
      <ErrorBox error={editing ? '' : error} />
      {notice && (
        <div className="collection-notice">
          <Icon name="CheckCircle2" size={15} />
          {notice}
          <button
            className="icon-button"
            aria-label={t('Dismiss collection message')}
            onClick={() => setNotice('')}
            data-ui-attrs={'{"aria-label":"Dismiss collection message"}'}
          >
            <Icon name="X" size={13} />
          </button>
        </div>
      )}
      <PhotoAlbums
        collections={collections}
        library={library}
        revision={revision}
        onOpen={(name) => {
          setAlbum(name);
          requestAnimationFrame(() =>
            document
              .querySelector('.managed-filters')
              ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
          );
        }}
        onSave={async (next, expectedRevision) => {
          await persist(next, expectedRevision);
          if (album && !resolveAlbums(next).some((a) => a.name === album)) setAlbum('');
          setNotice(`Albums saved. Build to update ${naming.name} and album pages.`);
        }}
      />
      <>
        <div className="managed-filters">
          <div className="search-field">
            <Icon name="Search" size={15} />
            <input
              aria-label={t('Search photos')}
              type="search"
              value={query}
              placeholder={t('Find a moment…')}
              onChange={(event) => setQuery(event.target.value)}
              data-ui-attrs={'{"aria-label":"Search photos","placeholder":"Find a moment…"}'}
            />
          </div>
          <select
            aria-label={t('Sort photos')}
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            data-ui-attrs={'{"aria-label":"Sort photos"}'}
          >
            <option value="newest" data-ui={'Newest first'}>
              {t('Newest first')}
            </option>
            <option value="oldest" data-ui={'Oldest first'}>
              {t('Oldest first')}
            </option>
          </select>
        </div>
        <SelectionToolbar selection={selection} matching={matching}>
          <Button className="small" icon="Trash2" onClick={() => setBatch('remove')}>
            <UiText message={'Remove selected'} />
          </Button>
          <Button className="small" icon="FolderOpen" onClick={() => setBatch('album')}>
            <UiText message={'Move to album'} />
          </Button>
        </SelectionToolbar>
        <PageSelection selection={selection} items={shown} />
        <div className="collection-toolbar">
          <div className="archive-tabs">
            <button className={!album ? 'active' : ''} onClick={() => setAlbum('')}>
              <UiText message={'All moments '} />
              <span>{library.photos.length}</span>
            </button>
            {albums.map((a) => (
              <button key={a} className={album === a ? 'active' : ''} onClick={() => setAlbum(a)}>
                {a}
              </button>
            ))}
          </div>
          <span className="small-caption" data-ui={'Click a moment to edit its story'}>
            {t('Click a moment to edit its story')}
          </span>
        </div>
        <div className="studio-photo-grid">
          {shown.map((photo) => (
            <article
              key={photo.id}
              className={
                'studio-photo-card glass-panel managed-choice-card' +
                (selection.has(photo.id) ? ' is-selected' : '')
              }
            >
              <SelectionCheck
                label={'Select photo ' + (photo.caption || photo.alt)}
                checked={selection.has(photo.id)}
                disabled={busy}
                onChange={() => selection.toggle(photo)}
              />
              <button
                className="studio-photo-image"
                onClick={() => {
                  setEditing({ ...photo });
                  setError('');
                }}
                aria-label={t('Edit {value0}', { value0: photo.caption })}
              >
                <img src={photo.src} alt={photo.alt} />
                {photo.demo && (
                  <span className="photo-demo-tag" data-ui={'Sample illustration'}>
                    {t('Sample illustration')}
                  </span>
                )}
              </button>
              <div className="studio-photo-caption">
                <div>
                  <h3>{photo.caption || t('An untitled moment')}</h3>
                  <p>
                    {photo.album} · {formatDate(photo.takenAt, true)}
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label={t('Remove {value0}', { value0: photo.caption })}
                  disabled={busy}
                  onClick={() => {
                    void remove(photo.id);
                  }}
                >
                  <Icon name="Trash2" size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
        <Pagination page={currentPage} total={matching.length} size={25} onPage={setPage} />
        {!library.photos.length && (
          <EmptyState icon="Image" title={t('Keep your first moment')}>
            <UiText message={'Add a photo and give it a little context.'} />
          </EmptyState>
        )}
      </>
      {batch && (
        <BatchDialog
          title={
            batch === 'remove'
              ? t('Remove selected moments?')
              : t('Move selected moments to an album')
          }
          names={selection.items.map(
            (record) => photoRecords.find((photo) => photo.id === record.id)?.caption || record.id,
          )}
          destructive={batch === 'remove'}
          confirmLabel={batch === 'remove' ? 'Remove moments' : 'Move moments'}
          onClose={() => setBatch('')}
          onConfirm={async () => {
            const result = await send<{ value: Library; revision: string }>(
              'photos/batch',
              'POST',
              {
                action: batch,
                ids: selection.items.map((item) => item.id),
                revision: selection.items[0]?.revision,
                ...(batch === 'album' ? { album: batchAlbum } : {}),
              },
            );
            onSaved(result.value, result.revision);
            selection.clear();
            setNotice(
              batch === 'remove'
                ? 'Selected moments moved to Trash. Restore them from Photo Trash at any time.'
                : 'Selected moments updated. Undo last change restores the group.',
            );
          }}
        >
          {batch === 'album' && (
            <Field label={t('Destination album')}>
              <input
                list="existing-photo-albums"
                value={batchAlbum}
                onChange={(event) => setBatchAlbum(event.target.value)}
              />
              <datalist id="existing-photo-albums">
                {albums.map((album) => (
                  <option key={album} value={album} />
                ))}
              </datalist>
            </Field>
          )}
          {batch === 'remove' && (
            <p
              className="help"
              data-ui={'These moments move to Photo Trash. Their images stay in the media library.'}
            >
              {t('These moments move to Photo Trash. Their images stay in the media library.')}
            </p>
          )}
        </BatchDialog>
      )}
      {editing && (
        <Modal
          title={t('A moment in your journal')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>
                <UiText message={'Cancel'} />
              </Button>
              <Button
                variant="primary"
                icon={busy ? 'LoaderCircle' : 'Check'}
                disabled={busy}
                onClick={() => {
                  void saveItem().catch(() => undefined);
                }}
              >
                {busy ? t('Saving…') : t('Save to collection')}
              </Button>
            </>
          }
        >
          <>
            <button className="photo-form-preview" onClick={() => setPicker(true)}>
              {editing.src ? (
                <img src={editing.src} alt={editing.alt || t('Selected image')} />
              ) : (
                <span>
                  <Icon name="Image" size={25} />
                  <UiText message={'Choose a photo'} />
                </span>
              )}
            </button>
            <Field label={t('Image URL')}>
              <div className="input-with-button">
                <input
                  value={editing.src}
                  onChange={(e) => setEditing({ ...editing, src: e.target.value })}
                />
                <Button className="small" onClick={() => setPicker(true)}>
                  <UiText message={'Choose'} />
                </Button>
              </div>
            </Field>
            <Field label={t('Caption')}>
              <input
                value={editing.caption}
                onChange={(e) => setEditing({ ...editing, caption: e.target.value })}
              />
            </Field>
            <Field
              label={t('Image description')}
              help={t(
                'Describe the image for people using screen readers. If left blank, the caption is used.',
              )}
            >
              <input
                id="journal-image-description"
                value={editing.alt}
                aria-invalid={error.startsWith('Add an image description') || undefined}
                placeholder={t('Uses the caption if left blank')}
                onChange={(e) => setEditing({ ...editing, alt: e.target.value })}
                data-ui-attrs={'{"placeholder":"Uses the caption if left blank"}'}
              />
            </Field>
            <div className="field-row">
              <Field label={t('Album')}>
                <input
                  list="journal-albums"
                  value={editing.album}
                  onChange={(e) => setEditing({ ...editing, album: e.target.value })}
                />
                <datalist id="journal-albums">
                  {albums.map((a) => (
                    <option value={a} key={a} />
                  ))}
                </datalist>
              </Field>
              <Field label={t('Date')}>
                <input
                  type="date"
                  value={editing.takenAt}
                  onChange={(e) => setEditing({ ...editing, takenAt: e.target.value })}
                />
              </Field>
            </div>
          </>
          <label className="toggle-row">
            <span data-ui={'Sample content label'}>{t('Sample content label')}</span>
            <input
              type="checkbox"
              checked={editing.demo}
              onChange={(e) => setEditing({ ...editing, demo: e.target.checked })}
            />
          </label>
          <ErrorBox error={error} />
        </Modal>
      )}
      {picker && (
        <MediaPicker
          onClose={() => setPicker(false)}
          onSelect={(src) => setEditing({ ...editing, src })}
        />
      )}
    </div>
  );
}
export function MediaLibrary({
  onOpenReference,
  siteUrl,
}: {
  onOpenReference: (reference: MediaReference) => void;
  siteUrl: string;
}) {
  const [cloud, setCloud] = useState(false),
    [metadataTick, setMetadataTick] = useState(0);
  const [files, setFiles] = useState<MediaFile[]>([]),
    [selected, setSelected] = useState<MediaFile | null>(null),
    [busy] = useState(false),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [drag, setDrag] = useState(false),
    [uploads, setUploads] = useState<File[]>([]),
    [editingImage, setEditingImage] = useState<MediaFile | null>(null);
  const [audit, setAudit] = useState<MediaAudit>(),
    [usageFilter, setUsageFilter] = useState('all'),
    [sort, setSort] = useState('newest'),
    [page, setPage] = useState(1),
    [cleanup, setCleanup] = useState<CleanupReview>(),
    [working, setWorking] = useState(false),
    [notice, setNotice] = useState('');
  const [usageLoading, setUsageLoading] = useState(true),
    [usageError, setUsageError] = useState('');
  const usageRequest = useRef(0);
  const records = useMemo(
    () =>
      files.map((file) => ({
        ...file,
        id: file.url,
        revision: file.revision || '0'.repeat(64),
      })),
    [files],
  );
  const selection = useSelection(records, query + '|' + usageFilter);
  const loadUsage = async () => {
    const request = ++usageRequest.current;
    setUsageLoading(true);
    try {
      const result = await api<MediaAudit>('media/usage');
      if (request === usageRequest.current) {
        setAudit(result);
        setUsageError('');
      }
    } catch (failure) {
      if (request === usageRequest.current) setUsageError((failure as Error).message);
    } finally {
      if (request === usageRequest.current) setUsageLoading(false);
    }
  };
  useEffect(() => {
    const refresh = () => {
      if (isCloudStudio()) {
        usageRequest.current++;
        setAudit(undefined);
        setUsageLoading(false);
      } else void loadUsage().catch((error) => setError(error.message));
      void load();
    };
    refresh();
    window.addEventListener('studio-filesystem', refresh);
    return () => {
      usageRequest.current++;
      window.removeEventListener('studio-filesystem', refresh);
    };
  }, []);
  useEffect(() => {
    setPage(1);
  }, [query, usageFilter]);
  const usageIndex = useMemo(
    () => new Map(audit?.items.map((item) => [item.url, item]) || []),
    [audit],
  );
  const usage = (url: string) => usageIndex.get(url);
  const searchIndex = useMemo(
    () =>
      new Map(
        records.map((file) => [
          file.url,
          `${file.displayName || ''} ${file.name} ${(usageIndex.get(file.url)?.references || []).map((reference) => `${reference.title} ${reference.context} ${reference.source} ${reference.field || ''}`).join(' ')}`.toLowerCase(),
        ]),
      ),
    [records, usageIndex],
  );
  const normalizedQuery = query.toLowerCase();
  const matching = records
    .filter((file) => {
      const item = usage(file.url);
      return (
        searchIndex.get(file.url)!.includes(normalizedQuery) &&
        (usageFilter === 'all' ||
          (usageFilter === 'unused'
            ? item && !item.active.length && !item.history.length
            : usageFilter === 'active'
              ? item?.active.length
              : item && !item.active.length && item.history.length))
      );
    })
    .sort((a, b) =>
      sort === 'name'
        ? (a.displayName || a.name).localeCompare(b.displayName || b.name)
        : sort === 'size'
          ? b.bytes - a.bytes
          : b.modifiedAt.localeCompare(a.modifiedAt),
    );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(matching.length / 25))),
    shown = matching.slice((currentPage - 1) * 25, currentPage * 25);
  const input = useRef<HTMLInputElement>(null);
  const load = () =>
    api<MediaFile[]>('media')
      .then(setFiles)
      .catch((e) => setError(e.message));

  function upload(list: FileList | File[]) {
    setUploads(Array.from(list));
    if (input.current) input.current.value = '';
  }
  return (
    <div
      className={`studio-page media-page ${drag ? 'drag-active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!busy) void upload(e.dataTransfer.files);
      }}
    >
      <PageHeading
        eyebrow={t('A place for your images')}
        title={t('The collected bits.')}
        description={t('Originals and illustrations, ready to become part of a story.')}
      >
        <Button
          icon={busy ? 'LoaderCircle' : 'Upload'}
          variant="primary"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? t('Uploading…') : t('Upload media')}
        </Button>
        <input
          type="file"
          aria-label={t('Upload media files')}
          ref={input}
          className="sr-only"
          accept="image/png,image/jpeg,image/webp,image/avif,image/gif,application/pdf"
          multiple
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
          }}
          data-ui-attrs={'{"aria-label":"Upload media files"}'}
        />
      </PageHeading>
      <Button className="small" icon="CloudUpload" onClick={() => setCloud(true)}>
        {t('Cloud storage')}
      </Button>
      {cloud && (
        <Suspense fallback={<p>{t('Loading…')}</p>}>
          <CloudMedia onClose={() => setCloud(false)} />
        </Suspense>
      )}
      <ErrorBox error={error} />
      <ErrorBox error={usageError} />
      {notice && (
        <p className="operation-message" role="status">
          {notice}{' '}
          <a href="#backups" data-ui={'View backups'}>
            {t('View backups')}
          </a>
        </p>
      )}
      {!!audit?.issues.length && <ErrorBox error={audit.issues.join('\n')} />}
      {audit && <MissingMedia items={audit.items} />}
      <div className="media-toolbar">
        <div className="search-field">
          <Icon name="Search" size={15} />
          <input
            type="search"
            placeholder={t('Find an image…')}
            aria-label={t('Search media library')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-ui-attrs={'{"placeholder":"Find an image…","aria-label":"Search media library"}'}
          />
        </div>
        <span className="small-caption">
          {files.length} <UiText message={' files · Drag and drop to upload'} />
        </span>
        <select
          aria-label={t('Filter media usage')}
          value={usageFilter}
          onChange={(event) => setUsageFilter(event.target.value)}
          data-ui-attrs={'{"aria-label":"Filter media usage"}'}
        >
          <option value="all" data-ui={'All media'}>
            {t('All media')}
          </option>
          <option value="unused" data-ui={'Unused'}>
            {t('Unused')}
          </option>
          <option value="active" data-ui={'In use'}>
            {t('In use')}
          </option>
          <option value="history" data-ui={'In history'}>
            {t('In history')}
          </option>
        </select>
        <select
          aria-label={t('Sort media')}
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          data-ui-attrs={'{"aria-label":"Sort media"}'}
        >
          <option value="newest" data-ui={'Newest first'}>
            {t('Newest first')}
          </option>
          <option value="name" data-ui={'Name A–Z'}>
            {t('Name A–Z')}
          </option>
          <option value="size" data-ui={'Largest first'}>
            {t('Largest first')}
          </option>
        </select>
        <Button
          className="small"
          icon="RotateCcw"
          disabled={working}
          onClick={() => {
            setWorking(true);
            void loadUsage()
              .catch((error) => setError(error.message))
              .finally(() => setWorking(false));
          }}
        >
          <UiText message={'Check usage'} />
        </Button>
      </div>
      <SelectionToolbar selection={selection} matching={matching}>
        <Button
          className="small"
          icon="Download"
          disabled={working}
          onClick={() => {
            setWorking(true);
            void exportSelection('media', selection.items)
              .catch((error) => setError(error.message))
              .finally(() => setWorking(false));
          }}
        >
          <UiText message={'Download selected'} />
        </Button>
        <Button
          className="small"
          icon="Trash2"
          disabled={working || !audit || !!audit.issues.length || !!usageError || usageLoading}
          onClick={() => {
            setWorking(true);
            void send<CleanupReview>('media/cleanup/review', 'POST', {
              urls: selection.items.map((item) => item.id),
            })
              .then(setCleanup)
              .catch((error) => setError(error.message))
              .finally(() => setWorking(false));
          }}
        >
          <UiText message={'Review deletion'} />
        </Button>
      </SelectionToolbar>
      <PageSelection selection={selection} items={shown} />
      <div className="media-grid">
        {shown.map((file) => (
          <div
            key={file.url}
            className={'managed-choice-card' + (selection.has(file.id) ? ' is-selected' : '')}
          >
            <SelectionCheck
              label={'Select media ' + file.name}
              checked={selection.has(file.id)}
              disabled={working}
              onChange={() => selection.toggle(file)}
            />
            <button
              className="media-card glass-panel"
              key={file.url}
              onClick={() => setSelected(file)}
            >
              {attachmentFile(file.name) ? (
                <div className="media-pdf">
                  <Icon name="FileText" size={40} />
                </div>
              ) : (
                <img src={file.url} alt={file.name} />
              )}
              <span>{file.displayName || file.name}</span>
              <small>
                {(file.bytes / 1024).toFixed(1)} <UiText message={' KB'} />
              </small>
              <small>
                {usageError ? t('Usage check unavailable') : mediaUsageSummary(usage(file.url))}
              </small>
              {mediaUsageLocations(usage(file.url)) && (
                <span className="media-reference-summary">
                  {mediaUsageLocations(usage(file.url))}
                </span>
              )}
            </button>
          </div>
        ))}
      </div>
      <Pagination page={currentPage} total={matching.length} size={25} onPage={setPage} />
      {cleanup && (
        <BatchDialog
          title={t('Delete unused media?')}
          names={cleanup.items.map((item) => item.name)}
          destructive
          confirmLabel="Create safety backup & delete"
          onClose={() => setCleanup(undefined)}
          onConfirm={async () => {
            const result = await send<{ deleted: number; safetyBackup: string }>(
              'media/cleanup/' + cleanup.id + '/commit',
              'POST',
              { revision: cleanup.revision },
            );
            selection.clear();
            await load();
            await loadUsage();
            setNotice(
              result.deleted + ' unused files deleted. A complete safety backup was saved first.',
            );
          }}
        >
          <p
            className="help"
            data-ui={
              'Only files without current or retained references are eligible. A notebook safety backup is required. R2 objects and published deployment files stay available.'
            }
          >
            {t(
              'Only files without current or retained references are eligible. A notebook safety backup is required. R2 objects and published deployment files stay available.',
            )}
          </p>
        </BatchDialog>
      )}
      {!files.length && (
        <EmptyState icon="Image" title={t('A collection starts with one image')}>
          <UiText message={'Drop a file here, or choose one from your computer.'} />
        </EmptyState>
      )}
      {drag && (
        <div className="drop-overlay">
          <Icon name="Upload" size={40} />
          <h2 data-ui={'A new piece of the story.'}>{t('A new piece of the story.')}</h2>
          <p data-ui={'Drop your images or PDFs here.'}>{t('Drop your images or PDFs here.')}</p>
        </div>
      )}
      {!!uploads.length && (
        <ImagePreparation
          files={uploads}
          onClose={() => {
            setUploads([]);
            void load();
          }}
          onUploaded={() => {
            void load();
          }}
        />
      )}
      {editingImage && (
        <ImagePreparation
          source={editingImage}
          onClose={() => setEditingImage(null)}
          onUploaded={(file) => {
            setSelected(file);
            void load();
          }}
        />
      )}
      {selected && (
        <Modal
          title={t('A closer look')}
          wide
          onClose={() => setSelected(null)}
          footer={
            <>
              <CopyButton value={selected.url} label={t('Copy local URL')} />
              {selected.canEdit && (
                <Button icon="Crop" onClick={() => setEditingImage(selected)}>
                  <UiText message={'Edit original'} />
                </Button>
              )}
            </>
          }
        >
          {attachmentFile(selected.name) ? (
            <a className="button secondary" href={selected.url} target="_blank" rel="noreferrer">
              <UiText message={'Open file'} />
              <Icon name="ExternalLink" size={14} />
            </a>
          ) : (
            <button
              className="media-view-action"
              aria-label={t('Open image viewer')}
              onClick={(event) =>
                void openImageViewer(
                  files
                    .filter((f) => imageFile(f.name))
                    .map((f) => ({
                      src: f.url,
                      alt: f.displayName || f.name,
                      caption: f.displayName || f.name,
                      width: f.width,
                      height: f.height,
                      originalSrc: f.sourceId ? '/api/media/' + f.sourceId + '/source' : undefined,
                      loadDetails: (signal: AbortSignal) =>
                        api('media/details?url=' + encodeURIComponent(f.url), { signal }),
                    })),
                  files.filter((f) => imageFile(f.name)).findIndex((f) => f.url === selected.url),
                  event.currentTarget,
                )
              }
              data-ui-attrs={'{"aria-label":"Open image viewer"}'}
            >
              <img className="media-detail-image" src={selected.url} alt={selected.name} />
              <span>
                <Icon name="Expand" size={16} /> <UiText message={' View image'} />
              </span>
            </button>
          )}
          <h3 className="media-detail-name">{selected.displayName || selected.name}</h3>
          <MediaNaming
            url={selected.url}
            siteUrl={siteUrl}
            onSaved={(result) => {
              setSelected(
                (current) =>
                  current && {
                    ...current,
                    displayName: result.metadata.displayName || current.name,
                    downloadName: result.downloadName,
                    shortCode: result.metadata.shortCode,
                    publishForSharing: result.metadata.publishForSharing,
                  },
              );
              setMetadataTick((value) => value + 1);
              void load();
              if (!isCloudStudio()) void loadUsage();
            }}
          />
          <p className="help">{selected.name}</p>
          <MediaUsageDetails
            key={'usage:' + selected.url}
            item={usage(selected.url)}
            loading={usageLoading}
            error={usageError}
            incomplete={!!audit?.issues.length}
            onRetry={() => {
              void loadUsage();
            }}
            onOpen={(reference) => {
              setSelected(null);
              onOpenReference(reference);
            }}
          />
          {!attachmentFile(selected.name) && (
            <MediaInformation
              key={'information:' + selected.url + metadataTick}
              url={selected.url}
            />
          )}
          <p className="help">
            {selected.url} · {(selected.bytes / 1024).toFixed(1)} <UiText message={' KB'} />
          </p>
          <p className="help">
            {selected.canEdit
              ? t('The original is kept privately. Edits create a new image.')
              : t('This image has no retained original. Upload it again to enable editing.')}
          </p>
        </Modal>
      )}
    </div>
  );
}
