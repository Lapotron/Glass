import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useState, type MouseEvent } from 'react';
import { Button, Icon } from '../shared/ui.js';
import type { CollectionsConfig } from '../shared/collections.js';
import type {
  NotebookResetReview,
  NotebookResetResult,
  ResetRecovery,
} from '../shared/notebook-reset.js';
import { api, send, isCloudStudio } from './api.js';
import { ErrorBox, Field, Modal } from './components.js';
import { formatBytes } from '../shared/media-details.js';

export function NotebookResetControls({
  beforeReview,
  onCompleted,
  collections,
}: {
  beforeReview: () => Promise<void>;
  onCompleted: () => Promise<void>;
  collections: CollectionsConfig;
}) {
  const [review, setReview] = useState<NotebookResetReview | null>(null),
    [recovery, setRecovery] = useState<ResetRecovery | null>(null),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    void api<{ recoveries: ResetRecovery[] }>('notebook/reset')
      .then((result) => {
        if (live) setRecovery(result.recoveries[0] || null);
      })
      .catch((failure) => {
        if (live) setError(failure.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const labels: Record<keyof NotebookResetReview['counts'], string> = {
    posts: collections.posts.name,
    lab: collections.lab.name,
    photos: 'Photo moments',
    albums: 'Albums',
    projects: 'Projects',
    media: 'Media files',
    trash: 'Trash items',
    revisions: 'Revisions and Undo',
    backups: 'Saved backups',
    builds: 'Build history',
  };
  async function downloadRecovery(event: MouseEvent<HTMLAnchorElement>, url: string) {
    if (busy) {
      event.preventDefault();
      return;
    }
    if (!isCloudStudio()) return;
    const snapshot = /^\/api\/backups\/([^/]+)\/download$/.exec(url);
    if (!snapshot) return;
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { downloadCloudBackup } = await import('./cloud-backup.js');
      await downloadCloudBackup(snapshot[1]);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="notebook-reset-section" aria-labelledby="notebook-reset-heading">
      <div className="settings-card-heading">
        <Icon name="RotateCcw" />
        <h2 id="notebook-reset-heading" data-ui={'Reset notebook data'}>
          {t('Reset notebook data')}
        </h2>
      </div>
      <p
        className="help"
        data-ui={
          'Start with an empty notebook. Keep your site identity, appearance, content names, Cloudflare/R2 settings and site artwork.'
        }
      >
        {t(
          'Start with an empty notebook. Keep your site identity, appearance, content names, Cloudflare/R2 settings and site artwork.',
        )}
      </p>
      <p
        className="help"
        data-ui={
          'Clear writings, photo moments, albums, About text, unused media, Trash, revisions, saved backups and build history. A fresh recovery copy is saved before clearing data. Your deployed site and R2 objects stay available.'
        }
      >
        {t(
          'Clear writings, photo moments, albums, About text, unused media, Trash, revisions, saved backups and build history. A fresh recovery copy is saved before clearing data. Your deployed site and R2 objects stay available.',
        )}
      </p>
      <Button
        variant="danger"
        icon={busy ? 'LoaderCircle' : 'RotateCcw'}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          setMessage('');
          setConfirmation('');
          try {
            await beforeReview();
            setReview(await send<NotebookResetReview>('notebook/reset/review', 'POST', {}));
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <UiText message={'Review data reset'} />
      </Button>
      {!review && <ErrorBox error={error} />}
      {message && (
        <p className="operation-message" role="status">
          {message}
        </p>
      )}
      {recovery && (
        <p className="reset-recovery-link">
          <Icon name="Archive" size={15} />
          <a
            href={recovery.url}
            download
            data-ui={'Download the recovery copy'}
            aria-disabled={busy}
            onClick={(event) => void downloadRecovery(event, recovery.url)}
          >
            {t('Download the recovery copy')}
          </a>
          <span>
            {formatBytes(recovery.bytes)} · {new Date(recovery.createdAt).toLocaleString()}
          </span>
        </p>
      )}
      {review && (
        <Modal
          title={t('Reset notebook data?')}
          wide
          onClose={() => {
            if (!busy) {
              setReview(null);
              setError('');
            }
          }}
          footer={
            <>
              <Button
                disabled={busy}
                onClick={() => {
                  setReview(null);
                  setError('');
                }}
              >
                <UiText message={'Cancel'} />
              </Button>
              <Button
                variant="danger"
                icon={busy ? 'LoaderCircle' : 'RotateCcw'}
                disabled={busy || confirmation !== 'RESET'}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const result = await send<NotebookResetResult>(
                      `notebook/reset/${review.id}/commit`,
                      'POST',
                      { sourceRevision: review.sourceRevision, confirmation },
                    );
                    setRecovery(result.recovery);
                    setReview(null);
                    setConfirmation('');
                    setMessage(
                      isCloudStudio()
                        ? t(
                            'Notebook reset. Site settings and connections are kept. Publish when you are ready to update the public site.',
                          )
                        : 'Notebook data reset. Your site settings and Cloudflare/R2 connection are kept. The empty local preview is ready.',
                    );
                    await onCompleted();
                  } catch (failure) {
                    setError((failure as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? t('Resetting…') : t('Reset notebook data')}
              </Button>
            </>
          }
        >
          <p className="modal-intro">
            <UiText message={'This clears data in '} />
            <strong>{review.siteName}</strong>
            <UiText
              message={
                '. Your site settings, Cloudflare/R2 credentials, reader/editor preferences and '
              }
            />
            {review.keptMedia.length} <UiText message={'referenced site files are kept.'} />
          </p>
          <dl className="reset-counts">
            {Object.entries(review.counts).map(([key, count]) => (
              <div key={key}>
                <dt>{labels[key as keyof typeof labels]}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <p className="help">
            {isCloudStudio()
              ? t(
                  'A reference snapshot keeps your current notebook recoverable. Existing backups move to seven-day recovery. Reset does not build or publish; the public site stays available.',
                )
              : t(
                  'A portable recovery copy of the current notebook is retained. Existing backup archives and earlier reset copies are removed. The reset also replaces the local public preview with an empty build; it does not publish or delete remote files.',
                )}
          </p>
          <a
            className="button secondary small"
            href={review.backupUrl}
            download
            aria-disabled={busy}
            onClick={(event) => void downloadRecovery(event, review.backupUrl)}
          >
            <Icon name="Download" size={15} />
            <UiText message={'Download recovery copy · '} />
            {formatBytes(review.backupBytes)}
          </a>
          {review.keptMedia.length > 0 && (
            <details className="reset-kept-media">
              <summary data-ui={'Site files being kept'}>{t('Site files being kept')}</summary>
              <ul>
                {review.keptMedia.map((url) => (
                  <li key={url}>
                    <code>{url}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Field label={t('Type RESET to confirm')}>
            <input
              value={confirmation}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
          <ErrorBox error={error} />
          {error && (
            <Button
              className="small"
              icon="RotateCcw"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                setConfirmation('');
                try {
                  setReview(await send<NotebookResetReview>('notebook/reset/review', 'POST', {}));
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <UiText message={'Review reset again'} />
            </Button>
          )}
        </Modal>
      )}
    </section>
  );
}
