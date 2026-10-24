import { CloudError, type CloudEnv, type FileRecord } from './types.js';
import { CloudWorkspace, commitStaged, jsonChunks, privatePath } from './workspace.js';
import { putObject, pinObjects } from './storage.js';
import { portableNotebookPath, notebookCategory } from '../shared/notebook-data.js';
import { z } from 'zod';
import { NativeStore } from './native-store.js';
import { digest } from '../engine/store.js';
import { CloudTransfers } from './transfers.js';
const day = 86400000;
export const objectKey = (file: Pick<FileRecord, 'path' | 'sha' | 'encrypted'>) =>
  'workspace/' +
  (file.encrypted ? 'secrets/' + encodeURIComponent(file.path) + '/' : 'blobs/') +
  file.sha;
export const storagePolicySchema = z
  .object({
    automatic: z.boolean().default(true),
    keepReleases: z.number().int().min(1).max(20).default(3),
    cacheBytes: z
      .number()
      .int()
      .min(0)
      .max(512 * 1024 ** 2)
      .default(128 * 1024 ** 2),
    cacheDays: z.number().int().min(1).max(30).default(7),
    recoveryDays: z.literal(7).default(7),
  })
  .strict();
export const historyPath = (path: string) =>
  /^\.studio\/(?:revisions|pages|history|project-history|jobs|job-history|backups)\//.test(path);
