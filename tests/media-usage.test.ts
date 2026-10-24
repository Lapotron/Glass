import { beforeEach, afterEach, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/engine/store.js';
import { BackupService } from '../src/engine/backup.js';
import { MediaService } from '../src/engine/media.js';
import { MediaMaintenance, markdownMediaLocations } from '../src/engine/media-maintenance.js';
import { Operations } from '../src/engine/operations.js';
import { photoAlbumSchema } from '../src/shared/contracts.js';
import { missingMediaReferences, type MediaUsage } from '../src/shared/operations.js';
let root: string, store: Store, maintenance: MediaMaintenance;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-media-usage-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  maintenance = new MediaMaintenance(
    store,
    new MediaService(store),
    new BackupService(store),
    () => true,
  );
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('records exact Markdown body lines and roles while excluding code examples and unused definitions', () => {
  const locations = markdownMediaLocations(
    '# Media\n\n![First](/media/wave.svg)\n\n![Second][photo]\n\n[photo]: /media/wave.svg\n\n```md\n![Code](/media/code.svg)\n```\n\n:::image-compare{before="/media/wave.svg" after="/media/alpine.svg"}\n:::\n\n[unused]: /media/unused.svg\n',
  );
  expect(locations).toEqual([
    { url: '/media/wave.svg', line: 3, field: 'Markdown image' },
    { url: '/media/wave.svg', line: 5, field: 'Referenced image' },
    { url: '/media/wave.svg', line: 13, field: 'image-compare.before' },
    { url: '/media/alpine.svg', line: 13, field: 'image-compare.after' },
  ]);
});
it('identifies draft covers, sharing images and Markdown references independently of the public build', async () => {
  const entry = await store.create('posts', 'Usage draft', 'usage-draft');
  await store.saveEntry(entry.id, {
    metadata: { ...entry, cover: '/media/wave.svg', seo: { image: '/media/wave.svg' } },
    body: '# Draft\n\n![A wave](/media/wave.svg)\n\n![Again](/media/wave.svg)\n',
    revision: entry.revision,
  });
  const item = (await maintenance.audit()).items.find((item) => item.url === '/media/wave.svg')!;
  const references = item.references!.filter((reference) => reference.entryId === entry.id);
  expect(references).toHaveLength(4);
  expect(
    references.every(
      (reference) =>
        reference.status === 'draft' &&
        !reference.href &&
        reference.source === `content/posts/${entry.file}`,
    ),
  ).toBe(true);
  expect(references.map((reference) => reference.field)).toEqual([
    'Cover image',
    'Sharing image',
    'Markdown image',
    'Markdown image',
  ]);
  expect(
    references.filter((reference) => reference.line).map((reference) => reference.line),
  ).toEqual([3, 5]);
  expect(item.active).toContain('Usage draft');
  await expect(maintenance.review([item.url])).rejects.toThrow('Only unused');
});
it('names individual photo, album, About and site-settings locations rather than generic collection labels', async () => {
  let model = await store.snapshot();
  await store.saveJson(
    'site',
    { ...model.site, theme: { ...model.site.theme, backgroundImage: '/media/coast-dawn.svg' } },
    model.siteRevision,
  );
  model = await store.snapshot();
  await store.saveJson(
    'library',
    {
      ...model.library,
      albums: [
        photoAlbumSchema.parse({
          id: 'coast-album',
          name: model.library.photos[0].album,
          slug: 'coast',
          cover: '/media/coast-dawn.svg',
        }),
      ],
    },
    model.libraryRevision,
  );
  await store.saveAbout('A story.\n\n![Dawn](/media/coast-dawn.svg)\n', model.about.revision);
  const references = (await maintenance.audit()).items.find(
    (item) => item.url === '/media/coast-dawn.svg',
  )!.references!;
  expect(references).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: 'Background picture',
        kind: 'setting',
        field: 'theme.backgroundImage',
        view: 'appearance',
      }),
      expect.objectContaining({
        title: model.library.photos[0].caption,
        kind: 'photo',
        field: 'photos[0].src',
        context: 'Album: ' + model.library.photos[0].album,
      }),
      expect.objectContaining({
        kind: 'album',
        field: 'albums[0].cover',
        source: 'content/library.json',
      }),
      expect.objectContaining({ kind: 'about', line: 3, source: 'content/about.md' }),
    ]),
  );
});
it('separates Trash, photo Trash, article revisions, About history and collection Undo from current uses', async () => {
  const entry = await store.create('posts', 'Retained usage', 'retained-usage');
  const saved = await store.saveEntry(entry.id, {
    metadata: entry,
    body: '![Private history](/media/coast-dawn.svg)',
    revision: entry.revision,
  });
  await store.saveEntry(saved.id, {
    metadata: saved,
    body: '![Current](/media/coast-dawn.svg)',
    revision: saved.revision,
  });
  const latest = (await store.snapshot()).entries.find((item) => item.id === entry.id)!;
  await new Operations(store).content({
    action: 'trash',
    items: [{ id: latest.id, revision: latest.revision }],
  });
  const model = await store.snapshot();
  await new Operations(store).photos({
    action: 'remove',
    ids: [model.library.photos[0].id],
    revision: model.libraryRevision,
  });
  const about = await store.saveAbout('![Previous](/media/coast-dawn.svg)', model.about.revision);
  await store.saveAbout('Current About.', about.revision);
  const item = (await maintenance.audit()).items.find(
    (item) => item.url === '/media/coast-dawn.svg',
  )!;
  for (const kind of ['trash', 'photo-trash', 'revision', 'collection-history', 'about-history'])
    expect(
      item.references?.some(
        (reference) => reference.kind === kind && reference.scope === 'history',
      ),
      kind,
    ).toBe(true);
  expect(
    item.references
      ?.filter((reference) => reference.scope === 'history')
      .every((reference) => !reference.href && !reference.entryId),
  ).toBe(true);
  await expect(maintenance.review([item.url])).rejects.toThrow('Only unused');
});
it('bounds detailed usage output while keeping all media protected', async () => {
  const entry = await store.create('posts', 'Many uses', 'many-uses');
  await store.saveEntry(entry.id, {
    metadata: entry,
    body: Array.from({ length: 350 }, (_, i) => `![Wave ${i}](/media/wave.svg)`).join('\n\n'),
    revision: entry.revision,
  });
  const item = (await maintenance.audit()).items.find((item) => item.url === '/media/wave.svg')!;
  expect(item.references).toHaveLength(300);
  expect(item.referencesTruncated).toBe(true);
  expect(item.active).toContain('Many uses');
});
it('separates missing media in renamed revisions from current problems without discarding recovery protection', async () => {
  const entry = await store.create('posts', 'sample page', 'renamed-history');
  const saved = await store.saveEntry(entry.id, {
    metadata: entry,
    body: '![Dawn](/media/old-dawn.svg)\n\n![Dusk](/media/old-dusk.svg)',
    revision: entry.revision,
  });
  await store.saveEntry(saved.id, {
    metadata: { ...saved, title: 'A current article' },
    body: 'Current content has no missing images.',
    revision: saved.revision,
  });
  const audit = await maintenance.audit();
  const missing = missingMediaReferences(audit.items);
  expect(missing.current).toEqual([]);
  expect(missing.recovery.map((item) => item.url).sort()).toEqual([
    '/media/old-dawn.svg',
    '/media/old-dusk.svg',
  ]);
  for (const item of missing.recovery) {
    expect(item.active).toEqual([]);
    expect(item.history).toContain('Revision: sample page');
    expect(item.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'revision',
          scope: 'history',
          title: 'sample page',
        }),
      ]),
    );
    expect(item.references?.every((reference) => !reference.entryId && !reference.href)).toBe(true);
    expect(item.references?.every((reference) => !('currentTitle' in reference))).toBe(true);
  }
  const old = await store.getRevision(entry.id, saved.revision);
  expect(old.entry.title).toBe('sample page');
  expect(old.entry.body).toContain('/media/old-dawn.svg');
  await fs.copyFile(
    path.join(root, 'content/media/coast-dawn.svg'),
    path.join(root, 'content/media/old-dawn.svg'),
  );
  await expect(maintenance.review(['/media/old-dawn.svg'])).rejects.toThrow('Only unused');
});
it('keeps missing current draft references prominent even when history also mentions the same file', async () => {
  const entry = await store.create('posts', 'Current draft', 'missing-draft');
  const saved = await store.saveEntry(entry.id, {
    metadata: entry,
    body: '![Missing](/media/current-gap.svg)',
    revision: entry.revision,
  });
  await store.saveEntry(saved.id, {
    metadata: saved,
    body: '![Still missing](/media/current-gap.svg)',
    revision: saved.revision,
  });
  const missing = missingMediaReferences((await maintenance.audit()).items);
  expect(missing.current.map((item) => item.url)).toEqual(['/media/current-gap.svg']);
  expect(missing.recovery).toEqual([]);
  const unknown: MediaUsage = {
    url: '/media/unknown.svg',
    name: 'unknown.svg',
    bytes: 0,
    active: [],
    history: [],
    missing: true,
  };
  expect(missingMediaReferences([unknown]).current).toEqual([unknown]);
});
