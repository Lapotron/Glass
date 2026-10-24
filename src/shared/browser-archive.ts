/** Streaming USTAR/PAX codec. No Node adapters, whole-archive buffers or path extraction. */
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
export function tarHeader(name: string, size: number, type = '0') {
  const header = new Uint8Array(512),
    text = (at: number, length: number, value: string) =>
      header.set(encoder.encode(value).slice(0, length), at),
    octal = (at: number, length: number, value: number) =>
      text(at, length, value.toString(8).padStart(length - 1, '0') + '\0');
  text(0, 100, name);
  octal(100, 8, 384);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, 0);
  text(148, 8, '        ');
  text(156, 1, type);
  text(257, 6, 'ustar\0');
  text(263, 2, '00');
  const checksum = header.reduce((a, b) => a + b, 0);
  text(148, 8, checksum.toString(8).padStart(6, '0') + '\0 ');
  return header;
}
function paxPath(path: string) {
  const value = ' path=' + path + '\n';
  let length = encoder.encode(value).length + 1;
  for (;;) {
    const next = encoder.encode(String(length) + value).length;
    if (next === length) return encoder.encode(String(length) + value);
    length = next;
  }
}
export async function* tarFile(name: string, size: number, stream: ReadableStream<Uint8Array>) {
  if (encoder.encode(name).length > 99) {
    const pax = paxPath(name);
    yield tarHeader('PaxHeader', pax.length, 'x');
    yield pax;
    yield new Uint8Array((512 - (pax.length % 512)) % 512);
    name = 'file';
  }
  yield tarHeader(name, size);
  const reader = stream.getReader();
  let read = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      read += next.value.length;
      if (read > size) throw new Error('Archive file exceeds its manifest length.');
      yield next.value;
    }
    if (read !== size) throw new Error('Archive file is incomplete.');
  } finally {
    reader.releaseLock();
  }
  yield new Uint8Array((512 - (size % 512)) % 512);
}
export function iteratorStream(source: AsyncGenerator<Uint8Array>) {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await source.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await source.return(undefined);
    },
  });
}
export class ArchiveReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  total = 0;
  private ended = false;
  constructor(
    stream: ReadableStream<Uint8Array>,
    readonly limit = 8 * 1024 ** 3 + 64 * 1024 ** 2,
  ) {
    this.reader = stream.getReader();
  }
  async take(length: number) {
    if (!length) return new Uint8Array();
    if (this.offset === this.chunk.length) {
      const next = await this.reader.read();
      if (next.done) throw new Error('Archive is incomplete.');
      this.chunk = next.value;
      this.offset = 0;
    }
    const output = this.chunk.subarray(this.offset, this.offset + length);
    this.offset += output.length;
    this.total += output.length;
    if (this.total > this.limit) throw new Error('Archive exceeds the expanded size limit.');
    return output;
  }
  async bytes(length: number) {
    if (length > 16 * 1024 ** 2) throw new Error('Archive metadata exceeds 16 MiB.');
    const result = new Uint8Array(length);
    for (let offset = 0; offset < length;) {
      const chunk = await this.take(length - offset);
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
  async header(depth = 0): Promise<{ name: string; size: number } | null> {
    if (this.ended) return null;
    const bytes = await this.bytes(512);
    if (bytes.every((byte) => !byte)) {
      if (!(await this.bytes(512)).every((byte) => !byte))
        throw new Error('Invalid archive end marker.');
      let padding = 0;
      for (;;) {
        const tail = this.chunk.subarray(this.offset);
        if (tail.some((byte) => byte !== 0))
          throw new Error('Archive has unexpected trailing data.');
        padding += tail.length;
        if (padding > 65536) throw new Error('Archive has excessive trailing padding.');
        const next = await this.reader.read();
        if (next.done) break;
        this.chunk = next.value;
        this.offset = 0;
      }
      this.ended = true;
      return null;
    }
    const string = (at: number, length: number) =>
        decoder.decode(bytes.slice(at, at + length)).replace(/\0.*$/s, ''),
      size = parseInt(string(124, 12).trim(), 8),
      expected = parseInt(string(148, 8).trim(), 8);
    if (
      bytes.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0) !==
        expected ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > 4 * 1024 ** 3
    )
      throw new Error('Invalid archive header.');
    const type = string(156, 1),
      name = [string(345, 155), string(0, 100)].filter(Boolean).join('/');
    if (type === 'x') {
      if (depth > 1) throw new Error('Archive has too many nested PAX records.');
      const pax = decoder.decode(await this.bytes(size));
      await this.bytes((512 - (size % 512)) % 512);
      const match = /(?:^|\n)\d+ path=([^\n]+)\n/.exec(pax),
        next = await this.header(depth + 1);
      if (!match || !next) throw new Error('Unsupported PAX record.');
      return { ...next, name: match[1] };
    }
    if (type && type !== '0')
      throw new Error('Archive links, directories and special files are not allowed.');
    return { name, size };
  }
  async padding(size: number) {
    await this.bytes((512 - (size % 512)) % 512);
  }
  async close() {
    await this.reader.cancel();
  }
}
