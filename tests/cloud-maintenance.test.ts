import { beforeEach, afterEach, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, digest } from '../src/engine/store.js';
import { JobService } from '../src/server/publishing.js';
import { CloudMediaService, recordCloudOwnership } from '../src/server/cloud-media.js';
import { createR2Client, synchronizeMedia } from '../src/server/r2.js';
import type { Job } from '../src/shared/contracts.js';
import type { DeliveryAsset } from '../src/engine/media-delivery.js';
let root: string,
  store: Store,
  jobs: JobService,
  service: CloudMediaService,
  objects: Map<string, { bytes: Buffer; sha: string; date: Date }>,
  deleted: string[],
  asset: DeliveryAsset;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-cloud-maintenance-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  const model = await store.read();
  await store.saveJson(
    'site',
    {
      ...model.site,
      url: 'https://reader.example',
      cloudflare: { ...model.site.cloudflare, accountId: 'a'.repeat(32), projectName: 'test' },
      mediaDelivery: {
        mode: 'r2',
        bucket: 'test',
        prefix: 'media',
        publicOrigin: 'https://assets.reader.example',
      },
    },
    model.siteRevision,
  );
  jobs = new JobService(store);
  await jobs.initialize();
  await jobs.connections.update({
    revision: (await jobs.connections.summary()).revision,
    set: {
      cloudflareApiToken: 'cloudflare-test-token',
      r2AccessKeyId: 'test-access-key',
      r2SecretAccessKey: 'test-secret-key',
    },
  });
  const bytes = Buffer.from('matching bytes'),
    sha = digest(bytes);
  asset = {
    key: 'media/v2/' + sha + '.webp',
    sha256: sha,
    bytes: bytes.length,
    url: 'https://assets.reader.example/media/v2/' + sha + '.webp',
    contentType: 'image/webp',
    file: 'media/example.webp',
  };
  objects = new Map(
    [asset.key, 'media/' + sha + '/old.webp', 'media/' + sha + '/unknown.webp'].map((key) => [
      key,
      { bytes, sha, date: new Date(Date.now() - 30 * 86400000) },
    ]),
  );
  deleted = [];
  await recordCloudOwnership(root, (await store.read()).site, [
    asset,
    { ...asset, key: 'media/' + sha + '/old.webp' },
  ]);
  const client = (() => ({
    destroy() {},
    async send(command: { constructor: { name: string }; input: { Key?: string } }) {
      const key = command.input.Key || '';
      const value = objects.get(key);
      switch (command.constructor.name) {
        case 'ListObjectsV2Command':
          return {
            Contents: [...objects].map(([Key, v]) => ({
              Key,
              Size: v.bytes.length,
              LastModified: v.date,
            })),
          };
        case 'HeadObjectCommand':
          return { ContentLength: value!.bytes.length, Metadata: { sha256: value!.sha } };
        case 'GetObjectCommand':
          return {
            Body: (async function* () {
              yield value!.bytes;
            })(),
          };
        case 'DeleteObjectCommand':
          deleted.push(key);
          objects.delete(key);
          return {};
        default:
          throw new Error('Unexpected S3 call');
      }
    },
  })) as unknown as typeof createR2Client;
  service = new CloudMediaService(store, jobs, () => true, {
    client,
    fetcher: async (input) => {
      expect(new URL(String(input)).searchParams.get('per_page')).toBe('25');
      return Response.json({ success: true, result: [] });
    },
  });
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('distinguishes duplicate content from owned cleanup eligibility and revalidates retained references', async () => {
  const inventory = await service.inventory();
  expect(inventory.duplicateGroups).toBe(1);
  expect(inventory.objects.find((o) => o.key.endsWith('unknown.webp'))).toMatchObject({
    owned: false,
    eligible: false,
  });
  const old = inventory.objects.find((o) => o.key.endsWith('old.webp'))!;
  expect(old.eligible).toBe(true);
  const review = await service.review(inventory.revision, [old.key]);
  jobs.jobs.push({
    id: 'retained',
    action: 'publish',
    state: 'succeeded',
    logs: [],
    startedAt: new Date().toISOString(),
    build: {
      id: 'retained',
      outputDir: root,
      pages: 1,
      manifest: [],
      diagnostics: [],
      sourceRevision: 'a'.repeat(64),
      completedAt: new Date().toISOString(),
      media: { version: 1, assets: [{ ...asset, key: old.key }] },
    },
  } as Job);
  await expect(service.cleanup(review.id, review.revision)).rejects.toThrow('references changed');
  expect(deleted).toEqual([]);
});
it('verifies bytes before reviewed deletion and journals the exact completed set', async () => {
  const inventory = await service.inventory(),
    old = inventory.objects.find((o) => o.key.endsWith('old.webp'))!;
  const review = await service.review(inventory.revision, [old.key]);
  expect(await service.cleanup(review.id, review.revision)).toEqual({
    deleted: 1,
    bytes: asset.bytes,
  });
  expect(deleted).toEqual([old.key]);
  expect(objects.has(asset.key)).toBe(true);
  const journal = JSON.parse(
    await fs.readFile(
      path.join(root, '.studio/cloud-media/operations', review.id + '.json'),
      'utf8',
    ),
  );
  expect(journal).toMatchObject({ state: 'complete', deleted: [old.key] });
});
it('synchronizes one object when multiple canonical paths share a content key', async () => {
  await fs.mkdir(path.join(root, 'media'));
  await fs.writeFile(path.join(root, 'media/example.webp'), 'matching bytes');
  let uploads = 0,
    verifications = 0,
    last = 0;
  await synchronizeMedia(
    {
      matches: async () => false,
      upload: async () => {
        uploads++;
      },
      verify: async () => {
        verifications++;
      },
    },
    root,
    [asset, { ...asset, file: 'media/another.webp' }],
    (_stage, done) => (last = done),
  );
  expect(uploads).toBe(1);
  expect(verifications).toBe(1);
  expect(last).toBe(2);
});

it('protects retained transfer artifacts even after their visible build-history rows are removed', async () => {
  const folder = path.join(root, '.studio/builds', 'retained-artifact');
  await fs.mkdir(folder, { recursive: true });
  const key = 'media/' + asset.sha256 + '/old.webp';
  await fs.writeFile(
    path.join(folder, 'media-transfer.json'),
    JSON.stringify({ version: 1, assets: [{ ...asset, key }] }),
  );
  jobs.jobs = [];
  const inventory = await service.inventory();
  expect(inventory.objects.find((object) => object.key === key)).toMatchObject({
    protected: true,
    eligible: false,
    reason: 'Retained artifact',
  });
  await fs.writeFile(path.join(folder, 'media-transfer.json'), '{broken');
  const invalid = await service.inventory();
  expect(invalid.blockers).toContain(
    'Local deployment history is incomplete or unreadable. Restore it before cleanup.',
  );
  expect(invalid.objects.every((object) => !object.eligible)).toBe(true);
});
