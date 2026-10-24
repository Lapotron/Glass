import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '../shared/ui.js';
import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { formatBytes } from '../shared/media-details.js';
import { LARGE_BACKUP_BYTES, type BackupUpload } from '../shared/backup-transfer.js';
import type { RestoreReview } from '../engine/backup.js';
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
    [error, setError] = useState('');
  const controller = useRef<AbortController>(null);
  const uploadedReview = useRef('');
  useEffect(() => {
    if (restored && restored === uploadedReview.current) void discard();
  }, [restored]);
  useEffect(() => {
    onBusy(phase === 'uploading' || phase === 'validating');
  }, [phase, onBusy]);
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
    if (chosen.size < 1 || chosen.size > LARGE_BACKUP_BYTES) {
      setError(t('Choose a notebook archive up to 4 GiB.'));
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    const options = { signal: abort.signal };
    setError('');
    setPhase('uploading');
    setFile(chosen);
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
        if (isCloudStudio()) {
          const status = await api<any>('cloud/status', options);
          if (!status.buildsConfigured)
            throw new Error(
              t('Connect the reader Deploy Hook in Hosting before importing an archive.'),
            );
          const available = status.budgetBytes - (status.physicalStorage?.bytes || 0);
          if (chosen.size > available)
            throw new Error(
              t(
                'The archive exceeds available private storage. Review the storage budget in Hosting first.',
              ),
            );
        }
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
      setPhase('complete');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setError((error as Error).message);
      const saved = stored();
      if (saved)
        await api<BackupUpload>('backups/uploads/' + saved.id)
          .then(setTransfer)
          .catch(() => {});
      setPhase('paused');
    }
  }
  async function discard() {
    const id = transfer?.id || pending?.id;
    if (!id) return;
    setError('');
    try {
      await api('backups/uploads/' + id, { method: 'DELETE' });
      remember(null);
      setTransfer(undefined);
      setFile(undefined);
      setDone(0);
      setPhase('idle');
      onReview(null);
      uploadedReview.current = '';
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const active = phase === 'uploading' || phase === 'validating';
  return (
    <div className="backup-import">
      <p className="help">
        <UiText message="Import .tar.gz large archives or existing .json.gz backups. Uploads use checked 8 MiB parts and can resume for 24 hours." />
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
        <div className="backup-transfer" aria-busy={active}>
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
            <span>
              {phase === 'validating'
                ? t('Checking archive…')
                : phase === 'complete'
                  ? t('Ready to review')
                  : phase === 'paused'
                    ? t('Paused')
                    : t('Uploading…')}
            </span>
          </div>
          <progress
            aria-label={t('Backup upload progress')}
            value={done}
            max={file?.size || transfer?.bytes || 1}
          />
          <p className="help" aria-live="polite">
            {file ? (
              `${formatBytes(done)} / ${formatBytes(file.size)}`
            ) : (
              <UiText message="Choose the original archive to resume your upload." />
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
                <UiText message="Discard upload" />
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
