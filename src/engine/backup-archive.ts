import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import path from 'node:path';
import { pack, extract } from 'tar-stream';
import { z } from 'zod';
import { backupLocations, backupPath, backupTarget } from './backup-paths.js';
import { LARGE_BACKUP_BYTES, LARGE_BACKUP_EXPANDED_BYTES } from '../shared/backup-transfer.js';

export const largeBackupManifestSchema = z
  .object({
    format: z.literal('fieldnotes-notebook'),
    version: z.literal(3),
    createdAt: z.iso.datetime(),
    files: z
      .array(
        z
          .object({
            path: z.string().max(2048).refine(backupPath, 'Invalid backup path'),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().min(0).max(LARGE_BACKUP_BYTES),
          })
          .strict(),
      )
      .min(2)
      .max(20000),
  })
  .strict();
export type LargeBackupManifest = z.infer<typeof largeBackupManifestSchema>;
export type BackupFileIndex = LargeBackupManifest['files'];
export const backupRevision = (files: { path: string; sha256: string }[]) =>
  createHash('sha256')
    .update(
      files
        .map((file) => `${file.path}:${file.sha256}`)
        .sort()
        .join('\n'),
    )
    .digest('hex');

export async function hashBackupFile(file: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function requireSpace(directory: string, bytes: number) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const disk = await fs.statfs(directory, { bigint: true });
  if (disk.bavail * disk.bsize < BigInt(Math.ceil(bytes + 64 * 1024 ** 2)))
    throw new Error(
      'There is not enough free disk space to safely stage this backup. Keep the original archive and free space before retrying.',
    );
}
export async function indexBackupFiles(root: string): Promise<BackupFileIndex> {
  const files: BackupFileIndex = [];
  let total = 0;
  async function walk(disk: string, prefix: string) {
    const stat = await fs.lstat(disk).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error('Backups cannot include symbolic links: ' + prefix);
    if (stat.isDirectory()) {
      const children = await fs.readdir(disk);
      for (const child of children.sort())
        if (!child.startsWith('.')) await walk(path.join(disk, child), prefix + '/' + child);
      return;
    }
    if (!stat.isFile() || !backupPath(prefix))
      throw new Error('This file is outside portable notebook data: ' + prefix);
    total += stat.size;
    if (
      files.length >= 20000 ||
      stat.size > LARGE_BACKUP_BYTES ||
      total > LARGE_BACKUP_EXPANDED_BYTES
    )
      throw new Error(
        'Large backups support 20,000 files, 4 GiB per file and 8 GiB of notebook data.',
      );
    const sha256 = await hashBackupFile(disk);
    const after = await fs.lstat(disk);
    if (after.isSymbolicLink() || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
      throw new Error('The notebook changed during backup. Wait for saves and try again.');
    files.push({ path: prefix, sha256, bytes: stat.size });
  }
  for (const location of backupLocations)
    await walk(path.join(root, location.disk), location.archive);
  return files;
}
function bounded(limit: number, message: string) {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > limit ? new Error(message) : null, chunk);
    },
  });
}
export async function createLargeBackup(root: string, destination: string, files: BackupFileIndex) {
  const manifest = largeBackupManifestSchema.parse({
    format: 'fieldnotes-notebook',
    version: 3,
    createdAt: new Date().toISOString(),
    files,
  });
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (total > LARGE_BACKUP_EXPANDED_BYTES) throw new Error('The expanded backup exceeds 8 GiB.');
  await requireSpace(
    path.dirname(destination),
    Math.min(LARGE_BACKUP_BYTES, total * 1.01 + 8 * 1024 ** 2) * 2,
  );
  const output = pack();
  const writing = pipeline(
    output,
    createGzip({ level: 1 }),
    bounded(LARGE_BACKUP_BYTES, 'The compressed backup exceeds 4 GiB.'),
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  );
  // Observe an early disk/stream failure while each entry is being produced.
  void writing.catch(() => {});
  try {
    await new Promise<void>((resolve, reject) =>
      output.entry({ name: 'manifest.json', mode: 0o600 }, JSON.stringify(manifest), (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    for (const file of files) {
      const source = backupTarget(root, file.path);
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes)
        throw new Error('A notebook file changed during backup.');
      const hash = createHash('sha256');
      const measure = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        createReadStream(source),
        measure,
        output.entry({ name: 'data/' + file.path, size: file.bytes, mode: 0o600 }),
      );
      if (hash.digest('hex') !== file.sha256)
        throw new Error('A notebook file changed during backup: ' + file.path);
    }
    output.finalize();
    await writing;
    if (backupRevision(await indexBackupFiles(root)) !== backupRevision(files))
      throw new Error('The notebook changed during backup. Try again after saves finish.');
    return manifest;
  } catch (error) {
    output.destroy(error as Error);
    await writing.catch(() => {});
    await fs.rm(destination, { force: true });
    throw error;
  }
}

export async function extractLargeBackup(
  archive: string,
  root: string,
): Promise<LargeBackupManifest> {
  if ((await fs.stat(archive)).size > LARGE_BACKUP_BYTES)
    throw new Error('Backup exceeds the 4 GiB compressed limit.');
  const reader = extract();
  const writing = pipeline(
    createReadStream(archive),
    createGunzip(),
    bounded(LARGE_BACKUP_EXPANDED_BYTES + 64 * 1024 ** 2, 'The expanded backup exceeds 8 GiB.'),
    reader,
  );
  void writing.catch(() => {});
  let manifest: LargeBackupManifest | undefined;
  const seen = new Set<string>();
  let expected = new Map<string, BackupFileIndex[number]>();
  try {
    for await (const entry of reader) {
      const header = entry.header;
      if (header.type !== 'file' || header.linkname)
        throw new Error('Backup archives may contain regular files only.');
      if (!manifest) {
        if (header.name !== 'manifest.json' || header.size > 8 * 1024 ** 2)
          throw new Error('The backup must begin with its bounded manifest.json.');
        const chunks: Buffer[] = [];
        for await (const chunk of entry) chunks.push(Buffer.from(chunk as Uint8Array));
        manifest = largeBackupManifestSchema.parse(
          JSON.parse(Buffer.concat(chunks).toString('utf8')),
        );
        expected = new Map(manifest.files.map((file) => [file.path, file]));
        if (expected.size !== manifest.files.length) throw new Error('Duplicate backup path.');
        const expanded = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
        if (expanded > LARGE_BACKUP_EXPANDED_BYTES)
          throw new Error('The expanded backup exceeds 8 GiB.');
        await requireSpace(root, expanded);
        continue;
      }
      const name = header.name.startsWith('data/') ? header.name.slice(5) : '';
      const file = expected.get(name);
      if (!file || !backupPath(name) || seen.has(name) || file.bytes !== header.size)
        throw new Error('Unexpected, duplicate or invalid backup member: ' + header.name);
      seen.add(name);
      const destination = backupTarget(root, name);
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const hash = createHash('sha256');
      let bytes = 0;
      const measure = new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          hash.update(chunk);
          callback(
            bytes > file.bytes ? new Error('A backup member exceeds its declared size.') : null,
            chunk,
          );
        },
      });
      await pipeline(entry, measure, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
      if (bytes !== file.bytes || hash.digest('hex') !== file.sha256)
        throw new Error('Backup checksum does not match: ' + name);
    }
    await writing;
    if (!manifest || seen.size !== expected.size)
      throw new Error('The archive is missing notebook files.');
    return manifest;
  } catch (error) {
    reader.destroy(error as Error);
    await writing.catch(() => {});
    throw error;
  }
}

export async function legacyBackupFile(file: string): Promise<boolean> {
  const source = createReadStream(file);
  const unzip = createGunzip();
  source.on('error', (error) => unzip.destroy(error));
  source.pipe(unzip);
  try {
    for await (const chunk of unzip) {
      const first = Buffer.from(chunk).toString('utf8').trimStart()[0];
      if (first) return first === '{';
    }
    throw new Error('Empty backup archive.');
  } finally {
    source.destroy();
    unzip.destroy();
  }
}
