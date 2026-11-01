import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { validPublicMediaPrefix } from '../src/shared/public-media-policy.js';

/** Generate a Worker bound to an explicitly named existing bucket; never auto-provision one. */
export function mediaWorkerConfig(environment: NodeJS.ProcessEnv) {
  const name = environment.GLASS_MEDIA_WORKER || '',
    bucket = environment.GLASS_PRIVATE_BUCKET || '',
    prefix = environment.GLASS_MEDIA_PREFIX || 'media',
    input = environment.GLASS_MEDIA_ORIGIN || '';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name))
    throw new Error('Set GLASS_MEDIA_WORKER to the media Worker name.');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error('Set GLASS_PRIVATE_BUCKET to the existing Studio bucket name.');
  if (!validPublicMediaPrefix(prefix))
    throw new Error('Set GLASS_MEDIA_PREFIX to a safe public-only prefix.');
  let origin: URL;
  try {
    origin = new URL(input);
  } catch {
    throw new Error('Set GLASS_MEDIA_ORIGIN to the exact HTTPS media origin.');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('The media origin must be an HTTPS origin without a path or credentials.');
  return {
    name,
    main: 'worker.mjs',
    compatibility_date: '2026-10-12',
    workers_dev: false,
    vars: { MEDIA_ORIGIN: origin.origin, MEDIA_PREFIX: prefix },
    r2_buckets: [{ binding: 'BUCKET', bucket_name: bucket }],
  };
}

export async function buildMediaWorker(environment = process.env) {
  const config = mediaWorkerConfig(environment);
  const output = path.resolve('.studio/cloud/media');
  await fs.mkdir(output, { recursive: true });
  await build({
    entryPoints: ['src/cloud/public-media-worker.ts'],
    outfile: path.join(output, 'worker.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
  });
  await fs.writeFile(path.join(output, 'wrangler.jsonc'), JSON.stringify(config, null, 2) + '\n');
  console.log(
    'Prepared a media-only Worker with an existing private bucket binding. No hostname or deployment was changed.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  buildMediaWorker().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
