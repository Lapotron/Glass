import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { BackupCatalog, BackupAutomation } from './BackupTools.js';
import { BackupImport } from './BackupImport.js';
import { useEffect, useState } from 'react';
import { Button, Icon } from '../shared/ui.js';
import type { BackupRecord, RestoreReview } from '../engine/backup.js';
import { api, send, isCloudStudio, workspacePreferenceKey } from './api.js';
import { formatBytes } from '../shared/media-details.js';
import { Modal, Field, PageHeading, ErrorBox } from './components.js';
export function Backups({ onRestored }: { onRestored: () => Promise<void> }) {
  const [items, setItems] = useState<BackupRecord[]>([]),
    [review, setReview] = useState<RestoreReview | null>(null),
    [working, setBusy] = useState(false),
    [importing, setImporting] = useState(false),
    [format, setFormat] = useState<'large' | 'legacy'>('large'),
    [restored, setRestored] = useState(''),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false),
    [message, setMessage] = useState('');
  const busy = working || importing;
  async function refresh() {
    setItems(await api<BackupRecord[]>('backups'));
  }
  useEffect(() => {
    const update = () => void refresh().catch((error) => setError(error.message));
    update();
    window.addEventListener('studio-filesystem', update);
    return () => window.removeEventListener('studio-filesystem', update);
  }, []);
  async function create() {
    setBusy(true);
    setError('');
    try {
      const record = await send<BackupRecord>('backups', 'POST', { format });
      await refresh();
      setMessage('A portable backup is ready. Download it below.');
      if (isCloudStudio()) return;
      const link = document.createElement('a');
      link.href = `/api/backups/${record.id}/download`;
      link.download = '';
      link.click();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function inspect(file?: File, id?: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = new FormData();
      if (file) data.set('file', file);
      setReview(
        id
          ? await send<RestoreReview>(`backups/${id}/review`, 'POST', {})
          : await api<RestoreReview>('backups/review', { method: 'POST', body: data }),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!review) return;
    setBusy(true);
    setError('');
    try {
      const result = await send<{ safetyBackup: string }>(`backups/${review.id}/restore`, 'POST', {
        sourceRevision: review.sourceRevision,
      });
      setConfirm(false);
      setReview(null);
      await onRestored();
      if (isCloudStudio()) localStorage.removeItem(workspacePreferenceKey('native-backup-import'));
      await refresh();
      setMessage(
        `Notebook restored. The previous notebook is saved as safety backup ${result.safetyBackup}.`,
      );
      setRestored(review.id);
    } catch (error) {
      setError((error as Error).message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="studio-page">
      <PageHeading
        eyebrow={t('Keep a way back')}
        title={t('Your notebook, kept safe.')}
        description={t('Portable backups of your writing, media, settings, revisions, and Trash.')}
      >
        {!isCloudStudio() && (
          <Field label={t('Archive format')}>
            <select
              value={format}
              disabled={busy}
              onChange={(event) => setFormat(event.target.value as 'large' | 'legacy')}
            >
              <option value="large" data-ui="Large notebook (.tar.gz)">
                {t('Large notebook (.tar.gz)')}
              </option>
              <option value="legacy" data-ui="Compatibility (.json.gz)">
                {t('Compatibility (.json.gz)')}
              </option>
            </select>
          </Field>
        )}
        <Button
          variant="primary"
          icon={busy ? 'LoaderCircle' : 'Download'}
          disabled={busy}
          onClick={() => void create()}
        >
          {isCloudStudio() ? t('Create backup') : <UiText message={'Create & download backup'} />}
        </Button>
      </PageHeading>
      <ErrorBox error={error} />
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}
      <BackupAutomation onChanged={refresh} />
      <div className="backup-layout">
        <section className="settings-card glass-panel">
          <div className="settings-card-heading">
            <Icon name="Upload" />
            <h2 data-ui={'Import a notebook'}>{t('Import a notebook')}</h2>
          </div>
          <p className="help">
            <UiText message="Review the archive before replacing your notebook. Connection credentials, deployments and generated caches are excluded." />
          </p>
          <BackupImport
            blocked={working}
            restored={restored}
            onReview={(value) => {
              setReview(value);
              if (value) {
                setMessage('');
                setError('');
              }
            }}
            onBusy={setImporting}
          />
          {review && (
            <div className="backup-review">
              <h3>{review.name}</h3>
              <p className="help">
                <UiText message={'Saved '} />
                {new Date(review.createdAt).toLocaleString()}
              </p>
              <dl>
                <div>
                  <dt data-ui={'Entries'}>{t('Entries')}</dt>
                  <dd>{review.entries}</dd>
                </div>
                <div>
                  <dt data-ui={'Media'}>{t('Media')}</dt>
                  <dd>{review.media}</dd>
                </div>
                <div>
                  <dt data-ui={'Revisions'}>{t('Revisions')}</dt>
                  <dd>{review.revisions}</dd>
                </div>
              </dl>
              <p className="help">
                {review.added} <UiText message={' files added · '} />
                {review.changed} <UiText message={' replaced · '} />
                {review.removed} <UiText message={' removed'} />
              </p>
              <div className="backup-review-details">
                <span className="badge">
                  <Icon name="ShieldCheck" size={13} />
                  <UiText message="Checksums verified" />
                </span>
                <span>
                  {review.archiveFormat === 'tar'
                    ? t('Streaming archive · version 3')
                    : t('Compatible JSON archive')}
                </span>
                {review.unpackedBytes !== undefined && (
                  <span>
                    {formatBytes(review.unpackedBytes)} {t('unpacked')}
                  </span>
                )}
              </div>
              {review.archiveSha256 && (
                <details className="backup-integrity">
                  <summary>{t('Archive fingerprint')}</summary>
                  <code>{review.archiveSha256}</code>
                </details>
              )}
              <Button
                variant="primary"
                icon="RotateCcw"
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                <UiText message={'Restore reviewed notebook'} />
              </Button>
            </div>
          )}
        </section>
        <section className="settings-card glass-panel">
          <div className="settings-card-heading">
            <Icon name="HardDrive" />
            <h2 data-ui={'Saved backups'}>{t('Saved backups')}</h2>
          </div>
          <BackupCatalog
            items={items}
            busy={busy}
            onChanged={refresh}
            onReview={(id) => void inspect(undefined, id)}
          />
        </section>
      </div>
      {confirm && review && (
        <Modal
          title={t('Restore this notebook?')}
          dismissible={!busy}
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
          footer={
            <>
              <Button disabled={busy} onClick={() => setConfirm(false)}>
                <UiText message={'Keep current notebook'} />
              </Button>
              <Button
                variant="primary"
                icon="RotateCcw"
                disabled={busy}
                onClick={() => void restore()}
              >
                {busy ? t('Restoring…') : t('Restore notebook')}
              </Button>
            </>
          }
        >
          <p className="modal-intro">
            <UiText message={'Restore “'} />
            {review.name}
            <UiText message={'” with '} />
            {review.entries} <UiText message={' entries and '} />
            {review.media}{' '}
            <UiText
              message={
                ' media files. A complete safety backup of the current notebook is created first.'
              }
            />
          </p>
          <p
            className="help"
            data-ui={
              'This updates the private notebook. Build and publish when you want the restored version on the web.'
            }
          >
            {t(
              'This updates the private notebook. Build and publish when you want the restored version on the web.',
            )}
          </p>
        </Modal>
      )}
    </div>
  );
}
