import { expect, it } from 'vitest';
import {
  ArchiveReader,
  iteratorStream,
  tarFile,
  tarHeader,
} from '../src/shared/browser-archive.js';

const encode = (value: string) => new TextEncoder().encode(value);
async function archive(name: string, value: Uint8Array) {
  return new Uint8Array(
    await new Response(
      iteratorStream(
        (async function* () {
          yield* tarFile(name, value.length, new Blob([new Uint8Array(value)]).stream());
          yield new Uint8Array(1024);
        })(),
      ),
    ).arrayBuffer(),
  );
}
function fragmented(bytes: Uint8Array) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      const end = Math.min(bytes.length, offset + 37);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}
it('round-trips long Unicode media names through fragmented PAX streams', async () => {
  const name = 'data/media/' + '研究图像'.repeat(20) + '.png',
    value = encode('exact portable bytes');
  const reader = new ArchiveReader(fragmented(await archive(name, value)));
  const header = await reader.header();
  expect(header).toEqual({ name, size: value.length });
  expect(await reader.bytes(header!.size)).toEqual(value);
  await reader.padding(header!.size);
  expect(await reader.header()).toBeNull();
  await reader.close();
});
it('rejects truncated bodies, damaged headers and nonzero trailing data', async () => {
  const data = await archive('data/media/image.png', encode('complete body'));
  const damaged = data.slice();
  damaged[0] ^= 1;
  await expect(new ArchiveReader(fragmented(damaged)).header()).rejects.toThrow('header');
  const short = new ArchiveReader(fragmented(data.slice(0, 517)));
  const header = await short.header();
  await expect(short.bytes(header!.size)).rejects.toThrow('incomplete');
  const trailing = new Uint8Array(data.length + 1);
  trailing.set(data);
  trailing[data.length] = 1;
  const reader = new ArchiveReader(fragmented(trailing));
  const first = await reader.header();
  await reader.bytes(first!.size);
  await reader.padding(first!.size);
  await expect(reader.header()).rejects.toThrow('trailing');
});
it('refuses links and oversized payloads before reading their bodies', async () => {
  await expect(
    new ArchiveReader(new Blob([tarHeader('link', 0, '2')]).stream()).header(),
  ).rejects.toThrow('special files');
  await expect(
    new ArchiveReader(new Blob([tarHeader('huge', 4 * 1024 ** 3 + 1)]).stream()).header(),
  ).rejects.toThrow('header');
});
it('checks streaming gzip trailers rather than accepting a valid tar prefix', async () => {
  const data = await archive('data/media/file.txt', encode('portable file'));
  const compressed = new Uint8Array(
    await new Response(
      new Blob([data]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );
  compressed[compressed.length - 5] ^= 1;
  const reader = new ArchiveReader(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
  );
  await expect(
    (async () => {
      for (;;) {
        const file = await reader.header();
        if (!file) break;
        await reader.bytes(file.size);
        await reader.padding(file.size);
      }
    })(),
  ).rejects.toThrow();
});
