import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { archiveNotebookPath, notebookArchivePath } from '../shared/notebook-data.js';
import { tarFile, iteratorStream, ArchiveReader } from '../shared/browser-archive.js';
import { BACKUP_CHUNK_BYTES, type BackupUpload } from '../shared/backup-transfer.js';
type RecordFile = { path: string; sha: string; bytes: number; modified?: string };
const encoder = new TextEncoder();
const digest = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
let token = '';
async function api(
  route: string,
  method = 'GET',
  body?: unknown,
  headers?: Record<string, string>,
) {
  const response = await fetch('/api/' + route, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Studio-Token': token, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || 'Backup request failed (' + response.status + ').');
  return data;
}
async function* exportArchive(base: string, files: RecordFile[], portable = true) {
  const manifest = portable
    ? encoder.encode(
        JSON.stringify({
          format: 'fieldnotes-notebook',
          version: 3,
          createdAt: new Date().toISOString(),
          files: files.map((file) => ({
            path: archiveNotebookPath(file.path),
            sha256: file.sha,
            bytes: file.bytes,
          })),
        }),
      )
    : new Uint8Array();
  if (portable) yield* tarFile('manifest.json', manifest.length, new Blob([manifest]).stream());
  let done = 0,
    lastProgress = 0;
  for (const file of files) {
    const response = await fetch(
      '/api/' + base + '/file?' + new URLSearchParams({ path: file.path }),
    );
    if (!response.ok || !response.body)
      throw new Error('A snapshot file could not be downloaded: ' + file.path);
    const hash = sha256.create();
    const measured = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          hash.update(chunk);
          done += chunk.length;
          if (performance.now() - lastProgress > 150) {
            lastProgress = performance.now();
            postMessage({ type: 'progress', bytes: done });
          }
          controller.enqueue(chunk);
        },
      }),
    );
    yield* tarFile(
      portable ? 'data/' + archiveNotebookPath(file.path) : file.path,
      file.bytes,
      measured,
    );
    if (bytesToHex(hash.digest()) !== file.sha)
      throw new Error('Snapshot checksum failed: ' + file.path);
  }
  postMessage({ type: 'progress', bytes: done });
  yield new Uint8Array(1024);
}
async function exportBackup(input: any) {
  const base =
    input.kind === 'export'
      ? 'cloud/exports/' + input.id
      : input.kind === 'artifact'
        ? 'jobs/' + input.id + '/artifact'
        : 'backups/' + input.id;
  const manifest = await api(base + '/manifest'),
    stream = iteratorStream(
      exportArchive(
        base,
        manifest.files,
        !!manifest.portable || !input.kind || input.kind === 'backup',
      ),
    ).pipeThrough(
      new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
    );
  if (input.streaming) {
    (
      self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }
    ).postMessage({ type: 'stream', stream }, [stream]);
    return;
  }
  // Some browsers expose OPFS but reject it (private browsing, quota policy or WebKit).
  // Only small archives may fall back to memory; never buffer a large export silently.
  let root: FileSystemDirectoryHandle | undefined;
  try {
    root = await navigator.storage?.getDirectory?.();
  } catch {}
  if (!root) {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = stream.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.length;
        if (bytes > 32 * 1024 ** 2)
          throw new Error(
            'This browser cannot store a large streamed download. Use filesystem downloads or a browser with private file storage.',
          );
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    postMessage({
      type: 'parts',
      parts: [new File(chunks as BlobPart[], 'backup.tar.gz', { type: 'application/gzip' })],
    });
    return;
  }
  const estimate = await navigator.storage.estimate(),
    required =
      manifest.files.reduce((sum: number, file: RecordFile) => sum + file.bytes, 0) * 1.02 +
      2 * 1024 ** 2;
  if (estimate.quota !== undefined && estimate.quota - (estimate.usage || 0) < required) {
    await stream.cancel();
    throw new Error(
      'There is not enough private browser storage for this archive. Choose a filesystem download destination or free browser storage, then retry. The saved snapshot is unchanged.',
    );
  }
  // OPFS-backed parts keep the multi-gigabyte fallback off the JavaScript heap.
  const folder = await root.getDirectoryHandle('glass-backup-' + input.session, { create: true });
  const reader = stream.getReader(),
    parts: File[] = [];
  let writer:
      | {
          write(value: Uint8Array<ArrayBuffer>): Promise<void>;
          close(): Promise<void>;
          abort(): Promise<void>;
        }
      | undefined,
    handle: FileSystemFileHandle | undefined,
    partBytes = 0,
    index = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      let offset = 0;
      while (offset < next.value.length) {
        if (!writer) {
          handle = await folder.getFileHandle(String(++index).padStart(4, '0'), { create: true });
          if (typeof (handle as any).createSyncAccessHandle === 'function') {
            const access = await (handle as any).createSyncAccessHandle();
            let position = 0;
            writer = {
              async write(value) {
                let offset = 0;
                while (offset < value.length) {
                  const count = access.write(value.subarray(offset), { at: position });
                  if (!count) throw new Error('Private download storage is full.');
                  offset += count;
                  position += count;
                }
              },
              async close() {
                access.flush();
                access.close();
              },
              async abort() {
                access.close();
              },
            };
          } else writer = await handle.createWritable();
        }
        const count = Math.min(next.value.length - offset, 32 * 1024 ** 2 - partBytes);
        await writer!.write(new Uint8Array(next.value.slice(offset, offset + count)));
        offset += count;
        partBytes += count;
        if (partBytes === 32 * 1024 ** 2) {
          await writer!.close();
          parts.push(await handle!.getFile());
          writer = undefined;
          partBytes = 0;
        }
      }
    }
    if (writer) {
      await writer.close();
      parts.push(await handle!.getFile());
    }
    postMessage({ type: 'parts', parts });
  } catch (error) {
    await writer?.abort();
    await root.removeEntry('glass-backup-' + input.session, { recursive: true });
    throw error;
  }
}
async function uploadFile(session: string, file: RecordFile, reader: ArchiveReader) {
  const route = 'cloud/migration/' + session,
    hash = sha256.create();
  const linked = await api(route + '/link', 'POST', file);
  let transfer: BackupUpload | undefined;
  if (!linked.linked && file.bytes > BACKUP_CHUNK_BYTES)
    transfer = await api(route + '/uploads', 'POST', {
      name: file.path.split('/').at(-1),
      bytes: file.bytes,
      fingerprint: file.sha,
      path: file.path,
      sha: file.sha,
      modified: file.modified,
    });
  const parts = new Map(transfer?.parts.map((part) => [part.part, part]));
  for (let offset = 0, part = 1; offset < file.bytes; offset += BACKUP_CHUNK_BYTES, part++) {
    const chunk = await reader.bytes(Math.min(BACKUP_CHUNK_BYTES, file.bytes - offset));
    hash.update(chunk);
    if (!linked.linked) {
      if (transfer) {
        const checksum = digest(chunk);
        if (parts.has(part)) {
          if (parts.get(part)!.sha256 !== checksum)
            throw new Error('Archive differs from its uploaded parts.');
        } else
          await api(
            route + '/uploads/' + transfer.id + '/parts/' + part,
            'PUT',
            new Blob([chunk]),
            { 'Content-Type': 'application/octet-stream', 'X-Part-SHA256': checksum },
          );
      } else
        await api(
          route + '/file?' + new URLSearchParams({ path: file.path }),
          'PUT',
          new Blob([chunk]),
          {
            'Content-Type': 'application/octet-stream',
            ...(file.modified ? { 'X-File-Modified': file.modified } : {}),
          },
        );
    }
    postMessage({ type: 'progress', bytes: reader.total });
  }
  if (bytesToHex(hash.digest()) !== file.sha)
    throw new Error('Archive checksum failed: ' + file.path);
  if (!file.bytes && !linked.linked)
    await api(route + '/file?' + new URLSearchParams({ path: file.path }), 'PUT', new Blob([]), {
      'Content-Type': 'application/octet-stream',
    });
  if (transfer) await api(route + '/uploads/' + transfer.id + '/complete', 'POST', {});
}
async function importBackup(input: any) {
  const file = input.file as File | undefined;
  const remote = file
    ? undefined
    : await fetch('/api/backups/' + encodeURIComponent(input.legacy.id) + '/download');
  if (remote && !remote.ok) throw new Error('Saved backup archive is unavailable.');
  const size = file?.size ?? input.legacy.bytes,
    name = file?.name ?? input.legacy.name,
    body = file?.stream() ?? remote?.body;
  if (!body) throw new Error('Backup stream is unavailable.');
  const session =
    input.migration || (await api('cloud/migration', 'POST', { version: input.version }));
  postMessage({ type: 'session', session });
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
  if (first === '{') {
    if (size > 128 * 1024 ** 2)
      throw new Error(
        'Compatibility archive exceeds 128 MiB compressed. Use a streaming .tar.gz archive.',
      );
    const chunks: Uint8Array[] = [];
    // Compatibility archives contain base64 JSON; keep the old explicit size ceiling.
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
    if (
      envelope.format !== 'fieldnotes-notebook' ||
      ![1, 2].includes(envelope.version) ||
      !Array.isArray(envelope.files) ||
      envelope.files.length > 10000
    )
      throw new Error('Invalid compatibility backup.');
    for (const record of envelope.files) {
      const path = notebookArchivePath(record.path),
        value = Uint8Array.from(atob(record.data), (char) => char.charCodeAt(0));
      if (digest(value) !== record.sha256) throw new Error('Archive checksum failed: ' + path);
      const next = { path, sha: record.sha256, bytes: value.length };
      files.push(next);
      const source = new ArchiveReader(new Blob([value]).stream());
      await uploadFile(session.id, next, source);
      await source.close();
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
        manifest.files.length < 2 ||
        manifest.files.length > 20000
      )
        throw new Error('Invalid streaming backup manifest.');
      files = manifest.files.map((record: any) => ({
        path: notebookArchivePath(record.path),
        sha: record.sha256,
        bytes: record.bytes,
      }));
      if (
        new Set(files.map((file) => file.path)).size !== files.length ||
        files.some(
          (file) =>
            !/^[a-f0-9]{64}$/.test(file.sha) ||
            !Number.isSafeInteger(file.bytes) ||
            file.bytes < 0 ||
            file.bytes > 4 * 1024 ** 3,
        ) ||
        files.reduce((sum, file) => sum + file.bytes, 0) > 8 * 1024 ** 3
      )
        throw new Error('Invalid backup file index.');
      const remaining = new Map(
        files.map((record) => ['data/' + archiveNotebookPath(record.path), record]),
      );
      for (let index = 0; index < files.length; index++) {
        const header = await reader.header();
        const record = header && remaining.get(header.name);
        if (!record || !header || header.size !== record.bytes)
          throw new Error('Archive entries differ from their manifest.');
        remaining.delete(header.name);
        await uploadFile(session.id, record, reader);
        await reader.padding(record.bytes);
      }
      if (await reader.header()) throw new Error('Archive has unexpected extra files.');
    } finally {
      await reader.close();
    }
  }
  const review = await api('backups/import/review', 'POST', {
    migration: session.id,
    name,
    files,
  });
  postMessage({ type: 'review', review });
}
self.onmessage = async (event: MessageEvent) => {
  token = event.data.token || '';
  try {
    if (event.data.action === 'hash') {
      const hash = sha256.create(),
        reader = (event.data.file as Blob).stream().getReader();
      let bytes = 0,
        last = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          hash.update(next.value);
          bytes += next.value.length;
          if (performance.now() - last > 150) {
            last = performance.now();
            postMessage({ type: 'progress', bytes });
          }
        }
      } finally {
        reader.releaseLock();
      }
      postMessage({ type: 'hash', sha: bytesToHex(hash.digest()) });
    } else if (event.data.action === 'export') await exportBackup(event.data);
    else if (event.data.action === 'import') await importBackup(event.data);
    else if (event.data.action === 'cleanup') {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('glass-backup-' + event.data.session, { recursive: true });
      postMessage({ type: 'cleaned' });
    }
  } catch (error) {
    postMessage({ type: 'error', message: (error as Error).message });
  }
};
