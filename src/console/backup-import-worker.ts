import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { archiveNotebookPath, notebookArchivePath } from '../shared/notebook-data.js';
import { ArchiveReader } from '../shared/browser-archive.js';
import { BACKUP_CHUNK_BYTES, type BackupUpload } from '../shared/backup-transfer.js';
import type { BackupImportProgress } from '../shared/backup-progress.js';
import type { RestoreReview } from '../engine/backup.js';

type RecordFile = { path: string; sha: string; bytes: number; modified?: string };
type Request = (
  route: string,
  method?: string,
  body?: unknown,
  headers?: Record<string, string>,
) => Promise<any>;
type Input = {
  file?: File;
  legacy?: { id: string; name: string; bytes: number };
  version: number;
  migration?: { id: string };
};
type Message =
  | { type: 'session'; session: { id: string } }
  | { type: 'import-progress'; progress: BackupImportProgress };
const digest = (bytes: Uint8Array) => bytesToHex(sha256(bytes));

/** At most three 8 MiB payloads are in flight. The archive itself remains sequential. */
class UploadPool {
  private pending = new Set<Promise<void>>();
  private error: unknown;
  async available() {
    if (this.pending.size >= 3) await Promise.race(this.pending);
    if (this.error) throw this.error;
  }
  add(task: () => Promise<void>) {
    const pending = Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        this.error ||= error;
      })
      .finally(() => this.pending.delete(pending));
    this.pending.add(pending);
  }
  async drain() {
    await Promise.all(this.pending);
    if (this.error) throw this.error;
  }
}

