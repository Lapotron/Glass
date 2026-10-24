import { useEffect, useRef, useState } from 'react';
import { api, workspacePreferenceKey } from './api.js';
import { Button, Icon } from '../shared/ui.js';
import { t } from '../shared/i18n.js';
import { formatBytes } from '../shared/media-details.js';
import { ErrorBox, Modal } from './components.js';
import {
  BACKUP_CHUNK_BYTES,
  LARGE_BACKUP_BYTES,
  type BackupUpload,
} from '../shared/backup-transfer.js';
import type { CloudStatus } from '../shared/cloud-builds.js';
import { validCloudExportPath } from '../shared/cloud-migration.js';

type RecordFile = {
  path: string;
  storagePath?: string;
  sha: string;
  bytes: number;
  modified?: string;
};
type Review = {
  files: Map<string, File>;
  manifest: { format: 'glass-cloud-workspace'; version: 1; files: RecordFile[] };
  version: number;
  fingerprint: string;
};
type Session = { id: string; fingerprint: string; version: number };
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
const digest = async (value: Blob | string) =>
  hex(
    await crypto.subtle.digest(
      'SHA-256',
      typeof value === 'string' ? new TextEncoder().encode(value) : await value.arrayBuffer(),
    ),
  );
function savedSession(): Session | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(workspacePreferenceKey('migration-upload')) || 'null',
    );
    return value &&
      /^[a-f0-9-]{36}$/.test(value.id) &&
      /^[a-f0-9]{64}$/.test(value.fingerprint) &&
      Number.isInteger(value.version)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function NotebookMigration({
  status,
  onImported,
}: {
  status?: CloudStatus;
  onImported: () => Promise<void>;
}) {
  const [review, setReview] = useState<Review>(),
    [session, setSession] = useState(savedSession),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [progress, setProgress] = useState({ done: 0, total: 0, bytes: 0, totalBytes: 0 });
  const aborter = useRef<AbortController>(null);
  useEffect(() => () => aborter.current?.abort(), []);
  function remember(value: Session | null) {
    setSession(value);
    try {
      if (value)
        localStorage.setItem(workspacePreferenceKey('migration-upload'), JSON.stringify(value));
      else localStorage.removeItem(workspacePreferenceKey('migration-upload'));
    } catch {}
  }
  async function choose(list: FileList | null) {
    if (!list?.length || !status) return;
    setError('');
    setMessage('');
    try {
      const files = [...list],
        manifestFile = files.find((file) => file.name === 'manifest.json');
      if (!manifestFile || manifestFile.size > 16 * 1024 ** 2)
        throw new Error(t('Choose the exported cloud workspace folder, including manifest.json.'));
      const manifest = JSON.parse(await manifestFile.text()) as Review['manifest'];
      if (
        manifest.format !== 'glass-cloud-workspace' ||
        manifest.version !== 1 ||
        !Array.isArray(manifest.files) ||
        manifest.files.length < 2 ||
        manifest.files.length > 30000 ||
        new Set(manifest.files.map((file) => file.path)).size !== manifest.files.length
      )
        throw new Error(t('This folder is not a Glass cloud migration export.'));
      const prefix = manifestFile.webkitRelativePath.slice(0, -manifestFile.name.length) + 'data/';
      const indexed = new Map(
        files
          .filter((file) => file.webkitRelativePath.startsWith(prefix))
          .map((file) => [file.webkitRelativePath.slice(prefix.length), file]),
      );
      const logical = new Map<string, File>();
      for (const record of manifest.files) {
        if (
          !/^(?:content\/|\.studio\/|dist\/)/.test(record.path) ||
          record.path.split('/').some((part) => !part || part === '.' || part === '..') ||
          /[\\\0]/.test(record.path) ||
          !/^[a-f0-9]{64}$/.test(record.sha) ||
          !Number.isSafeInteger(record.bytes) ||
          record.bytes < 0 ||
          record.bytes > LARGE_BACKUP_BYTES ||
          !validCloudExportPath(record.storagePath || record.path) ||
          indexed.get(record.storagePath || record.path)?.size !== record.bytes
        )
          throw new Error(
            t('An exported file is missing or has changed: {value0}', { value0: record.path }),
          );
        logical.set(record.path, indexed.get(record.storagePath || record.path)!);
      }
      const fingerprint = await digest(
        JSON.stringify(
          manifest.files
            .map(({ path, sha, bytes }) => ({ path, sha, bytes }))
            .sort((a, b) => a.path.localeCompare(b.path)),
        ),
      );
      if (session && session.fingerprint !== fingerprint)
        throw new Error(
          t(
            'Another folder import is paused. Choose its original folder or forget that session before starting a different import.',
          ),
        );
      setReview({
        files: logical,
        manifest,
        version: session?.version ?? status.version,
        fingerprint,
      });
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function migrate() {
    if (!review) return;
    const controller = new AbortController();
    aborter.current = controller;
    const signal = controller.signal;
    setBusy(true);
    setError('');
    setMessage('');
    const totals = {
      done: 0,
      total: review.manifest.files.length,
      bytes: 0,
      totalBytes: review.manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    };
    setProgress({ ...totals });
    try {
      let current = session,
        uploaded: RecordFile[] = [];
      if (current) {
        const state = await api<{ state: string; version: number; files: RecordFile[] }>(
          'cloud/migration/' + current.id,
          { signal },
        );
        if (state.state === 'completed') {
          remember(null);
          setReview(undefined);
          setMessage(t('Notebook imported. Reload Studio to open the cloud copy.'));
          await onImported();
          return;
        }
        if (state.version !== review.version)
          throw new Error(
            t(
              'This import belongs to a different notebook revision. Review Hosting before trying again.',
            ),
          );
        uploaded = state.files;
      } else {
        const created = await api<{ id: string; version: number }>('cloud/migration', {
          signal,
          method: 'POST',
          body: JSON.stringify({ version: review.version }),
        });
        current = { ...created, fingerprint: review.fingerprint };
        remember(current);
      }
      const route = 'cloud/migration/' + current.id,
        confirmed = new Map(uploaded.map((file) => [file.path, file])),
        queue = [...review.manifest.files];
      const settled = await Promise.allSettled(
        Array.from({ length: Math.min(2, queue.length) }, async () => {
          try {
            for (;;) {
              signal.throwIfAborted();
              const record = queue.shift();
              if (!record) return;
              const old = confirmed.get(record.path),
                file = review.files.get(record.path)!;
              if (old?.sha === record.sha && old.bytes === record.bytes) {
                totals.bytes += record.bytes;
                totals.done++;
                setProgress({ ...totals });
                continue;
              }
              if (file.size <= BACKUP_CHUNK_BYTES) {
                const result = await api<RecordFile>(
                  route + '/file?' + new URLSearchParams({ path: record.path }),
                  {
                    signal,
                    method: 'PUT',
                    body: file,
                    headers: {
                      'Content-Type': 'application/octet-stream',
                      ...(record.modified ? { 'X-File-Modified': record.modified } : {}),
                    },
                  },
                );
                if (result.sha !== record.sha)
                  throw new Error(
                    t('An exported file failed its checksum: {value0}', { value0: record.path }),
                  );
                totals.bytes += record.bytes;
              } else {
                const transfer = await api<BackupUpload>(route + '/uploads', {
                  signal,
                  method: 'POST',
                  body: JSON.stringify({
                    name: file.name,
                    bytes: file.size,
                    fingerprint: record.sha,
                    path: record.path,
                    sha: record.sha,
                    modified: record.modified,
                  }),
                });
                const parts = new Map(transfer.parts.map((part) => [part.part, part]));
                if (transfer.state !== 'ready')
                  for (
                    let part = 1, offset = 0;
                    offset < file.size;
                    part++, offset += transfer.chunkBytes
                  ) {
                    signal.throwIfAborted();
                    const chunk = file.slice(
                        offset,
                        Math.min(file.size, offset + transfer.chunkBytes),
                      ),
                      sha256 = await digest(chunk);
                    if (parts.has(part) && parts.get(part)!.sha256 !== sha256)
                      throw new Error(
                        t('An exported file failed its checksum: {value0}', {
                          value0: record.path,
                        }),
                      );
                    if (!parts.has(part))
                      await api(route + '/uploads/' + transfer.id + '/parts/' + part, {
                        signal,
                        method: 'PUT',
                        headers: {
                          'Content-Type': 'application/octet-stream',
                          'X-Part-SHA256': sha256,
                        },
                        body: chunk,
                      });
                    totals.bytes += chunk.size;
                    setProgress({ ...totals });
                  }
                else totals.bytes += record.bytes;
                await api(route + '/uploads/' + transfer.id + '/complete', {
                  signal,
                  method: 'POST',
                });
              }
              totals.done++;
              setProgress({ ...totals });
            }
          } catch (error) {
            controller.abort();
            throw error;
          }
        }),
      );
      const failure =
        settled.find(
          (result) =>
            result.status === 'rejected' && (result.reason as Error).name !== 'AbortError',
        ) || settled.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      signal.throwIfAborted();
      await api(route + '/commit', {
        signal,
        method: 'POST',
        body: JSON.stringify({
          files: review.manifest.files.map(({ path, sha, bytes }) => ({ path, sha, bytes })),
        }),
      });
      remember(null);
      setReview(undefined);
      setMessage(t('Notebook imported. Reload Studio to open the cloud copy.'));
      await onImported();
    } catch (error) {
      setError(
        (error as Error).name === 'AbortError'
          ? t(
              'Import paused. Uploaded files are retained for 24 hours; choose the original folder to resume.',
            )
          : (error as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  const meter = (
    <div className="hosting-progress" aria-live="polite">
      <progress
        value={progress.bytes}
        max={progress.totalBytes || 1}
        aria-label={t('Notebook migration progress')}
      />
      <span>
        {t('Uploaded {value0} of {value1}', { value0: progress.done, value1: progress.total })} ·{' '}
        {formatBytes(progress.bytes)} / {formatBytes(progress.totalBytes)}
      </span>
    </div>
  );
  return (
    <section className="glass-panel hosting-section">
      <h2>
        <Icon name="FolderUp" size={19} />
        {t('Import your notebook')}
      </h2>
      <p>
        {t(
          'Choose a cloud:export folder to review its contents. Files upload privately, pass checksum validation, then replace the notebook together. Keep the original notebook until verification is complete.',
        )}
      </p>
      <label className="button secondary hosting-file" aria-disabled={busy || status?.preview}>
        <Icon name="FolderOpen" size={16} />
        {session ? t('Resume migration folder') : t('Choose migration folder')}
        <input
          aria-label={t('Choose migration folder')}
          type="file"
          multiple
          {...{ webkitdirectory: '' }}
          disabled={busy || status?.preview || !status}
          onChange={(event) => {
            void choose(event.target.files);
            event.target.value = '';
          }}
        />
      </label>
      {session && !busy && (
        <Button
          className="small"
          variant="ghost"
          onClick={() => {
            remember(null);
            setReview(undefined);
            setError('');
          }}
        >
          {t('Forget paused session')}
        </Button>
      )}
      <p className="help">
        {t(
          'Large files use checked 8 MiB parts. Paused imports resume for 24 hours. Existing cloud credentials are kept when the export omits them. Create a notebook backup before replacing existing content.',
        )}
      </p>
      <ErrorBox error={review ? '' : error} />
      {message && (
        <p className="help" role="status">
          {message}
        </p>
      )}
      {review && (
        <Modal
          title={t('Review notebook import')}
          onClose={() => {
            if (!busy) setReview(undefined);
          }}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setReview(undefined)} disabled={busy}>
                {t('Cancel')}
              </Button>
              {busy && (
                <Button icon="Pause" onClick={() => aborter.current?.abort()}>
                  {t('Pause import')}
                </Button>
              )}
              <Button
                variant="primary"
                icon={busy ? 'LoaderCircle' : 'CloudUpload'}
                disabled={busy}
                onClick={() => void migrate()}
              >
                {busy
                  ? t('Importing…')
                  : session
                    ? t('Resume reviewed import')
                    : t('Import reviewed notebook')}
              </Button>
            </>
          }
        >
          <p>
            {t(
              'This replaces the current cloud notebook with {value0} verified files ({value1}). The live public site and original notebook remain available.',
              {
                value0: review.manifest.files.length,
                value1: formatBytes(
                  review.manifest.files.reduce((sum, file) => sum + file.bytes, 0),
                ),
              },
            )}
          </p>
          {review.manifest.files.some(
            (file) =>
              file.path === '.studio/connections.json' || file.path.startsWith('.studio/services/'),
          ) && (
            <p className="help">
              {t(
                'This restricted export includes private service settings and credentials. They remain encrypted in private cloud storage.',
              )}
            </p>
          )}
          <p className="help">
            {t('Newer cloud edits stop the import; they are never overwritten silently.')}
          </p>
          {progress.total > 0 && meter}
          <ErrorBox error={error} />
        </Modal>
      )}
    </section>
  );
}
