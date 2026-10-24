import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/engine/store.js';
import { MediaService } from '../src/engine/media.js';
import { renderMarkdown } from '../src/engine/markdown.js';
import { buildSite } from '../src/engine/build.js';
import { createApp } from '../src/server/app.js';
import { prepareMediaDelivery } from '../src/engine/media-delivery.js';
import { attachmentFile, imageFile } from '../src/shared/attachments.js';

it('stores original attachment bytes, separates images and validates PDF/audio/video signatures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-files-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  try {
    const media = new MediaService(new Store(root));
    for (const [name, bytes, type] of [
      ['Lecture notes.pdf', Buffer.from('%PDF-1.7\nhello'), 'application/pdf'],
      ['Recording.mp3', Buffer.from('ID3\u0004\u0000\u0000sample'), 'audio/mpeg'],
      [
        'Demonstration.mp4',
        Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom0000')]),
        'video/mp4',
      ],
    ] as const) {
      const file = await media.upload(new File([bytes], name, { type }));
      expect(file.canEdit).toBe(false);
      expect(attachmentFile(file.name)).toBe(true);
      expect(imageFile(file.name)).toBe(false);
      expect(await fs.readFile(path.join(root, 'content', file.url))).toEqual(bytes);
      expect((await media.list()).some((item) => item.url === file.url)).toBe(true);
    }
    await expect(
      media.upload(new File(['plain text'], 'bad.mp3', { type: 'audio/mpeg' })),
    ).rejects.toThrow('contents');
    await expect(
      media.upload(new File(['plain text'], 'bad.pdf', { type: 'application/pdf' })),
    ).rejects.toThrow('contents');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('publishes linked attachments, excludes unreferenced files and resolves R2 delivery without changing Markdown', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-file-build-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  try {
    const store = new Store(root),
      media = new MediaService(store),
      model = await store.read();
    const pdf = await media.upload(
      new File(['%PDF-1.7\nnotes'], 'notes.pdf', { type: 'application/pdf' }),
    );
    const mp3 = await media.upload(
      new File(['ID3recording'], 'recording.mp3', { type: 'audio/mpeg' }),
    );
    const unused = await media.upload(
      new File(['private unreferenced draft'], 'unused.txt', { type: 'text/plain' }),
    );
    const entry = model.entries.find((entry) => entry.status === 'published')!;
    const source = `[Notes](${pdf.url}#page=2)\n\n[Recording][audio]\n\n[audio]: ${mp3.url}`;
    expect((await renderMarkdown(source)).media).toEqual([pdf.url + '#page=2', mp3.url]);
    entry.body = source;
    const build = await buildSite(store, { model, updateDist: false });
    expect(await fs.readFile(path.join(build.outputDir, pdf.url))).toEqual(
      Buffer.from('%PDF-1.7\nnotes'),
    );
    await expect(fs.access(path.join(build.outputDir, unused.url))).rejects.toThrow();
    model.site.mediaDelivery = {
      ...model.site.mediaDelivery,
      mode: 'r2',
      bucket: 'files',
      publicOrigin: 'https://assets.example.com',
      prefix: 'media',
    };
    const delivered = await prepareMediaDelivery(build, model.site);
    expect(delivered.media!.assets.find((asset) => asset.file.endsWith('.pdf'))?.contentType).toBe(
      'application/pdf',
    );
    expect(delivered.media!.assets.find((asset) => asset.file.endsWith('.mp3'))?.contentType).toBe(
      'audio/mpeg',
    );
    expect(entry.body).toBe(source);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);

it('serves audio/video ranges with correct MIME and rejects unsatisfiable ranges', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-file-http-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  await fs.writeFile(path.join(root, 'content/media/test.mp3'), 'ID3abcde');
  const context = await createApp(root, { watchFiles: false });
  try {
    const url = 'http://127.0.0.1/media/test.mp3';
    const response = await context.app.request(url, { headers: { Range: 'bytes=3-5' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Content-Range')).toBe('bytes 3-5/8');
    expect(await response.text()).toBe('abc');
    expect((await context.app.request(url, { headers: { Range: 'bytes=99-' } })).status).toBe(416);
  } finally {
    context.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
