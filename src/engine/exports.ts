import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { Store, digest } from './store.js';
import { BackupService, backupArchiveName } from './backup.js';
import { selectedItemsSchema } from '../shared/operations.js';
import { OperationConflict } from './operations.js';
import { MediaService } from './media.js';
type ExportFile = { name: string; bytes: Buffer };
function tarHeader(name: string, size: number) {
  const header = Buffer.alloc(512);
  // PAX carries Unicode and long canonical filenames without lossy truncation.
  const write = (value: string, start: number, length: number) =>
    header.write(value, start, length, 'ascii');
  write(name, 0, 100);
  write('0000600\0', 100, 8);
  write('0000000\0', 108, 8);
  write('0000000\0', 116, 8);
  write(size.toString(8).padStart(11, '0') + '\0', 124, 12);
  write('00000000000\0', 136, 12);
  header.fill(32, 148, 156);
  write('0', 156, 1);
  write('ustar\0', 257, 6);
  write('00', 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return header;
}
function paxPath(name: string) {
  const value = ' path=' + name + '\n';
  let length = Buffer.byteLength(value) + 1;
  while (Buffer.byteLength(String(length)) + Buffer.byteLength(value) !== length)
    length = Buffer.byteLength(String(length)) + Buffer.byteLength(value);
  return Buffer.from(length + value);
}
async function* tar(files: AsyncIterable<ExportFile>) {
  let index = 0;
  for await (const file of files) {
    const pax = paxPath(file.name),
      header = tarHeader('pax-' + index, pax.length);
    header[156] = 120;
    header.fill(32, 148, 156);
    header.write(
      header
        .reduce((sum, byte) => sum + byte, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
      148,
      8,
      'ascii',
    );
    yield header;
    yield pax;
    yield Buffer.alloc((512 - (pax.length % 512)) % 512);
    yield tarHeader('entry-' + index++, file.bytes.length);
    yield file.bytes;
    yield Buffer.alloc((512 - (file.bytes.length % 512)) % 512);
  }
  yield Buffer.alloc(1024);
}
export class Exports {
  private tickets = new Map<string, { file: string; name: string; expires: number }>();
  constructor(
    readonly store: Store,
    readonly backups: BackupService,
  ) {}
  discardTickets() {
    this.tickets.clear();
  }
  async initialize() {
    await fs.rm(path.join(this.store.root, '.studio/exports'), { recursive: true, force: true });
  }
  async prepare(kind: 'content' | 'backups' | 'media', request: unknown) {
    const selected = selectedItemsSchema.parse(request);
    return this.store.exclusive(async () => {
      const model = await this.store.read(),
        backups = kind === 'backups' ? await this.backups.list() : [];
      const media = kind === 'media' ? await new MediaService(this.store).list() : [];
      const available =
        kind === 'content'
          ? model.entries
          : kind === 'backups'
            ? backups
            : media.map((file) => ({ id: file.url, revision: file.revision }));
      const issues = selected
        .filter(
          (item) =>
            !available.some((entry) => entry.id === item.id && entry.revision === item.revision),
        )
        .map((item) => ({
          id: item.id,
          message: item.id + ' changed. Refresh the selection before exporting.',
        }));
      if (issues.length) throw new OperationConflict(issues);
      if (
        kind === 'backups' &&
        selected.reduce(
          (sum, item) => sum + (backups.find((backup) => backup.id === item.id)?.bytes || 0),
          0,
        ) >
          512 * 1024 ** 2
      )
        throw new Error('Combined downloads support 512 MiB. Download large backups individually.');
      const files = async function* (service: Exports) {
        let total = 0;
        for (const item of selected) {
          const entry = model.entries.find((entry) => entry.id === item.id);
          const asset = media.find((file) => file.url === item.id);
          const bytes =
            kind === 'backups'
              ? await service.backups.download(item.id)
              : kind === 'media'
                ? await fs.readFile(path.join(service.store.content, 'media', asset!.name))
                : await fs.readFile(path.join(service.store.content, entry!.kind, entry!.file));
          if (kind === 'content' && digest(bytes) !== item.revision)
            throw new Error('An entry changed during export. Try again.');
          total += bytes.length;
          if (total > 512 * 1024 * 1024)
            throw new Error('Export up to 512 MiB at once. Choose fewer files.');
          yield {
            name:
              kind === 'backups'
                ? 'backups/glass-' +
                  backupArchiveName(backups.find((backup) => backup.id === item.id)!)
                : kind === 'media'
                  ? 'media/' + asset!.name
                  : entry!.kind + '/' + entry!.file,
            bytes,
          };
        }
      };
      return this.archive(files(this), 'glass-' + kind + '.tar.gz');
    });
  }
  /** Call inside the Store queue, after validating the captured selection. */
  async archive(files: AsyncIterable<ExportFile>, name: string) {
    for (const [id, ticket] of this.tickets)
      if (ticket.expires <= Date.now()) {
        this.tickets.delete(id);
        await fs.rm(ticket.file, { force: true });
      }
    if (this.tickets.size >= 5)
      throw new Error('Finish an existing download, or retry after five minutes.');
    const id = randomUUID(),
      directory = path.join(this.store.root, '.studio/exports');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, id + '.tar.gz');
    try {
      await pipeline(
        Readable.from(tar(files)),
        createGzip(),
        createWriteStream(file, { flags: 'wx', mode: 0o600 }),
      );
    } catch (error) {
      await fs.rm(file, { force: true });
      throw error;
    }
    this.tickets.set(id, { file, name, expires: Date.now() + 5 * 60000 });
    return { url: '/api/exports/' + id };
  }
  download(id: string) {
    const ticket = this.tickets.get(id);
    if (!ticket || ticket.expires < Date.now())
      throw new Error('This download expired. Prepare it again.');
    return { ...ticket, stream: createReadStream(ticket.file) };
  }
  async release(id: string) {
    const ticket = this.tickets.get(id);
    if (!ticket) return;
    this.tickets.delete(id);
    await fs.rm(ticket.file, { force: true });
  }
}