export async function importBackup(input: Input, api: Request, report: (message: Message) => void) {
  const started = performance.now();
  const progress: BackupImportProgress = {
    stage: 'preparing',
    totalBytes: 0,
    completedBytes: 0,
    uploadedBytes: 0,
    reusedBytes: 0,
    totalFiles: 0,
    completedFiles: 0,
    currentFile: '',
    elapsedMs: 0,
  };
  let lastProgress = -Infinity;
  function notify(force = false) {
    const now = performance.now();
    if (!force && now - lastProgress < 150) return;
    lastProgress = now;
    report({ type: 'import-progress', progress: { ...progress, elapsedMs: now - started } });
  }
  function stage(value: BackupImportProgress['stage']) {
    progress.stage = value;
    notify(true);
  }
  function confirmed(bytes: number, reused: boolean) {
    progress.completedBytes += bytes;
    if (reused) progress.reusedBytes += bytes;
    else progress.uploadedBytes += bytes;
    notify();
  }
  notify(true);
  const timer = setInterval(() => notify(), 500);
  try {
    const file = input.file;
    const remote = file
      ? undefined
      : await fetch('/api/backups/' + encodeURIComponent(input.legacy!.id) + '/download');
    if (remote && !remote.ok) throw new Error('Saved backup archive is unavailable.');
    const size = file?.size ?? input.legacy!.bytes,
      name = file?.name ?? input.legacy!.name,
      body = file?.stream() ?? remote?.body;
    if (!body) throw new Error('Backup stream is unavailable.');
    const session =
      input.migration || (await api('cloud/migration', 'POST', { version: input.version }));
    report({ type: 'session', session });
    const route = 'cloud/migration/' + session.id;
    const pool = new UploadPool();
    const activeFiles = new Set<string>();
    async function smallFile(record: RecordFile, bytes: Uint8Array<ArrayBuffer>) {
      // Verify before sending, including when the server can reuse an immutable blob.
      if (digest(bytes) !== record.sha) throw new Error('Archive checksum failed: ' + record.path);
      pool.add(async () => {
        activeFiles.add(record.path);
        progress.currentFile = activeFiles.values().next().value || '';
        notify(activeFiles.size === 1);
        const linked = await api(route + '/link', 'POST', record);
        if (!linked.linked)
          await api(
            route + '/file?' + new URLSearchParams({ path: record.path }),
            'PUT',
            new Blob([bytes]),
            {
              'Content-Type': 'application/octet-stream',
              ...(record.modified ? { 'X-File-Modified': record.modified } : {}),
            },
          );
        progress.completedFiles++;
        activeFiles.delete(record.path);
        progress.currentFile = activeFiles.values().next().value || '';
        confirmed(record.bytes, !!linked.linked);
        notify(!activeFiles.size);
      });
    }
    async function largeFile(record: RecordFile, reader: ArchiveReader) {
      await pool.drain();
      progress.currentFile = record.path;
      notify(true);
      const linked = await api(route + '/link', 'POST', record),
        hash = sha256.create();
      let transfer: BackupUpload | undefined;
      if (!linked.linked)
        transfer = await api(route + '/uploads', 'POST', {
          name: record.path.split('/').at(-1),
          bytes: record.bytes,
          fingerprint: record.sha,
          path: record.path,
          sha: record.sha,
          modified: record.modified,
        });
      const parts = new Map(transfer?.parts.map((part) => [part.part, part]));
      for (let offset = 0, part = 1; offset < record.bytes; offset += BACKUP_CHUNK_BYTES, part++) {
        await pool.available();
        const bytes = await reader.bytes(Math.min(BACKUP_CHUNK_BYTES, record.bytes - offset));
        hash.update(bytes);
        if (linked.linked) confirmed(bytes.length, true);
        else {
          const checksum = digest(bytes),
            existing = parts.get(part),
            number = part;
          if (existing) {
            if (existing.sha256 !== checksum)
              throw new Error('Archive differs from its uploaded parts.');
            confirmed(bytes.length, true);
          } else
            pool.add(async () => {
              await api(
                route + '/uploads/' + transfer!.id + '/parts/' + number,
                'PUT',
                new Blob([bytes]),
                { 'Content-Type': 'application/octet-stream', 'X-Part-SHA256': checksum },
              );
              confirmed(bytes.length, false);
            });
        }
      }
      if (bytesToHex(hash.digest()) !== record.sha)
        throw new Error('Archive checksum failed: ' + record.path);
      await pool.drain();
      if (transfer) await api(route + '/uploads/' + transfer.id + '/complete', 'POST', {});
      progress.completedFiles++;
      progress.currentFile = '';
      notify(true);
    }
    let files: RecordFile[] = [];
    const compressed = body.pipeThrough(new DecompressionStream('gzip')).getReader();
    const initial: Uint8Array[] = [];
    let first = '';
    while (!first) {
      const next = await compressed.read();
      if (next.done) throw new Error('Empty backup archive.');
      initial.push(next.value);
      const prefix = await new Blob(initial as BlobPart[]).text();
      first = prefix.trimStart()[0] || '';
      if (prefix.length > 65536 && !first) throw new Error('Backup prefix is too large.');
    }
    const source = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (initial.length) {
          controller.enqueue(initial.shift()!);
          return;
        }
        try {
          const next = await compressed.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        return compressed.cancel();
      },
    });
    function index(records: RecordFile[]) {
      if (
        records.length < 2 ||
        new Set(records.map((file) => file.path)).size !== records.length ||
        records.some(
          (file) =>
            !/^[a-f0-9]{64}$/.test(file.sha) ||
            !Number.isSafeInteger(file.bytes) ||
            file.bytes < 0 ||
            file.bytes > 4 * 1024 ** 3,
        ) ||
        records.reduce((sum, file) => sum + file.bytes, 0) > 8 * 1024 ** 3
      )
        throw new Error('Invalid backup file index.');
      files = records;
      progress.totalFiles = records.length;
      progress.totalBytes = records.reduce((sum, file) => sum + file.bytes, 0);
      stage('transferring');
    }
    if (first === '{') {
      if (size > 128 * 1024 ** 2)
        throw new Error(
          'Compatibility archive exceeds 128 MiB compressed. Use a streaming .tar.gz archive.',
        );
      const chunks: Uint8Array[] = [];
      const stream = source.getReader();
      let bytes = 0;
      try {
        for (;;) {
          const next = await stream.read();
          if (next.done) break;
          bytes += next.value.length;
          if (bytes > 384 * 1024 ** 2)
            throw new Error(
              'Compatibility archive exceeds 384 MiB. Use a streaming .tar.gz archive.',
            );
          chunks.push(next.value);
        }
      } finally {
        stream.releaseLock();
      }
      const envelope = JSON.parse(await new Blob(chunks as BlobPart[]).text());
      chunks.length = 0;
      if (
        envelope.format !== 'fieldnotes-notebook' ||
        ![1, 2].includes(envelope.version) ||
        !Array.isArray(envelope.files) ||
        envelope.files.length > 10000
      )
        throw new Error('Invalid compatibility backup.');
      index(
        envelope.files.map((record: any) => {
          if (
            typeof record.data !== 'string' ||
            record.data.length % 4 ||
            /[^A-Za-z0-9+/=]/.test(record.data) ||
            (record.data.includes('=') &&
              !/^={1,2}$/.test(record.data.slice(record.data.indexOf('='))))
          )
            throw new Error('Invalid compatibility file encoding.');
          return {
            path: notebookArchivePath(record.path),
            sha: record.sha256,
            bytes:
              (record.data.length / 4) * 3 -
              (record.data.endsWith('==') ? 2 : record.data.endsWith('=') ? 1 : 0),
          };
        }),
      );
      for (let i = 0; i < files.length; i++) {
        const record = files[i];
        await pool.available();
        const value = Uint8Array.from(atob(envelope.files[i].data), (char) => char.charCodeAt(0));
        if (record.bytes <= BACKUP_CHUNK_BYTES) await smallFile(record, value);
        else {
          const reader = new ArchiveReader(new Blob([value]).stream());
          try {
            await largeFile(record, reader);
          } finally {
            await reader.close();
          }
        }
      }
    } else {
      const reader = new ArchiveReader(source);
      try {
        const first = await reader.header();
        if (first?.name !== 'manifest.json')
          throw new Error('Archive must start with manifest.json.');
        const manifest = JSON.parse(new TextDecoder().decode(await reader.bytes(first.size)));
        await reader.padding(first.size);
        if (
          manifest.format !== 'fieldnotes-notebook' ||
          manifest.version !== 3 ||
          !Array.isArray(manifest.files) ||
          manifest.files.length > 20000
        )
          throw new Error('Invalid streaming backup manifest.');
        index(
          manifest.files.map((record: any) => ({
            path: notebookArchivePath(record.path),
            sha: record.sha256,
            bytes: record.bytes,
          })),
        );
        const remaining = new Map(
          files.map((record) => ['data/' + archiveNotebookPath(record.path), record]),
        );
        for (let i = 0; i < files.length; i++) {
          // Acquire capacity before reading so backpressure also bounds decoded file buffers.
          await pool.available();
          const header = await reader.header(),
            record = header && remaining.get(header.name);
          if (!record || !header || header.size !== record.bytes)
            throw new Error('Archive entries differ from their manifest.');
          remaining.delete(header.name);
          if (record.bytes <= BACKUP_CHUNK_BYTES)
            await smallFile(record, await reader.bytes(record.bytes));
          else await largeFile(record, reader);
          await reader.padding(record.bytes);
        }
        await pool.drain();
        stage('checking');
        // Consume the full TAR ending and gzip trailer before requesting any restore review.
        if (await reader.header()) throw new Error('Archive has unexpected extra files.');
      } finally {
        await reader.close();
      }
    }
    await pool.drain();
    progress.currentFile = '';
    stage('reviewing');
    const review = (await api('backups/import/review', 'POST', {
      migration: session.id,
      name,
      files,
    })) as RestoreReview;
    stage('ready');
    return review;
  } finally {
    clearInterval(timer);
  }
}
