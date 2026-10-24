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
export { jsonChunks } from './json-chunks.js';
import { jsonChunks } from './json-chunks.js';
const corePaths =
  "path GLOB 'content/*' OR path GLOB '.studio/jobs/*' OR path GLOB '.studio/services/*' OR path IN ('.studio/connections.json','.studio/backup-settings.json','.studio/scheduler.json')";
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
  references = new Map<string, FileRecord>();
  completion: Statement[] = [];
  effects: { sql: string; values: unknown[] }[] = [];
  cache = new Map<string, Uint8Array>();
  modified = new Map<string, number>();
  version = 0;
  serial = 0;
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
  complete(sql: string, ...values: unknown[]) {
    this.effects.push({ sql, values });
    this.completion.push(this.env.DB.prepare(sql).bind(...values));
  }
  async load(workingSet: boolean | 'core' | 'catalog' = false) {
    // One statement gives a coherent revision/manifest snapshot, even across concurrent writers.
    const rows = await this.env.DB.prepare(
      'SELECT w.version, ' +
        (workingSet === 'catalog'
          ? "f.path,f.sha,f.bytes,f.modified,CASE WHEN (f.path GLOB 'content/*' AND f.path NOT GLOB 'content/media/*') OR f.path GLOB '.studio/media-originals/*/record.json' THEN f.text ELSE NULL END AS text,f.encrypted"
          : 'f.*') +
        ' FROM cloud_workspace w LEFT JOIN ' +
        (workingSet && workingSet !== 'catalog'
          ? '(SELECT * FROM cloud_files WHERE ' +
            (workingSet === 'core' ? corePaths : workingPaths) +
            ')'
          : 'cloud_files') +
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
    return this.changed.has(path)
      ? this.changed.get(path) !== null
      : this.references.has(path) || this.files.has(path);
  }
  async read(path: string) {
    path = filePath(path);
    if (this.changed.has(path)) {
      const value = this.changed.get(path);
      if (value) return value;
      throw Object.assign(new Error('File not found: ' + path), { code: 'ENOENT' });
    }
    const record = this.references.get(path) || this.files.get(path);
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
    this.references.delete(path);
    this.serial++;
    this.changed.set(path, value);
    this.modified.set(
      path,
      Math.max(
        Date.now(),
        (this.modified.get(path) || Date.parse(this.files.get(path)?.modified || '1970-01-01')) + 1,
      ),
    );
  }
  /** Attach a verified, immutable object without reading its bytes into the isolate. */
  reference(record: FileRecord) {
    filePath(record.path);
    this.changed.delete(record.path);
    this.references.set(record.path, record);
    this.serial++;
  }
  paths() {
    const paths = new Set([...this.files.keys(), ...this.references.keys()]);
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
    if (!this.changed.size && !this.references.size && !this.completion.length) return this.version;
    const paths = new Set([...this.changed.keys(), ...this.references.keys()]);
    const total =
      Number(
        await this.env.DB.prepare(
          'SELECT COALESCE(SUM(bytes),0) AS bytes FROM cloud_files',
        ).first<number>('bytes'),
      ) +
      [...this.changed].reduce(
        (n, [p, v]) => n + (v?.byteLength || 0) - (this.files.get(p)?.bytes || 0),
        0,
      ) +
      [...this.references].reduce(
        (sum, [path, file]) => sum + file.bytes - (this.files.get(path)?.bytes || 0),
        0,
      );
    const limit = Number(this.env.STORAGE_BUDGET_BYTES || 5 * 1024 ** 3);
    if (!Number.isFinite(limit) || limit <= 0 || total > 8 * 1024 ** 3)
      throw new CloudError(
        'Notebook logical size exceeds the 8 GiB portable workspace limit, or its storage budget is invalid. Physical storage is checked separately and shared blobs are counted once.',
        413,
      );
    const records: FileRecord[] = [...this.references.values()];
    for (const [path, value] of this.changed)
      if (value) {
        const sha = await hash(value),
          encrypted = privatePath(path) ? 1 : 0;
        const text =
          !encrypted &&
          !path.startsWith('content/media/') &&
          !path.startsWith('.studio/builds/') &&
          /\.(?:json|md|txt|log|html|css|js|mjs|xml)$/.test(path) &&
          value.byteLength < 128 * 1024
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
    const byPath = new Map(records.map((record) => [record.path, record]));
    const staged = paths.size > 35 ? crypto.randomUUID() : null;
    if (staged) {
      const values = [...paths].map((path) => {
        const r = byPath.get(path);
        return [
          path,
          r?.sha || null,
          r?.bytes || 0,
          r?.modified || '',
          r?.text ?? null,
          r?.encrypted || 0,
        ];
      });
      for (const chunk of jsonChunks(values)) {
        await this.env.DB.prepare(
          "INSERT INTO cloud_patches SELECT ?,json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]') FROM json_each(?)",
        )
          .bind(staged, chunk)
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
    for (const path of staged ? [] : paths) {
      const record = byPath.get(path);
      statements.push(
        record
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
    statements.push(
      this.env.DB.prepare('UPDATE cloud_workspace SET version=version+1 WHERE id=1'),
      ...this.completion,
    );
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
    for (const path of paths) {
      const record = byPath.get(path);
      if (record) this.files.set(path, record);
      else this.files.delete(path);
    }
    this.changed.clear();
    this.references.clear();
    this.completion.length = 0;
    this.effects.length = 0;
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
    value.byteLength < 128 * 1024
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
    8 * 1024 ** 3
  )
    throw new CloudError('Notebook logical size exceeds the 8 GiB portable workspace limit.', 413);
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
