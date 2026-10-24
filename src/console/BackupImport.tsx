import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '../shared/ui.js';
import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { formatBytes } from '../shared/media-details.js';
import {
  LARGE_BACKUP_BYTES,
  LARGE_BACKUP_EXPANDED_BYTES,
  type BackupUpload,
} from '../shared/backup-transfer.js';
import type { RestoreReview } from '../engine/backup.js';
import type { BackupImportProgress } from '../shared/backup-progress.js';
import { api, ApiError, isCloudStudio, workspacePreferenceKey } from './api.js';
import { ErrorBox, Field } from './components.js';

type Phase = 'idle' | 'uploading' | 'paused' | 'validating' | 'complete';
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
async function fingerprint(file: File) {
  const sample = new Blob([
    JSON.stringify([file.name, file.size, file.lastModified]),
    file.slice(0, 512 * 1024),
    file.slice(Math.max(0, file.size - 512 * 1024)),
  ]);
  return hex(await crypto.subtle.digest('SHA-256', await sample.arrayBuffer()));
}
const stored = () => {
  try {
    const value = JSON.parse(
      localStorage.getItem(workspacePreferenceKey('backup-upload')) || 'null',
    );
    return value && /^[a-f0-9-]{36}$/.test(value.id) && /^[a-f0-9]{64}$/.test(value.fingerprint)
      ? (value as { id: string; fingerprint: string })
      : null;
  } catch {
    return null;
  }
};
export function BackupImport({
  blocked,
  onReview,
  onBusy,
  restored = '',
}: {
  blocked: boolean;
  onReview: (review: RestoreReview | null) => void;
  onBusy: (busy: boolean) => void;
  restored?: string;
}) {
  const [file, setFile] = useState<File>(),
    [transfer, setTransfer] = useState<BackupUpload>(),
    [pending, setPending] = useState(stored),
    [phase, setPhase] = useState<Phase>('idle'),
    [done, setDone] = useState(0),
    [detail, setDetail] = useState<BackupImportProgress>(),
    [elapsed, setElapsed] = useState(0),
    [error, setError] = useState('');
  const controller = useRef<AbortController>(null);
  const started = useRef(0);
  const uploadedReview = useRef('');
  useEffect(() => {
    if (restored && restored === uploadedReview.current) void discard();
  }, [restored]);
  useEffect(() => {
    onBusy(phase === 'uploading' || phase === 'validating');
  }, [phase, onBusy]);
  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'validating') return;
    const timer = window.setInterval(() => setElapsed(performance.now() - started.current), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);
  useEffect(
    () => () => {
      controller.current?.abort();
      onBusy(false);
    },
    [onBusy],
  );
  const remember = (value: BackupUpload | null) => {
    const next = value ? { id: value.id, fingerprint: value.fingerprint } : null;
    setPending(next);
    try {
      if (next) localStorage.setItem(workspacePreferenceKey('backup-upload'), JSON.stringify(next));
      else localStorage.removeItem(workspacePreferenceKey('backup-upload'));
    } catch {}
  };
  async function upload(chosen: File, retryValidation = false) {
    const maximum = isCloudStudio()
      ? LARGE_BACKUP_EXPANDED_BYTES + 64 * 1024 ** 2
      : LARGE_BACKUP_BYTES;
    if (chosen.size < 1 || chosen.size > maximum) {
      setError(
        isCloudStudio()
          ? t('Choose a hosted notebook archive up to 8 GiB plus archive metadata.')
          : t('Choose a notebook archive up to 4 GiB.'),
      );
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    const options = { signal: abort.signal };
    setError('');
    setDone(0);
    setDetail(undefined);
    setElapsed(0);
    started.current = performance.now();
    setPhase('uploading');
    setFile(chosen);
    if (isCloudStudio()) {
      try {
        const { importCloudBackup } = await import('./cloud-backup.js');
        const review = await importCloudBackup(chosen, {
          signal: abort.signal,
          progress: (progress) => {
            setDetail(progress);
            setDone(progress.completedBytes);
            setElapsed(performance.now() - started.current);
            if (['checking', 'reviewing'].includes(progress.stage)) setPhase('validating');
          },
        });
        onReview(review);
        uploadedReview.current = review.id;
        setElapsed(performance.now() - started.current);
        setPhase('complete');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setError((error as Error).message);
        setElapsed(performance.now() - started.current);
        setPhase('paused');
      }
      return;
    }
    try {
      const signature = await fingerprint(chosen);
      let current: BackupUpload | undefined;
      const saved = stored();
      if (saved && saved.fingerprint !== signature)
        throw new Error(
          t(
            'An unfinished upload belongs to another archive. Discard it before choosing a different file.',
          ),
        );
      if (saved) {
        try {
          current = await api<BackupUpload>('backups/uploads/' + saved.id, options);
        } catch (error) {
          if (
            error instanceof ApiError &&
            ([404, 410].includes(error.status) || /expired|ENOENT/.test(error.message))
          )
            remember(null);
          else throw error;
        }
      }
      if (!current) {
        current = await api<BackupUpload>('backups/uploads', {
          ...options,
          method: 'POST',
          body: JSON.stringify({ name: chosen.name, bytes: chosen.size, fingerprint: signature }),
        });
        remember(current);
      }
      setTransfer(current);
      if (current.state !== 'ready') {
        const confirmed = new Map(current.parts.map((part) => [part.part, part]));
        let completed = 0;
        setDone(0);
        for (let part = 1, offset = 0; offset < chosen.size; part++, offset += current.chunkBytes) {
          abort.signal.throwIfAborted();
          const chunk = chosen.slice(offset, Math.min(chosen.size, offset + current.chunkBytes));
          const checksum = hex(await crypto.subtle.digest('SHA-256', await chunk.arrayBuffer()));
          const existing = confirmed.get(part);
          if (existing && existing.sha256 !== checksum)
            throw new Error(
              t(
                'The selected archive does not match its uploaded parts. Discard this transfer and choose the original file.',
              ),
            );
          if (!existing)
            await api('backups/uploads/' + current.id + '/parts/' + part, {
              ...options,
              method: 'PUT',
              headers: { 'Content-Type': 'application/octet-stream', 'X-Part-SHA256': checksum },
              body: chunk,
            });
          completed += chunk.size;
          setDone(completed);
        }
      } else setDone(chosen.size);
      abort.signal.throwIfAborted();
      setPhase('validating');
      setTransfer({ ...current, state: 'ready' });
      const review = await api<RestoreReview>('backups/uploads/' + current.id + '/complete', {
        ...options,
        method: 'POST',
        body: JSON.stringify(
          retryValidation ||
            (current.state === 'ready' && !['queued', 'running'].includes(current.jobState || ''))
            ? { requestId: crypto.randomUUID() }
            : {},
        ),
      });
      onReview(review);
      uploadedReview.current = review.id;
      setElapsed(performance.now() - started.current);
      setPhase('complete');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setError((error as Error).message);
      const saved = stored();
      if (saved)
        await api<BackupUpload>('backups/uploads/' + saved.id)
          .then(setTransfer)
          .catch(() => {});
      setPhase('paused');
      setElapsed(performance.now() - started.current);
    }
  }
  async function discard() {
    const id = transfer?.id || pending?.id;
    if (!id && !isCloudStudio()) return;
    setError('');
    try {
      if (isCloudStudio()) localStorage.removeItem(workspacePreferenceKey('native-backup-import'));
      else await api('backups/uploads/' + id, { method: 'DELETE' });
      remember(null);
      setTransfer(undefined);
      setFile(undefined);
      setDone(0);
      setDetail(undefined);
      setElapsed(0);
      setPhase('idle');
      onReview(null);
      uploadedReview.current = '';
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const active = phase === 'uploading' || phase === 'validating';
  const cloud = isCloudStudio();
  const total = cloud ? detail?.totalBytes || 0 : file?.size || transfer?.bytes || 0;
  const ratio = total
    ? done / total
    : detail?.totalFiles
      ? detail.completedFiles / detail.totalFiles
      : 0;
  const preparing = cloud && (!detail || detail.stage === 'preparing');
  const indeterminate = active && (preparing || phase === 'validating');
  const percent = phase === 'complete' ? 100 : Math.min(99, Math.floor(ratio * 100));
  const status =
    phase === 'complete'
      ? t('Ready to review')
      : phase === 'paused' || phase === 'idle'
        ? t('Paused')
        : detail?.stage === 'checking'
          ? t('Verifying archive ending…')
          : detail?.stage === 'reviewing'
            ? t('Preparing restore review…')
            : phase === 'validating'
              ? t('Checking archive…')
              : preparing
                ? t('Reading archive…')
                : cloud
                  ? t('Checking and uploading…')
                  : t('Uploading…');
  const checking =
    phase === 'validating' ||
    detail?.stage === 'checking' ||
    detail?.stage === 'reviewing' ||
    (!cloud && transfer?.state === 'ready');
  const step = phase === 'complete' ? 3 : checking ? 2 : preparing ? 0 : 1;
  const duration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const rate = elapsed >= 2000 ? done / (elapsed / 1000) : 0;
  const remaining = rate && elapsed >= 3000 && total > done ? ((total - done) / rate) * 1000 : 0;
  return (
    <div className="backup-import">
      <p className="help">
        {isCloudStudio()
          ? t(
              'Import .tar.gz or .json.gz directly. Checked transfers resume for seven idle days; your notebook changes only after review.',
            )
          : t(
              'Import .tar.gz large archives or existing .json.gz backups. Uploads use checked 8 MiB parts and can resume for 24 hours.',
            )}
      </p>
      <Field label={t('Notebook backup')}>
        <input
          type="file"
          accept=".gz,.tar.gz,application/gzip"
          disabled={blocked || active}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void upload(selected);
            event.target.value = '';
          }}
        />
      </Field>
      <ErrorBox error={error} />
      {(file || pending) && (
        <div
          className={'backup-transfer' + (indeterminate ? ' is-indeterminate' : '')}
          data-phase={phase}
          aria-busy={active}
        >
          <div className="backup-transfer-heading">
            <Icon
              name={
                phase === 'complete'
                  ? 'CheckCircle2'
                  : phase === 'validating'
                    ? 'ShieldCheck'
                    : 'Upload'
              }
              size={16}
            />
            <strong>{file?.name || t('Unfinished backup upload')}</strong>
            <span className="backup-transfer-percent">{indeterminate ? '—' : `${percent}%`}</span>
          </div>
          <div className="backup-transfer-meter">
            <progress
              aria-label={t('Backup upload progress')}
              aria-valuetext={indeterminate ? status : `${percent}%`}
              value={indeterminate ? undefined : percent / 100}
              max={1}
            />
          </div>
          <ol className="backup-transfer-stages" aria-label={t('Backup import stages')}>
            {(
              [
                [t('Read archive'), 'Archive'],
                [t('Check and transfer'), 'Upload'],
                [t('Prepare review'), 'ShieldCheck'],
              ] as const
            ).map(([label, icon], index) => (
              <li
                key={label}
                data-state={index < step ? 'done' : index === step ? 'active' : 'waiting'}
              >
                <Icon name={index < step ? 'Check' : icon} size={14} />
                <span>{label}</span>
              </li>
            ))}
          </ol>
          <p className="backup-transfer-status" role="status">
            {status}
          </p>
          {file && (
            <dl className="backup-transfer-facts">
              <div>
                <dt>{cloud ? t('Confirmed data') : t('Archive transferred')}</dt>
                <dd>
                  {total || detail?.totalFiles
                    ? `${formatBytes(done)} / ${formatBytes(total)}`
                    : '—'}
                </dd>
              </div>
              {detail && detail.totalFiles > 0 && (
                <div>
                  <dt>{t('Files checked')}</dt>
                  <dd>
                    {detail.completedFiles} / {detail.totalFiles}
                  </dd>
                </div>
              )}
              {detail && (
                <>
                  <div>
                    <dt>{t('Uploaded this attempt')}</dt>
                    <dd>{formatBytes(detail.uploadedBytes)}</dd>
                  </div>
                  <div>
                    <dt>{t('Already stored')}</dt>
                    <dd>{formatBytes(detail.reusedBytes)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>{t('Elapsed')}</dt>
                <dd>{duration(elapsed)}</dd>
              </div>
              <div>
                <dt>{t('Processing speed')}</dt>
                <dd>{rate && phase === 'uploading' ? `${formatBytes(rate)}/s` : '—'}</dd>
              </div>
            </dl>
          )}
          {detail?.currentFile && phase !== 'complete' && (
            <p className="backup-transfer-file" title={detail.currentFile}>
              <Icon name="FileText" size={13} />
              <span>{detail.currentFile}</span>
            </p>
          )}
          <p className="help">
            {!file ? (
              <UiText message="Choose the original archive to resume your upload." />
            ) : cloud ? (
              t('Archive: {value0}. Transfer totals use expanded file data.', {
                value0: formatBytes(file.size),
              })
            ) : null}
            {remaining > 0 && phase === 'uploading' && (
              <> · {t('About {value0} remaining', { value0: duration(remaining) })}</>
            )}
            {phase === 'validating' && (
              <>
                {' '}
                ·{' '}
                <UiText message="Validation runs in the background. Your current notebook stays in place." />
              </>
            )}
          </p>
          <div className="heading-actions">
            {phase === 'uploading' && (
              <Button className="small" icon="Pause" onClick={() => controller.current?.abort()}>
                <UiText message="Pause upload" />
              </Button>
            )}
            {phase === 'validating' && (
              <Button className="small" icon="Pause" onClick={() => controller.current?.abort()}>
                <UiText message="Stop waiting" />
              </Button>
            )}
            {phase === 'paused' && file && (
              <Button
                className="small"
                icon="Play"
                disabled={blocked}
                onClick={() => void upload(file, transfer?.jobState === 'failed')}
              >
                {transfer?.jobState === 'failed' ? t('Retry validation') : t('Resume upload')}
              </Button>
            )}
            {!active && (
              <Button
                className="small"
                icon="Trash2"
                disabled={blocked}
                onClick={() => void discard()}
              >
                {cloud ? t('Forget import') : t('Discard upload')}
              </Button>
            )}
          </div>
          {transfer?.expiresAt && phase !== 'complete' && (
            <p className="help">
              {t('Upload expires')}: {new Date(transfer.expiresAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
