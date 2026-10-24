import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { archiveNotebookPath } from '../shared/notebook-data.js';
import { tarFile, iteratorStream } from '../shared/browser-archive.js';
import { importBackup } from './backup-import-worker.js';
type RecordFile = { path: string; sha: string; bytes: number; modified?: string };
const encoder = new TextEncoder();
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
    else if (event.data.action === 'import') {
      const review = await importBackup(event.data, api, (message) => postMessage(message));
      postMessage({ type: 'review', review });
    } else if (event.data.action === 'cleanup') {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('glass-backup-' + event.data.session, { recursive: true });
      postMessage({ type: 'cleaned' });
    }
  } catch (error) {
    postMessage({ type: 'error', message: (error as Error).message });
  }
};