export class NativeData {
  constructor(readonly env: CloudEnv) {}
  async policy() {
    const row = await this.env.DB.prepare(
      'SELECT value FROM cloud_storage_policy WHERE id=1',
    ).first<{ value: string }>();
    return storagePolicySchema.parse(JSON.parse(row?.value || '{}'));
  }
  async savePolicy(input: unknown) {
    const value = storagePolicySchema.parse(input);
    await this.env.DB.batch([
      this.env.DB.prepare('UPDATE cloud_storage_policy SET value=? WHERE id=1').bind(
        JSON.stringify(value),
      ),
      this.env.DB.prepare('UPDATE cloud_gc_schedule SET next=? WHERE id=1').bind(
        value.automatic ? new Date(Date.now() + 3600000).toISOString() : '9999-01-01T00:00:00.000Z',
      ),
    ]);
    return value;
  }
  async snapshot(ws: CloudWorkspace, kind = 'manual', label = '') {
    const id = Date.now() + '-' + crypto.randomUUID(),
      created = new Date().toISOString();
    const files = [...ws.files.values()]
      .filter((file) => portableNotebookPath(file.path))
      .map((file) => ({
        ...file,
        text:
          (file.path.startsWith('content/') && !file.path.startsWith('content/media/')) ||
          /^\.studio\/media-originals\/[^/]+\/record\.json$/.test(file.path)
            ? file.text
            : null,
      }));
    await pinObjects(this.env, files.map(objectKey));
    const key = 'snapshots/' + id + '/manifest.json';
    await putObject(
      this.env,
      key,
      JSON.stringify({ version: 1, workspaceVersion: ws.version, files }),
    );
    await this.env.DB.batch([
      this.env.DB.prepare(
        'INSERT INTO cloud_snapshots(id,kind,manifest_key,created,label,summary) VALUES(?,?,?,?,?,?)',
      ).bind(
        id,
        kind,
        key,
        created,
        label,
        JSON.stringify(this.record({ id, kind, created, label }, files)),
      ),
      this.env.DB.prepare('INSERT INTO cloud_manifest_roots VALUES(?,?)').bind(
        key,
        JSON.stringify([...new Set(files.map(objectKey))]),
      ),
    ]);
    return this.record({ id, kind, created, label }, files);
  }
  record(row: { id: string; kind: string; created: string; label?: string }, files: FileRecord[]) {
    return {
      id: row.id,
      name: 'glass-notebook-' + row.id + '.tar.gz',
      createdAt: row.created,
      label: row.label || '',
      reason: row.kind,
      files: files.length,
      entries: files.filter((f) => /^content\/(posts|lab)\//.test(f.path)).length,
      media: files.filter((f) => f.path.startsWith('content/media/')).length,
      revisions: files.filter((f) => f.path.startsWith('.studio/revisions/')).length,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      archiveFormat: 'tar',
      available: true,
      snapshot: true,
      revision: digest(row.id + '|' + (row.label || '')),
    };
  }
  async snapshots() {
    const rows = (
      await this.env.DB.prepare(
        'SELECT * FROM cloud_snapshots WHERE deleted IS NULL ORDER BY created DESC LIMIT 500',
      ).all<any>()
    ).results;
    return rows.map((row) => ({
      ...JSON.parse(row.summary),
      label: row.label,
      revision: digest(row.id + '|' + (row.label || '')),
    }));
  }
  async manifest(
    id: string,
    includeDeleted = false,
  ): Promise<{ version: number; workspaceVersion: number; files: FileRecord[] }> {
    const row = await this.env.DB.prepare(
      'SELECT * FROM cloud_snapshots WHERE id=?' + (includeDeleted ? '' : ' AND deleted IS NULL'),
    )
      .bind(id)
      .first<any>();
    if (!row) throw new CloudError('Snapshot not found.', 404);
    const object = await this.env.BUCKET.get(row.manifest_key);
    if (!object) throw new CloudError('Snapshot manifest is missing.', 503);
    const data = JSON.parse(await object.text());
    if (
      data.version !== 1 ||
      !Array.isArray(data.files) ||
      data.files.some(
        (file: FileRecord) =>
          !portableNotebookPath(file.path) ||
          !/^[a-f0-9]{64}$/.test(file.sha) ||
          !Number.isSafeInteger(file.bytes) ||
          file.bytes < 0,
      ) ||
      new Set(data.files.map((file: FileRecord) => file.path)).size !== data.files.length
    )
      throw new CloudError('Snapshot is damaged; cleanup is blocked.', 409);
    return data;
  }
  async restore(id: string, ws: CloudWorkspace, revision: number, actor: string) {
    if (ws.version !== revision)
      throw new CloudError('The notebook changed. Review the restore again.', 409);
    const manifest = await this.manifest(id),
      safety = await this.snapshot(ws, 'before-restore');
    await pinObjects(this.env, manifest.files.map(objectKey));
    const validation = new CloudWorkspace(this.env);
    manifest.files.forEach((file) => validation.files.set(file.path, file));
    const store = new NativeStore(validation);
    await store.snapshot();
    await store.validateRecoveryReferences();
    const stage = 'snapshot-' + crypto.randomUUID();
    for (const chunk of jsonChunks(
      manifest.files.map((file) => [
        file.path,
        file.sha,
        file.bytes,
        file.modified,
        file.text,
        file.encrypted,
      ]),
    )) {
      await this.env.DB.prepare(
        "INSERT INTO cloud_patches SELECT ?,json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),COALESCE(json_extract(value,'$[4]'),(SELECT text FROM cloud_files WHERE path=json_extract(value,'$[0]') AND sha=json_extract(value,'$[1]'))),json_extract(value,'$[5]') FROM json_each(?)",
      )
        .bind(stage, chunk)
        .run();
    }
    const retained = [...ws.files.values()].filter((file) => !portableNotebookPath(file.path));
    await commitStaged(this.env, stage, ws.version, actor, true, [], retained);
    return { ok: true, safetyBackup: safety.id };
  }
  async review(id: string, ws: CloudWorkspace) {
    const manifest = await this.manifest(id),
      row = await this.env.DB.prepare('SELECT * FROM cloud_snapshots WHERE id=?')
        .bind(id)
        .first<any>();
    const before = new Map(
        [...ws.files.values()]
          .filter((file) => portableNotebookPath(file.path))
          .map((file) => [file.path, file.sha]),
      ),
      next = new Map(manifest.files.map((file) => [file.path, file.sha]));
    return {
      ...this.record(row, manifest.files),
      sourceRevision: String(ws.version),
      added: manifest.files.filter((file) => !before.has(file.path)).length,
      changed: manifest.files.filter(
        (file) => before.has(file.path) && before.get(file.path) !== file.sha,
      ).length,
      removed: [...before.keys()].filter((path) => !next.has(path)).length,
      archiveFormat: 'tar',
    };
  }
  async history(
    ws: CloudWorkspace,
    options: { category?: string; query?: string; cursor?: string; deleted?: boolean } = {},
  ) {
    const requested = Number(options.cursor || 0),
      offset = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
    if (options.deleted) {
      const now = new Date().toISOString(),
        total =
          (await this.env.DB.prepare(
            'SELECT COUNT(*) AS count FROM cloud_history_deleted WHERE expires>?',
          )
            .bind(now)
            .first<number>('count')) || 0;
      return {
        items: (
          await this.env.DB.prepare(
            'SELECT id,path,deleted,expires FROM cloud_history_deleted WHERE expires>? ORDER BY deleted DESC,id LIMIT 50 OFFSET ?',
          )
            .bind(now, offset)
            .all()
        ).results,
        total,
        cursor: offset + 50 < total ? String(offset + 50) : '',
      };
    }
    const files = [...ws.files.values()]
      .filter((file) => historyPath(file.path))
      .filter(
        (file) =>
          (!options.category || notebookCategory(file.path) === options.category) &&
          (!options.query || file.path.toLowerCase().includes(options.query.toLowerCase())),
      )
      .sort((a, b) => b.modified.localeCompare(a.modified) || a.path.localeCompare(b.path));
    const items = files.slice(offset, offset + 50).map((file) => ({
      id: file.path,
      path: file.path,
      revision: file.sha,
      bytes: file.bytes,
      modified: file.modified,
      category: notebookCategory(file.path),
    }));
    return {
      items,
      total: files.length,
      cursor: offset + 50 < files.length ? String(offset + 50) : '',
    };
  }
  async deleteHistory(ws: CloudWorkspace, input: unknown) {
    const data = z
      .object({
        items: z
          .array(z.object({ path: z.string(), revision: z.string() }))
          .min(1)
          .max(500),
      })
      .parse(input);
    if (new Set(data.items.map((item) => item.path)).size !== data.items.length)
      throw new CloudError('Choose each history record once.');
    const chosen = data.items.map((item) => {
      const file = ws.files.get(item.path);
      if (!file || !historyPath(item.path) || file.sha !== item.revision)
        throw new CloudError('History changed. Review the selection again.', 409);
      return file;
    });
    // A legacy compressed backup and its catalogue record are one recoverable item.
    const grouped = new Map(chosen.map((file) => [file.path, file]));
    for (const file of chosen) {
      const match = /^(\.studio\/backups\/\d+-[a-f0-9-]+)\.(?:json|json\.gz|tar\.gz)$/.exec(
        file.path,
      );
      if (match)
        for (const suffix of ['.json', '.json.gz', '.tar.gz']) {
          const companion = ws.files.get(match[1] + suffix);
          if (companion) grouped.set(companion.path, companion);
        }
    }
    const deleted = new Date().toISOString(),
      expires = new Date(Date.now() + 7 * day).toISOString();
    const ids: string[] = [],
      undoId = crypto.randomUUID();
    const values = [...grouped.values()].map((file) => {
      const id = crypto.randomUUID();
      ids.push(id);
      ws.write(file.path, null);
      return [id, file.path, JSON.stringify({ ...file, text: null }), deleted, expires];
    });
    ws.complete(
      "INSERT INTO cloud_history_deleted SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]') FROM json_each(?)",
      JSON.stringify(values),
    );
    ws.complete(
      'INSERT INTO cloud_history_groups VALUES(?,?,?)',
      undoId,
      JSON.stringify(ids),
      deleted,
    );
    return { ok: true, deleted: grouped.size, recoverUntil: expires, undoId };
  }
  async restoreHistory(ws: CloudWorkspace, id: string) {
    const row = await this.env.DB.prepare(
      'SELECT * FROM cloud_history_deleted WHERE id=? AND expires>?',
    )
      .bind(z.uuid().parse(id), new Date().toISOString())
      .first<any>();
    if (!row) throw new CloudError('Deleted history is unavailable.', 404);
    const file = JSON.parse(row.record) as FileRecord;
    if (ws.has(file.path)) throw new CloudError('That history path is occupied.', 409);
    const source = await this.env.BUCKET.head(objectKey(file));
    if (!source) throw new CloudError('History object is missing.', 503);
    await pinObjects(this.env, [objectKey(file)]);
    ws.reference(file);
    ws.complete('DELETE FROM cloud_history_deleted WHERE id=?', id);
    return { ok: true };
  }
  async purgeHistory(id: string) {
    await this.env.DB.prepare('DELETE FROM cloud_history_deleted WHERE id=?')
      .bind(z.uuid().parse(id))
      .run();
    return { ok: true };
  }
  async restoreGroup(ws: CloudWorkspace, id: string) {
    const row = await this.env.DB.prepare('SELECT items FROM cloud_history_groups WHERE id=?')
      .bind(z.uuid().parse(id))
      .first<{ items: string }>();
    if (!row) throw new CloudError('History recovery group is unavailable.', 404);
    const records = (
      await this.env.DB.prepare(
        'SELECT id,record FROM cloud_history_deleted WHERE id IN (SELECT value FROM json_each(?)) AND expires>?',
      )
        .bind(row.items, new Date().toISOString())
        .all<{ id: string; record: string }>()
    ).results;
    if (records.length !== JSON.parse(row.items).length)
      throw new CloudError(
        'Some history in this selection expired or was purged. Recover remaining items from Hosting.',
        409,
      );
    const files = records.map((item) => JSON.parse(item.record) as FileRecord);
    if (files.some((file) => ws.has(file.path)))
      throw new CloudError('A history path is occupied. Nothing was restored.', 409);
    await pinObjects(this.env, files.map(objectKey));
    files.forEach((file) => ws.reference(file));
    ws.complete(
      'DELETE FROM cloud_history_deleted WHERE id IN (SELECT value FROM json_each(?))',
      row.items,
    );
    ws.complete('DELETE FROM cloud_history_groups WHERE id=?', id);
    return { ok: true };
  }
  async deleteSnapshot(id: string, revision: string) {
    const row = await this.env.DB.prepare(
      'SELECT label FROM cloud_snapshots WHERE id=? AND deleted IS NULL',
    )
      .bind(id)
      .first<{ label: string }>();
    if (!row || digest(id + '|' + row.label) !== revision)
      throw new CloudError('Snapshot changed. Review again.', 409);
    await this.manifest(id);
    await this.env.DB.prepare(
      'UPDATE cloud_snapshots SET deleted=?,expires=? WHERE id=? AND deleted IS NULL',
    )
      .bind(new Date().toISOString(), new Date(Date.now() + 7 * day).toISOString(), id)
      .run();
    return { ok: true, recoverUntil: new Date(Date.now() + 7 * day).toISOString() };
  }
  async deletedSnapshots() {
    return (
      await this.env.DB.prepare(
        'SELECT id,kind,label,created,deleted,expires FROM cloud_snapshots WHERE deleted IS NOT NULL AND expires>? ORDER BY deleted DESC LIMIT 100',
      )
        .bind(new Date().toISOString())
        .all()
    ).results;
  }
  async recoverSnapshot(id: string) {
    const recovered = await this.env.DB.prepare(
      'UPDATE cloud_snapshots SET deleted=NULL,expires=NULL WHERE id=? AND expires>? RETURNING id',
    )
      .bind(id, new Date().toISOString())
      .first();
    if (!recovered) throw new CloudError('Deleted backup expired or is unavailable.', 410);
    return { ok: true };
  }
  async purgeSnapshot(id: string) {
    await this.env.DB.prepare('DELETE FROM cloud_snapshots WHERE id=? AND deleted IS NOT NULL')
      .bind(id)
      .run();
    return { ok: true };
  }
  async roots() {
    const roots = new Set<string>();
    const current = (
      await this.env.DB.prepare('SELECT path,sha,encrypted FROM cloud_files').all<FileRecord>()
    ).results;
    current.forEach((file) => roots.add(objectKey(file)));
    const patches = (
      await this.env.DB.prepare(
        'SELECT path,sha,encrypted FROM cloud_patches WHERE sha IS NOT NULL',
      ).all<FileRecord>()
    ).results;
    patches.forEach((file) => roots.add(objectKey(file)));
    const deleted = (
      await this.env.DB.prepare('SELECT record FROM cloud_history_deleted WHERE expires>?')
        .bind(new Date().toISOString())
        .all<{ record: string }>()
    ).results;
    deleted.forEach((row) => roots.add(objectKey(JSON.parse(row.record))));
    const snapshots = (
      await this.env.DB.prepare(
        'SELECT id,manifest_key FROM cloud_snapshots WHERE deleted IS NULL OR expires>?',
      )
        .bind(new Date().toISOString())
        .all<{ id: string; manifest_key: string }>()
    ).results;
    const indexed = (
      await this.env.DB.prepare('SELECT key,objects FROM cloud_manifest_roots').all<{
        key: string;
        objects: string;
      }>()
    ).results;
    const indices = new Map(indexed.map((row) => [row.key, row.objects]));
    for (const row of snapshots) {
      roots.add(row.manifest_key);
      const index = indices.get(row.manifest_key);
      if (index) JSON.parse(index).forEach((key: string) => roots.add(key));
      else {
        const data = await this.manifest(row.id, true);
        data.files.forEach((file) => roots.add(objectKey(file)));
      }
    }
    const policy = await this.policy();
    const releases = (
      await this.env.DB.prepare(
        'SELECT id,manifest_key FROM cloud_releases WHERE id IN (SELECT approved_release FROM cloud_control UNION SELECT live_release FROM cloud_control) OR id IN (SELECT id FROM cloud_releases WHERE deployment_url IS NOT NULL ORDER BY created DESC LIMIT ?)',
      )
        .bind(policy.keepReleases)
        .all<{ id: string; manifest_key: string }>()
    ).results;
    const jobs = (
      await this.env.DB.prepare(
        "SELECT id FROM cloud_jobs WHERE state IN ('queued','running') OR (state='failed' AND updated>?)",
      )
        .bind(new Date(Date.now() - 7 * day).toISOString())
        .all<{ id: string }>()
    ).results;
    for (const row of releases) {
      roots.add(row.manifest_key);
      const obj = await this.env.BUCKET.get(row.manifest_key);
      if (!obj)
        throw new CloudError('A retained release manifest is missing. Cleanup is blocked.', 409);
      const manifest = JSON.parse(await obj.text());
      if (!Array.isArray(manifest.files))
        throw new CloudError('A retained release is damaged. Cleanup is blocked.', 409);
      manifest.files.forEach((file: FileRecord) => roots.add(objectKey(file)));
      const id = row.manifest_key.split('/')[1];
      if (id) jobs.push({ id });
    }
    const artifacts = (
      await this.env.DB.prepare(
        'SELECT job_id,manifest_key FROM cloud_artifacts WHERE expired IS NULL',
      ).all<{ job_id: string; manifest_key: string }>()
    ).results;
    const kept = new Set(jobs.map((job) => job.id));
    for (const row of artifacts.filter((row) => kept.has(row.job_id))) {
      roots.add(row.manifest_key);
      const index = indices.get(row.manifest_key);
      if (!index)
        throw new CloudError('A retained artifact index is missing. Cleanup is blocked.', 409);
      JSON.parse(index).forEach((key: string) => roots.add(key));
    }
    for (const job of jobs) {
      const files = (
        await this.env.DB.prepare('SELECT path,sha,encrypted FROM cloud_job_files WHERE job_id=?')
          .bind(job.id)
          .all<FileRecord>()
      ).results;
      files.forEach((file) => roots.add(objectKey(file)));
      roots.add('jobs/' + job.id + '/manifest.json');
      roots.add('jobs/' + job.id + '/objects/result.json');
      roots.add('jobs/' + job.id + '/request');
    }
    const transfers = (
      await this.env.DB.prepare(
        "SELECT key FROM cloud_transfers WHERE expires>? AND state!='cancelled'",
      )
        .bind(new Date().toISOString())
        .all<{ key: string }>()
    ).results;
    transfers.forEach((row) => roots.add(row.key));
    const operations = (
      await this.env.DB.prepare('SELECT manifest_key FROM cloud_operations WHERE expires>?')
        .bind(new Date().toISOString())
        .all<{ manifest_key: string }>()
    ).results;
    operations.forEach((row) => roots.add(row.manifest_key));
    const exports = (
      await this.env.DB.prepare('SELECT manifest_key FROM cloud_exports WHERE expires>?')
        .bind(new Date().toISOString())
        .all<{ manifest_key: string }>()
    ).results;
    for (const row of exports) {
      roots.add(row.manifest_key);
      const index = indices.get(row.manifest_key);
      if (!index) throw new CloudError('Export index is incomplete; cleanup is blocked.', 409);
      JSON.parse(index).forEach((key: string) => roots.add(key));
    }
    const reviews = (
      await this.env.DB.prepare(
        "SELECT json_extract(response,'$.key') AS key FROM cloud_reviews WHERE json_extract(response,'$.expiresAt')>? AND json_extract(response,'$.key') IS NOT NULL",
      )
        .bind(new Date().toISOString())
        .all<{ key: string }>()
    ).results;
    reviews.forEach((row) => roots.add(row.key));
    const migrations = (
      await this.env.DB.prepare(
        'SELECT recovery_key FROM cloud_migrations WHERE recovery_key IS NOT NULL',
      ).all<{ recovery_key: string }>()
    ).results;
    for (const row of migrations) {
      roots.add(row.recovery_key);
      const index = indices.get(row.recovery_key);
      if (index) {
        JSON.parse(index).forEach((key: string) => roots.add(key));
        continue;
      }
      const object = await this.env.BUCKET.get(row.recovery_key);
      if (!object)
        throw new CloudError('Migration recovery data is missing. Cleanup is blocked.', 409);
      const data = JSON.parse(await object.text());
      if (!Array.isArray(data.files))
        throw new CloudError('Migration recovery data is damaged.', 409);
      data.files
        .filter((file: FileRecord) => portableNotebookPath(file.path) || privatePath(file.path))
        .forEach((file: FileRecord) => roots.add(objectKey(file)));
    }
    return roots;
  }
  /** Expose legacy hidden migration recoveries without retaining their generated build graph. */
  async adoptLegacyRecovery() {
    const row = await this.env.DB.prepare(
      'SELECT id,created,recovery_key FROM cloud_migrations WHERE recovery_key IS NOT NULL AND recovery_key NOT IN (SELECT key FROM cloud_manifest_roots) ORDER BY created LIMIT 1',
    ).first<{ id: string; created: string; recovery_key: string }>();
    if (!row) return false;
    const source = await this.env.BUCKET.get(row.recovery_key);
    if (!source)
      throw new CloudError('Legacy migration recovery is missing. Cleanup is blocked.', 409);
    if (source.size > 16 * 1024 ** 2)
      throw new CloudError(
        'Legacy recovery metadata exceeds the safe 16 MiB maintenance limit. Keep its independent export and review this recovery before cleanup.',
        413,
      );
    const manifest = JSON.parse(await source.text());
    if (!Array.isArray(manifest.files))
      throw new CloudError('Legacy migration recovery is damaged. Cleanup is blocked.', 409);
    const files: FileRecord[] = manifest.files
      .filter((file: FileRecord) => portableNotebookPath(file.path))
      .map((file: FileRecord) => ({
        ...file,
        text:
          (file.path.startsWith('content/') && !file.path.startsWith('content/media/')) ||
          /^\.studio\/media-originals\/[^/]+\/record\.json$/.test(file.path)
            ? file.text
            : null,
      }));
    const privateFiles: FileRecord[] = manifest.files.filter((file: FileRecord) =>
      privatePath(file.path),
    );
    if (
      [...files, ...privateFiles].some(
        (file) =>
          !/^[a-f0-9]{64}$/.test(file.sha) || !Number.isSafeInteger(file.bytes) || file.bytes < 0,
      )
    )
      throw new CloudError('Legacy recovery references are damaged.', 409);
    const id = String(Date.parse(row.created)) + '-' + row.id,
      key = 'snapshots/' + id + '/manifest.json',
      compact = 'migrations/' + row.id + '/private-recovery.json';
    await pinObjects(this.env, [...files, ...privateFiles].map(objectKey));
    if (files.length) {
      await putObject(
        this.env,
        key,
        JSON.stringify({ version: 1, workspaceVersion: manifest.version, files }),
      );
    }
    await putObject(
      this.env,
      compact,
      JSON.stringify({ version: manifest.version, files: privateFiles }),
    );
    await this.env.DB.batch([
      ...(files.length
        ? [
            this.env.DB.prepare(
              "INSERT OR IGNORE INTO cloud_snapshots(id,kind,manifest_key,created,label,summary) VALUES(?,'before-restore',?,?,'Migration recovery',?)",
            ).bind(
              id,
              key,
              row.created,
              JSON.stringify(
                this.record(
                  { id, kind: 'before-restore', created: row.created, label: 'Migration recovery' },
                  files,
                ),
              ),
            ),
            this.env.DB.prepare('INSERT OR IGNORE INTO cloud_manifest_roots VALUES(?,?)').bind(
              key,
              JSON.stringify([...new Set(files.map(objectKey))]),
            ),
          ]
        : []),
      this.env.DB.prepare('INSERT OR IGNORE INTO cloud_manifest_roots VALUES(?,?)').bind(
        compact,
        JSON.stringify([...new Set(privateFiles.map(objectKey))]),
      ),
      this.env.DB.prepare(
        'UPDATE cloud_migrations SET recovery_key=? WHERE id=? AND recovery_key=?',
      ).bind(compact, row.id, row.recovery_key),
    ]);
    return true;
  }
  async summary(ws: CloudWorkspace) {
    const categories: Record<string, { files: number; bytes: number }> = {};
    for (const file of ws.files.values()) {
      const key = notebookCategory(file.path);
      const row = (categories[key] ||= { files: 0, bytes: 0 });
      row.files++;
      row.bytes += file.bytes;
    }
    const physical = await this.env.DB.prepare(
      'SELECT bytes,budget FROM cloud_storage WHERE id=1',
    ).first();
    const objects = await this.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM cloud_objects',
    ).first();
    const deleted = await this.env.DB.prepare(
      "SELECT COUNT(*) AS count,COALESCE(SUM(json_extract(record,'$.bytes')),0) AS bytes FROM cloud_history_deleted",
    ).first();
    const snapshots = await this.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM cloud_snapshots WHERE deleted IS NULL OR expires>?',
    )
      .bind(new Date().toISOString())
      .first();
    const artifacts = await this.env.DB.prepare(
      'SELECT COALESCE(SUM(files),0) AS files,COALESCE(SUM(bytes),0) AS bytes FROM cloud_artifacts WHERE expired IS NULL',
    ).first<{ files: number; bytes: number }>();
    if (artifacts?.files) {
      const category = (categories.artifacts ||= { files: 0, bytes: 0 });
      category.files += artifacts.files;
      category.bytes += artifacts.bytes;
    }
    return {
      version: ws.version,
      categories,
      physical,
      objects,
      deleted,
      snapshots,
      policy: await this.policy(),
      checkedAt: new Date().toISOString(),
    };
  }
  async expireGenerated(ws: CloudWorkspace, actor: string, cacheOnly = false) {
    const policy = await this.policy();
    const retained = (
      await this.env.DB.prepare(
        "SELECT id FROM cloud_jobs WHERE state IN ('queued','running') UNION SELECT substr(manifest_key,6,36) FROM cloud_releases WHERE id IN (SELECT approved_release FROM cloud_control UNION SELECT live_release FROM cloud_control) OR id IN (SELECT id FROM cloud_releases WHERE deployment_url IS NOT NULL ORDER BY created DESC LIMIT ?)",
      )
        .bind(policy.keepReleases)
        .all<{ id: string }>()
    ).results;
    const keep = new Set(retained.map((row) => row.id));
    if (!cacheOnly) {
      await this.env.DB.prepare(
        'UPDATE cloud_artifacts SET expired=? WHERE expired IS NULL AND job_id NOT IN (SELECT value FROM json_each(?))',
      )
        .bind(new Date().toISOString(), JSON.stringify([...keep]))
        .run();
      // Keep failed/conflicting output for seven days so its recovery action remains usable.
      await this.env.DB.prepare(
        "DELETE FROM cloud_patches WHERE id IN (SELECT 'job-'||id FROM cloud_jobs WHERE state='succeeded' OR (state NOT IN ('queued','running') AND updated<?))",
      )
        .bind(new Date(Date.now() - 7 * day).toISOString())
        .run();
      await this.env.DB.prepare(
        "DELETE FROM cloud_patches WHERE id IN (SELECT 'migration-'||id FROM cloud_migrations WHERE state='uploading' AND COALESCE(touched,created)<?)",
      )
        .bind(new Date(Date.now() - 7 * day).toISOString())
        .run();
      await this.env.DB.prepare(
        "DELETE FROM cloud_patches WHERE id IN (SELECT 'job-'||id FROM cloud_media_uploads WHERE state='uploading' AND COALESCE(updated,created)<?)",
      )
        .bind(new Date(Date.now() - 7 * day).toISOString())
        .run();
      await this.env.DB.prepare(
        "DELETE FROM cloud_patches WHERE id IN (SELECT 'operation-'||id FROM cloud_operations WHERE expires<?)",
      )
        .bind(new Date().toISOString())
        .run();
    }
    const caches = [...ws.files.values()]
      .filter((file) => notebookCategory(file.path) === 'cache')
      .sort((a, b) => b.modified.localeCompare(a.modified));
    let budget = cacheOnly ? 0 : policy.cacheBytes;
    for (const file of caches) {
      if (Date.parse(file.modified) < Date.now() - policy.cacheDays * day || file.bytes > budget)
        ws.write(file.path, null);
      else budget -= file.bytes;
    }
    if (!cacheOnly)
      for (const file of ws.files.values()) {
        const match = file.path.match(/^\.studio\/builds\/([^/]+)\/(.+)$/);
        if (
          match &&
          !keep.has(match[1]) &&
          !['source.json', 'media-transfer.json'].includes(match[2])
        )
          ws.write(file.path, null);
      }
    const detached = ws.changed.size;
    if (detached) await ws.commit(actor);
    return detached;
  }
  async cleanup(ws: CloudWorkspace, actor: string) {
    if (this.env.PREVIEW === 'true') throw new CloudError('Cleanup is disabled in previews.', 403);
    if (await this.adoptLegacyRecovery())
      return {
        ok: true,
        removed: 0,
        detached: 0,
        bytes: 0,
        abortedTransfers: 0,
        actor,
        more: true,
      };
    const detached = await this.expireGenerated(ws, actor);
    const owner = crypto.randomUUID(),
      now = new Date().toISOString();
    const lock = await this.env.DB.prepare(
      'INSERT INTO cloud_storage_lock VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE cloud_storage_lock.expires<? RETURNING owner',
    )
      .bind(owner, new Date(Date.now() + 60000).toISOString(), now)
      .first();
    if (!lock) throw new CloudError('Storage maintenance is already running.', 409);
    try {
      const beforePhysical = await this.env.DB.prepare(
        'SELECT bytes FROM cloud_storage WHERE id=1',
      ).first<number>('bytes');
      const expired = (
        await this.env.DB.prepare(
          "SELECT id,actor FROM cloud_transfers WHERE expires<? AND (state!='cancelled' OR key IN (SELECT key FROM cloud_objects)) ORDER BY expires LIMIT 2",
        )
          .bind(now)
          .all<{ id: string; actor: string }>()
      ).results;
      if (expired.length)
        await new CloudTransfers(this.env).discard(expired[0].id, expired[0].actor, true);
      const roots = await this.roots();
      const cursor =
        (await this.env.DB.prepare('SELECT cursor FROM cloud_gc_cursor WHERE id=1').first<string>(
          'cursor',
        )) || '';
      const candidates = (
        await this.env.DB.prepare(
          'SELECT key,bytes FROM cloud_objects WHERE key>? AND created<? AND key NOT IN (SELECT key FROM cloud_object_pins WHERE expires>?) ORDER BY key LIMIT 500',
        )
          .bind(cursor, new Date(Date.now() - day).toISOString(), now)
          .all<{ key: string; bytes: number }>()
      ).results;
      let removed = 0,
        bytes = 0;
      let scanned = '';
      const chosen: { key: string; bytes: number }[] = [];
      for (const candidate of candidates) {
        scanned = candidate.key;
        if (
          roots.has(candidate.key) ||
          !/^(?:workspace\/blobs\/|workspace\/secrets\/|jobs\/|snapshots\/|operations\/|exports\/|reviews\/|migrations\/)/.test(
            candidate.key,
          )
        )
          continue;
        chosen.push(candidate);
        if (chosen.length === 100) break;
      }
      if (chosen.length) {
        if (
          !(await this.env.DB.prepare(
            'SELECT owner FROM cloud_storage_lock WHERE owner=? AND expires>?',
          )
            .bind(owner, new Date().toISOString())
            .first())
        )
          throw new CloudError('Cleanup lease expired. No further objects were removed.', 409);
        await this.env.BUCKET.delete(chosen.map((row) => row.key));
        bytes = chosen.reduce((sum, row) => sum + row.bytes, 0);
        removed = chosen.length;
        const keys = JSON.stringify(chosen.map((row) => row.key));
        await this.env.DB.batch([
          this.env.DB.prepare(
            'UPDATE cloud_storage SET bytes=bytes-COALESCE((SELECT SUM(bytes) FROM cloud_objects WHERE key IN (SELECT value FROM json_each(?))),0) WHERE id=1',
          ).bind(keys),
          this.env.DB.prepare(
            'DELETE FROM cloud_objects WHERE key IN (SELECT value FROM json_each(?))',
          ).bind(keys),
          this.env.DB.prepare(
            'DELETE FROM cloud_manifest_roots WHERE key IN (SELECT value FROM json_each(?))',
          ).bind(keys),
        ]);
      }
      await this.env.DB.prepare('UPDATE cloud_gc_cursor SET cursor=? WHERE id=1')
        .bind(candidates.length === 500 || removed === 100 ? scanned : '')
        .run();
      const afterPhysical = await this.env.DB.prepare(
        'SELECT bytes FROM cloud_storage WHERE id=1',
      ).first<number>('bytes');
      return {
        ok: true,
        removed,
        detached,
        bytes: Math.max(bytes, (beforePhysical || 0) - (afterPhysical || 0)),
        abortedTransfers: expired.length ? 1 : 0,
        actor,
        more: candidates.length === 500 || removed === 100 || expired.length > 1,
      };
    } finally {
      await this.env.DB.prepare('DELETE FROM cloud_storage_lock WHERE owner=?').bind(owner).run();
    }
  }
}
/** Hourly bounded work, enabled after the owner saves a policy or completes a publication. */
export async function storageMaintenance(env: CloudEnv) {
  if (env.PREVIEW === 'true') return;
  const now = new Date().toISOString(),
    row = await env.DB.prepare('SELECT next FROM cloud_gc_schedule WHERE id=1').first<{
      next: string;
    }>();
  if (!row || row.next > now) return;
  const service = new NativeData(env);
  if (!(await service.policy()).automatic) return;
  const claimed = await env.DB.prepare(
    'UPDATE cloud_gc_schedule SET next=? WHERE id=1 AND next=? RETURNING id',
  )
    .bind(new Date(Date.now() + 3600000).toISOString(), row.next)
    .first();
  if (!claimed) return;
  await service.cleanup(await new CloudWorkspace(env).load('catalog'), 'storage-maintenance');
}
