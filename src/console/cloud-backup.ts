import { api, cloudSessionToken, workspacePreferenceKey, ApiError } from './api.js';
import type { RestoreReview } from '../engine/backup.js';
import { formatBytes } from '../shared/media-details.js';
import { t } from '../shared/i18n.js';
function backupWorker() {
  return new Worker(new URL('./cloud-backup.worker.ts', import.meta.url), { type: 'module' });
}
export async function importCloudBackup(
  file: File | { id: string; bytes: number; revision: string; name: string },
  options: { signal: AbortSignal; progress: (bytes: number) => void },
): Promise<RestoreReview> {
  const key = workspacePreferenceKey('native-backup-import'),
    sample =
      file instanceof File
        ? new Blob([
            JSON.stringify([file.name, file.size, file.lastModified]),
            file.slice(0, 524288),
            file.slice(Math.max(0, file.size - 524288)),
          ])
        : new Blob([JSON.stringify(file)]);
  const fingerprint = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await sample.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const saved = JSON.parse(localStorage.getItem(key) || 'null');
  if (saved && saved.fingerprint !== fingerprint)
    throw new Error(
      'A different backup import is paused. Resume its original file, or forget the paused import in Hosting.',
    );
  const status = await api('cloud/status'),
    worker = backupWorker();
  return new Promise((resolve, reject) => {
    const stop = () => {
      worker.terminate();
      options.signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      stop();
      reject(new DOMException('Paused', 'AbortError'));
    };
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) {
      abort();
      return;
    }
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'session')
        localStorage.setItem(key, JSON.stringify({ fingerprint, migration: data.session }));
      if (data.type === 'progress') options.progress(data.bytes);
      if (data.type === 'error') {
        stop();
        reject(new Error(data.message));
      }
      if (data.type === 'review') {
        stop();
        resolve(data.review);
      }
    };
    worker.onerror = (event) => {
      stop();
      reject(new Error(event.message || 'Backup worker failed.'));
    };
    worker.postMessage({
      action: 'import',
      ...(file instanceof File ? { file } : { legacy: file }),
      token: cloudSessionToken(),
      version: status.version,
      migration: saved?.migration,
    });
  });
}
export async function downloadCloudBackup(
  id: string,
  kind: 'backup' | 'export' | 'artifact' = 'backup',
) {
  const session = crypto.randomUUID(),
    worker = backupWorker(),
    urls: string[] = [];
  const dialog = document.createElement('dialog');
  dialog.className = 'studio-modal glass-panel cloud-backup-dialog';
  const title = document.createElement('h2');
  title.textContent = t('Export notebook');
  const status = document.createElement('p');
  status.className = 'help';
  status.textContent = t('Preparing a checked, portable archive…');
  const list = document.createElement('div');
  list.className = 'heading-actions';
  const close = document.createElement('button');
  close.className = 'button secondary';
  close.textContent = t('Close');
  close.onclick = () => dialog.close();
  dialog.append(title, status, list, close);
  document.body.append(dialog);
  dialog.setAttribute('aria-label', t('Export notebook'));
  dialog.showModal();
  const closed = new Promise<void>((resolve) =>
    dialog.addEventListener('close', () => resolve(), { once: true }),
  );
  let writer: FileSystemWritableFileStream | undefined,
    settled = false;
  const done = () => {
    settled = true;
  };
  dialog.addEventListener(
    'close',
    () => {
      if (!settled) worker.terminate();
      setTimeout(() => {
        worker.terminate();
        const cleaner = backupWorker();
        const cleanupTimer = setTimeout(() => cleaner.terminate(), 5000);
        cleaner.onmessage = () => {
          clearTimeout(cleanupTimer);
          cleaner.terminate();
        };
        cleaner.postMessage({ action: 'cleanup', session });
        urls.forEach(URL.revokeObjectURL);
      }, 3000);
      dialog.remove();
      if (!settled) void writer?.abort();
    },
    { once: true },
  );
  try {
    const leased =
      kind === 'export'
        ? { id }
        : await api(
            (kind === 'artifact' ? 'jobs/' + id + '/artifact' : 'backups/' + id) + '/export',
            { method: 'POST', body: '{}' },
          );
    const picker = (window as any).showSaveFilePicker;
    if (picker) {
      try {
        const handle = await picker.call(window, {
          suggestedName: 'glass-notebook-' + id + '.tar.gz',
          types: [
            { description: 'Portable notebook', accept: { 'application/gzip': ['.tar.gz'] } },
          ],
        });
        writer = await handle.createWritable();
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          dialog.close();
          return;
        }
        if (!['SecurityError', 'NotAllowedError'].includes((error as Error).name)) throw error;
      }
    }
    const base = 'cloud/exports/' + leased.id;
    const manifest = await api(base + '/manifest');
    let exported = 0;
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'progress') {
        exported = data.bytes;
        status.textContent =
          formatBytes(exported) +
          ' / ' +
          formatBytes(manifest.files.reduce((sum: number, file: any) => sum + file.bytes, 0));
      }
      if (data.type === 'error') {
        status.textContent = data.message;
        void writer?.abort();
        done();
      }
      if (data.type === 'stream')
        void (data.stream as ReadableStream)
          .pipeTo(writer as unknown as WritableStream)
          .then(() => {
            status.textContent = t('Portable backup saved and checksums verified.');
            done();
          })
          .catch((error) => {
            status.textContent = error.message;
            done();
          });
      if (data.type === 'parts') {
        const multipart = data.parts.length > 1;
        status.textContent = multipart
          ? t(
              'Download every part. Join them in order to restore the .tar.gz archive. Temporary parts use browser storage, not Studio storage.',
            )
          : t('The checked portable archive is ready to download.');
        data.parts.forEach((file: File, index: number) => {
          const link = document.createElement('a'),
            url = URL.createObjectURL(file);
          urls.push(url);
          link.href = url;
          link.download =
            'glass-notebook-' +
            id +
            '.tar.gz' +
            (multipart ? '.part-' + String(index + 1).padStart(4, '0') : '');
          link.className = 'button secondary small';
          link.textContent =
            (multipart ? t('Part {value0}', { value0: index + 1 }) : t('Download archive')) +
            ' · ' +
            formatBytes(file.size);
          list.append(link);
        });
        const help = document.createElement('pre');
        const archiveName = 'glass-notebook-' + id + '.tar.gz';
        help.textContent =
          'macOS / Linux: cat ' +
          archiveName +
          '.part-* > ' +
          archiveName +
          '\nWindows: cmd /c copy /b ' +
          archiveName +
          '.part-* ' +
          archiveName;
        if (multipart) dialog.append(help);
        done();
      }
    };
    worker.onerror = (event) => {
      status.textContent = event.message;
      done();
    };
    worker.postMessage({
      action: 'export',
      id: leased.id,
      kind: 'export',
      session,
      token: cloudSessionToken(),
      streaming: !!writer,
    });
  } catch (error) {
    if (kind === 'backup' && error instanceof ApiError && error.status === 404) {
      done();
      await writer?.abort();
      dialog.close();
      location.assign('/api/backups/' + encodeURIComponent(id) + '/download');
      return;
    }
    status.textContent = (error as Error).message;
    done();
    await writer?.abort();
  }
  await closed;
}
