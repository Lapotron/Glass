import { putObject } from './storage.js';
import {
  CloudError,
  hash,
  type CloudEnv,
  type FileRecord,
  type WorkspaceManifest,
  type Statement,
} from './types.js';
const encoder = new TextEncoder();
const workingPaths = [
  "path GLOB '.studio/render-cache/mermaid/*'",
  "path GLOB 'content/*'",
  "path GLOB '.studio/builds/*/source.json'",
  ...[
    'jobs',
    'job-history',
    'revisions',
    'trash',
    'history',
    'project-history',
    'pages',
    'media-originals',
    'media-info',
    'backups',
    'cloud-media',
    'search-console',
    'analytics',
    'services',
    'reset-recovery',
    'health',
    'transactions',
  ].map((name) => "path GLOB '.studio/" + name + "/*'"),
  "path IN ('.studio/connections.json','.studio/backup-settings.json','.studio/scheduler.json')",
].join(' OR ');
export const privatePath = (name: string) =>
  /^(?:\.studio\/(?:connections\.json|services\/|cloud\/)|private\/)/.test(name);
export function filePath(value: string) {
  const name = value.replace(/^\/workspace\/?/, '');
  if (
    !name ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new CloudError('Invalid workspace path.');
  if (!/^(?:content\/|\.studio\/|dist\/)/.test(name))
    throw new CloudError('Path is outside the notebook.');
  return name;
}
async function key(secret: string) {
  if (!secret || secret.length < 32)
    throw new CloudError('STUDIO_SECRET must contain at least 32 characters.', 503);
  return crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', encoder.encode(secret)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function seal(bytes: Uint8Array, secret: string, path: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(path) },
    await key(secret),
    new Uint8Array(bytes),
  );
  const output = new Uint8Array(iv.length + encrypted.byteLength);
  output.set(iv);
  output.set(new Uint8Array(encrypted), 12);
  return output;
}
export async function unseal(bytes: Uint8Array, secret: string, path: string) {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(path) },
      await key(secret),
      bytes.slice(12),
    ),
  );
}
export class CloudWorkspace {
  files = new Map<string, FileRecord>();
  changed = new Map<string, Uint8Array | null>();
  cache = new Map<string, Uint8Array>();
  modified = new Map<string, number>();
  version = 0;
  directories = new Set([
    '',
    'content',
    'content/posts',
    'content/lab',
    'content/media',
    '.studio',
  ]);
  constructor(
    readonly env: Pick<CloudEnv, 'DB' | 'BUCKET' | 'STUDIO_SECRET' | 'STORAGE_BUDGET_BYTES'>,
  ) {}
  async load(workingSet = false) {
    // One statement gives a coherent revision/manifest snapshot, even across concurrent writers.
    const rows = await this.env.DB.prepare(
      'SELECT w.version, f.* FROM cloud_workspace w LEFT JOIN ' +
        (workingSet ? '(SELECT * FROM cloud_files WHERE ' + workingPaths + ')' : 'cloud_files') +
        ' f ON 1=1 WHERE w.id=1',
    ).all<FileRecord & { version: number }>();
    this.version = rows.results[0]?.version || 0;
    for (const row of rows.results) if (row.path) this.files.set(row.path, row);
    return this;
  }
  manifest(): WorkspaceManifest {
    return { version: this.version, files: [...this.files.values()] };
  }
  has(path: string) {
    return this.changed.has(path) ? this.changed.get(path) !== null : this.files.has(path);
  }
  async read(path: string) {
    path = filePath(path);
    if (this.changed.has(path)) {
      const value = this.changed.get(path);
      if (value) return value;
      throw Object.assign(new Error('File not found: ' + path), { code: 'ENOENT' });
    }
    const record = this.files.get(path);
    if (!record) throw Object.assign(new Error('File not found: ' + path), { code: 'ENOENT' });
    if (record.text !== null) return encoder.encode(record.text);
    if (this.cache.has(path)) return this.cache.get(path)!;
    const object = await this.env.BUCKET.get(
      'workspace/' +
        (record.encrypted ? 'secrets/' + encodeURIComponent(path) + '/' : 'blobs/') +
        record.sha,
    );
    if (!object) throw new CloudError('A notebook object is missing: ' + path, 503);
    let bytes = new Uint8Array(await object.arrayBuffer());
    if (record.encrypted) bytes = await unseal(bytes, this.env.STUDIO_SECRET, path);
    if ((await hash(bytes)) !== record.sha)
      throw new CloudError('Notebook checksum mismatch: ' + path, 503);
    this.cache.set(path, bytes);
    return bytes;
  }
  write(path: string, value: Uint8Array | null) {
    path = filePath(path);
    this.changed.set(path, value);
    this.modified.set(
      path,
      Math.max(
        Date.now(),
        (this.modified.get(path) || Date.parse(this.files.get(path)?.modified || '1970-01-01')) + 1,
      ),
    );
  }
  paths() {
    const paths = new Set(this.files.keys());
    for (const [path, value] of this.changed) {
      if (value) paths.add(path);
      else paths.delete(path);
    }
    return [...paths];
  }
  async commit(actor: string) {
    for (const [path, value] of this.changed)
      if (
        (value === null && !this.files.has(path)) ||
        (value && this.files.get(path)?.sha === (await hash(value)))
      )
        this.changed.delete(path);
    if (!this.changed.size) return this.version;
    const total =
      [...this.files.values()].reduce((n, f) => n + f.bytes, 0) +
      [...this.changed].reduce(
        (n, [p, v]) => n + (v?.byteLength || 0) - (this.files.get(p)?.bytes || 0),
        0,
      );
    const limit = Number(this.env.STORAGE_BUDGET_BYTES || 5 * 1024 ** 3);
    if (!Number.isFinite(limit) || limit <= 0 || total > limit)
      throw new CloudError(
        'Workspace storage budget reached. Review retained data before adding files.',
        413,
      );
    const records: FileRecord[] = [];
    for (const [path, value] of this.changed)
      if (value) {
        const sha = await hash(value),
          encrypted = privatePath(path) ? 1 : 0;
        const text =
          !encrypted &&
          !path.startsWith('content/media/') &&
          !path.startsWith('.studio/builds/') &&
          /\.(?:json|md|txt|log|html|css|js|mjs|xml)$/.test(path) &&
          value.byteLength < 512 * 1024
            ? new TextDecoder('utf-8', { fatal: true }).decode(value)
            : null;
        // Private originals/backups never share the public media bucket. Authenticated manifests own objects.
        await putObject(
          this.env,
          'workspace/' + (encrypted ? 'secrets/' + encodeURIComponent(path) + '/' : 'blobs/') + sha,
          encrypted ? await seal(value, this.env.STUDIO_SECRET, path) : value,
        );
        records.push({
          path,
          sha,
          bytes: value.byteLength,
          modified: new Date(this.modified.get(path) || Date.now()).toISOString(),
          text,
          encrypted,
        });
      }
    const statements = [
      this.env.DB.prepare('INSERT INTO cloud_commits(parent,actor,created) VALUES(?,?,?)').bind(
        this.version,
        actor,
        new Date().toISOString(),
      ),
    ];
    const staged = this.changed.size > 40 ? crypto.randomUUID() : null;
    if (staged) {
      for (const [path] of this.changed) {
        const r = records.find((x) => x.path === path);
        await this.env.DB.prepare(
          'INSERT INTO cloud_patches(id,path,sha,bytes,modified,text,encrypted) VALUES(?,?,?,?,?,?,?)',
        )
          .bind(
            staged,
            path,
            r?.sha || null,
            r?.bytes || 0,
            r?.modified || '',
            r?.text ?? null,
            r?.encrypted || 0,
          )
          .run();
      }
      statements.push(
        this.env.DB.prepare(
          'DELETE FROM cloud_files WHERE path IN (SELECT path FROM cloud_patches WHERE id=?)',
        ).bind(staged),
        this.env.DB.prepare(
          'INSERT INTO cloud_files SELECT path,sha,bytes,modified,text,encrypted FROM cloud_patches WHERE id=? AND sha IS NOT NULL',
        ).bind(staged),
      );
    }
    for (const [path, value] of staged ? [] : this.changed) {
      const record = records.find((r) => r.path === path);
      statements.push(
        value
          ? this.env.DB.prepare(
              'INSERT INTO cloud_files(path,sha,bytes,modified,text,encrypted) VALUES(?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET sha=excluded.sha,bytes=excluded.bytes,modified=excluded.modified,text=excluded.text,encrypted=excluded.encrypted',
            ).bind(
              path,
              record!.sha,
              record!.bytes,
              record!.modified,
              record!.text,
              record!.encrypted,
            )
          : this.env.DB.prepare('DELETE FROM cloud_files WHERE path=?').bind(path),
      );
    }
    statements.push(this.env.DB.prepare('UPDATE cloud_workspace SET version=version+1 WHERE id=1'));
    try {
      await this.env.DB.batch(statements);
    } catch (error) {
      if (/UNIQUE|constraint|version conflict/i.test(String(error)))
        throw new CloudError(
          'The notebook changed. Your draft is preserved; reload before saving.',
          409,
        );
      throw error;
    }
    if (staged)
      await this.env.DB.prepare('DELETE FROM cloud_patches WHERE id=?').bind(staged).run();
    for (const [path, value] of this.changed) {
      const record = records.find((r) => r.path === path);
      if (value && record) this.files.set(path, record);
      else this.files.delete(path);
    }
    this.changed.clear();
    return ++this.version;
  }
}

