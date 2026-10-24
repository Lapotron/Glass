import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { Store, digest } from '../src/engine/store.js';
import { randomUUID } from 'node:crypto';
import { commitFiles, commitNotebookResetFiles } from '../src/engine/file-transaction.js';
import { BackupService } from '../src/engine/backup.js';
import { NotebookReset } from '../src/engine/notebook-reset.js';
import { MediaService } from '../src/engine/media.js';
import { cameraPicture } from './fixtures/camera.js';
import { createApp } from '../src/server/app.js';

let root: string, store: Store, backups: BackupService, reset: NotebookReset;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-reset-test-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  backups = new BackupService(store);
  reset = new NotebookReset(store, backups, () => true);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
const commit = (review: Awaited<ReturnType<NotebookReset['review']>>) =>
  reset.commit(review.id, { sourceRevision: review.sourceRevision, confirmation: 'RESET' });

it('clears notebook data and old artifacts while preserving settings, artwork and an importable recovery copy', async () => {
  const original = await store.snapshot();
  const settings = await fs.readFile(path.join(root, 'content/site.json'));
  const secrets = 'Private connection bytes that must stay unchanged';
  await fs.mkdir(path.join(root, '.studio'), { recursive: true });
  await fs.writeFile(path.join(root, '.studio/connections.json'), secrets, { mode: 0o600 });
  await fs.writeFile(path.join(root, '.studio/launcher.json'), '{"port":4310}');
  await fs.writeFile(path.join(root, '.studio/backup-settings.json'), '{"enabled":false}');
  await backups.create();
  await store.trash(original.entries[0].id, original.entries[0].revision);
  for (const file of [
    'dist/old-secret/index.html',
    '.studio/jobs/old.json',
    '.studio/builds/old/source.json',
    '.studio/render-cache/old.svg',
    '.studio/reports/old.json',
    '.studio/search-console/imports/old.json',
    '.studio/health/history.json',
    '.studio/analytics/segments.json',
  ]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), 'Old notebook data');
  }
  const review = await reset.review();
  expect(review.counts.photos).toBe(original.library.photos.length);
  expect(review.counts.trash).toBe(1);
  expect(review.keptMedia).toContain(original.site.profile.portrait);
  expect((await store.snapshot()).library).toEqual(original.library);
  const archive = await reset.download(review.id),
    manifest = JSON.parse(gunzipSync(archive).toString('utf8'));
  expect(
    manifest.files.some((file: { path: string }) =>
      /connections|launcher|jobs|dist/.test(file.path),
    ),
  ).toBe(false);
  const result = await commit(review);
  expect(await fs.readFile(path.join(root, 'content/site.json'))).toEqual(settings);
  expect(await fs.readFile(path.join(root, '.studio/connections.json'), 'utf8')).toBe(secrets);
  expect((await fs.stat(path.join(root, '.studio/connections.json'))).mode & 0o777).toBe(0o600);
  expect(await fs.readFile(path.join(root, '.studio/launcher.json'), 'utf8')).toBe('{"port":4310}');
  const blank = await store.snapshot();
  expect(blank.entries).toEqual([]);
  expect(blank.about.body).toBe('');
  expect(blank.library).toMatchObject({ photos: [], albums: [], news: [], mediaDetails: {} });
  expect(await store.listTrash()).toEqual([]);
  expect(await backups.list()).toEqual([]);
  await expect(fs.access(path.join(root, 'dist/old-secret/index.html'))).rejects.toThrow();
  for (const file of [
    '.studio/search-console/imports/old.json',
    '.studio/health/history.json',
    '.studio/analytics/segments.json',
  ])
    await expect(fs.access(path.join(root, file))).rejects.toThrow();
  expect(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8')).not.toContain(
    'Old notebook data',
  );
  expect((await fs.readdir(path.join(root, 'content/media'))).sort()).toEqual(
    review.keptMedia.map((url) => decodeURIComponent(url.slice(7))).sort(),
  );
  expect(
    await new NotebookReset(
      new Store(root),
      new BackupService(new Store(root)),
      () => true,
    ).download(result.recovery.id),
  ).toEqual(archive);
  const restoreReview = await backups.inspect(await reset.download(result.recovery.id));
  await backups.restore(restoreReview.id, restoreReview.sourceRevision);
  expect((await store.snapshot()).library).toEqual(original.library);
});
it('retains only original variants used by settings, keeping the original editable after reset', async () => {
  const media = new MediaService(store),
    first = await media.upload(
      new File([new Uint8Array(await cameraPicture())], 'source.jpg', { type: 'image/jpeg' }),
    );
  const second = await media.variant(first.sourceId!, { resize: { width: 200, height: 200 } });
  const model = await store.snapshot();
  await store.saveJson(
    'site',
    { ...model.site, profile: { ...model.site.profile, portrait: second.url } },
    model.siteRevision,
  );
  await commit(await reset.review());
  expect(
    (await media.source(first.sourceId!)).record.variants.map((variant) => variant.name),
  ).toEqual([second.name]);
  await expect(fs.access(path.join(root, 'content/media', first.name))).rejects.toThrow();
  await expect(media.validate()).resolves.toBeUndefined();
});
it('rejects changed content, artifacts and site settings after a reset review without clearing any data', async () => {
  const review = await reset.review(),
    before = await store.snapshot();
  await fs.mkdir(path.join(root, '.studio/jobs'), { recursive: true });
  await fs.writeFile(path.join(root, '.studio/jobs/new.json'), '{}');
  await expect(commit(review)).rejects.toThrow('Nothing was reset');
  expect(await store.snapshot()).toEqual(before);
  expect(await reset.recoveries()).toEqual([]);
});
it('requires exact confirmation, rejects expired reviews and refuses active work', async () => {
  const before = await store.snapshot(),
    review = await reset.review();
  await expect(
    reset.commit(review.id, { sourceRevision: review.sourceRevision, confirmation: 'reset' }),
  ).rejects.toThrow();
  const busy = new NotebookReset(store, backups, () => false);
  await expect(busy.review()).rejects.toThrow('active build');
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(review.expiresAt) + 1);
  await expect(commit(review)).rejects.toThrow('expired');
  expect(await store.snapshot()).toEqual(before);
});
it('rolls back content, artifacts and backups if reset installation fails', async () => {
  await backups.create();
  const before = await store.snapshot(),
    review = await reset.review(),
    rename = fs.rename.bind(fs);
  let failed = false;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (!failed && String(to) === path.join(root, 'content/library.json')) {
      failed = true;
      throw new Error('Simulated reset failure');
    }
    return rename(from, to);
  });
  await expect(commit(review)).rejects.toThrow('Simulated reset failure');
  expect(await store.snapshot()).toEqual(before);
  expect(await backups.list()).toHaveLength(1);
  expect(await reset.recoveries()).toEqual([]);
  expect(reset.busy).toBe(false);
});
it('rejects symbolic links before reset and leaves their targets unchanged', async () => {
  const outside = path.join(root, 'keep.txt');
  await fs.writeFile(outside, 'Keep this.');
  await fs.symlink(outside, path.join(root, 'content/media/linked.txt'));
  await expect(reset.review()).rejects.toThrow('symbolic links');
  expect(await fs.readFile(outside, 'utf8')).toBe('Keep this.');
});
it('refuses reset preparation when its recovery archive cannot pass ordinary backup validation', async () => {
  const before = await store.snapshot(),
    folder = path.join(root, '.studio/pages/about');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, 'a'.repeat(64) + '.json'),
    JSON.stringify({ body: 'Damaged history', savedAt: new Date().toISOString() }),
  );
  await expect(reset.review()).rejects.toThrow('Damaged About revision');
  expect(await store.snapshot()).toEqual(before);
  expect(await reset.recoveries()).toEqual([]);
});
it('blocks new queued work during maintenance and resumes ordinary saves afterwards', async () => {
  let release = () => {};
  let ready = () => {};
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const pending = store.maintenance(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
        ready();
      }),
  );
  await started;
  await expect(store.snapshot()).rejects.toThrow('being reset');
  release();
  await pending;
  expect((await store.snapshot()).entries.length).toBeGreaterThan(0);
});
it('recovers an interrupted reset of public output and private page history before reading source', async () => {
  const name = '.studio/pages/about/' + 'a'.repeat(64) + '.json';
  const files = ['dist/index.html', name],
    before = ['Earlier public page', 'Earlier About history'];
  const folder = path.join(root, '.studio/operations', randomUUID());
  await fs.mkdir(folder, { recursive: true });
  for (const [index, file] of files.entries()) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), 'Interrupted reset');
    await fs.writeFile(path.join(folder, 'before-' + index), before[index]);
  }
  await fs.writeFile(
    path.join(folder, 'plan.json'),
    JSON.stringify({
      version: 2,
      state: 'applying',
      steps: files.map((file, index) => ({
        file,
        before: digest(before[index]),
        after: digest('Interrupted reset'),
      })),
    }),
  );
  await new Store(root).snapshot();
  for (const [index, file] of files.entries())
    expect(await fs.readFile(path.join(root, file), 'utf8')).toBe(before[index]);
});
it('keeps ordinary operation bounds separate from the larger reset journal', async () => {
  const changes = Array.from({ length: 10001 }, (_, index) => ({
    file: path.join(root, 'content/media', `${index}.svg`),
    value: null,
  }));
  await expect(commitFiles(root, changes)).rejects.toThrow('10,000-file');
  await expect(
    commitNotebookResetFiles(
      root,
      Array.from({ length: 50001 }, () => changes[0]),
    ),
  ).rejects.toThrow('50,000-file');
});
it('keeps reset APIs local and token protected, and refreshes in-memory job and preview state', async () => {
  const context = await createApp(root, { watchFiles: false });
  try {
    expect(
      (await context.app.request('http://localhost/api/notebook/reset/review', { method: 'POST' }))
        .status,
    ).toBe(403);
    const bootstrap = await (await context.app.request('http://localhost/api/bootstrap')).json();
    const headers = {
      'Content-Type': 'application/json',
      'X-Studio-Token': bootstrap.token,
      Origin: 'http://localhost',
    };
    const reviewed = await context.app.request('http://localhost/api/notebook/reset/review', {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(reviewed.status).toBe(200);
    const review = await reviewed.json();
    const response = await context.app.request(
      `http://localhost/api/notebook/reset/${review.id}/commit`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ sourceRevision: review.sourceRevision, confirmation: 'RESET' }),
      },
    );
    expect(response.status, await response.text()).toBe(200);
    expect(context.jobs.jobs).toEqual([]);
    expect(context.scheduler.state.pendingIds).toEqual([]);
    expect((await store.snapshot()).entries).toEqual([]);
  } finally {
    context.close();
  }
});
