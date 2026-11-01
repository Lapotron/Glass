import { z } from 'zod';
import { siteSchema, type SiteConfig } from '../shared/contracts.js';
import {
  publicMediaKey,
  publicMediaTypes,
  validPublicMediaPrefix,
} from '../shared/public-media-policy.js';
import { CloudError, hash, type CloudEnv, type WorkspaceManifest } from './types.js';
import type { CloudJob } from './jobs.js';
import { putObject, reserveObject } from './storage.js';

const assetSchema = z
  .object({
    key: z.string().max(512),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(25 * 1024 ** 2),
    contentType: z.string().max(128),
  })
  .strict();
type MediaAsset = z.infer<typeof assetSchema>;
type CapturedMedia = {
  job: string;
  release: string;
  bucket: string;
  prefix: string;
  origin: string;
};

async function job(env: CloudEnv, id: string) {
  const value = await env.DB.prepare(
    "SELECT * FROM cloud_jobs WHERE id=? AND state='running' AND kind='publish'",
  )
    .bind(id)
    .first<CloudJob>();
  const approved = await env.DB.prepare(
    'SELECT approved_release FROM cloud_control WHERE id=1',
  ).first<string>('approved_release');
  if (!value || !value.release_id || value.release_id !== approved || env.PREVIEW === 'true')
    throw new CloudError(
      'This media upload does not belong to the active approved Publish job.',
      409,
    );
  return value;
}

async function capturedSite(env: CloudEnv, id: string): Promise<SiteConfig> {
  const source = await env.BUCKET.get('jobs/' + id + '/manifest.json');
  if (!source) throw new CloudError('The captured Publish snapshot is unavailable.', 503);
  const manifest = JSON.parse(await source.text()) as WorkspaceManifest;
  const record = manifest.files?.find((file) => file.path === 'content/site.json');
  if (!record || record.encrypted || !/^[a-f0-9]{64}$/.test(record.sha))
    throw new CloudError('The captured media settings are unavailable.', 503);
  const blob = record.text === null ? await env.BUCKET.get('workspace/blobs/' + record.sha) : null;
  const text = record.text ?? (blob ? await blob.text() : '');
  if (!text || (await hash(text)) !== record.sha)
    throw new CloudError('The captured media settings failed their checksum.', 503);
  return siteSchema.parse(JSON.parse(text));
}

export async function beginSharedMedia(env: CloudEnv, id: string) {
  const active = await job(env, id),
    site = await capturedSite(env, id),
    delivery = site.mediaDelivery;
  if (
    delivery.mode !== 'r2' ||
    delivery.transport !== 'studio-binding' ||
    !env.PRIVATE_BUCKET_NAME ||
    delivery.bucket !== env.PRIVATE_BUCKET_NAME ||
    !delivery.publicOrigin ||
    !validPublicMediaPrefix(delivery.prefix)
  )
    throw new CloudError(
      'Shared media needs the named Studio bucket, a safe public prefix and a media origin in the captured settings.',
      409,
    );
  const captured: CapturedMedia = {
    job: id,
    release: active.release_id!,
    bucket: delivery.bucket,
    prefix: delivery.prefix,
    origin: delivery.publicOrigin,
  };
  await putObject(env, 'jobs/' + id + '/shared-media.json', JSON.stringify(captured));
  return { ok: true };
}

async function capture(env: CloudEnv, id: string) {
  const active = await job(env, id),
    object = await env.BUCKET.get('jobs/' + id + '/shared-media.json');
  if (!object) throw new CloudError('Initialize the captured shared-media publication first.', 409);
  const value = JSON.parse(await object.text()) as CapturedMedia;
  if (
    value.job !== id ||
    value.release !== active.release_id ||
    value.bucket !== env.PRIVATE_BUCKET_NAME ||
    !validPublicMediaPrefix(value.prefix)
  )
    throw new CloudError('The shared-media publication no longer matches its captured job.', 409);
  return value;
}

function assetFor(value: unknown, prefix: string): MediaAsset {
  const asset = assetSchema.parse(value),
    path = publicMediaKey('/' + asset.key, prefix);
  if (
    !path ||
    path.key !== asset.key ||
    path.digest !== asset.sha256 ||
    publicMediaTypes[path.extension] !== asset.contentType
  )
    throw new CloudError('The public media key, content type or checksum is invalid.');
  return asset;
}

export async function sharedMediaMatches(env: CloudEnv, id: string, input: unknown) {
  const config = await capture(env, id),
    asset = assetFor(input, config.prefix);
  const existing = await env.BUCKET.head(asset.key);
  return {
    matches:
      !!existing &&
      existing.size === asset.bytes &&
      existing.customMetadata?.sha256 === asset.sha256 &&
      existing.customMetadata?.['glass-public'] === '1' &&
      existing.httpMetadata?.contentType === asset.contentType &&
      /max-age=31536000/.test(existing.httpMetadata?.cacheControl || '') &&
      /immutable/.test(existing.httpMetadata?.cacheControl || ''),
  };
}

export async function uploadSharedMedia(
  env: CloudEnv,
  id: string,
  input: unknown,
  request: Request,
) {
  const config = await capture(env, id),
    asset = assetFor(input, config.prefix);
  const length = request.headers.get('Content-Length');
  if (
    length === null ||
    !/^\d+$/.test(length) ||
    Number(length) !== asset.bytes ||
    (!request.body && asset.bytes)
  )
    throw new CloudError('The public media upload length is invalid.', 413);
  const existing = await env.BUCKET.head(asset.key);
  if (
    existing &&
    (existing.size !== asset.bytes || existing.customMetadata?.sha256 !== asset.sha256)
  )
    throw new CloudError(
      'A conflicting object already occupies this media key. No object was replaced.',
      409,
    );
  // The input first lands under an unservable job key. R2 validates its checksum while streaming.
  const staging = 'jobs/' + id + '/public-media-staging/' + crypto.randomUUID();
  await reserveObject(env, staging, asset.bytes);
  try {
    const received = (await env.BUCKET.put(staging, request.body || new Uint8Array(), {
      sha256: asset.sha256,
    })) as { size?: number } | null;
    if (!received || received.size !== asset.bytes)
      throw new CloudError('The uploaded public media length could not be verified.', 503);
    await capture(env, id);
    await reserveObject(env, asset.key, asset.bytes);
    const source = await env.BUCKET.get(staging);
    if (!source) throw new CloudError('The verified media staging object is unavailable.', 503);
    const result = (await env.BUCKET.put(asset.key, source.body, {
      sha256: asset.sha256,
      customMetadata: { sha256: asset.sha256, 'glass-public': '1' },
      httpMetadata: {
        contentType: asset.contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    })) as { size?: number } | null;
    if (!result || result.size !== asset.bytes)
      throw new CloudError('The uploaded public media length could not be verified.', 503);
    return { ok: true };
  } finally {
    // A failed cleanup remains in the tracked job namespace for bounded storage maintenance.
    await env.BUCKET.delete(staging);
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE cloud_storage SET bytes=bytes-COALESCE((SELECT bytes FROM cloud_objects WHERE key=?),0) WHERE id=1',
      ).bind(staging),
      env.DB.prepare('DELETE FROM cloud_objects WHERE key=?').bind(staging),
    ]);
  }
}
