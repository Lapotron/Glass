import { z } from 'zod';
import { CloudError, type CloudEnv, type FileRecord } from './types.js';
import { CloudWorkspace } from './workspace.js';
import { NativeStore } from './native-store.js';
import { cloudMedia } from './media.js';
import { putObject, pinObjects } from './storage.js';
import { NativeData, historyPath } from './native-data.js';
type ArchiveFile = FileRecord & { sourcePath?: string };
export class NativeArchive {
  constructor(readonly env: CloudEnv) {}
  async history(ws: CloudWorkspace, actor: string, input: unknown) {
    const { items } = z
      .object({
        items: z
          .array(z.object({ path: z.string(), revision: z.string() }))
          .min(1)
          .max(500),
      })
      .parse(input);
    if (new Set(items.map((item) => item.path)).size !== items.length)
      throw new CloudError('Choose each history record once.');
    const files = items.map((item) => {
      const file = ws.files.get(item.path);
      if (!file || !historyPath(item.path) || file.encrypted || file.sha !== item.revision)
        throw new CloudError('History selection changed. Reload before downloading.', 409);
      return { ...file, text: null };
    });
    return this.lease(files, actor);
  }
  async select(ws: CloudWorkspace, actor: string, kind: 'content' | 'media', input: unknown) {
    const data = z
        .object({
          items: z
            .array(z.object({ id: z.string(), revision: z.string() }))
            .min(1)
            .max(500),
        })
        .parse(input),
      store = new NativeStore(ws),
      model = await store.snapshot(),
      media = kind === 'media' ? await cloudMedia(ws, store) : [];
    if (new Set(data.items.map((item) => item.id)).size !== data.items.length)
      throw new CloudError('Choose each export item once.');
    const files: ArchiveFile[] = data.items.map((item) => {
      const entry = model.entries.find((entry) => entry.id === item.id),
        asset = media.find((file) => file.url === item.id);
      const path =
        kind === 'content' && entry && entry.revision === item.revision
          ? 'content/' + entry.kind + '/' + entry.file
          : kind === 'media' && asset && asset.revision === item.revision
            ? 'content/media/' + asset.name
            : '';
      const record = ws.files.get(path);
      if (!record)
        throw new CloudError('The export selection changed. Reload before downloading.', 409);
      return { ...record, text: null, sourcePath: path, path: path.slice('content/'.length) };
    });
    return this.lease(files, actor);
  }
  async lease(files: ArchiveFile[], actor: string, portable = false) {
    await pinObjects(
      this.env,
      files.map((file) => 'workspace/blobs/' + file.sha),
    );
    const id = crypto.randomUUID(),
      key = 'exports/' + id + '/manifest.json',
      created = new Date().toISOString(),
      expires = new Date(Date.now() + 86400000).toISOString();
    await putObject(this.env, key, JSON.stringify({ version: 1, files, portable }));
    await this.env.DB.batch([
      this.env.DB.prepare('INSERT INTO cloud_exports VALUES(?,?,?,?,?)').bind(
        id,
        actor,
        key,
        created,
        expires,
      ),
      this.env.DB.prepare('INSERT INTO cloud_manifest_roots VALUES(?,?)').bind(
        key,
        JSON.stringify([...new Set(files.map((file) => 'workspace/blobs/' + file.sha))]),
      ),
    ]);
    return { id, name: 'glass-export.tar.gz', expiresAt: expires };
  }
  async snapshot(id: string, actor: string) {
    const manifest = await new NativeData(this.env).manifest(id);
    return this.lease(manifest.files, actor, true);
  }
  async artifactExport(id: string, actor: string) {
    const manifest = await this.artifact(id);
    return this.lease(manifest.files, actor);
  }
  async manifest(id: string, actor: string) {
    const row = await this.env.DB.prepare(
      'SELECT manifest_key FROM cloud_exports WHERE id=? AND actor=? AND expires>?',
    )
      .bind(z.uuid().parse(id), actor, new Date().toISOString())
      .first<{ manifest_key: string }>();
    if (!row) throw new CloudError('Export expired. Select the files again.', 410);
    const source = await this.env.BUCKET.get(row.manifest_key);
    if (!source) throw new CloudError('Export index is unavailable.', 503);
    return JSON.parse(await source.text()) as { files: ArchiveFile[] };
  }
  async artifact(id: string) {
    if (!/^[\w-]{1,100}$/.test(id)) throw new CloudError('Invalid build identity.');
    const row = await this.env.DB.prepare(
      'SELECT manifest_key,expired FROM cloud_artifacts WHERE job_id=?',
    )
      .bind(id)
      .first<{ manifest_key: string; expired: string | null }>();
    if (!row || row.expired)
      throw new CloudError(
        'The downloadable artifact has expired. The live deployment and build report are kept.',
        410,
      );
    const source = await this.env.BUCKET.get(row.manifest_key);
    if (!source) throw new CloudError('Artifact index is missing.', 503);
    return JSON.parse(await source.text()) as { files: ArchiveFile[] };
  }
}
