import { mapConcurrent } from '../src/engine/work-cache.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CloudJob } from '../src/cloud/jobs.js';
import type { WorkspaceManifest, FileRecord } from '../src/cloud/types.js';
import { snapshotSelection } from '../src/shared/cloud-snapshot.js';
export const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const cloudHeaders = () => ({
  Authorization: 'Bearer ' + required('GLASS_CI_TOKEN'),
  ...(process.env.CF_ACCESS_CLIENT_ID
    ? {
        'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': required('CF_ACCESS_CLIENT_SECRET'),
      }
    : {}),
});
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error('Configure ' + name + ' in Cloudflare build secrets.');
  return value;
}
export async function cloudFetch(route: string, options: RequestInit = {}) {
  const origin = new URL(required('GLASS_STUDIO_ORIGIN'));
  if (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1')
    throw new Error('Studio must use HTTPS.');
  const response = await fetch(new URL('/__ci/' + route, origin), {
    ...options,
    headers: { ...cloudHeaders(), ...options.headers },
    redirect: 'error',
  });
  if (!response.ok) {
    let message = 'Cloud operation failed (' + response.status + ').';
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new Error(message);
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
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha(bytes) !== file.sha) throw new Error('Snapshot checksum mismatch: ' + file.path);
    await fs.writeFile(destination, bytes);
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
  await cloudFetch('jobs/' + job + '/object/' + name, {
    method: 'PUT',
    body: new Uint8Array(bytes),
  });
  return name;
}
