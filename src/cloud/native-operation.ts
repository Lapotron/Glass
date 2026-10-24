import { z } from 'zod';
import { CloudError, hash, type CloudEnv, type FileRecord } from './types.js';
import { CloudWorkspace, stageFile, commitStaged, jsonChunks, privatePath } from './workspace.js';
import { putObject } from './storage.js';
type Change = {
  path: string;
  sha: string | null;
  bytes: number;
  modified: string;
  data: string | null;
};
export class NativeOperation {
  constructor(readonly env: CloudEnv) {}
  async capture(ws: CloudWorkspace, actor: string, result: unknown) {
    if (ws.completion.length !== ws.effects.length)
      throw new CloudError('This operation must finish in a single transaction.', 413);
    if (ws.references.size)
      throw new CloudError(
        'Existing object references must use the native reference transaction.',
        413,
      );
    const files: Change[] = [];
    for (const [path, bytes] of ws.changed) {
      if (privatePath(path))
        throw new CloudError('Private credentials must use their bounded settings API.', 413);
      if (bytes === null && !ws.files.has(path)) continue;
      const sha = bytes ? await hash(bytes) : null;
      if (sha === ws.files.get(path)?.sha) continue;
      if (bytes && bytes.length > 8 * 1024 ** 2)
        throw new CloudError('Use the resumable media/import API for large files.', 413);
      files.push({
        path,
        sha,
        bytes: bytes?.length || 0,
        modified: new Date(ws.modified.get(path) || Date.now()).toISOString(),
        data: bytes ? btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')) : null,
      });
    }
    const id = crypto.randomUUID(),
      created = new Date().toISOString(),
      expires = new Date(Date.now() + 7 * 86400000).toISOString(),
      key = 'operations/' + id + '/plan.json';
    const manifest = { version: 1, id, files, result, effects: ws.effects };
    if (new TextEncoder().encode(JSON.stringify(manifest)).length > 16 * 1024 ** 2)
      throw new CloudError('This batch exceeds the safe planning size. Choose fewer items.', 413);
    await putObject(this.env, key, JSON.stringify(manifest));
    await this.env.DB.prepare(
      'INSERT INTO cloud_operations(id,actor,version,manifest_key,created,expires) VALUES(?,?,?,?,?,?)',
    )
      .bind(id, actor, ws.version, key, created, expires)
      .run();
    for (const chunk of jsonChunks(files.filter((file) => !file.sha).map((file) => [file.path])))
      await this.env.DB.prepare(
        "INSERT INTO cloud_patches(id,path,sha,bytes,modified,text,encrypted) SELECT ?,json_extract(value,'$[0]'),NULL,0,'',NULL,0 FROM json_each(?)",
      )
        .bind('operation-' + id, chunk)
        .run();
    ws.changed.clear();
    ws.completion.length = 0;
    ws.effects = [];
    return { nativeOperation: id, state: 'staging' };
  }
  async row(id: string, actor: string) {
    const row = await this.env.DB.prepare('SELECT * FROM cloud_operations WHERE id=? AND actor=?')
      .bind(z.uuid().parse(id), actor)
      .first<{
        id: string;
        version: number;
        state: string;
        manifest_key: string;
        expires: string;
      }>();
    if (!row) throw new CloudError('Staged operation not found.', 404);
    if (Date.parse(row.expires) < Date.now())
      throw new CloudError('Staged operation expired.', 410);
    const object = await this.env.BUCKET.get(row.manifest_key);
    if (!object) throw new CloudError('Operation plan is missing.', 503);
    return {
      row,
      plan: JSON.parse(await object.text()) as {
        version: number;
        files: Change[];
        result: any;
        effects?: { sql: string; values: unknown[] }[];
      },
    };
  }
  async describe(id: string, actor: string) {
    const { row, plan } = await this.row(id, actor);
    return {
      id,
      state: row.state,
      expiresAt: row.expires,
      files: row.state === 'complete' ? [] : plan.files,
      result: row.state === 'complete' ? plan.result : undefined,
    };
  }
  async upload(id: string, actor: string, path: string, bytes: Uint8Array) {
    const { row, plan } = await this.row(id, actor),
      file = plan.files.find((file) => file.path === path);
    if (
      row.state !== 'staging' ||
      !file?.sha ||
      file.bytes !== bytes.length ||
      file.sha !== (await hash(bytes))
    )
      throw new CloudError('The file differs from its operation plan.', 409);
    return stageFile(this.env, 'operation-' + id, path, bytes, file.modified);
  }
  async commit(id: string, actor: string) {
    const { row, plan } = await this.row(id, actor);
    if (row.state === 'complete') return plan.result;
    const files = (
      await this.env.DB.prepare('SELECT path,sha,bytes FROM cloud_patches WHERE id=?')
        .bind('operation-' + id)
        .all<FileRecord>()
    ).results;
    const expected = new Map(plan.files.map((file) => [file.path, file]));
    if (
      files.length !== expected.size ||
      files.some(
        (file) =>
          expected.get(file.path)?.sha !== file.sha ||
          expected.get(file.path)?.bytes !== file.bytes,
      )
    )
      throw new CloudError('Operation upload is incomplete.', 409);
    await commitStaged(this.env, 'operation-' + id, row.version, actor, false, [
      ...(plan.effects || []).map((effect) =>
        this.env.DB.prepare(effect.sql).bind(...effect.values),
      ),
      this.env.DB.prepare(
        "UPDATE cloud_operations SET state='complete' WHERE id=? AND state='staging'",
      ).bind(id),
    ]);
    return plan.result;
  }
}