/** Stage large imports one object/request; the final D1 transaction changes visibility atomically. */
export async function stageFile(
  env: CloudWorkspace['env'],
  id: string,
  path: string,
  value: Uint8Array | null,
  modified?: string,
) {
  path = filePath(path);
  const sha = value ? await hash(value) : null,
    encrypted = privatePath(path) ? 1 : 0;
  if (value)
    await putObject(
      env,
      'workspace/' + (encrypted ? 'secrets/' + encodeURIComponent(path) + '/' : 'blobs/') + sha,
      encrypted ? await seal(value, env.STUDIO_SECRET, path) : value,
    );
  const text =
    value &&
    !encrypted &&
    !path.startsWith('content/media/') &&
    !path.startsWith('.studio/builds/') &&
    /\.(?:json|md|txt|log|html|css|js|mjs|xml)$/.test(path) &&
    value.byteLength < 512 * 1024
      ? new TextDecoder('utf-8', { fatal: true }).decode(value)
      : null;
  await env.DB.prepare(
    'INSERT INTO cloud_patches(id,path,sha,bytes,modified,text,encrypted) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id,path) DO UPDATE SET sha=excluded.sha,bytes=excluded.bytes,modified=excluded.modified,text=excluded.text,encrypted=excluded.encrypted',
  )
    .bind(
      id,
      path,
      sha,
      value?.byteLength || 0,
      modified && Number.isFinite(Date.parse(modified))
        ? new Date(modified).toISOString()
        : new Date().toISOString(),
      text,
      encrypted,
    )
    .run();
  return { path, sha, bytes: value?.byteLength || 0 };
}
export async function commitStaged(
  env: CloudWorkspace['env'],
  id: string,
  version: number,
  actor: string,
  replace = false,
  completion: Statement[] = [],
  retained: FileRecord[] = [],
) {
  const totals = await env.DB.prepare(
    'SELECT (SELECT COALESCE(SUM(bytes),0) FROM cloud_files) AS current, (SELECT COALESCE(SUM(bytes),0) FROM cloud_patches WHERE id=?) AS staged,(SELECT COALESCE(SUM(bytes),0) FROM cloud_files WHERE path IN (SELECT path FROM cloud_patches WHERE id=?)) AS replaced',
  )
    .bind(id, id)
    .first<{ current: number; staged: number; replaced: number }>();
  if (!totals) throw new CloudError('Staged import could not be read.');
  if (
    (replace
      ? totals.staged + retained.reduce((sum, file) => sum + file.bytes, 0)
      : totals.current - totals.replaced + totals.staged) >
    Number(env.STORAGE_BUDGET_BYTES || 5 * 1024 ** 3)
  )
    throw new CloudError('Workspace storage budget reached.', 413);
  const statements = [
    env.DB.prepare('INSERT INTO cloud_commits(parent,actor,created) VALUES(?,?,?)').bind(
      version,
      actor,
      new Date().toISOString(),
    ),
    replace
      ? env.DB.prepare(
          'DELETE FROM cloud_files WHERE path NOT IN (SELECT value FROM json_each(?))',
        ).bind(JSON.stringify(retained.map((file) => file.path)))
      : env.DB.prepare(
          'DELETE FROM cloud_files WHERE path IN (SELECT path FROM cloud_patches WHERE id=?)',
        ).bind(id),
    env.DB.prepare(
      'INSERT INTO cloud_files SELECT path,sha,bytes,modified,text,encrypted FROM cloud_patches WHERE id=? AND sha IS NOT NULL',
    ).bind(id),
    env.DB.prepare('UPDATE cloud_workspace SET version=version+1 WHERE id=1'),
    ...completion,
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (/UNIQUE|constraint|version conflict/i.test(String(error)))
      throw new CloudError(
        'The notebook changed. The staged result was retained and no files were replaced.',
        409,
      );
    throw error;
  }
  await env.DB.prepare('DELETE FROM cloud_patches WHERE id=?').bind(id).run();
  return version + 1;
}
