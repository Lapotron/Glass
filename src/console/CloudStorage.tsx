import { useEffect, useState, useRef } from 'react';
import { api, send, workspacePreferenceKey, completeNativeOperation } from './api.js';
import { Button, Icon } from '../shared/ui.js';
import { t } from '../shared/i18n.js';
import { formatBytes } from '../shared/media-details.js';
import { Field, ToggleField, ErrorBox, Modal } from './components.js';
type Item = {
  id: string;
  path: string;
  revision?: string;
  bytes?: number;
  modified?: string;
  deleted?: string;
  expires?: string;
  category?: string;
};
type Summary = {
  categories: Record<string, { files: number; bytes: number }>;
  physical: { bytes: number; budget: number };
  objects: { count: number };
  policy: {
    automatic: boolean;
    keepReleases: number;
    cacheBytes: number;
    cacheDays: number;
    recoveryDays: 7;
  };
  snapshots: { count: number };
};
export function CloudStorage() {
  const sequence = useRef(0);
  const categories: Record<string, string> = {
    content: t('Writing and settings'),
    media: t('Media'),
    originals: t('Private originals'),
    history: t('Authored history'),
    backups: t('Backup archives'),
    artifacts: t('Release artifacts'),
    cache: t('Render cache'),
    operations: t('Operations'),
  };
  const tabs = [
    { id: 'Storage', label: t('Storage') },
    { id: 'History', label: t('History') },
    { id: 'Recovery', label: t('Recovery') },
  ];
  const [tab, setTab] = useState('Storage'),
    [summary, setSummary] = useState<Summary>(),
    [items, setItems] = useState<Item[]>([]),
    [total, setTotal] = useState(0),
    [snapshots, setSnapshots] = useState<any[]>([]),
    [operations, setOperations] = useState<any[]>([]),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [cursor, setCursor] = useState(''),
    [next, setNext] = useState(''),
    [selection, setSelection] = useState<string[]>([]),
    [review, setReview] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function refresh() {
    const current = ++sequence.current;
    setLoading(true);
    setError('');
    const [storage, list, deleted, paused] = await Promise.all([
      api<Summary>('storage'),
      api<{ items: Item[]; cursor: string; total: number }>(
        'history?' +
          new URLSearchParams({ q: query, category, cursor, deleted: String(tab === 'Recovery') }),
      ),
      tab === 'Recovery' ? api<any[]>('backups/deleted') : Promise.resolve([]),
      tab === 'Recovery' ? api<any[]>('cloud/operations') : Promise.resolve([]),
    ]).catch((error) => {
      if (current === sequence.current) setLoading(false);
      throw error;
    });
    if (current !== sequence.current) return;
    setSummary(storage);
    setItems(list.items);
    setTotal(list.total);
    setNext(list.cursor);
    setSnapshots(deleted);
    setSelection([]);
    setOperations(paused);
    setLoading(false);
  }
  useEffect(() => {
    setSelection([]);
    setLoading(true);
    let active = true;
    const timer = setTimeout(() => {
      if (active) void refresh().catch((error) => setError(error.message));
    }, 200);
    return () => {
      active = false;
      sequence.current++;
      clearTimeout(timer);
    };
  }, [tab, query, category, cursor]);
  async function act(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    try {
      const result = await task();
      setMessage(typeof result === 'string' ? result : success);
      setReview('');
      await refresh();
      window.dispatchEvent(new Event('studio-filesystem'));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selected = items.filter((item) => selection.includes(item.id));
  const historyLabel = (path: string) =>
    path.startsWith('.studio/revisions/')
      ? t('Article revision')
      : path.startsWith('.studio/pages/about/')
        ? t('About revision')
        : path.startsWith('.studio/history/') || path.startsWith('.studio/project-history/')
          ? t('Collection history')
          : path.startsWith('.studio/backups/')
            ? t('Backup archive')
            : t('History record');
  return (
    <section className="glass-panel hosting-section cloud-storage" aria-busy={busy || loading}>
      <h2>
        <Icon name="HardDrive" size={19} />
        {t('Storage and history')}
      </h2>
      <div className="heading-actions" role="group" aria-label={t('Storage views')}>
        {tabs.map(({ id: name, label }) => (
          <Button
            key={name}
            className="small"
            variant={tab === name ? 'primary' : 'ghost'}
            aria-pressed={tab === name}
            disabled={busy || loading}
            onClick={() => {
              if (tab === name) return;
              sequence.current++;
              setTab(name);
              setLoading(true);
              setCursor('');
              setSelection([]);
            }}
          >
            {label}
          </Button>
        ))}
        <Button
          className="small"
          variant="ghost"
          icon="RotateCcw"
          disabled={busy || loading}
          onClick={() => void refresh().catch((error) => setError(error.message))}
        >
          {t('Reload')}
        </Button>
      </div>
      <ErrorBox error={error} />
      {!summary && !error && (
        <p className="help" role="status">
          {t('Loading…')}
        </p>
      )}
      {message && (
        <p className="help" role="status">
          {message}
        </p>
      )}
      {tab === 'Storage' && summary && (
        <>
          <p className="storage-capacity">
            {formatBytes(summary.physical.bytes)}{' '}
            <span>/ {formatBytes(summary.physical.budget)}</span>
          </p>
          <progress
            aria-label={t('Private storage usage')}
            value={summary.physical.bytes}
            max={summary.physical.budget}
          />
          <dl className="hosting-facts">
            <div>
              <dt>{t('Retained snapshots')}</dt>
              <dd>{summary.snapshots.count.toLocaleString()}</dd>
            </div>
            <div>
              <dt>{t('Physical objects')}</dt>
              <dd>{summary.objects.count.toLocaleString()}</dd>
            </div>
            {Object.entries(summary.categories).map(([name, value]) => (
              <div key={name}>
                <dt>{categories[name] || name}</dt>
                <dd>
                  {value.files.toLocaleString()} {t('files')} · {formatBytes(value.bytes)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="help">
            {t(
              'Logical sizes may share the same physical blobs. Backups and retained releases can keep bytes after a history record is deleted. Original media and authored history are never deleted automatically.',
            )}
          </p>
          <div className="storage-policy">
            <ToggleField
              label={t('Safe automatic cleanup')}
              checked={summary.policy.automatic}
              onChange={(automatic) =>
                setSummary({ ...summary, policy: { ...summary.policy, automatic } })
              }
            />
            <Field label={t('Successful release artifacts to retain')}>
              <input
                type="number"
                min="1"
                max="20"
                value={summary.policy.keepReleases}
                onChange={(event) =>
                  setSummary({
                    ...summary,
                    policy: { ...summary.policy, keepReleases: event.target.valueAsNumber },
                  })
                }
              />
            </Field>
            <Field label={t('Shared render cache (MiB)')}>
              <input
                type="number"
                min="0"
                max="512"
                value={summary.policy.cacheBytes / 1024 ** 2}
                onChange={(event) =>
                  setSummary({
                    ...summary,
                    policy: {
                      ...summary.policy,
                      cacheBytes: event.target.valueAsNumber * 1024 ** 2,
                    },
                  })
                }
              />
            </Field>
            <Field label={t('Cache lifetime (days)')}>
              <input
                type="number"
                min="1"
                max="30"
                value={summary.policy.cacheDays}
                onChange={(event) =>
                  setSummary({
                    ...summary,
                    policy: { ...summary.policy, cacheDays: event.target.valueAsNumber },
                  })
                }
              />
            </Field>
          </div>
          <div className="heading-actions">
            <Button
              icon="Save"
              disabled={busy || loading}
              onClick={() =>
                void act(
                  () => send('storage/policy', 'PUT', summary.policy),
                  t('Storage preferences saved.'),
                )
              }
            >
              {t('Save preferences')}
            </Button>
            <Button
              icon="Trash2"
              disabled={busy || loading}
              onClick={() =>
                void act(async () => {
                  const result = await send('storage/cleanup', 'POST', {});
                  return (
                    t('Unused storage reclaimed: {value0}', { value0: formatBytes(result.bytes) }) +
                    (result.more ? ' · ' + t('More remains; run cleanup again.') : '')
                  );
                }, '')
              }
            >
              {t('Run safe cleanup')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || loading}
              onClick={() =>
                void act(
                  () => send('storage/cache/purge', 'POST', {}),
                  t('Shared cache detached. Source files and history were kept.'),
                )
              }
            >
              {t('Clear shared cache')}
            </Button>
          </div>
          <p className="help">
            {t(
              'Current, approved and active releases are always pinned. Cleanup uses a one-day grace period and bounded batches. Deleted history remains recoverable for seven days.',
            )}
          </p>
        </>
      )}
      {tab === 'History' && (
        <>
          <div className="managed-filters">
            <div className="search-field">
              <Icon name="Search" size={15} />
              <input
                type="search"
                aria-label={t('Search history')}
                placeholder={t('Find history by path…')}
                value={query}
                onChange={(event) => {
                  if (query === event.target.value) return;
                  sequence.current++;
                  setQuery(event.target.value);
                  setLoading(true);
                  setCursor('');
                }}
              />
            </div>
            <select
              aria-label={t('History category')}
              value={category}
              onChange={(event) => {
                if (category === event.target.value) return;
                sequence.current++;
                setCategory(event.target.value);
                setLoading(true);
                setCursor('');
              }}
            >
              <option value="">{t('All history')}</option>
              {['history', 'backups', 'operations'].map((name) => (
                <option key={name} value={name}>
                  {categories[name]}
                </option>
              ))}
            </select>
          </div>
          <div className="heading-actions">
            <Button
              className="small"
              disabled={!items.length || busy || loading}
              onClick={() =>
                setSelection(selection.length === items.length ? [] : items.map((item) => item.id))
              }
            >
              {t('Select this page')}
            </Button>
            <Button
              className="small"
              icon="Trash2"
              disabled={!selection.length || busy || loading}
              onClick={() => setReview('delete')}
            >
              {t('Delete selected')} ({selection.length})
            </Button>
            <Button
              className="small"
              icon="Download"
              disabled={!selection.length || busy || loading}
              onClick={() =>
                void act(async () => {
                  const lease = await send('history/export', 'POST', {
                    items: selected.map((item) => ({ path: item.path, revision: item.revision })),
                  });
                  const { downloadCloudBackup } = await import('./cloud-backup.js');
                  await downloadCloudBackup(lease.id, 'export');
                }, '')
              }
            >
              {t('Export selected')}
            </Button>
          </div>
        </>
      )}
      {tab !== 'Storage' && (
        <ul className="storage-history-list">
          {items.map((item) => (
            <li key={item.id}>
              {tab === 'History' && (
                <input
                  type="checkbox"
                  aria-label={t('Select {value0}', { value0: item.path })}
                  checked={selection.includes(item.id)}
                  disabled={busy || loading}
                  onChange={(event) =>
                    setSelection(
                      event.target.checked
                        ? [...selection, item.id]
                        : selection.filter((id) => id !== item.id),
                    )
                  }
                />
              )}
              <div>
                <strong>{historyLabel(item.path)}</strong>
                <code className="storage-history-path" title={item.path}>
                  {item.path}
                </code>
                <small>
                  {item.modified
                    ? new Date(item.modified).toLocaleString()
                    : t('Recover until') + ' ' + new Date(item.expires!).toLocaleString()}
                  {item.bytes !== undefined ? ' · ' + formatBytes(item.bytes) : ''}
                </small>
              </div>
              <div className="heading-actions">
                {tab === 'Recovery' ? (
                  <>
                    <Button
                      className="small"
                      disabled={busy || loading}
                      onClick={() =>
                        void act(
                          () => send('history/' + item.id + '/restore', 'POST', {}),
                          t('History restored.'),
                        )
                      }
                    >
                      {t('Restore')}
                    </Button>
                    <Button
                      className="small"
                      variant="ghost"
                      disabled={busy || loading}
                      onClick={() => setReview(item.id)}
                    >
                      {t('Purge now')}
                    </Button>
                  </>
                ) : (
                  <a
                    className="button ghost small"
                    href={
                      '/api/history/file?' +
                      new URLSearchParams({ path: item.path, revision: item.revision! })
                    }
                    download
                  >
                    <Icon name="Download" size={14} />
                    {t('Export')}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {tab !== 'Storage' && summary && !items.length && (
        <p className="help" role="status">
          {tab === 'Recovery'
            ? t('No deleted history is awaiting recovery.')
            : t('No history matches these filters.')}
        </p>
      )}
      {tab !== 'Storage' && (
        <div className="heading-actions">
          <Button
            className="small"
            disabled={!cursor || busy || loading}
            onClick={() => setCursor('')}
          >
            {t('First page')}
          </Button>
          <Button
            className="small"
            disabled={!cursor || busy || loading}
            onClick={() => setCursor(Number(cursor) > 50 ? String(Number(cursor) - 50) : '')}
          >
            {t('Previous page')}
          </Button>
          <span className="help">
            {t('{value0} history records', { value0: total.toLocaleString() })}
          </span>
          <Button
            className="small"
            disabled={!next || busy || loading}
            onClick={() => setCursor(next)}
          >
            {t('Next page')}
          </Button>
        </div>
      )}
      {tab === 'Recovery' && (
        <>
          <h3>{t('Paused batch operations')}</h3>
          <ul className="storage-history-list">
            {operations.map((record) => (
              <li key={record.id}>
                <div>
                  <strong>{record.id}</strong>
                  <small>
                    {t('Recover until')} {new Date(record.expires).toLocaleString()}
                  </small>
                </div>
                <Button
                  className="small"
                  disabled={busy || loading}
                  onClick={() =>
                    void act(
                      () => completeNativeOperation(record.id),
                      t('Batch operation completed. Reload the affected page.'),
                    )
                  }
                >
                  {t('Resume')}
                </Button>
              </li>
            ))}
          </ul>
          <h3>{t('Deleted backups')}</h3>
          <ul className="storage-history-list">
            {snapshots.map((record) => (
              <li key={record.id}>
                <div>
                  <strong>{record.label || record.id}</strong>
                  <small>
                    {t('Recover until')} {new Date(record.expires).toLocaleString()}
                  </small>
                </div>
                <Button
                  className="small"
                  disabled={busy || loading}
                  onClick={() =>
                    void act(
                      () => send('backups/' + record.id + '/recover', 'POST', {}),
                      t('Backup restored.'),
                    )
                  }
                >
                  {t('Restore')}
                </Button>
                <Button
                  className="small"
                  variant="ghost"
                  disabled={busy || loading}
                  onClick={() => setReview('snapshot:' + record.id)}
                >
                  {t('Purge now')}
                </Button>
              </li>
            ))}
          </ul>
          <Button
            className="small"
            variant="ghost"
            disabled={busy || loading}
            onClick={() => {
              localStorage.removeItem(workspacePreferenceKey('native-backup-import'));
              setMessage(
                t('Paused archive selection forgotten. Staged data expires after seven idle days.'),
              );
            }}
          >
            {t('Forget paused archive import')}
          </Button>
        </>
      )}
      {review && (
        <Modal
          title={
            review === 'delete' ? t('Delete selected history') : t('Permanently purge history')
          }
          onClose={() => !busy && setReview('')}
          footer={
            <>
              <Button disabled={busy || loading} onClick={() => setReview('')}>
                {t('Cancel')}
              </Button>
              <Button
                disabled={busy || loading}
                variant="primary"
                onClick={() =>
                  void act(
                    () =>
                      review === 'delete'
                        ? send('history/delete', 'POST', {
                            items: selected.map((item) => ({
                              path: item.path,
                              revision: item.revision,
                            })),
                          })
                        : send(
                            review.startsWith('snapshot:')
                              ? 'backups/' + review.slice(9) + '/purge'
                              : 'history/' + review,
                            'DELETE',
                            { confirm: 'PURGE' },
                          ),
                    review === 'delete'
                      ? t('History moved to seven-day recovery.')
                      : t(
                          'Recovery reference removed. Shared blobs remain protected by other references.',
                        ),
                  )
                }
              >
                {review === 'delete' ? t('Delete selected') : t('Purge now')}
              </Button>
            </>
          }
        >
          <p>
            {review === 'delete'
              ? t(
                  'These history records can be recovered for seven days. Current writing, media, originals and live deployments are kept.',
                )
              : t(
                  'This removes the recovery reference permanently. Data held by another backup or retained release stays protected; unused bytes are reclaimed by safe cleanup.',
                )}
          </p>
          {review === 'delete' && (
            <ul>
              {selected.map((item) => (
                <li key={item.id}>{item.path}</li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </section>
  );
}
