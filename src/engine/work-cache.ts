import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const workCounters: Record<string, number> = {};
export function countWork(name: string, amount = 1) {
  workCounters[name] = (workCounters[name] || 0) + amount;
}
export function resetWorkCounters() {
  for (const key of Object.keys(workCounters)) delete workCounters[key];
}

export async function mapConcurrent<T, R>(
  values: readonly T[],
  limit: number,
  work: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('Concurrency must be a positive integer.');
  const output = new Array<R>(values.length);
  let next = 0,
    failed = false;
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (!failed) {
        const index = next++;
        if (index >= values.length) return;
        try {
          output[index] = await work(values[index], index);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return output;
}

type Artifact<T> = { value: T; files: Record<string, Buffer> };
type Manifest<T> = { key: string; value: T; files: Record<string, string>; checksum: string };

/** Disposable, private, verified artifacts. A complete directory is installed atomically. */
export class ArtifactCache<T> {
  private pending = new Map<string, Promise<Artifact<T>>>();
  private used = new Map<string, number>();
  private writes = 0;
  private pruning?: Promise<void>;
  private diskIndex?: Map<string, { folder: string; bytes: number; used: number }>;
  private indexedAt = 0;
  constructor(
    readonly folder: string,
    readonly limit = 4 * 1024 ** 3,
  ) {}
  touch(key: string) {
    this.used.set(key, Date.now());
  }
  resetIndex() {
    this.diskIndex = undefined;
    this.indexedAt = 0;
    this.used.clear();
  }
  async get(key: string, generate: () => Promise<Artifact<T>>): Promise<Artifact<T>> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid work cache key.');
    this.touch(key);
    const active = this.pending.get(key);
    if (active) return active;
    const promise = this.load(key, generate);
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }
  private async load(key: string, generate: () => Promise<Artifact<T>>) {
    const folder = path.join(this.folder, key);
    try {
      const manifestPath = path.join(folder, 'manifest.json');
      if ((await fs.lstat(folder)).isSymbolicLink()) throw new Error('Linked cache.');
      const record = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Manifest<T>;
      if (
        record.key !== key ||
        record.checksum !== hash(JSON.stringify([record.value, record.files]))
      )
        throw new Error('Invalid work cache.');
      const files: Record<string, Buffer> = {};
      for (const [name, checksum] of Object.entries(record.files)) {
        if (!/^[\w.-]+$/.test(name) || name === 'manifest.json')
          throw new Error('Invalid cache file.');
        const file = path.join(folder, name);
        if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Linked cache file.');
        files[name] = await fs.readFile(file);
        if (hash(files[name]) !== checksum) throw new Error('Corrupt work cache.');
      }
      countWork('artifact.hit');
      return { value: record.value, files };
    } catch {
      /* A disposable cache never overrides canonical source. */
    }
    const generation = async () => {
      try {
        const stat = await fs.lstat(this.folder);
        return stat.isDirectory() && !stat.isSymbolicLink()
          ? `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
          : undefined;
      } catch {
        return undefined;
      }
    };
    await fs.mkdir(this.folder, { recursive: true }).catch(() => {});
    const startedIn = await generation();
    const artifact = await generate();
    countWork('artifact.miss');
    if (Object.values(artifact.files).reduce((sum, bytes) => sum + bytes.length, 0) > this.limit)
      return artifact;
    if (!startedIn || startedIn !== (await generation())) return artifact;
    const temporary = path.join(this.folder, `.pending-${randomUUID()}`);
    try {
      await fs.mkdir(temporary);
      const files: Record<string, string> = {};
      for (const [name, bytes] of Object.entries(artifact.files)) {
        if (!/^[\w.-]+$/.test(name) || name === 'manifest.json')
          throw new Error('Invalid generated cache file.');
        files[name] = hash(bytes);
        await fs.writeFile(path.join(temporary, name), bytes);
      }
      const record: Manifest<T> = {
        key,
        value: artifact.value,
        files,
        checksum: hash(JSON.stringify([artifact.value, files])),
      };
      const manifest = JSON.stringify(record);
      await fs.writeFile(path.join(temporary, 'manifest.json'), manifest);
      if (startedIn !== (await generation())) return artifact;
      await fs.rm(folder, { recursive: true, force: true });
      await fs.rename(temporary, folder);
      this.diskIndex?.set(key, {
        folder,
        bytes:
          Buffer.byteLength(manifest) +
          Object.values(artifact.files).reduce((sum, bytes) => sum + bytes.length, 0),
        used: this.used.get(key) || Date.now(),
      });
      if (++this.writes % 64 === 0) await this.prune().catch(() => {});
    } catch {
      /* Read-only/full caches still permit a valid uncached build. */
    } finally {
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
    return artifact;
  }
  prune(): Promise<void> {
    if (this.pruning) return this.pruning;
    this.pruning = this.pruneEntries().finally(() => {
      this.pruning = undefined;
    });
    return this.pruning;
  }
  private async pruneEntries() {
    if (!this.diskIndex || !this.indexedAt || Date.now() - this.indexedAt > 60_000) {
      this.diskIndex ||= new Map();
      const before = new Map(this.diskIndex);
      const names = await fs.readdir(this.folder).catch(() => [] as string[]);
      const records = await mapConcurrent(
        names.filter((name) => /^[a-f0-9]{64}$/.test(name)),
        16,
        async (name) => {
          const folder = path.join(this.folder, name);
          try {
            const entries = await fs.readdir(folder);
            let bytes = 0;
            for (const entry of entries) bytes += (await fs.lstat(path.join(folder, entry))).size;
            const manifest = path.join(folder, 'manifest.json');
            return {
              folder,
              bytes,
              used: (await fs.stat(manifest)).mtimeMs,
            };
          } catch {
            return { folder, bytes: 0, used: 0 };
          }
        },
      );
      const merged = new Map(records.map((record) => [path.basename(record.folder), record]));
      for (const [key, value] of this.diskIndex)
        if (value !== before.get(key)) merged.set(key, value);
      this.diskIndex = merged;
      this.indexedAt = Date.now();
    }
    const touched = [...this.used];
    await mapConcurrent(touched, 16, async ([key, used]) => {
      const record = this.diskIndex!.get(key);
      if (record) {
        record.used = Math.max(record.used, used);
        await fs
          .utimes(path.join(record.folder, 'manifest.json'), new Date(used), new Date(used))
          .catch(() => {});
      }
      if (this.used.get(key) === used) this.used.delete(key);
    });
    const records = [...this.diskIndex.values()].sort((a, b) => b.used - a.used);
    let bytes = 0;
    for (const record of records) {
      bytes += record.bytes;
      if (bytes > this.limit && !this.pending.has(path.basename(record.folder))) {
        await fs.rm(record.folder, { recursive: true, force: true }).catch(() => {});
        this.diskIndex.delete(path.basename(record.folder));
      }
    }
  }
}

/** Content rendering adds a byte-bounded memory LRU in front of the verified disk cache. */
export class RenderCache<T> {
  private memory = new Map<string, { text: string; bytes: number }>();
  private bytes = 0;
  private generation = '';
  readonly disk: ArtifactCache<null>;
  constructor(
    folder: string,
    readonly memoryLimit = 64 * 1024 ** 2,
  ) {
    this.disk = new ArtifactCache(folder, 256 * 1024 ** 2);
  }
  async sync() {
    await fs.mkdir(this.disk.folder, { recursive: true });
    const stat = await fs.stat(this.disk.folder);
    const generation = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    if (this.generation !== generation) {
      this.disk.resetIndex();
      this.memory.clear();
      this.bytes = 0;
      this.generation = generation;
    }
  }
  async get(key: string, generate: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    const cached = this.memory.get(key);
    if (cached) {
      this.disk.touch(key);
      this.memory.delete(key);
      this.memory.set(key, cached);
      countWork('markdown.hit');
      return JSON.parse(cached.text) as T;
    }
    const artifact = await this.disk.get(key, async () => ({
      value: null,
      files: { 'result.json': Buffer.from(JSON.stringify(await generate())) },
    }));
    const text = artifact.files['result.json'].toString();
    const bytes = Buffer.byteLength(text);
    const value = JSON.parse(text) as T;
    if (bytes <= this.memoryLimit && this.generation === generation) {
      this.bytes -= this.memory.get(key)?.bytes || 0;
      this.memory.set(key, { text, bytes });
      this.bytes += bytes;
      while (this.bytes > this.memoryLimit) {
        const oldest = this.memory.keys().next().value!;
        this.bytes -= this.memory.get(oldest)!.bytes;
        this.memory.delete(oldest);
      }
    }
    return value;
  }
}
