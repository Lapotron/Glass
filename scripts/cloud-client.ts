import { mapConcurrent } from '../src/engine/work-cache.js';
import { promises as fs, createReadStream, createWriteStream, type Stats } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CloudJob } from '../src/cloud/jobs.js';
import type { WorkspaceManifest, FileRecord } from '../src/cloud/types.js';
import { snapshotSelection } from '../src/shared/cloud-snapshot.js';
import { BACKUP_CHUNK_BYTES, type BackupUpload } from '../src/shared/backup-transfer.js';
export const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const cloudHeaders = () => {
  const access = process.env.CF_ACCESS_CLIENT_ID || process.env.CF_ACCESS_CLIENT_SECRET;
  return {
    Authorization: 'Bearer ' + required('GLASS_CI_TOKEN'),
    ...(access
      ? {
          'CF-Access-Client-Id': required('CF_ACCESS_CLIENT_ID'),
          'CF-Access-Client-Secret': required('CF_ACCESS_CLIENT_SECRET'),
        }
      : {}),
  };
};
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error('Configure ' + name + ' in Cloudflare build secrets.');
  return value;
}
export async function cloudFetch(
  route: string,
  options: RequestInit = {},
  request: typeof fetch = fetch,
) {
  const origin = new URL(required('GLASS_STUDIO_ORIGIN'));
  if (
    !(
      origin.protocol === 'https:' ||
      (origin.protocol === 'http:' && origin.hostname === '127.0.0.1')
    ) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      'GLASS_STUDIO_ORIGIN must be the exact HTTPS Studio origin, without a path or credentials.',
    );
  const headers = new Headers(cloudHeaders());
  new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  const response = await request(new URL('/__ci/' + route, origin), {
    ...options,
    headers,
    redirect: 'manual',
  });
  const bootstrap =
    route === 'deployment-credentials'
      ? ' For a first Studio deployment, supply CLOUDFLARE_API_TOKEN in the build environment so deployment does not need an existing coordinator. Current Studio deployments synchronize that credential automatically.'
      : '';
  const accessHelp =
    'Check CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET in Workers Builds GLASS_CI_SECRETS, and authorize that service token in a Service Auth policy for the whole Studio hostname.';
  if (response.status >= 300 && response.status < 400) {
    let accessLogin = false;
    try {
      const location = new URL(response.headers.get('location') || '', origin);
      accessLogin =
        location.protocol === 'https:' &&
        location.hostname.endsWith('.cloudflareaccess.com') &&
        location.pathname.startsWith('/cdn-cgi/access/login/');
    } catch {}
    await response.body?.cancel();
    throw new Error(
      'Studio CI at ' +
        origin.origin +
        ' returned a redirect (HTTP ' +
        response.status +
        '). ' +
        (accessLogin
          ? 'Cloudflare Access requires a machine login. ' + accessHelp
          : 'Check GLASS_STUDIO_ORIGIN and remove redirects from /__ci/ requests.') +
        ' Credentials were not forwarded.' +
        bootstrap,
    );
  }
  if (!response.ok) {
    let message = 'Cloud operation failed (' + response.status + ').';
    let apiError = false;
    try {
      const body = await response.json();
      if (typeof body.error === 'string' && body.error) {
        message = body.error;
        apiError = true;
      }
    } catch {}
    if (apiError && response.status === 401)
      message += ' Check that GLASS_CI_TOKEN matches the Studio runtime CI_TOKEN.';
    else if (!apiError && [401, 403].includes(response.status)) message += ' ' + accessHelp;
    throw new Error(message + bootstrap);
  }
  if (response.headers.get('content-type')?.includes('text/html')) {
    await response.body?.cancel();
    throw new Error(
      'Studio CI returned HTML instead of an API response. Check GLASS_STUDIO_ORIGIN. ' +
        accessHelp +
        bootstrap,
    );
  }
  return response;
}
export async function claim() {
  const id = required('WORKERS_CI_BUILD_UUID'),
    commit = required('WORKERS_CI_COMMIT_SHA'),
    branch = required('WORKERS_CI_BRANCH');
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return (await (
        await cloudFetch('claim?' + new URLSearchParams({ build: id, commit, branch }))
      ).json()) as { job: CloudJob; manifest: WorkspaceManifest };
    } catch (error) {
      if (!String(error).includes('settling') || attempt === 5) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Build registration failed.');
}
export function safePath(name: string) {
  if (
    !/^(content\/|\.studio\/|dist\/)/.test(name) ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.split('/').some((p) => p === '.' || p === '..' || !p)
  )
    throw new Error('Invalid snapshot path.');
  return name;
}
export async function materialize(root: string, job: CloudJob, manifest: WorkspaceManifest) {
  const selected: FileRecord[] = [];
  const selection = snapshotSelection(JSON.parse(job.request).path || '');
  await mapConcurrent(manifest.files, 12, async (file) => {
    if (!selection.includes(file.path)) return;
    safePath(file.path);
    const destination = path.join(root, file.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const response = await cloudFetch(
      'jobs/' + job.id + '/blob/' + file.sha + '?' + new URLSearchParams({ path: file.path }),
    );
    await responseToFile(response, destination, file.sha);
    await fs.utimes(destination, new Date(file.modified), new Date(file.modified));
    selected.push(file);
  });
  for (const folder of ['content/posts', 'content/lab', 'content/media'])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  return selected;
}
export async function filesUnder(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Cloud jobs cannot export symbolic links.');
    if (entry.isDirectory()) result.push(...(await filesUnder(root, name)));
    else if (entry.isFile()) result.push(name);
  }
  return result;
}
export async function uploadObject(job: string, name: string, bytes: Uint8Array) {
  if (bytes.byteLength > BACKUP_CHUNK_BYTES) {
    const temporary = path.join(
      await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'glass-transfer-')),
      'object',
    );
    try {
      await fs.writeFile(temporary, bytes);
      await uploadCloudFile(job, temporary, 'object', name);
    } finally {
      await fs.rm(path.dirname(temporary), { recursive: true, force: true });
    }
    return name;
  }
  await cloudFetch('jobs/' + job + '/object/' + name, {
    method: 'PUT',
    body: new Uint8Array(bytes),
  });
  return name;
}
export async function responseToFile(response: Response, destination: string, expected?: string) {
  if (!response.body) throw new Error('The cloud download has no body.');
  const digest = createHash('sha256');
  const measure = new Transform({
    transform(chunk, _encoding, callback) {
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await pipeline(
      Readable.fromWeb(response.body as any),
      measure,
      createWriteStream(destination, { mode: 0o600 }),
    );
    if (expected && digest.digest('hex') !== expected)
      throw new Error('Snapshot checksum mismatch.');
  } catch (error) {
    await fs.rm(destination, { force: true });
    throw error;
  }
}
export async function cloudFileHash(file: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
export async function uploadCloudFile(
  job: string,
  file: string,
  purpose: 'file' | 'object',
  target: string,
) {
  const stat = await fs.stat(file),
    sha256 = await cloudFileHash(file);
  if (stat.size <= BACKUP_CHUNK_BYTES) {
    const bytes = new Uint8Array(await fs.readFile(file));
    if (purpose === 'object') {
      await uploadObject(job, target, bytes);
      return;
    }
    await cloudFetch('jobs/' + job + '/file?' + new URLSearchParams({ path: target }), {
      method: 'PUT',
      headers: { 'X-File-Modified': stat.mtime.toISOString() },
      body: bytes,
    });
    return;
  }
  await uploadMultipartFile('jobs/' + job + '/transfers', file, stat, sha256, { purpose, target });
}
export async function uploadArtifactFile(job: string, file: string, name: string) {
  const stat = await fs.stat(file),
    checksum = await cloudFileHash(file);
  if (stat.size <= BACKUP_CHUNK_BYTES)
    await cloudFetch('jobs/' + job + '/artifact-file?' + new URLSearchParams({ sha: checksum }), {
      method: 'PUT',
      body: new Uint8Array(await fs.readFile(file)),
    });
  else
    await uploadMultipartFile('jobs/' + job + '/transfers', file, stat, checksum, {
      purpose: 'file',
      target: '.studio/builds/' + job + '/public/' + name,
      unindexed: '1',
    });
  return {
    path: name,
    sha: checksum,
    bytes: stat.size,
    modified: stat.mtime.toISOString(),
    text: null,
    encrypted: 0 as const,
  };
}
export async function uploadCloudMigration(
  id: string,
  file: string,
  target: string,
  modified?: string,
) {
  const stat = await fs.stat(file),
    checksum = await cloudFileHash(file),
    base = 'migration/' + id;
  if (stat.size <= BACKUP_CHUNK_BYTES) {
    const result = await (
      await cloudFetch(base + '/file?' + new URLSearchParams({ path: target }), {
        method: 'PUT',
        headers: { 'X-File-Modified': modified || stat.mtime.toISOString() },
        body: new Uint8Array(await fs.readFile(file)),
      })
    ).json();
    if (result.sha !== checksum) throw new Error('Uploaded checksum mismatch: ' + target);
  } else
    await uploadMultipartFile(base + '/uploads', file, stat, checksum, {
      path: target,
      modified: modified || stat.mtime.toISOString(),
    });
}
async function uploadMultipartFile(
  base: string,
  file: string,
  stat: Stats,
  sha256: string,
  metadata: Record<string, string>,
) {
  const transfer = (await (
    await cloudFetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: path.basename(file),
        bytes: stat.size,
        fingerprint: sha256,
        sha: sha256,
        modified: stat.mtime.toISOString(),
        ...metadata,
      }),
    })
  ).json()) as BackupUpload;
  const existing = new Map(transfer.parts.map((part) => [part.part, part]));
  const handle = await fs.open(file, 'r');
  try {
    if (transfer.state !== 'ready')
      for (
        let part = 1, position = 0;
        position < stat.size;
        part++, position += BACKUP_CHUNK_BYTES
      ) {
        const length = Math.min(BACKUP_CHUNK_BYTES, stat.size - position),
          buffer = Buffer.allocUnsafe(length);
        let offset = 0;
        while (offset < length) {
          const result = await handle.read(buffer, offset, length - offset, position + offset);
          if (!result.bytesRead) throw new Error('The upload file changed.');
          offset += result.bytesRead;
        }
        const checksum = sha(buffer);
        if (existing.has(part)) {
          if (existing.get(part)!.sha256 !== checksum)
            throw new Error('A resumed upload part no longer matches its source.');
          continue;
        }
        await cloudFetch(base + '/' + transfer.id + '/parts/' + part, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', 'X-Part-SHA256': checksum },
          body: new Uint8Array(buffer),
        });
      }
  } finally {
    await handle.close();
  }
  const latest = await fs.stat(file);
  if (
    latest.size !== stat.size ||
    latest.mtimeMs !== stat.mtimeMs ||
    (await cloudFileHash(file)) !== sha256
  )
    throw new Error('The source changed during upload. No result was committed.');
  await cloudFetch(base + '/' + transfer.id + '/complete', { method: 'POST' });
}
