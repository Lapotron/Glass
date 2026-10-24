import { z } from 'zod';
import { NativeData } from './native-data.js';
import { NativeStore } from './native-store.js';
import { CloudWorkspace } from './workspace.js';
import { CloudError, type CloudEnv } from './types.js';
import { canonicalMediaUrl } from '../shared/media-details.js';
import { emptyProjects } from '../shared/projects.js';
import { librarySchema } from '../shared/contracts.js';
import { portableNotebookPath } from '../shared/notebook-data.js';
export class NativeReset {
  constructor(readonly env: CloudEnv) {}
  async idle() {
    if (
      await this.env.DB.prepare(
        "SELECT id FROM cloud_jobs WHERE state IN ('queued','running') LIMIT 1",
      ).first()
    )
      throw new CloudError('Wait for publication before resetting the notebook.', 409);
  }
  async review(ws: CloudWorkspace) {
    await this.idle();
    const model = await new NativeStore(ws).snapshot(),
      media = new Set<string>();
    const values = (value: unknown) => {
      if (typeof value === 'string' && value.startsWith('/media/'))
        media.add(canonicalMediaUrl(value));
      else if (Array.isArray(value)) value.forEach(values);
      else if (value && typeof value === 'object') Object.values(value).forEach(values);
    };
    values(model.site);
    const kept = new Set(['content/site.json']),
      records: Record<string, string> = {};
    for (const url of media) {
      const path = 'content/media/' + decodeURIComponent(url.slice(7));
      if (!ws.has(path)) throw new CloudError('Site settings reference missing media: ' + url);
      kept.add(path);
    }
    for (const path of ws
      .paths()
      .filter((path) => /^\.studio\/media-originals\/[^/]+\/record.json$/.test(path))) {
      const record = JSON.parse(new TextDecoder().decode(await ws.read(path))),
        variants = record.variants.filter((variant: any) =>
          kept.has('content/media/' + variant.name),
        );
      if (variants.length) {
        kept.add(path);
        kept.add(path.replace(/record.json$/, 'original'));
        records[path] = JSON.stringify({ ...record, variants });
      }
    }
    const backup = await new NativeData(this.env).snapshot(ws, 'before-reset'),
      id = crypto.randomUUID(),
      expiresAt = new Date(Date.now() + 20 * 60000).toISOString();
    const review = {
      id,
      sourceRevision: String(ws.version),
      expiresAt,
      siteName: model.site.name,
      keptMedia: [...media],
      backupBytes: backup.bytes,
      backupUrl: '/api/backups/' + backup.id + '/download',
      counts: {
        posts: model.entries.filter((entry) => entry.kind === 'posts').length,
        lab: model.entries.filter((entry) => entry.kind === 'lab').length,
        photos: model.library.photos.length,
        albums: model.library.albums.length,
        projects: model.projects?.projects.length || 0,
        media: ws.paths().filter((path) => path.startsWith('content/media/')).length,
        trash: ws.paths().filter((path) => /^\.studio\/trash\/.*\.json$/.test(path)).length,
        revisions: ws.paths().filter((path) => path.startsWith('.studio/revisions/')).length,
        backups: (await new NativeData(this.env).snapshots()).length,
        builds: ws.paths().filter((path) => path.startsWith('.studio/jobs/')).length,
      },
    };
    await this.env.DB.prepare('INSERT INTO cloud_reviews VALUES(?,?,?,?)')
      .bind(
        id,
        'native-reset',
        ws.version,
        JSON.stringify({ review, backup, kept: [...kept], records }),
      )
      .run();
    return review;
  }
  async commit(id: string, ws: CloudWorkspace, input: unknown) {
    await this.idle();
    const data = z
      .object({ confirmation: z.literal('RESET'), sourceRevision: z.string() })
      .parse(input);
    const row = await this.env.DB.prepare(
      "SELECT response,version FROM cloud_reviews WHERE id=? AND job_id='native-reset'",
    )
      .bind(z.uuid().parse(id))
      .first<{ response: string; version: number }>();
    if (!row) throw new CloudError('Reset review expired.', 409);
    const plan = JSON.parse(row.response);
    if (
      Date.parse(plan.review.expiresAt) < Date.now() ||
      row.version !== ws.version ||
      String(ws.version) !== data.sourceRevision
    )
      throw new CloudError('The notebook changed. Review reset again.', 409);
    const model = await new NativeStore(ws).snapshot(),
      kept = new Set(plan.kept);
    const legacyBackups = [...ws.files.values()].filter((file) =>
      /^\.studio\/backups\/\d+-[a-f0-9-]+\.json$/.test(file.path),
    );
    if (legacyBackups.length)
      await new NativeData(this.env).deleteHistory(ws, {
        items: legacyBackups.map((file) => ({ path: file.path, revision: file.sha })),
      });
    for (const path of ws.paths())
      if (
        !kept.has(path) &&
        (portableNotebookPath(path) ||
          /^\.studio\/(?:jobs|job-history|builds|render-cache|assets|backups|search-console|analytics|health)\//.test(
            path,
          ))
      )
        ws.write(path, null);
    for (const [path, value] of Object.entries(plan.records))
      ws.write(path, new TextEncoder().encode(value as string));
    const library = librarySchema.parse({
      photos: [],
      albums: [],
      news: [],
      mediaDetails: Object.fromEntries(
        Object.entries(model.library.mediaDetails).filter(([url]) =>
          plan.review.keptMedia.includes(url),
        ),
      ),
    });
    ws.write(
      'content/library.json',
      new TextEncoder().encode(JSON.stringify(library, null, 2) + '\n'),
    );
    ws.write(
      'content/projects.json',
      new TextEncoder().encode(JSON.stringify(emptyProjects(), null, 2) + '\n'),
    );
    ws.write('content/about.md', new Uint8Array());
    ws.complete('DELETE FROM cloud_reviews WHERE id=?', id);
    ws.complete(
      'UPDATE cloud_snapshots SET deleted=?,expires=? WHERE deleted IS NULL AND id!=?',
      new Date().toISOString(),
      new Date(Date.now() + 7 * 86400000).toISOString(),
      plan.backup.id,
    );
    return {
      recovery: {
        id: plan.backup.id,
        bytes: plan.backup.bytes,
        createdAt: plan.backup.createdAt,
        url: plan.review.backupUrl,
      },
      counts: plan.review.counts,
    };
  }
}
