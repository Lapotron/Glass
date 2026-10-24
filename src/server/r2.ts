import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SiteConfig } from '../shared/contracts.js';
import type { DeliveryAsset } from '../engine/media-delivery.js';
import { digest } from '../engine/store.js';
import { r2RequestError } from './r2-errors.js';
export type MediaTransport = {
  matches(asset: DeliveryAsset): Promise<boolean>;
  upload(asset: DeliveryAsset, bytes: Buffer): Promise<void>;
  verify(asset: DeliveryAsset): Promise<void>;
  close?(): void;
  inspect?(): Promise<void>;
};
export { r2Readiness } from './r2-readiness.js';
import { r2Readiness } from './r2-readiness.js';
export function createR2Client(site: SiteConfig, environment: NodeJS.ProcessEnv) {
  return new S3Client({
    region: 'auto',
    endpoint: 'https://' + site.cloudflare.accountId + '.r2.cloudflarestorage.com',
    maxAttempts: 3,
    requestHandler: {
      connectionTimeout: 10000,
      requestTimeout: 30000,
      throwOnRequestTimeout: true,
    },
    credentials: {
      accessKeyId: environment.R2_ACCESS_KEY_ID!,
      secretAccessKey: environment.R2_SECRET_ACCESS_KEY!,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
export function createR2Transport(
  site: SiteConfig,
  environment = process.env,
  request: typeof fetch = fetch,
): MediaTransport {
  const readiness = r2Readiness(site, environment);
  if (!readiness.configured)
    throw new Error(
      'R2 needs: ' +
        readiness.missing.join(', ') +
        '. Save credentials in Studio’s Private connection credentials.',
    );
  const client = createR2Client(site, environment);
  const bucket = site.mediaDelivery.bucket;
  return {
    async inspect() {
      try {
        await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
      } catch (error) {
        throw r2RequestError(error, 'bucket read');
      }
    },
    async matches(asset) {
      try {
        const value = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.key }));
        return (
          value.Metadata?.sha256 === asset.sha256 &&
          value.ContentLength === asset.bytes &&
          value.ContentType?.split(';')[0] === asset.contentType &&
          /max-age=31536000/.test(value.CacheControl || '') &&
          /immutable/.test(value.CacheControl || '')
        );
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
        )
          return false;
        throw r2RequestError(error, 'object inspection');
      }
    },
    async upload(asset, bytes) {
      if (digest(bytes) !== asset.sha256)
        throw new Error('The prepared media artifact changed before upload. Build again.');
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: asset.key,
            Body: bytes,
            ContentLength: bytes.length,
            ContentType: asset.contentType,
            CacheControl: 'public, max-age=31536000, immutable',
            ContentMD5: createHash('md5').update(bytes).digest('base64'),
            Metadata: { sha256: asset.sha256 },
          }),
        );
      } catch (error) {
        throw r2RequestError(error, 'media upload');
      }
    },
    async verify(asset) {
      const origin = new URL(site.url).origin;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await request(asset.url, {
            method: 'GET',
            credentials: 'omit',
            redirect: 'manual',
            headers: { Origin: origin },
            signal: AbortSignal.timeout(15000),
          });
          if (
            !response.ok ||
            response.headers.get('content-type')?.split(';')[0] !== asset.contentType
          )
            throw new Error('Media domain did not return the expected image.');
          if (!['*', origin].includes(response.headers.get('access-control-allow-origin') || ''))
            throw new Error(
              'The media domain needs public GET/HEAD CORS for image downloads. ' +
                'Open the R2 bucket’s Settings → CORS Policy and allow GET and HEAD from your site origin or *. ' +
                'If the policy was just changed, purge the media hostname’s cached files in Cloudflare.',
            );
          if (!response.headers.get('cache-control')?.includes('immutable'))
            throw new Error('Media cache headers are missing.');
          const hash = createHash('sha256');
          let size = 0;
          if (!response.body) throw new Error('The image response was empty.');
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > asset.bytes) throw new Error('The delivered image size changed.');
            hash.update(chunk);
          }
          if (size !== asset.bytes || hash.digest('hex') !== asset.sha256)
            throw new Error('The CDN image checksum does not match the prepared artifact.');
          return;
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(
        'Media verification failed: ' + (lastError as Error).message + ' Pages was not uploaded.',
      );
    },
    close() {
      client.destroy();
    },
  };
}
export async function synchronizeMedia(
  transport: MediaTransport,
  output: string,
  assets: DeliveryAsset[],
  progress: (stage: 'syncing-media' | 'verifying-media', done: number, uploaded: number) => void,
) {
  const unique: DeliveryAsset[] = [];
  const seen = new Set<string>();
  for (const asset of assets)
    if (!seen.has(asset.key)) {
      seen.add(asset.key);
      unique.push(asset);
    }
  const counts = new Map<string, number>();
  for (const asset of assets) counts.set(asset.key, (counts.get(asset.key) || 0) + 1);
  let uploaded = 0,
    done = 0;
  const parallel = async (work: (asset: DeliveryAsset) => Promise<void>) => {
    let index = 0,
      failed = false;
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(4, unique.length) }, async () => {
        for (;;) {
          const asset = unique[index++];
          if (!asset || failed) return;
          try {
            await work(asset);
          } catch (error) {
            failed = true;
            throw error;
          }
        }
      }),
    );
    const error = results.find((result) => result.status === 'rejected');
    if (error?.status === 'rejected') throw error.reason;
  };
  try {
    progress('syncing-media', 0, 0);
    await parallel(async (asset) => {
      if (!(await transport.matches(asset))) {
        await transport.upload(asset, await fs.readFile(path.join(output, asset.file)));
        uploaded++;
      }
      done += counts.get(asset.key)!;
      progress('syncing-media', done, uploaded);
    });
    done = 0;
    progress('verifying-media', 0, uploaded);
    await parallel(async (asset) => {
      await transport.verify(asset);
      done += counts.get(asset.key)!;
      progress('verifying-media', done, uploaded);
    });
  } finally {
    transport.close?.();
  }
}
