import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useState } from 'react';
import { Button, Icon, EmptyState } from '../shared/ui.js';
import type { BackupRecord } from '../engine/backup.js';
import type { BackupSettings } from '../shared/operations.js';
import { api, send, isCloudStudio } from './api.js';
import { Field, ToggleField, ErrorBox } from './components.js';
import {
  useSelection,
  SelectionCheck,
  SelectionToolbar,
  PageSelection,
  BatchDialog,
  Pagination,
  exportSelection,
} from './Selection.js';
type BackupSummary = { value: BackupSettings; revision: string; running: boolean; nextDue: string };
const size = (bytes: number) => (bytes / 1048576).toFixed(1) + ' MiB';
export function BackupAutomation({ onChanged }: { onChanged: () => Promise<void> }) {
  const [saved, setSaved] = useState<BackupSummary>(),
    [enabled, setEnabled] = useState(false),
    [keep, setKeep] = useState(14),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const load = async () => {
    const next = await api<BackupSummary>('backup-settings');
    setSaved(next);
    setEnabled(next.value.enabled);
    setKeep(next.value.keepAutomatic);
  };
  useEffect(() => {
    void load().catch((error) => setError(error.message));
  }, []);
  return (
    <section className="settings-card glass-panel backup-controls">
      <div className="settings-card-heading">
        <Icon name="Clock3" />
        <h2 data-ui={'Daily backups'}>{t('Daily backups')}</h2>
      </div>
      <p className="help">
        {isCloudStudio()
          ? t(
              'Cloudflare checks daily backups even when your browser is closed. Work runs through the private build queue.',
            )
          : t(
              'Runs once every 24 hours while Studio is open. Overdue backups run after Studio starts. Manual and safety backups are kept until you delete them.',
            )}
      </p>
      <ToggleField label={t('Automatic daily backups')} checked={enabled} onChange={setEnabled} />
      <Field label={t('Automatic backups to keep')}>
        <input
          type="number"
          min="1"
          max="100"
          value={Number.isFinite(keep) ? keep : ''}
          onChange={(event) => setKeep(event.target.valueAsNumber)}
        />
      </Field>
      <p className="help">
        {saved?.value.lastSuccess
          ? 'Last success: ' + new Date(saved.value.lastSuccess).toLocaleString()
          : t('No automatic backup yet.')}
        {enabled && saved?.nextDue && ' · Next due: ' + new Date(saved.nextDue).toLocaleString()}
      </p>
      <ErrorBox error={error || saved?.value.error || ''} />
      {message && (
        <p role="status" className="success-message">
          {message}
        </p>
      )}
      <div className="heading-actions">
        <Button
          variant="primary"
          icon="Save"
          disabled={!saved || busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void send<BackupSummary>('backup-settings', 'PUT', {
              enabled,
              keepAutomatic: keep,
              revision: saved!.revision,
            })
              .then((next) => {
                setSaved(next);
                setMessage('Backup preferences saved.');
              })
              .catch((error) => setError(error.message))
              .finally(() => setBusy(false));
          }}
        >
          <UiText message={'Save backup preferences'} />
        </Button>
        <Button
          icon="HardDrive"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void send<{ deferred?: boolean }>('backup-settings/run', 'POST', {})
              .then(async (result) => {
                if (result.deferred) throw new Error('Wait for the current job, then retry.');
                await load();
                await onChanged();
                setMessage('Automatic backup completed.');
              })
              .catch((error) => setError(error.message))
              .finally(() => setBusy(false));
          }}
        >
          <UiText message={'Run automatic backup now'} />
        </Button>
        <Button
          className="small"
          variant="ghost"
          disabled={busy}
          onClick={() => void load().catch((error) => setError(error.message))}
        >
          <UiText message={'Reload preferences'} />
        </Button>
      </div>
    </section>
  );
}
export function BackupCatalog({
  items,
  busy,
  onChanged,
  onReview,
}: {
  items: BackupRecord[];
  busy: boolean;
  onChanged: () => Promise<void>;
  onReview: (id: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [sort, setSort] = useState('newest'),
    [page, setPage] = useState(1),
    [action, setAction] = useState(''),
    [label, setLabel] = useState(''),
    [error, setError] = useState(''),
    [downloading, setDownloading] = useState(false);
  const selection = useSelection(items, query);
  useEffect(() => {
    setPage(1);
  }, [query]);
  const visible = items
    .filter((item) =>
      `${item.label || ''} ${item.name} ${item.reason} ${new Date(item.createdAt).toLocaleString()}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'size'
        ? b.bytes - a.bytes
        : sort === 'oldest'
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
    );
  const current = Math.min(page, Math.max(1, Math.ceil(visible.length / 25))),
    shown = visible.slice((current - 1) * 25, current * 25);
  const names = selection.items.map((record) => {
    const item = items.find((item) => item.id === record.id);
    return (
      (item?.label || item?.name || record.id) +
      (item ? ' · ' + new Date(item.createdAt).toLocaleString() : '')
    );
  });
  return (
    <>
      <p className="help">
        {items.length} <UiText message={' saved backups · '} />
        {size(items.reduce((sum, item) => sum + item.bytes, 0))}
      </p>
      <div className="managed-filters">
        <div className="search-field">
          <Icon name="Search" size={15} />
          <input
            type="search"
            aria-label={t('Search backups')}
            placeholder={t('Find a saved backup…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            data-ui-attrs={'{"aria-label":"Search backups","placeholder":"Find a saved backup…"}'}
          />
        </div>
        <select
          aria-label={t('Sort backups')}
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          data-ui-attrs={'{"aria-label":"Sort backups"}'}
        >
          <option value="newest" data-ui={'Newest first'}>
            {t('Newest first')}
          </option>
          <option value="oldest" data-ui={'Oldest first'}>
            {t('Oldest first')}
          </option>
          <option value="size" data-ui={'Largest first'}>
            {t('Largest first')}
          </option>
        </select>
      </div>
      <ErrorBox error={error} />
      <SelectionToolbar selection={selection} matching={visible}>
        <Button
          className="small"
          icon="Download"
          disabled={busy || downloading}
          onClick={() => {
            setDownloading(true);
            void exportSelection('backups', selection.items)
              .catch((error) => setError(error.message))
              .finally(() => setDownloading(false));
          }}
        >
          {downloading ? t('Preparing…') : t('Download selected')}
        </Button>
        <Button className="small" icon="Trash2" disabled={busy} onClick={() => setAction('delete')}>
          <UiText message={'Delete selected'} />
        </Button>
        {selection.count === 1 && (
          <Button
            className="small"
            icon="PenLine"
            onClick={() => {
              setLabel(items.find((item) => item.id === selection.items[0].id)?.label || '');
              setAction('label');
            }}
          >
            <UiText message={'Rename label'} />
          </Button>
        )}
      </SelectionToolbar>
      <PageSelection selection={selection} items={shown} />
      {!visible.length ? (
        <EmptyState
          icon="Archive"
          title={items.length ? t('No matching backups') : t('A clean starting point')}
        >
          <UiText message={'Create a backup or change your search.'} />
        </EmptyState>
      ) : (
        <div className="backup-list">
          {shown.map((item) => (
            <article key={item.id}>
              <SelectionCheck
                label={'Select backup ' + item.id}
                checked={selection.has(item.id)}
                disabled={busy}
                onChange={() => selection.toggle(item)}
              />
              <div>
                <strong>
                  {item.label ||
                    (item.reason === 'before-restore'
                      ? 'Before restore'
                      : item.reason === 'before-cleanup'
                        ? 'Before media cleanup'
                        : item.reason === 'automatic'
                          ? 'Automatic backup'
                          : item.name)}
                </strong>
                <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                <small>
                  {item.entries} <UiText message={' entries · '} />
                  {item.media} <UiText message={' media · '} />
                  {size(item.bytes)}
                  {item.available === false && ' · Archive missing'}
                </small>
                <small>
                  {item.archiveFormat === 'tar'
                    ? t('Large archive · v3')
                    : t('Compatibility archive · v1/v2')}
                  {item.unpackedBytes !== undefined &&
                    ' · ' + size(item.unpackedBytes) + ' ' + t('unpacked')}
                </small>
              </div>
              <div className="backup-actions">
                <a
                  className="button secondary small"
                  href={'/api/backups/' + item.id + '/download'}
                  download
                >
                  <Icon name="Download" size={14} />
                  <UiText message={'Download'} />
                </a>
                <Button
                  className="small"
                  icon="Eye"
                  disabled={busy || item.available === false}
                  onClick={() => onReview(item.id)}
                >
                  <UiText message={'Review'} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Pagination page={current} total={visible.length} size={25} onPage={setPage} />
      {action && (
        <BatchDialog
          title={
            action === 'delete'
              ? t('Delete selected backups permanently?')
              : t('Rename backup label')
          }
          names={names}
          destructive={action === 'delete'}
          confirmLabel={action === 'delete' ? 'Delete backups permanently' : 'Save label'}
          onClose={() => setAction('')}
          onConfirm={async () => {
            await send('backups/batch', 'POST', {
              action,
              items: selection.items,
              ...(action === 'label' ? { label } : {}),
            });
            selection.clear();
            await onChanged();
          }}
        >
          {action === 'delete' ? (
            <p className="help">
              {t('These saved archives will be removed from private notebook storage.')}
              {(selection.count === items.length ||
                (items.some((item) => item.available !== false) &&
                  items
                    .filter((item) => item.available !== false)
                    .every((item) => selection.has(item.id)))) &&
                ' This selection includes your last saved backup.'}
            </p>
          ) : (
            <Field label={t('Backup label')}>
              <input
                maxLength={100}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
          )}
        </BatchDialog>
      )}
    </>
  );
}
