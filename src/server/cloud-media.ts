import {
  ListObjectsV2Command,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { atomicWrite, digest, type Store } from '../engine/store.js';
import type { JobService } from './publishing.js';
import { createR2Client, createR2Transport, r2Readiness } from './r2.js';
import type { DeliveryAsset } from '../engine/media-delivery.js';
import type { SiteConfig } from '../shared/contracts.js';
import type { CloudMediaInventory, CloudMediaReview } from '../shared/cloud-media.js';

const namespace = (site: SiteConfig) =>
  digest(
    JSON.stringify([
      site.cloudflare.accountId,
      site.mediaDelivery.bucket,
      site.mediaDelivery.prefix,
    ]),
  );
async function readOwnership(file: string): Promise<Record<string, string>> {
  for (const item of [path.dirname(path.dirname(file)), path.dirname(file), file]) {
    try {
      if ((await fs.lstat(item)).isSymbolicLink())
        throw new Error('Cloud ownership cannot use symbolic links.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const value = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([key, hash]) =>
        !key || key.length > 2048 || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new Error('Invalid cloud ownership history.');
  return value as Record<string, string>;
}
/** Ownership survives build-history removal. It is private bookkeeping, never a public manifest. */
export async function recordCloudOwnership(
  root: string,
  site: SiteConfig,
  assets: DeliveryAsset[],
) {
  const file = path.join(root, '.studio/cloud-media', namespace(site) + '.json');
  let previous: Record<string, string> = {};
  try {
    previous = await readOwnership(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Cloud media ownership could not be read.', { cause: error });
  }
  for (const asset of assets) previous[asset.key] = asset.sha256;
  await atomicWrite(file, JSON.stringify(previous));
}
export class CloudMediaService {
  private reviews = new Map<string, CloudMediaReview>();
  busy = false;
  constructor(
    private store: Store,
    private jobs: JobService,
    private idle: () => boolean,
    private services: { client?: typeof createR2Client; fetcher?: typeof fetch } = {},
  ) {}
  async inventory(): Promise<CloudMediaInventory> {
    const { site } = await this.store.snapshot(),
      credentials = await this.jobs.connections.values();
    if (!r2Readiness(site, credentials).configured)
      throw new Error('Complete the R2 bucket, media domain and private credentials first.');
    if (site.mediaDelivery.mode !== 'r2')
      throw new Error('Enable R2 delivery before checking cloud media.');
    const prefix = site.mediaDelivery.prefix + '/',
      protectedKeys = new Set<string>(),
      owned: Record<string, string> = {};
    const blockers: string[] = [];
    // Only captured manifests whose public origin matches this target establish ownership.
    for (const job of this.jobs.jobs) {
      let targetMatches = false;
      if (job.build)
        try {
          const source = JSON.parse(
            await fs.readFile(
              path.join(this.store.root, '.studio/builds', job.build.id, 'source.json'),
              'utf8',
            ),
          );
          targetMatches =
            source.site?.cloudflare?.accountId === site.cloudflare.accountId &&
            source.site?.mediaDelivery?.bucket === site.mediaDelivery.bucket;
        } catch {
          /* Unknown captured ownership is never inferred from filenames. */
        }
      for (const a of job.build?.media?.assets || []) {
        if (
          a.key.startsWith(prefix) &&
          a.url.startsWith(site.mediaDelivery.publicOrigin.replace(/\/$/, '') + '/')
        ) {
          protectedKeys.add(a.key);
          if (targetMatches) owned[a.key] = a.sha256;
        }
      }
    }
    // Artifacts outlive visible job rows. Their captured transfer manifests remain rollback roots.
    try {
      const folder = path.join(this.store.root, '.studio/builds');
      let names: string[] = [];
      try {
        if ((await fs.lstat(folder)).isSymbolicLink()) throw new Error();
        names = await fs.readdir(folder);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      for (const name of names.filter((value) => /^[\w-]+$/.test(value))) {
        const directory = path.join(folder, name),
          stat = await fs.lstat(directory);
        if (stat.isSymbolicLink()) throw new Error();
        if (!stat.isDirectory()) continue;
        let assets: DeliveryAsset[];
        try {
          const file = path.join(directory, 'media-transfer.json'),
            metadata = await fs.lstat(file);
          if (metadata.isSymbolicLink() || metadata.size > 5 * 1024 * 1024) throw new Error();
          const transfer = JSON.parse(await fs.readFile(file, 'utf8'));
          if (
            transfer.version !== 1 ||
            !Array.isArray(transfer.assets) ||
            transfer.assets.length > 10000
          )
            throw new Error();
          assets = transfer.assets;
          if (
            assets.some(
              (a) =>
                !a ||
                typeof a.key !== 'string' ||
                typeof a.url !== 'string' ||
                typeof a.sha256 !== 'string' ||
                !/^[a-f0-9]{64}$/.test(a.sha256),
            )
          )
            throw new Error();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        for (const asset of assets)
          if (
            asset.key.startsWith(prefix) &&
            asset.url.startsWith(site.mediaDelivery.publicOrigin.replace(/\/$/, '') + '/')
          )
            protectedKeys.add(asset.key);
      }
    } catch {
      blockers.push(
        'Local deployment history is incomplete or unreadable. Restore it before cleanup.',
      );
    }
    try {
      for (const name of (await fs.readdir(path.join(this.store.root, '.studio/jobs'))).filter(
        (n) => n.endsWith('.json'),
      )) {
        const file = path.join(this.store.root, '.studio/jobs', name);
        if ((await fs.lstat(file)).isSymbolicLink()) throw new Error();
        JSON.parse(await fs.readFile(file, 'utf8'));
      }
    } catch {
      blockers.push(
        'Local deployment history is incomplete or unreadable. Restore it before cleanup.',
      );
    }
    const ledger = path.join(this.store.root, '.studio/cloud-media', namespace(site) + '.json');
    try {
      Object.assign(owned, await readOwnership(ledger));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        blockers.push('Cloud media ownership history is unreadable.');
    }
    // Capture owned keys while retained manifests are still available.
    if (Object.keys(owned).length)
      await recordCloudOwnership(
        this.store.root,
        site,
        Object.entries(owned).map(([key, sha256]) => ({
          key,
          sha256,
          file: '',
          url: '',
          bytes: 0,
          contentType: '',
        })),
      );
    if (!credentials.CLOUDFLARE_API_TOKEN)
      blockers.push('Save a Cloudflare token to verify retained Pages deployments.');
    else {
      try {
        let page = 1;
        for (;;) {
          const response = await (this.services.fetcher || fetch)(
            'https://api.cloudflare.com/client/v4/accounts/' +
              site.cloudflare.accountId +
              '/pages/projects/' +
              encodeURIComponent(site.cloudflare.projectName) +
              '/deployments?per_page=25&page=' +
              page,
            {
              headers: { Authorization: 'Bearer ' + credentials.CLOUDFLARE_API_TOKEN },
              redirect: 'error',
              signal: AbortSignal.timeout(15000),
            },
          );
          const data = (await response.json()) as { success: boolean; result?: { url: string }[] };
          if (!response.ok || !data.success) throw new Error();
          const urls = new Set(
            this.jobs.jobs.flatMap((j) =>
              j.deployment ? [j.deployment.url.replace(/\/$/, '')] : [],
            ),
          );
          const untracked = (data.result || []).filter((d) => !urls.has(d.url.replace(/\/$/, '')));
          if (untracked.length)
            blockers.push(
              'Some retained Pages deployments have no local manifest. Retire those deployments or restore their history before cleanup.',
            );
          if ((data.result?.length || 0) < 25) break;
          if (++page > 80) throw new Error();
        }
      } catch {
        blockers.push('Retained Pages deployments could not be verified. Cleanup is blocked.');
      }
    }
    const client = (this.services.client || createR2Client)(site, credentials);
    try {
      const objects: CloudMediaInventory['objects'] = [];
      let cursor: string | undefined;
      do {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: site.mediaDelivery.bucket,
            Prefix: prefix,
            MaxKeys: 1000,
            ContinuationToken: cursor,
          }),
        );
        for (const value of result.Contents || []) {
          const key = value.Key!;
          const relative = key.slice(prefix.length);
          const sha = relative.match(/^(?:v2\/)?([a-f0-9]{64})(?:\/|\.)/)?.[1] || '';
          const protectedObject = protectedKeys.has(key),
            isOwned = Boolean(owned[key] && owned[key] === sha);
          const old = Boolean(
            value.LastModified && value.LastModified.getTime() < Date.now() - 7 * 86400000,
          );
          objects.push({
            key,
            bytes: value.Size || 0,
            sha256: sha,
            modifiedAt: value.LastModified?.toISOString() || '',
            protected: protectedObject,
            owned: isOwned,
            duplicate: false,
            eligible: isOwned && !protectedObject && old && !blockers.length,
            reason: protectedObject
              ? 'Retained artifact'
              : !isOwned
                ? 'Ownership not verified'
                : !old
                  ? 'Seven-day recovery window'
                  : blockers.length
                    ? 'Deployment check required'
                    : 'Unreferenced owned object',
          });
        }
        cursor = result.IsTruncated ? result.NextContinuationToken : undefined;
        if (objects.length > 10000)
          throw new Error('Cloud inventory exceeds 10,000 objects. Narrow the managed prefix.');
      } while (cursor);
      const groups = new Map<string, typeof objects>();
      for (const item of objects) {
        if (!item.sha256) continue;
        const key = item.sha256 + ':' + item.bytes;
        const group = groups.get(key) || [];
        group.push(item);
        groups.set(key, group);
      }
      let duplicateBytes = 0,
        duplicateGroups = 0;
      for (const group of groups.values())
        if (group.length > 1) {
          duplicateGroups++;
          duplicateBytes += (group.length - 1) * group[0].bytes;
          for (const item of group) item.duplicate = true;
        }
      const connections = await this.jobs.connections.summary();
      return {
        revision: digest(
          JSON.stringify([namespace(site), connections.revision, objects, blockers]),
        ),
        checkedAt: new Date().toISOString(),
        bucket: site.mediaDelivery.bucket,
        prefix,
        objects,
        totalBytes: objects.reduce((n, o) => n + o.bytes, 0),
        duplicateBytes,
        duplicateGroups,
        blockers: [...new Set(blockers)],
      };
    } finally {
      client.destroy();
    }
  }
  async health() {
    const { site } = await this.store.snapshot();
    const asset = this.jobs.jobs
      .flatMap((j) => j.build?.media?.assets || [])
      .find((a) => a.url.startsWith(site.mediaDelivery.publicOrigin.replace(/\/$/, '') + '/'));
    if (!asset)
      throw new Error('Publish a referenced media asset before checking its CDN delivery.');
    const transport = createR2Transport(site, await this.jobs.connections.values());
    try {
      await transport.verify(asset);
      const response = await (this.services.fetcher || fetch)(asset.url, {
        method: 'HEAD',
        credentials: 'omit',
        redirect: 'manual',
        headers: { Origin: new URL(site.url).origin },
        signal: AbortSignal.timeout(15000),
      });
      if (
        !response.ok ||
        !['*', new URL(site.url).origin].includes(
          response.headers.get('access-control-allow-origin') || '',
        )
      )
        throw new Error('Media HEAD CORS verification failed.');
      return { verified: true, checkedAt: new Date().toISOString() };
    } finally {
      transport.close?.();
    }
  }
  async review(revision: string, keys: string[]): Promise<CloudMediaReview> {
    if (this.busy || !this.idle())
      throw new Error('Wait for active publication or recovery to finish.');
    if (!keys.length || keys.length > 100 || new Set(keys).size !== keys.length)
      throw new Error('Select 1–100 unique cloud objects.');
    const current = await this.inventory();
    if (current.revision !== revision)
      throw new Error('Cloud inventory changed. Refresh before reviewing.');
    const selected = keys.map((k) => current.objects.find((o) => o.key === k));
    if (selected.some((o) => !o?.eligible))
      throw new Error('Protected, unknown or recent objects cannot be removed.');
    const review = {
      id: randomUUID(),
      revision,
      keys,
      bytes: selected.reduce((n, o) => n + o!.bytes, 0),
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
    };
    if (this.reviews.size >= 5) this.reviews.clear();
    this.reviews.set(review.id, review);
    return review;
  }
  async cleanup(id: string, revision: string) {
    const review = this.reviews.get(id);
    if (!review || review.revision !== revision || Date.parse(review.expiresAt) < Date.now())
      throw new Error('Cloud cleanup review expired. Review again.');
    if (this.busy || !this.idle())
      throw new Error('Wait for active publication or recovery to finish.');
    this.busy = true;
    try {
      const current = await this.inventory();
      if (
        current.revision !== review.revision ||
        review.keys.some((k) => !current.objects.find((o) => o.key === k)?.eligible)
      )
        throw new Error('Cloud references changed. Nothing was removed.');
      const { site } = await this.store.snapshot(),
        credentials = await this.jobs.connections.values(),
        client = (this.services.client || createR2Client)(site, credentials);
      const journal = {
        id: review.id,
        startedAt: new Date().toISOString(),
        keys: review.keys,
        deleted: [] as string[],
        state: 'verifying',
      };
      const file = path.join(this.store.root, '.studio/cloud-media/operations', id + '.json');
      try {
        // Verify actual bytes for every object before the first irreversible delete.
        for (const key of review.keys) {
          const item = current.objects.find((o) => o.key === key)!;
          const head = await client.send(
            new HeadObjectCommand({ Bucket: site.mediaDelivery.bucket, Key: key }),
          );
          if (head.ContentLength !== item.bytes || head.Metadata?.sha256 !== item.sha256)
            throw new Error('Cloud object metadata changed. Review again.');
          const body = await client.send(
              new GetObjectCommand({ Bucket: site.mediaDelivery.bucket, Key: key }),
            ),
            hash = createHash('sha256');
          let bytes = 0;
          for await (const chunk of body.Body as AsyncIterable<Uint8Array>) {
            bytes += chunk.length;
            if (bytes > item.bytes) throw new Error('Cloud object changed.');
            hash.update(chunk);
          }
          if (bytes !== item.bytes || hash.digest('hex') !== item.sha256)
            throw new Error('Cloud checksum mismatch. Nothing was removed.');
        }
        const fresh = await this.inventory();
        if (fresh.revision !== review.revision)
          throw new Error('Cloud references changed. Nothing was removed.');
        journal.state = 'deleting';
        await atomicWrite(file, JSON.stringify(journal));
        for (const key of review.keys) {
          await client.send(
            new DeleteObjectCommand({ Bucket: site.mediaDelivery.bucket, Key: key }),
          );
          journal.deleted.push(key);
          await atomicWrite(file, JSON.stringify(journal));
        }
        journal.state = 'complete';
        await atomicWrite(file, JSON.stringify(journal));
        this.reviews.delete(id);
        return { deleted: journal.deleted.length, bytes: review.bytes };
      } catch {
        journal.state = 'stopped';
        await atomicWrite(file, JSON.stringify(journal));
        throw new Error(
          'Cloud cleanup stopped after ' +
            journal.deleted.length +
            ' removals. Refresh the inventory and inspect the operation journal.',
        );
      } finally {
        client.destroy();
      }
    } finally {
      this.busy = false;
    }
  }
}
