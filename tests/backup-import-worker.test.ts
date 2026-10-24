import { describe, expect, it, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { importBackup } from '../src/console/backup-import-worker.js';
import { tarFile, iteratorStream } from '../src/shared/browser-archive.js';
import { BACKUP_CHUNK_BYTES } from '../src/shared/backup-transfer.js';
import type { BackupImportProgress } from '../src/shared/backup-progress.js';

type Entry = { path: string; data: Buffer; sha?: string };
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const settings: Entry[] = [
  { path: 'content/site.json', data: Buffer.from('{"site":"test"}') },
  { path: 'content/library.json', data: Buffer.from('{"photos":[]}') },
];
async function archive(files: Entry[], legacy?: 1 | 2) {
  const manifest = {
    format: 'fieldnotes-notebook',
    version: legacy || 3,
    files: files.map((file) => ({
      path: file.path,
      sha256: file.sha || hash(file.data),
      ...(legacy ? { data: file.data.toString('base64') } : { bytes: file.data.length }),
    })),
  };
  let raw: Buffer;
  if (legacy) raw = Buffer.from(JSON.stringify(manifest));
  else {
    async function* tar() {
      const json = Buffer.from(JSON.stringify(manifest));
      yield* tarFile('manifest.json', json.length, new Blob([json]).stream());
      for (const file of files)
        yield* tarFile(
          'data/' + file.path,
          file.data.length,
          new Blob([new Uint8Array(file.data)]).stream(),
        );
      yield new Uint8Array(1024);
    }
    raw = Buffer.from(await new Response(iteratorStream(tar())).arrayBuffer());
  }
  return new File([gzipSync(raw)], 'test.' + (legacy ? 'json' : 'tar') + '.gz');
}
function backend({
  reused = new Set<string>(),
  parts = [] as any[],
  fail = '',
  holdParts = false,
} = {}) {
  let active = 0,
    maximum = 0,
    completed = 0,
    arrived = 0;
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const uploaded = new Map<string, Buffer>();
  const api = vi.fn(async (route: string, method?: string, body?: unknown) => {
    if (route === 'cloud/migration') return { id: 'test-session' };
    if (route.endsWith('/link')) return { linked: reused.has((body as any).path) };
    if (route.endsWith('/uploads')) return { id: 'test-upload', parts };
    if (method === 'PUT') {
      active++;
      maximum = Math.max(maximum, active);
      try {
        if (holdParts && route.includes('/parts/')) {
          if (++arrived === 3) release();
          await barrier;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (fail && route.includes(fail)) throw new Error('Upload rejected');
        uploaded.set(route, Buffer.from(await (body as Blob).arrayBuffer()));
        completed++;
      } finally {
        active--;
      }
      return { ok: true };
    }
    if (route.endsWith('/complete') || route === 'backups/import/review') {
      expect(active).toBe(0);
      return { id: 'checked-review' };
    }
    throw new Error('Unexpected request: ' + route);
  });
  return { api, uploaded, stats: () => ({ active, maximum, completed }) };
}
function reporter() {
  const updates: BackupImportProgress[] = [];
  let tick = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (tick += 160));
  return {
    updates,
    report: (message: any) => {
      if (message.type === 'import-progress') updates.push(message.progress);
    },
  };
}
afterEach(() => vi.restoreAllMocks());

describe('streaming hosted backup imports', () => {
  it.each([undefined, 1, 2] as const)(
    'bounds concurrency and counts expanded data cumulatively (format %s)',
    async (version) => {
      const files = [
        ...settings,
        ...Array.from({ length: 15 }, (_, i) => ({
          path: `content/media/${i}.bin`,
          data: Buffer.alloc(32768, i),
        })),
      ];
      const file = await archive(files, version),
        server = backend({ reused: new Set([files[2].path]) }),
        progress = reporter();
      const review = await importBackup({ file, version: 4 }, server.api, progress.report);
      expect(review.id).toBe('checked-review');
      expect(server.stats().maximum).toBe(3);
      expect(server.stats().completed).toBe(files.length - 1);
      const last = progress.updates.at(-1)!;
      const total = files.reduce((sum, entry) => sum + entry.data.length, 0);
      expect(last).toMatchObject({
        stage: 'ready',
        completedFiles: files.length,
        totalFiles: files.length,
        totalBytes: total,
        completedBytes: total,
        reusedBytes: files[2].data.length,
        uploadedBytes: total - files[2].data.length,
      });
      expect(last.totalBytes).toBeGreaterThan(file.size * 10);
      for (let i = 1; i < progress.updates.length; i++) {
        expect(progress.updates[i].completedBytes).toBeGreaterThanOrEqual(
          progress.updates[i - 1].completedBytes,
        );
        expect(progress.updates[i].completedBytes).toBeLessThanOrEqual(
          progress.updates[i].totalBytes,
        );
      }
      expect(progress.updates.some((update) => update.stage === 'preparing')).toBe(true);
      expect(progress.updates.some((update) => update.stage === 'reviewing')).toBe(true);
      expect(server.api.mock.calls.at(-1)?.[0]).toBe('backups/import/review');
    },
  );

  it('resumes checked multipart data, overlaps three chunks, and waits before assembly', async () => {
    const bytes = Buffer.alloc(BACKUP_CHUNK_BYTES * 3 + 17, 13),
      file = await archive([...settings, { path: 'content/media/large.bin', data: bytes }]),
      server = backend({
        holdParts: true,
        parts: [{ part: 1, sha256: hash(bytes.subarray(0, BACKUP_CHUNK_BYTES)) }],
      }),
      progress = reporter();
    await importBackup(
      { file, version: 4, migration: { id: 'existing-session' } },
      server.api,
      progress.report,
    );
    expect(server.api.mock.calls.some(([route]) => route === 'cloud/migration')).toBe(false);
    const parts = [...server.uploaded].filter(([route]) => route.includes('/parts/'));
    expect(parts.map(([route]) => route.split('/').at(-1)).sort()).toEqual(['2', '3', '4']);
    expect(
      hash(Buffer.concat(parts.sort(([a], [b]) => a.localeCompare(b)).map(([, data]) => data))),
    ).toBe(hash(bytes.subarray(BACKUP_CHUNK_BYTES)));
    expect(server.stats().maximum).toBe(3);
    expect(progress.updates.at(-1)).toMatchObject({
      stage: 'ready',
      completedFiles: 3,
      reusedBytes: BACKUP_CHUNK_BYTES,
      uploadedBytes:
        settings.reduce((sum, file) => sum + file.data.length, 0) +
        bytes.length -
        BACKUP_CHUNK_BYTES,
    });
  });

  it('refuses a mismatched resumed part before completing or reviewing it', async () => {
    const file = await archive([
      ...settings,
      {
        path: 'content/media/large.bin',
        data: Buffer.alloc(BACKUP_CHUNK_BYTES + 1, 13),
      },
    ]);
    const server = backend({ parts: [{ part: 1, sha256: '0'.repeat(64) }] });
    await expect(importBackup({ file, version: 4 }, server.api, () => {})).rejects.toThrow(
      'Archive differs from its uploaded parts',
    );
    expect(server.api.mock.calls.some(([route]) => /complete|review/.test(route))).toBe(false);
  });

  it('never uploads a small file with a bad checksum or requests its review', async () => {
    const file = await archive([
      ...settings,
      {
        path: 'content/media/corrupt.bin',
        data: Buffer.from('bad checksum'),
        sha: '0'.repeat(64),
      },
    ]);
    const server = backend();
    await expect(importBackup({ file, version: 4 }, server.api, () => {})).rejects.toThrow(
      'Archive checksum failed: content/media/corrupt.bin',
    );
    expect(server.api.mock.calls.some(([route]) => /corrupt|review/.test(route))).toBe(false);
    // Drain the already scheduled fixture requests before the test releases its environment.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('refuses a truncated gzip ending before restore review', async () => {
    const good = await archive(settings);
    const file = new File([good.slice(0, -4)], 'truncated.tar.gz');
    const server = backend();
    await expect(importBackup({ file, version: 4 }, server.api, () => {})).rejects.toThrow();
    expect(server.api.mock.calls.some(([route]) => route === 'backups/import/review')).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('stops admission on a failed request and never reports completion', async () => {
    const file = await archive([
      ...settings,
      ...Array.from({ length: 20 }, (_, i) => ({
        path: `content/media/${i}.bin`,
        data: Buffer.alloc(16, i),
      })),
    ]);
    const server = backend({ fail: 'site.json' }),
      progress = reporter();
    await expect(importBackup({ file, version: 4 }, server.api, progress.report)).rejects.toThrow(
      'Upload rejected',
    );
    expect(
      server.api.mock.calls.filter(([, method]) => method === 'PUT').length,
    ).toBeLessThanOrEqual(3);
    expect(progress.updates.some((update) => update.stage === 'ready')).toBe(false);
    expect(server.api.mock.calls.some(([route]) => route === 'backups/import/review')).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
