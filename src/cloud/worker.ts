import {
  startMigration,
  uploadMigration,
  finishMigration,
  migrationSession,
  linkMigration,
} from './migration.js';
import { putObject, reserveObject } from './storage.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { Store, ConflictError, digest } from '../engine/store.js';
import { saveProjects, undoProjects, importGithubProject } from '../engine/projects.js';
import { MediaMaintenance, type CleanupReview } from '../engine/media-maintenance.js';
import { canonicalMediaUrl } from '../shared/media-details.js';
import { entrySchema, publicEntry } from '../shared/contracts.js';
import { inspectMarkdown } from '../shared/markdown-analysis.js';
import { CloudWorkspace, filePath, unseal, stageFile, commitStaged } from './workspace.js';
import { withWorkspace } from './filesystem.js';
import { authenticate, checkOrigin, csrf, equalSecret } from './auth.js';
import { enqueue, claimBuild, type CloudJob } from './jobs.js';
import { CloudError, json, type Actor, type CloudEnv } from './types.js';
import { ConnectionSettings, PrivateSettings } from '../server/configuration.js';
import { analyticsStatus, proxyAnalytics } from '../server/analytics.js';
import { cloudMedia } from './media.js';
import { mediaMetadataSchema, mediaDownloadName } from '../shared/media-metadata.js';
import { effectiveMediaCode, mediaLinkMap } from '../engine/media-links.js';
import { serveMcp } from './mcp.js';
import { hash } from './types.js';
import { backupSettingsSchema } from '../shared/operations.js';
import { CloudTransfers, boundedUploadBody } from './transfers.js';
import { BACKUP_CHUNK_BYTES } from '../shared/backup-transfer.js';
import { cloudSchedule } from './schedule.js';
import { deferApprovedBuild, deferredBuildStatus, runDeferredBuild } from './deferred.js';
import { history, cloudJobRecord, persistHistory } from './history.js';
import { Operations, snapshotRevision, type MarkdownImportPlan } from '../engine/operations.js';
import { savedSegmentsSchema } from '../shared/aca-segments.js';
import { SearchConsoleService } from '../server/search-console.js';
import { annotationReader } from '../shared/annotations.js';
import { resolveEntrySettings } from '../shared/entry-settings.js';
import { acaSummary, saveAca } from './services.js';
import { HealthService } from '../server/health.js';
import { serviceReadiness } from '../server/service-readiness.js';
import { checkCloudflareConnection, checkR2Connection } from './connection-checks.js';
import { r2Readiness } from '../server/r2-readiness.js';
import { NativeStore } from './native-store.js';
import { NativeData, storageMaintenance } from './native-data.js';
import { NativeMedia } from './native-media.js';
import { portableNotebookPath } from '../shared/notebook-data.js';
import { pipelineMode, cloudMaintenancePath } from '../shared/cloud-pipeline.js';
import { PagesConnection } from './pages.js';
import { cameraFromImageHeader } from './image-details.js';
import { jobRecord } from '../server/job-history.js';
import { NativeReset } from './native-reset.js';
import { NativeOperation } from './native-operation.js';
import { NativeArchive } from './native-archive.js';
import { MediaProtectionService } from '../server/media-protection.js';
import { discussionCheckSchema, checkDiscussionConfiguration } from '../server/discussions.js';
import { discussionThemePreview } from '../engine/discussion-preview.js';
import { siteSchema } from '../shared/contracts.js';
import seed from '../../tests/fixtures/notebook/site.json';

const base = '/workspace';
const asJob = cloudJobRecord;
async function listJobs(env: CloudEnv) {
  return (
    await env.DB.prepare(
      'SELECT j.*,p.phase,p.logs FROM cloud_jobs j LEFT JOIN cloud_progress p ON p.job_id=j.id ORDER BY j.created DESC LIMIT 100',
    ).all<CloudJob>()
  ).results;
}
async function initialized(ws: CloudWorkspace, env: CloudEnv) {
  if (ws.has('content/site.json')) return;
  ws.write(
    'content/site.json',
    new TextEncoder().encode(
      JSON.stringify({
        ...seed,
        url: env.SITE_ORIGIN,
        profile: { ...seed.profile, portrait: '' },
        cloudflare: { ...seed.cloudflare, accountId: env.CLOUDFLARE_ACCOUNT_ID || '' },
      }),
    ),
  );
  ws.write(
    'content/library.json',
    new TextEncoder().encode(JSON.stringify({ photos: [], albums: [], news: [] })),
  );
  ws.write(
    'content/about.md',
    new TextEncoder().encode(
      '# Welcome\n\nImport your existing notebook in Hosting before publishing.\n',
    ),
  );
  await ws.commit('bootstrap');
  ws.changed.clear();
  await ws.load();
}
async function readObject(env: CloudEnv, record: { path: string; sha: string; encrypted: number }) {
  const object = await env.BUCKET.get(
    'workspace/' +
      (record.encrypted ? 'secrets/' + encodeURIComponent(record.path) + '/' : 'blobs/') +
      record.sha,
  );
  if (!object) throw new CloudError('A captured notebook object is missing.', 503);
  return record.encrypted
    ? new Response(
        await unseal(new Uint8Array(await object.arrayBuffer()), env.STUDIO_SECRET, record.path),
      )
    : new Response(object.body);
}
async function privateFile(env: CloudEnv, path: string) {
  const record = await env.DB.prepare(
    'SELECT path,sha,encrypted,bytes FROM cloud_files WHERE path=?',
  )
    .bind(filePath(path))
    .first<{ path: string; sha: string; encrypted: number; bytes: number }>();
  if (!record) throw new CloudError('File not found.', 404);
  return record;
}
export function createCloudApp(
  options: { authenticate?: typeof authenticate; connectionFetch?: typeof fetch } = {},
) {
  const app = new Hono<{
    Bindings: CloudEnv;
    Variables: { actor: Actor; csrf: string; workspace: CloudWorkspace; store: Store };
  }>();
  app.onError((error, _c) => {
    if (/private storage maintenance in progress/i.test(error.message))
      return json(
        {
          error:
            'Storage cleanup is running. Retry after it finishes; your draft and staged files are preserved.',
        },
        409,
      );
    if (/free tier daily row write limit|exceeded.*daily.*writ/i.test(error.message)) {
      const reset = new Date();
      reset.setUTCHours(24, 0, 0, 0);
      return new Response(
        JSON.stringify({
          error:
            'Cloudflare D1 reached its free daily write quota. Saving and publishing can resume after ' +
            reset.toISOString() +
            '. Keep unsaved draft tabs open.',
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-store',
            'Retry-After': String(Math.ceil((reset.getTime() - Date.now()) / 1000)),
          },
        },
      );
    }
    return json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('\n')
            : error.message,
      },
      error instanceof CloudError ? error.status : error instanceof ConflictError ? 409 : 400,
    );
  });
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Referrer-Policy', 'same-origin');
    if (c.req.path.startsWith('/__ci/')) {
      if (new URL(c.req.url).origin !== c.env.STUDIO_ORIGIN)
        throw new CloudError('This build coordinator hostname is not configured.', 403);
      if (
        !(await equalSecret(
          c.req.header('Authorization')?.replace(/^Bearer /, '') || null,
          c.env.CI_TOKEN,
        ))
      )
        throw new CloudError('Build authentication required.', 401);
      await next();
      return;
    }
    checkOrigin(c.req.raw, c.env);
    let actor: Actor;
    if (c.req.path === '/mcp' && c.req.header('Authorization')?.startsWith('Bearer ')) {
      const key = await c.env.DB.prepare(
        'SELECT k.actor,a.email FROM cloud_keys k JOIN cloud_actors a ON a.id=k.actor WHERE k.digest=? AND k.revoked=0 AND k.scopes=?',
      )
        .bind(await hash(c.req.header('Authorization')!.slice(7)), 'draft')
        .first<{ actor: string; email: string }>();
      if (!key) throw new CloudError('Authoring token is invalid or revoked.', 401);
      if (
        !c.env.ACCESS_ADMINS.toLowerCase()
          .split(',')
          .map((value) => value.trim())
          .includes(key.email.toLowerCase())
      )
        throw new CloudError('This authoring key no longer belongs to an allowed owner.', 403);
      actor = { id: key.actor, email: key.email };
    } else actor = await (options.authenticate || authenticate)(c.req.raw, c.env);
    c.set('actor', actor);
    c.set('csrf', await csrf(actor, c.env));
    if (
      c.req.path !== '/mcp' &&
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      c.req.header('X-Studio-Token') !== c.get('csrf')
    )
      throw new CloudError('Your Studio session expired. Reload this page.', 403);
    if (
      c.req.path !== '/mcp' &&
      !c.req.path.startsWith('/api/') &&
      !c.req.path.startsWith('/media/')
    ) {
      await next();
      return;
    }
    if (
      c.req.path.startsWith('/media/') ||
      /^\/api\/(?:jobs\/[\w-]+\/log|backups\/[\w-]+\/download|media\/[\w-]+\/source|notebook\/reset\/[\w-]+\/backup)$/.test(
        c.req.path,
      ) ||
      /^\/api\/(?:cloud-jobs\/|cloud\/(?:pulse$|mcp-keys(?:\/|$)|migration(?:\/|$)))/.test(
        c.req.path,
      ) ||
      /^\/api\/cloud\/(?:operations|exports)(?:\/|$)/.test(c.req.path) ||
      /^\/api\/jobs\/[\w-]+\/artifact\/(?:manifest|file|export)$/.test(c.req.path) ||
      /^\/api\/backups\/[\w-]+\/(?:manifest|file|export)$/.test(c.req.path) ||
      (c.req.path.startsWith('/api/media/uploads') && !c.req.path.endsWith('/commit')) ||
      /^\/api\/backups\/uploads(?:\/|$)/.test(c.req.path)
    ) {
      await next();
      return;
    }
    const knownActor = await c.env.DB.prepare(
      'SELECT id FROM cloud_actors WHERE id=? AND email=? AND role=?',
    )
      .bind(actor.id, actor.email, 'owner')
      .first();
    if (
      !knownActor &&
      !['GET', 'HEAD'].includes(c.req.method) &&
      c.req.path !== '/api/connections/test'
    )
      await c.env.DB.prepare(
        'INSERT INTO cloud_actors(id,email,role,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,role=excluded.role',
      )
        .bind(actor.id, actor.email, 'owner', new Date().toISOString())
        .run();
    const workingSet =
      c.req.path === '/mcp' ||
      /^\/api\/(?:bootstrap$|jobs$|content(?:$|\/[\w-]+(?:\/(?:download|revisions.*))?$)|pages\/about(?:\/|$)|site$|library$|projects$|maintenance$|health$|cloud\/status$|cloud-media\/protection$|connections(?:\/|$)|analytics(?:[-/]|$)|media(?:$|\/(?:metadata|details)$)|schedule$|aca\/deployment$|services\/readiness$|integrations\/)/.test(
        c.req.path,
      );
    const core =
      /^\/api\/(?:bootstrap|content|site|projects|connections(?:\/.*)?|analytics(?:[-/].*)?|cloud\/pages(?:\/.*)?|cloudflare(?:\/.*)?)$/.test(
        c.req.path,
      ) ||
      /^\/api\/content\/[\w-]+$/.test(c.req.path) ||
      c.req.path === '/api/cloud/status' ||
      (c.req.path === '/api/jobs' && c.req.method === 'GET');
    const catalog =
      /^\/api\/(?:storage|history|backups)(?:\/|$)/.test(c.req.path) ||
      cloudMaintenancePath(c.req.path) ||
      (c.req.path === '/api/jobs' && c.req.method !== 'GET');
    const workspace = await new CloudWorkspace(c.env).load(
      catalog ? 'catalog' : core ? 'core' : workingSet,
    );
    await initialized(workspace, c.env);
    c.set('workspace', workspace);
    c.set('store', new NativeStore(workspace));
    return withWorkspace(workspace, async () => {
      await next();
      if (c.res.status < 400) {
        if (
          [...workspace.changed.values()].filter((value) => value !== null).length > 5 &&
          workspace.completion.length === workspace.effects.length
        ) {
          const result = await c.res.json(),
            operation = await new NativeOperation(c.env).capture(workspace, actor.id, result);
          c.res = json(operation, 202);
        } else await workspace.commit(actor.id);
      }
    });
  });
  app.get('/__ci/claim', async (c) =>
    json(
      await claimBuild(
        c.env,
        c.req.query('build') || '',
        c.req.query('commit') || '',
        c.req.query('branch') || '',
      ),
    ),
  );
  app.get('/__ci/pipeline', async (c) => {
    if (c.env.PREVIEW === 'true' || c.req.query('branch') !== (c.env.PRODUCTION_BRANCH || 'main'))
      throw new CloudError('Production pipeline credentials cannot be used by previews.', 403);
    const build = c.req.query('build') || '';
    if (!/^[\w-]{1,100}$/.test(build)) throw new CloudError('Build metadata is required.');
    const job = await c.env.DB.prepare(
      'SELECT build_uuid,kind,state,request FROM cloud_jobs WHERE build_uuid=?',
    )
      .bind(build)
      .first<{ build_uuid: string | null; kind: string; state: string; request: string }>();
    const settling =
      !job &&
      !!(await c.env.DB.prepare(
        "SELECT id FROM cloud_jobs WHERE state='queued' AND build_uuid IS NULL",
      ).first());
    return json({ mode: pipelineMode(build, job), settling });
  });
  app.get('/__ci/workspace', async (c) => {
    const rows = (
      await c.env.DB.prepare(
        'SELECT w.version,f.path,f.sha,f.bytes,f.modified FROM cloud_workspace w LEFT JOIN cloud_files f ON 1=1 WHERE w.id=1',
      ).all<{ version: number; path: string; sha: string; bytes: number; modified: string }>()
    ).results;
    return json({
      version: rows[0]?.version || 0,
      files: rows.filter((row) => row.path).map(({ version: _version, ...file }) => file),
    });
  });
  app.post('/__ci/deferred-build', async (c) => json(await deferApprovedBuild(c.env)));
  app.get('/__ci/workspace/file', async (c) =>
    readObject(c.env, await privateFile(c.env, c.req.query('path') || '')),
  );
  app.post('/__ci/jobs/:id/progress', async (c) => {
    const job = await c.env.DB.prepare("SELECT id FROM cloud_jobs WHERE id=? AND state='running'")
      .bind(c.req.param('id'))
      .first();
    if (!job) throw new CloudError('This job is no longer active.', 409);
    const data = z
      .object({
        phase: z.enum([
          'building',
          'validating',
          'syncing-media',
          'verifying-media',
          'uploading',
          'verifying-deployment',
        ]),
        logs: z.array(z.string().max(2000)).max(200),
      })
      .strict()
      .parse(await c.req.json());
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO cloud_progress(job_id,phase,logs) VALUES(?,?,?) ON CONFLICT(job_id) DO UPDATE SET phase=excluded.phase,logs=excluded.logs',
      ).bind(c.req.param('id'), data.phase, JSON.stringify(data.logs)),
      c.env.DB.prepare('UPDATE cloud_jobs SET updated=? WHERE id=?').bind(
        new Date().toISOString(),
        c.req.param('id'),
      ),
    ]);
    return json({ ok: true });
  });
  app.get('/__ci/reader-assets', (c) =>
    c.env.ASSETS.fetch(new Request(new URL('/cloud-reader-assets.json', c.req.url))),
  );
  app.get('/__ci/deployment-credentials', async (c) => {
    const record = await c.env.DB.prepare(
      "SELECT * FROM cloud_files WHERE path='.studio/connections.json'",
    ).first<import('./types.js').FileRecord>();
    const ws = new CloudWorkspace(c.env);
    if (record) ws.files.set(record.path, record);
    return withWorkspace(ws, async () => {
      const values = await new ConnectionSettings(base, {
        CLOUDFLARE_API_TOKEN: c.env.CLOUDFLARE_API_TOKEN,
      }).values();
      if (!values.CLOUDFLARE_API_TOKEN)
        throw new CloudError(
          'Redeploy Studio with a Cloudflare build API token, or save a deployment token in Studio Credentials.',
          503,
        );
      return json({ CLOUDFLARE_API_TOKEN: values.CLOUDFLARE_API_TOKEN });
    });
  });
  app.get('/__ci/jobs/:id/result', async (c) => {
    const job = await c.env.DB.prepare('SELECT id FROM cloud_jobs WHERE id=?')
      .bind(c.req.param('id'))
      .first();
    if (!job) throw new CloudError('Unknown job.', 404);
    const object = await c.env.BUCKET.get('jobs/' + c.req.param('id') + '/objects/result.json');
    if (!object) throw new CloudError('This job has no result.', 404);
    return new Response(object.body, { headers: { 'Content-Type': 'application/json' } });
  });
  app.get('/__ci/jobs/:id/blob/:sha', async (c) => {
    const job = await c.env.DB.prepare('SELECT id FROM cloud_jobs WHERE id=?')
      .bind(c.req.param('id'))
      .first();
    if (!job) throw new CloudError('Unknown build.', 404);
    const record = await c.env.DB.prepare(
      'SELECT path,sha,encrypted FROM cloud_job_files WHERE job_id=? AND path=? AND sha=?',
    )
      .bind(c.req.param('id'), c.req.query('path') || '', c.req.param('sha'))
      .first<{ path: string; sha: string; encrypted: number }>();
    if (!record) throw new CloudError('This object is outside the captured snapshot.', 403);
    return readObject(c.env, record);
  });
  app.get('/__ci/jobs/:id/replay', async (c) => {
    const job = await c.env.DB.prepare(
      'SELECT j.*,p.phase,p.logs FROM cloud_jobs j LEFT JOIN cloud_progress p ON p.job_id=j.id WHERE j.id=?',
    )
      .bind(c.req.param('id'))
      .first<CloudJob>();
    if (!job) throw new CloudError('Job not found.', 404);
    const descriptor = JSON.parse(job.request),
      body = await c.env.BUCKET.get('jobs/' + job.id + '/request'),
      text =
        descriptor.contentType?.includes('application/json') && body && body.size < 2 * 1024 ** 2
          ? await body.text()
          : '';
    for (const id of (descriptor.path + ' ' + text).match(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g,
    ) || []) {
      const review = await c.env.DB.prepare('SELECT * FROM cloud_reviews WHERE id=?')
        .bind(id)
        .first<{ job_id: string; version: number; response: string }>();
      if (!review) continue;
      if (review.version !== job.version)
        throw new CloudError(
          'The notebook changed after review. Review again before continuing.',
          409,
        );
      const old = JSON.parse(review.response),
        expires =
          (old.review || old).expiresAt ||
          ((old.review || old).checkedAt
            ? new Date(Date.parse((old.review || old).checkedAt) + 600000).toISOString()
            : '');
      if (expires && Date.parse(expires) <= Date.now())
        throw new CloudError('This review expired. Review again before continuing.', 409);
      const original = await c.env.DB.prepare('SELECT request FROM cloud_jobs WHERE id=?')
        .bind(review.job_id)
        .first<{ request: string }>();
      return json({
        id,
        jobId: review.job_id,
        descriptor: JSON.parse(original!.request),
        response: old,
      });
    }
    return json({});
  });
  app.get('/__ci/jobs/:id/request', async (c) => {
    const object = await c.env.BUCKET.get('jobs/' + c.req.param('id') + '/request');
    return object ? new Response(object.body) : new Response(null, { status: 204 });
  });
  const transferJob = async (c: any) => {
    const job = await c.env.DB.prepare("SELECT * FROM cloud_jobs WHERE id=? AND state='running'")
      .bind(c.req.param('id'))
      .first();
    if (!job) throw new CloudError('No active job.', 409);
    return job as CloudJob;
  };
  app.post('/__ci/jobs/:id/transfers', async (c) => {
    const job = await transferJob(c),
      data = await c.req.json();
    if (!['file', 'object'].includes(data.purpose))
      throw new CloudError('Invalid transfer destination.');
    return json(
      await new CloudTransfers(c.env).start(job.actor, data, {
        purpose: data.purpose,
        target: data.target,
        sha: data.sha,
        modified: data.modified,
        job: job.id,
        unindexed:
          data.unindexed === '1' &&
          job.kind === 'publish' &&
          data.purpose === 'file' &&
          String(data.target).startsWith('.studio/builds/' + job.id + '/'),
      }),
    );
  });
  app.put('/__ci/jobs/:id/transfers/:transfer/parts/:part', async (c) => {
    const job = await transferJob(c),
      service = new CloudTransfers(c.env),
      row = await service.row(c.req.param('transfer'), job.actor);
    if (row.job_id !== job.id || row.purpose === 'backup')
      throw new CloudError('This transfer is outside the active job.', 403);
    return json(await service.part(row.id, job.actor, Number(c.req.param('part')), c.req.raw));
  });
  app.post('/__ci/jobs/:id/transfers/:transfer/complete', async (c) => {
    const job = await transferJob(c),
      service = new CloudTransfers(c.env),
      row = await service.row(c.req.param('transfer'), job.actor);
    if (row.job_id !== job.id || row.purpose === 'backup')
      throw new CloudError('This transfer is outside the active job.', 403);
    await service.finish(row.id, job.actor);
    return json({ ok: true });
  });
  app.get('/__ci/jobs/:id/backup-upload', async (c) => {
    const job = await c.env.DB.prepare('SELECT * FROM cloud_jobs WHERE id=?')
      .bind(c.req.param('id'))
      .first<CloudJob>();
    if (!job || JSON.parse(job.request).path !== '/api/backups/review-upload')
      throw new CloudError('This job has no uploaded backup.', 404);
    const request = await c.env.BUCKET.get('jobs/' + job.id + '/request');
    if (!request) throw new CloudError('The captured backup request is missing.');
    const input = JSON.parse(await request.text()),
      row = await new CloudTransfers(c.env).row(input.uploadId, job.actor);
    if (row.purpose !== 'backup' || row.state !== 'ready')
      throw new CloudError('This backup is outside the captured job.', 403);
    const archive = await c.env.BUCKET.get(row.key);
    if (!archive) throw new CloudError('The uploaded archive is missing.', 404);
    return new Response(archive.body, {
      headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(archive.size) },
    });
  });
  app.put('/__ci/jobs/:id/object/:key', async (c) => {
    const id = c.req.param('id'),
      key = c.req.param('key');
    if (!/^[\w.-]{1,150}$/.test(key)) throw new CloudError('Invalid job object.');
    const job = await c.env.DB.prepare('SELECT id FROM cloud_jobs WHERE id=? AND state=?')
      .bind(id, 'running')
      .first();
    if (!job) throw new CloudError('No active job.', 409);
    const length = Number(c.req.header('Content-Length'));
    if (!Number.isSafeInteger(length) || length < 0 || length > 90 * 1024 ** 2)
      throw new CloudError(
        'Result upload requires a bounded Content-Length (at most 90 MiB).',
        413,
      );
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength !== length)
      throw new CloudError('Result upload length does not match its header.');
    await putObject(c.env, 'jobs/' + id + '/objects/' + key, bytes);
    return json({ ok: true });
  });
  app.put('/__ci/jobs/:id/artifact-file', async (c) => {
    const job = await transferJob(c);
    if (job.kind !== 'publish')
      throw new CloudError('Only Publish can retain a public artifact.', 403);
    const sha = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(c.req.query('sha')),
      bytes = await boundedUploadBody(c.req.raw, BACKUP_CHUNK_BYTES);
    if ((await hash(bytes)) !== sha) throw new CloudError('Artifact checksum mismatch.');
    await reserveObject(c.env, 'workspace/blobs/' + sha, bytes.length);
    if (!(await c.env.BUCKET.head('workspace/blobs/' + sha)))
      await c.env.BUCKET.put('workspace/blobs/' + sha, bytes, { sha256: sha });
    return json({ ok: true });
  });
  app.put('/__ci/jobs/:id/artifact-index', async (c) => {
    const job = await transferJob(c);
    if (job.kind !== 'publish')
      throw new CloudError('Only Publish can retain a public artifact.', 403);
    const files = z
      .array(
        z.object({
          path: z
            .string()
            .min(1)
            .max(2048)
            .refine(
              (path) =>
                !path.startsWith('/') &&
                !path.includes('\\') &&
                !path.includes('\0') &&
                !path.split('/').some((part) => !part || part === '.' || part === '..'),
            ),
          sha: z.string().regex(/^[a-f0-9]{64}$/),
          bytes: z.number().int().nonnegative(),
          modified: z.string(),
          encrypted: z.literal(0),
          text: z.null(),
        }),
      )
      .min(1)
      .max(20000)
      .parse(await c.req.json());
    if (new Set(files.map((file) => file.path)).size !== files.length)
      throw new CloudError('Artifact paths must be unique.');
    const key = 'jobs/' + job.id + '/artifact.json';
    await putObject(c.env, key, JSON.stringify({ version: 1, files }));
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT OR REPLACE INTO cloud_artifacts VALUES(?,?,?,?,?,NULL)').bind(
        job.id,
        key,
        new Date().toISOString(),
        files.length,
        files.reduce((sum, file) => sum + file.bytes, 0),
      ),
      c.env.DB.prepare('INSERT OR REPLACE INTO cloud_manifest_roots VALUES(?,?)').bind(
        key,
        JSON.stringify([...new Set(files.map((file) => 'workspace/blobs/' + file.sha))]),
      ),
    ]);
    return json({ ok: true });
  });
  app.post('/__ci/jobs/:id/complete', async (c) => {
    const job = await c.env.DB.prepare(
      'SELECT j.*,p.phase,p.logs FROM cloud_jobs j LEFT JOIN cloud_progress p ON p.job_id=j.id WHERE j.id=?',
    )
      .bind(c.req.param('id'))
      .first<CloudJob>();
    if (!job || job.state !== 'running') throw new CloudError('This job is not running.', 409);
    const input = await c.req.json<{
      status: number;
      resultKey?: string;
      error?: string;
      staged?: boolean;
      changes?: { path: string; key: string | null }[];
    }>();
    if (job.kind === 'publish' && input.status < 400) {
      const verified = await c.env.DB.prepare(
        "SELECT id FROM cloud_releases WHERE id=? AND state IN ('live','staged') AND deployment_url IS NOT NULL AND build_uuid=?",
      )
        .bind(job.release_id, job.build_uuid)
        .first();
      if (!verified)
        throw new CloudError('Verify the live release before completing publication.', 409);
    }
    const ws = await new CloudWorkspace(c.env).load();
    if (input.staged && job.kind === 'api') {
      const destructive = /\/(?:restore|commit|cleanup|prepare)(?:\?|$)/.test(
        JSON.parse(job.request).path || '',
      );
      const conflict = await c.env.DB.prepare(
        "SELECT p.path FROM cloud_patches p LEFT JOIN cloud_files f ON f.path=p.path LEFT JOIN cloud_job_files b ON b.job_id=? AND b.path=p.path WHERE p.id=? AND COALESCE(f.sha,'')!=COALESCE(b.sha,'') LIMIT 1",
      )
        .bind(job.id, 'job-' + job.id)
        .first();
      if (conflict)
        throw new CloudError(
          'A file changed while this operation ran. The staged result was retained; no files were replaced.',
          409,
        );
      await commitStaged(c.env, 'job-' + job.id, destructive ? job.version : ws.version, job.actor);
    }
    if (job.kind !== 'api') {
      const staged = await c.env.DB.prepare('SELECT path FROM cloud_patches WHERE id=?')
        .bind('job-' + job.id)
        .all<{ path: string }>();
      if (
        staged.results.some(
          (f) =>
            !f.path.startsWith('.studio/builds/' + job.id + '/') &&
            !f.path.startsWith('.studio/render-cache/mermaid/') &&
            !f.path.startsWith('.studio/cloud-media/'),
        )
      )
        throw new CloudError('A publication cannot modify canonical content.', 403);
      if (staged.results.length) await commitStaged(c.env, 'job-' + job.id, ws.version, job.actor);
    }
    if (input.changes?.length) {
      if (ws.version !== job.version)
        throw new CloudError(
          'The notebook changed while this job ran. Its result was retained; no changes were applied.',
          409,
        );
      for (const item of input.changes) {
        const path = filePath(item.path);
        if (item.key === null) ws.write(path, null);
        else {
          if (!/^[\w.-]{1,150}$/.test(item.key)) throw new CloudError('Invalid result object.');
          const value = await c.env.BUCKET.get('jobs/' + job.id + '/objects/' + item.key);
          if (!value) throw new CloudError('A job result object is missing.');
          ws.write(path, new Uint8Array(await value.arrayBuffer()));
        }
      }
      await ws.commit(job.actor);
    }
    if (
      input.status < 400 &&
      input.resultKey &&
      /(?:\/review(?:-upload)?(?:[/?]|$)|\/protection\/check$)/.test(
        JSON.parse(job.request).path || '',
      )
    ) {
      const object = await c.env.BUCKET.get('jobs/' + job.id + '/objects/' + input.resultKey);
      if (object) {
        const payload = JSON.parse(await object.text()),
          review = payload.body?.review || payload.body;
        if (typeof review?.id === 'string') {
          const current = await c.env.DB.prepare(
            'SELECT version FROM cloud_workspace WHERE id=1',
          ).first<{ version: number }>();
          await c.env.DB.prepare(
            'INSERT OR REPLACE INTO cloud_reviews(id,job_id,version,response) VALUES(?,?,?,?)',
          )
            .bind(review.id, job.id, current!.version, JSON.stringify(payload.body))
            .run();
        }
      }
    }
    await c.env.DB.prepare(
      'UPDATE cloud_control SET deploy_lease=NULL,lease_expires=NULL WHERE deploy_lease=?',
    )
      .bind(job.id)
      .run();
    const completed = {
      ...job,
      state: input.status < 400 ? 'succeeded' : 'failed',
      updated: new Date().toISOString(),
      result_key: input.resultKey || null,
      error: input.error || null,
    };
    const resultObject = input.resultKey
      ? await c.env.BUCKET.get('jobs/' + job.id + '/objects/' + input.resultKey)
      : null;
    await persistHistory(
      c.env,
      completed,
      resultObject ? JSON.parse(await resultObject.text()) : undefined,
    );
    await c.env.DB.prepare(
      'UPDATE cloud_jobs SET state=?,updated=?,result_key=?,error=? WHERE id=?',
    )
      .bind(
        input.status < 400 ? 'succeeded' : 'failed',
        new Date().toISOString(),
        input.resultKey || null,
        input.error || null,
        job.id,
      )
      .run();
    if (job.kind === 'publish')
      await c.env.DB.prepare('UPDATE cloud_gc_schedule SET next=? WHERE id=1 AND next>?')
        .bind(
          new Date(Date.now() + 3600000).toISOString(),
          new Date(Date.now() + 3600000).toISOString(),
        )
        .run();
    if (
      input.status < 400 &&
      job.kind === 'api' &&
      JSON.parse(job.request).path === '/api/schedule/prepare'
    ) {
      const current = await new CloudWorkspace(c.env).load(true);
      await withWorkspace(current, async () => {
        const model = await new Store(base).snapshot();
        await enqueue(
          new Request(c.env.STUDIO_ORIGIN + '/api/jobs', { method: 'POST' }),
          c.env,
          current,
          { id: 'scheduler', email: 'scheduler' },
          model.site.publishing.scheduleAction === 'publish' ? 'publish' : 'build',
        );
      });
    }
    return json({ ok: true });
  });
  app.post('/__ci/jobs/:id/deploy-lease', async (c) => {
    const job = await c.env.DB.prepare('SELECT * FROM cloud_jobs WHERE id=?')
      .bind(c.req.param('id'))
      .first<CloudJob>();
    if (!job || job.kind !== 'publish' || job.state !== 'running')
      throw new CloudError('No publication is active.', 409);
    const row = await c.env.DB.prepare(
      'SELECT approved_release,deploy_lease,lease_expires FROM cloud_control WHERE id=1',
    ).first<{
      approved_release: string;
      deploy_lease: string | null;
      lease_expires: number | null;
    }>();
    if (row?.approved_release !== job.release_id)
      throw new CloudError('This release was superseded before deployment.', 409);
    const now = Date.now();
    if (row.deploy_lease && row.deploy_lease !== job.id && (row.lease_expires || 0) > now)
      throw new CloudError('Another deployment is active.', 409);
    await c.env.DB.prepare(
      'UPDATE cloud_control SET deploy_lease=?,lease_expires=? WHERE id=1 AND approved_release=?',
    )
      .bind(job.id, now + 20 * 60_000, job.release_id)
      .run();
    return json({ ok: true });
  });
  app.post('/__ci/jobs/:id/live', async (c) => {
    const job = await c.env.DB.prepare('SELECT * FROM cloud_jobs WHERE id=?')
      .bind(c.req.param('id'))
      .first<CloudJob>();
    const { url, project, staged } = await c.req.json<{
      url: string;
      project?: string;
      staged?: boolean;
    }>();
    if (!job || job.kind !== 'publish' || job.state !== 'running')
      throw new CloudError('No publication is active.', 409);
    const lease = await c.env.DB.prepare(
      'SELECT approved_release,deploy_lease FROM cloud_control WHERE id=1',
    ).first<{ approved_release: string; deploy_lease: string | null }>();
    if (lease?.deploy_lease !== job.id || lease.approved_release !== job.release_id)
      throw new CloudError('This publication no longer owns the deployment lease.', 409);
    const target = new URL(url);
    const siteRow = await c.env.DB.prepare(
      "SELECT text FROM cloud_files WHERE path='content/site.json'",
    ).first<{ text: string }>();
    const pagesProject =
      c.env.PAGES_PROJECT || JSON.parse(siteRow?.text || '{}').cloudflare?.projectName;
    const pagesOrigin =
      project === pagesProject &&
      /^[a-z0-9][a-z0-9-]{0,57}$/.test(project || '') &&
      target.protocol === 'https:' &&
      !target.port &&
      (target.hostname === project + '.pages.dev' ||
        target.hostname.endsWith('.' + project + '.pages.dev'));
    if (
      !pagesOrigin &&
      ![c.env.SITE_ORIGIN, c.env.SITE_STAGING_ORIGIN].filter(Boolean).includes(target.origin)
    )
      throw new CloudError('Deployment verification must use the configured site origin.');
    // CI probes the canonical hostname; same-zone Worker routing makes the
    // exact workers.dev origin the independent coordinator probe.
    const probe =
      !project && target.origin === c.env.SITE_ORIGIN && c.env.SITE_STAGING_ORIGIN
        ? c.env.SITE_STAGING_ORIGIN
        : target.origin;
    const response = await fetch(new URL('/assets/deployment.json', probe), {
        cache: 'no-store',
        redirect: 'manual',
      }),
      marker = (await response.json()) as { id: string };
    if (!response.ok || marker.id !== job.id)
      throw new CloudError('The live deployment marker does not match this build.', 503);
    const applied = await c.env.DB.prepare(
      'UPDATE cloud_control SET live_release=CASE WHEN ? THEN live_release ELSE ? END,deploy_lease=NULL,lease_expires=NULL WHERE id=1 AND deploy_lease=? AND approved_release=? RETURNING id',
    )
      .bind(staged ? 1 : 0, job.release_id, job.id, job.release_id)
      .first();
    if (!applied) throw new CloudError('This publication was superseded during verification.', 409);
    await c.env.DB.prepare(
      'UPDATE cloud_releases SET state=?,deployment_url=?,build_uuid=? WHERE id=?',
    )
      .bind(staged ? 'staged' : 'live', target.origin, job.build_uuid, job.release_id)
      .run();
    return json({ ok: true });
  });
  app.put('/__ci/jobs/:id/file', async (c) => {
    const job = await c.env.DB.prepare('SELECT id FROM cloud_jobs WHERE id=? AND state=?')
      .bind(c.req.param('id'), 'running')
      .first();
    if (!job) throw new CloudError('No active job.', 409);
    return json(
      await stageFile(
        c.env,
        'job-' + c.req.param('id'),
        c.req.query('path') || '',
        await boundedUploadBody(c.req.raw, BACKUP_CHUNK_BYTES),
        c.req.header('X-File-Modified'),
      ),
    );
  });
  app.delete('/__ci/jobs/:id/file', async (c) => {
    const job = await c.env.DB.prepare('SELECT id FROM cloud_jobs WHERE id=? AND state=?')
      .bind(c.req.param('id'), 'running')
      .first();
    if (!job) throw new CloudError('No active job.', 409);
    return json(
      await stageFile(c.env, 'job-' + c.req.param('id'), c.req.query('path') || '', null),
    );
  });
  app.post('/__ci/jobs/:id/deletions', async (c) => {
    const job = await c.env.DB.prepare("SELECT id FROM cloud_jobs WHERE id=? AND state='running'")
      .bind(c.req.param('id'))
      .first();
    if (!job) throw new CloudError('No active job.', 409);
    const paths = z
      .array(z.string().max(2048))
      .max(1000)
      .parse(await c.req.json())
      .map(filePath);
    await c.env.DB.prepare(
      "INSERT OR REPLACE INTO cloud_patches(id,path,sha,bytes,modified,text,encrypted) SELECT ?,value,NULL,0,'',NULL,0 FROM json_each(?)",
    )
      .bind('job-' + c.req.param('id'), JSON.stringify(paths))
      .run();
    return json({ ok: true, files: paths.length });
  });
  app.post('/api/cloud/migration', async (c) => {
    const row = await c.env.DB.prepare('SELECT version FROM cloud_workspace WHERE id=1').first<{
        version: number;
      }>(),
      input = await c.req.json<{ version?: number }>();
    if (input.version !== undefined && input.version !== row!.version)
      throw new CloudError(
        'The notebook changed after import review. Refresh Hosting and review again.',
        409,
      );
    return json(await startMigration(c.env, c.get('actor').id, row!.version));
  });
  app.put('/api/cloud/migration/:id/file', async (c) =>
    json(
      await uploadMigration(
        c.env,
        c.req.param('id'),
        c.get('actor').id,
        c.req.query('path') || '',
        await boundedUploadBody(c.req.raw, BACKUP_CHUNK_BYTES),
        c.req.header('X-File-Modified'),
      ),
    ),
  );
  app.get('/api/cloud/migration/:id', async (c) => {
    const id = z.uuid().parse(c.req.param('id'));
    const record = await c.env.DB.prepare(
      'SELECT state,version FROM cloud_migrations WHERE id=? AND actor=?',
    )
      .bind(id, c.get('actor').id)
      .first();
    if (!record) throw new CloudError('Import session not found.', 404);
    const files = await c.env.DB.prepare(
      'SELECT path,sha,bytes FROM cloud_patches WHERE id=? AND sha IS NOT NULL',
    )
      .bind('migration-' + id)
      .all();
    return json({ ...record, files: files.results });
  });
  const migrationActor = (c: any) =>
    c.req.path.startsWith('/__ci/') ? 'initial-migration' : c.get('actor').id;
  const startMigrationUpload = async (c: any) => {
    const actor = migrationActor(c),
      id = c.req.param('id'),
      data = await c.req.json();
    await migrationSession(c.env, id, actor);
    if (
      !String(data.path || '').startsWith('content/media/') &&
      !/^\.studio\/media-originals\/[^/]+\/original$/.test(data.path || '')
    )
      throw new CloudError(
        'Large multipart migration files must be media or private originals. Import text through the bounded file API.',
        413,
      );
    return json(
      await new CloudTransfers(c.env).start(actor, data, {
        purpose: 'migration',
        target: data.path,
        sha: data.sha,
        modified: data.modified,
        job: id,
      }),
      201,
    );
  };
  app.post('/api/cloud/migration/:id/uploads', startMigrationUpload);
  app.post('/__ci/migration/:id/uploads', startMigrationUpload);
  const migrationTransfer = async (c: any) => {
    const actor = migrationActor(c),
      id = c.req.param('id');
    await migrationSession(c.env, id, actor);
    const service = new CloudTransfers(c.env),
      row = await service.row(c.req.param('transfer'), actor);
    if (row.purpose !== 'migration' || row.job_id !== id)
      throw new CloudError('This transfer is outside the import.', 403);
    return { service, row, actor };
  };
  const uploadMigrationPart = async (c: any) => {
    const { service, row, actor } = await migrationTransfer(c);
    return json(await service.part(row.id, actor, Number(c.req.param('part')), c.req.raw));
  };
  app.put('/api/cloud/migration/:id/uploads/:transfer/parts/:part', uploadMigrationPart);
  app.put('/__ci/migration/:id/uploads/:transfer/parts/:part', uploadMigrationPart);
  const completeMigrationUpload = async (c: any) => {
    const { service, row, actor } = await migrationTransfer(c);
    await service.finish(row.id, actor);
    return json({ path: row.target, sha: row.sha, bytes: row.bytes });
  };
  app.post('/api/cloud/migration/:id/uploads/:transfer/complete', completeMigrationUpload);
  app.post('/__ci/migration/:id/uploads/:transfer/complete', completeMigrationUpload);
  app.post('/api/cloud/migration/:id/commit', async (c) =>
    json(await finishMigration(c.env, c.req.param('id'), c.get('actor').id, await c.req.json())),
  );
  app.post('/api/cloud/migration/:id/link', async (c) =>
    json(await linkMigration(c.env, c.req.param('id'), c.get('actor').id, await c.req.json())),
  );
  app.post('/__ci/migration', async (c) => {
    const count = await c.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM cloud_migrations WHERE state='completed'",
    ).first<{ count: number }>();
    if (count?.count)
      throw new CloudError(
        'Initial migration is already complete. Use owner-authenticated Hosting for subsequent imports.',
        409,
      );
    const ws = await new CloudWorkspace(c.env).load();
    return json(await startMigration(c.env, 'initial-migration', ws.version));
  });
  app.put('/__ci/migration/:id/file', async (c) =>
    json(
      await uploadMigration(
        c.env,
        c.req.param('id'),
        'initial-migration',
        c.req.query('path') || '',
        await boundedUploadBody(c.req.raw, BACKUP_CHUNK_BYTES),
        c.req.header('X-File-Modified'),
      ),
    ),
  );
  app.post('/__ci/migration/:id/commit', async (c) =>
    json(await finishMigration(c.env, c.req.param('id'), 'initial-migration', await c.req.json())),
  );
  app.get('/api/bootstrap', async (c) => {
    const model = await c.get('store').snapshot(),
      jobs = await listJobs(c.env);
    return json({
      ...model,
      entries: model.entries.map(publicEntry),
      token: c.get('csrf'),
      workspaceId: c.env.WORKSPACE_ID,
      jobs: await history(c.get('workspace'), c.env, jobs),
      runtime: {
        mode: 'cloud',
        preview: c.env.PREVIEW === 'true',
        studioOrigin: c.env.STUDIO_ORIGIN,
        siteOrigin: c.env.SITE_ORIGIN,
        busy: jobs.some((job) => ['queued', 'running'].includes(job.state)),
        pulse:
          c.get('workspace').version +
          '|' +
          (jobs
            .map((job) => job.updated)
            .sort()
            .at(-1) || ''),
        buildsConfigured: !!(
          c.env.BUILDS_DEPLOY_HOOK ||
          (await connections(c).summary()).fields.workersBuildsDeployHook.configured ||
          (c.env.BUILDS_TRIGGER_ID &&
            ((await connections(c).summary()).fields.cloudflareBuildsApiToken.configured ||
              (await connections(c).summary()).fields.cloudflareApiToken.configured))
        ),
      },
    });
  });
  app.get('/api/cloud/pulse', async (c) => {
    const row = await c.env.DB.prepare(
      'SELECT (SELECT version FROM cloud_workspace WHERE id=1) AS version,(SELECT MAX(updated) FROM cloud_jobs) AS updated',
    ).first<{ version: number; updated: string | null }>();
    return json({ pulse: row!.version + '|' + (row!.updated || '') });
  });
  app.get('/api/cloud/status', async (c) => {
    const totals = await c.env.DB.prepare(
      'SELECT COUNT(*) AS files,COALESCE(SUM(bytes),0) AS bytes FROM cloud_files',
    ).first<{ files: number; bytes: number }>();
    return json({
      mode: 'cloud',
      workspaceId: c.env.WORKSPACE_ID,
      version: c.get('workspace').version,
      studioOrigin: c.env.STUDIO_ORIGIN,
      siteOrigin: c.env.SITE_ORIGIN,
      accountId: c.env.CLOUDFLARE_ACCOUNT_ID || '',
      siteWorker: c.env.SITE_WORKER || '',
      studioWorker: c.env.STUDIO_WORKER || '',
      preview: c.env.PREVIEW === 'true',
      accessTeam: c.env.ACCESS_TEAM,
      buildsConfigured: !!(
        (await connections(c).values()).BUILDS_DEPLOY_HOOK ||
        (c.env.BUILDS_TRIGGER_ID &&
          ((await connections(c).values()).BUILDS_API_TOKEN ||
            (await connections(c).values()).CLOUDFLARE_API_TOKEN))
      ),
      physicalStorage: await c.env.DB.prepare(
        'SELECT bytes,budget FROM cloud_storage WHERE id=1',
      ).first(),
      files: totals?.files || 0,
      bytes: totals?.bytes || 0,
      budgetBytes: Number(c.env.STORAGE_BUDGET_BYTES || 5 * 1024 ** 3),
      jobs: await listJobs(c.env),
      deferredBuild: await deferredBuildStatus(c.env),
    });
  });
  const connections = (c: any) =>
    new ConnectionSettings(
      base,
      Object.fromEntries(
        Object.entries(c.env).filter(([, value]) => typeof value === 'string'),
      ) as NodeJS.ProcessEnv,
    );
  app.get('/api/connections', async (c) => json(await connections(c).summary()));
  app.get('/api/cloud-media/protection', async (c) =>
    json(await new MediaProtectionService(c.get('store'), connections(c)).status()),
  );
  app.put('/api/connections', async (c) => json(await connections(c).update(await c.req.json())));
  app.post('/api/connections/import-environment', async (c) =>
    json(await connections(c).importEnvironment((await c.req.json()).revision)),
  );
  app.get('/api/cloudflare/media', async (c) => {
    const { site } = await c.get('store').snapshot();
    return json(r2Readiness(site, await connections(c).values()));
  });
  app.post('/api/connections/test', async (c) => {
    const { provider } = z
      .object({ provider: z.enum(['cloudflare', 'r2']) })
      .strict()
      .parse(await c.req.json());
    const { site } = await c.get('store').snapshot();
    const credentials = await connections(c).values();
    const fetcher = options.connectionFetch || edgeFetch;
    return json(
      provider === 'r2'
        ? await checkR2Connection(site, credentials, fetcher)
        : await checkCloudflareConnection(site.cloudflare.accountId, credentials, fetcher),
    );
  });
  app.get('/api/services/readiness', async (c) =>
    json(await serviceReadiness(c.get('store'), connections(c), edgeFetch)),
  );
  app.get('/api/aca/deployment', async (c) => json(await acaSummary(c.env, c.get('store'))));
  app.put('/api/aca/deployment', async (c) =>
    json(await saveAca(c.env, c.get('store'), await c.req.json())),
  );
  app.post('/api/aca/deployment/check', async (c) => {
    const current = await acaSummary(c.env, c.get('store')),
      input = await c.req.json();
    if (input.revision && current.revision !== input.revision)
      throw new CloudError('ACA settings changed. Reload before checking.', 409);
    return json({
      readiness: await serviceReadiness(c.get('store'), connections(c), edgeFetch, [
        'workers',
        'd1',
        ...(current.options.domain ? ['zone' as const] : []),
      ]),
    });
  });
  app.get('/api/aca/versions', async (c) => {
    const current = await acaSummary(c.env, c.get('store')),
      credentials = await connections(c).values();
    if (!credentials.CLOUDFLARE_API_TOKEN)
      throw new CloudError('Save a Cloudflare API token first.');
    const response = await edgeFetch(
        'https://api.cloudflare.com/client/v4/accounts/' +
          current.accountId +
          '/workers/scripts/' +
          encodeURIComponent(current.options.workerName) +
          '/versions',
        {
          headers: { Authorization: 'Bearer ' + credentials.CLOUDFLARE_API_TOKEN },
          signal: AbortSignal.timeout(15000),
        },
      ),
      data = await response.json();
    if (!response.ok || !data.success)
      throw new CloudError('Could not read ACA versions. Check Workers Scripts Read access.', 502);
    return json({
      worker: current.options.workerName,
      versions: (data.result.items || [])
        .slice(0, 30)
        .map((version: any) => ({ id: version.id, createdAt: version.metadata?.created_on || '' })),
    });
  });
  for (const route of ['deployment/setup', 'deployment/deploy', 'rollback/review', 'rollback'])
    app.post('/api/aca/' + route, async (c) => {
      const job = await enqueue(c.req.raw, c.env, c.get('workspace'), c.get('actor'), 'api');
      return json({ cloudJob: job.id, state: job.state }, 202);
    });
  const queueCdnMaintenance = async (c: any) => {
    const model = await c.get('store').snapshot(),
      credentials = await connections(c).values();
    if (!credentials.CLOUDFLARE_API_TOKEN)
      throw new CloudError(
        'Save a Cloudflare token before running public CDN maintenance. No build was queued.',
      );
    if (
      !c.req.path.includes('/protection/') &&
      (model.site.mediaDelivery.mode !== 'r2' ||
        !credentials.R2_ACCESS_KEY_ID ||
        !credentials.R2_SECRET_ACCESS_KEY)
    )
      throw new CloudError(
        'Configure optional public R2 delivery and its scoped S3 credentials first. Private Studio uploads do not need these credentials. No build was queued.',
      );
    const job = await enqueue(c.req.raw, c.env, c.get('workspace'), c.get('actor'), 'api');
    return json({ cloudJob: job.id, state: job.state }, 202);
  };
  app.get('/api/cloud-media', async (c) => {
    if (c.req.header('X-Studio-Token') !== c.get('csrf'))
      throw new CloudError('Your Studio session expired. Reload this page.', 403);
    return queueCdnMaintenance(c);
  });
  for (const route of ['health', 'review', 'cleanup', 'protection/check', 'protection/apply'])
    app.post('/api/cloud-media/' + route, queueCdnMaintenance);
  app.post('/api/integrations/giscus/check', async (c) =>
    json(await checkDiscussionConfiguration(discussionCheckSchema.parse(await c.req.json()))),
  );
  app.post('/api/integrations/giscus/theme-preview', async (c) => {
    const { theme, mode } = z
      .object({ theme: siteSchema.shape.theme, mode: z.enum(['light', 'dark']) })
      .strict()
      .parse(await c.req.json());
    const { site } = await c.get('store').snapshot();
    return json({ html: discussionThemePreview({ ...site, theme }, mode) });
  });
  const edgeFetch: typeof fetch = (input, options) =>
    fetch(input, { ...options, redirect: 'manual' });
  app.get('/api/analytics/segments', async (_c) =>
    json(
      await new PrivateSettings(
        base + '/.studio/analytics/segments.json',
        savedSegmentsSchema,
      ).read(),
    ),
  );
  app.put('/api/analytics/segments', async (c) => {
    const data = z
      .object({ value: savedSegmentsSchema, revision: z.string() })
      .strict()
      .parse(await c.req.json());
    return json(
      await new PrivateSettings(
        base + '/.studio/analytics/segments.json',
        savedSegmentsSchema,
      ).save(data.value, data.revision),
    );
  });
  app.get('/api/analytics-status', async (c) =>
    json(await analyticsStatus(c.get('store'), connections(c), edgeFetch)),
  );
  app.get('/api/analytics/:name', async (c) =>
    json(
      await proxyAnalytics(
        c.get('store'),
        connections(c),
        c.req.param('name'),
        new URL(c.req.url).searchParams,
        edgeFetch,
      ),
    ),
  );
  app.get('/api/media', async (c) => json(await cloudMedia(c.get('workspace'), c.get('store'))));
  const maintenance = (c: any, reviews?: Map<string, CleanupReview>) =>
    new MediaMaintenance(
      c.get('store'),
      {
        list: () => cloudMedia(c.get('workspace'), c.get('store')),
        source: async (id: string) => {
          z.uuid().parse(id);
          return {
            record: JSON.parse(
              new TextDecoder().decode(
                await c.get('workspace').read('.studio/media-originals/' + id + '/record.json'),
              ),
            ),
          };
        },
      } as any,
      {
        create: (reason: string) => new NativeData(c.env).snapshot(c.get('workspace'), reason),
      } as any,
      () => true,
      reviews,
    );
  app.get('/api/media/usage', async (c) => json(await maintenance(c).audit()));
  app.post('/api/media/cleanup/review', async (c) => {
    const input = await c.req.json(),
      review = await maintenance(c).review(input.urls);
    await c.env.DB.prepare(
      'INSERT OR REPLACE INTO cloud_reviews(id,job_id,version,response) VALUES(?,?,?,?)',
    )
      .bind(review.id, 'native-media-cleanup', c.get('workspace').version, JSON.stringify(review))
      .run();
    return json(review);
  });
  app.post('/api/media/cleanup/:id/commit', async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT response FROM cloud_reviews WHERE id=? AND job_id='native-media-cleanup'",
    )
      .bind(z.uuid().parse(c.req.param('id')))
      .first<{ response: string }>();
    if (!row) throw new CloudError('Cleanup review expired. Review the selection again.', 409);
    const review = JSON.parse(row.response) as CleanupReview;
    return json(
      await maintenance(c, new Map([[review.id, review]])).cleanup(
        review.id,
        (await c.req.json()).revision,
      ),
    );
  });
  app.get('/api/media/details', async (c) => {
    const url = canonicalMediaUrl(c.req.query('url') || ''),
      file = (await cloudMedia(c.get('workspace'), c.get('store'))).find(
        (item) => item.url === url,
      );
    if (!file) throw new CloudError('Image not found.', 404);
    const model = await c.get('store').snapshot();
    const ws = c.get('workspace'),
      record = ws.files.get(
        file.sourceId
          ? '.studio/media-originals/' + file.sourceId + '/original'
          : 'content/media/' + file.name,
      );
    const header =
      record &&
      (await c.env.BUCKET.get('workspace/blobs/' + record.sha, {
        range: { offset: 0, length: Math.min(record.bytes, 1024 ** 2) },
      }));
    return json({
      ...file,
      format: file.name.split('.').at(-1)!.toUpperCase(),
      camera: header ? cameraFromImageHeader(new Uint8Array(await header.arrayBuffer())) : {},
      shortUrl: '/m/' + file.shortCode,
      publishCameraExif: model.library.mediaDetails[url]?.publishCameraExif || false,
      libraryRevision: model.libraryRevision,
    });
  });
  app.put('/api/media/details', async (c) => {
    const input = z
        .object({ url: z.string(), publishCameraExif: z.boolean(), revision: z.string() })
        .parse(await c.req.json()),
      url = canonicalMediaUrl(input.url),
      model = await c.get('store').snapshot();
    if (!c.get('workspace').has('content/media/' + decodeURIComponent(url.slice(7))))
      throw new CloudError('Image not found.', 404);
    return json(
      await c.get('store').saveJson(
        'library',
        {
          ...model.library,
          mediaDetails: {
            ...model.library.mediaDetails,
            [url]: {
              ...model.library.mediaDetails[url],
              publishCameraExif: input.publishCameraExif,
            },
          },
        },
        input.revision,
      ),
    );
  });
  app.get('/api/annotations/:id', async (c) => {
    const model = await c.get('store').snapshot(),
      comments = model.site.integrations.comments;
    return annotationReader()(c.req.raw, {
      repo: comments.repo,
      category: comments.category,
      entries: comments.enabled
        ? model.entries
            .filter(
              (entry) =>
                entry.status === 'published' &&
                resolveEntrySettings(model.site, entry).discussion.annotations,
            )
            .map((entry) => entry.id)
        : [],
    });
  });
  app.get('/api/search-console', async (_c) => json(await new SearchConsoleService(base).list()));
  app.get('/api/search-console/:id', async (c) =>
    json(await new SearchConsoleService(base).read(c.req.param('id'))),
  );
  app.post('/api/search-console/review', async (c) => {
    const input = z
      .object({
        source: z.string().max(2000000),
        name: z.string().min(1).max(200),
        property: z.url(),
        from: z.string(),
        to: z.string(),
      })
      .strict()
      .parse(await c.req.json());
    if (
      new URL(input.property).origin !== new URL((await c.get('store').snapshot()).site.url).origin
    )
      throw new CloudError('Import data for the current site property.');
    const plans = new Map(),
      service = new SearchConsoleService(base, plans),
      review = await service.prepare(input),
      key = 'reviews/' + review.id + '/search.json';
    await putObject(c.env, key, JSON.stringify(plans.get(review.id)));
    await c.env.DB.prepare('INSERT INTO cloud_reviews VALUES(?,?,?,?)')
      .bind(
        review.id,
        'native-search-import',
        c.get('workspace').version,
        JSON.stringify({ key, expiresAt: review.expiresAt }),
      )
      .run();
    return json(review);
  });
  app.post('/api/search-console/import', async (c) => {
    const id = z.uuid().parse((await c.req.json()).id),
      row = await c.env.DB.prepare(
        "SELECT response,version FROM cloud_reviews WHERE id=? AND job_id='native-search-import'",
      )
        .bind(id)
        .first<{ response: string; version: number }>();
    if (!row || row.version !== c.get('workspace').version)
      throw new CloudError('The notebook changed. Review the search import again.', 409);
    const meta = JSON.parse(row.response);
    if (Date.parse(meta.expiresAt) < Date.now())
      throw new CloudError('Search import review expired.', 409);
    const source = await c.env.BUCKET.get(meta.key);
    if (!source) throw new CloudError('Search import plan is missing.', 503);
    const result = await new SearchConsoleService(
      base,
      new Map([[id, JSON.parse(await source.text())]]),
    ).commit(id);
    c.get('workspace').complete('DELETE FROM cloud_reviews WHERE id=?', id);
    return json(result);
  });
  app.delete('/api/search-console/:id', async (c) =>
    json(
      await new SearchConsoleService(base).remove(
        c.req.param('id'),
        z.string().parse((await c.req.json()).revision),
      ),
    ),
  );
  app.get('/api/maintenance', async (c) => {
    const ws = c.get('workspace'),
      model = await c.get('store').snapshot(),
      jobs = await history(ws, c.env, await listJobs(c.env)),
      last = jobs.find((job) => job.state === 'succeeded' && job.build);
    const backups = ws
      .paths()
      .filter((path) => /^\.studio\/backups\/\d+-[a-f0-9-]+\.json$/.test(path));
    const times = await Promise.all(
      backups.map(
        async (path) =>
          JSON.parse(new TextDecoder().decode(await ws.read(path))).createdAt as string,
      ),
    );
    const latestSnapshot = await c.env.DB.prepare(
      'SELECT MAX(created) AS created FROM cloud_snapshots WHERE deleted IS NULL',
    ).first<string>('created');
    const snapshotBytes = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(bytes),0) AS bytes FROM cloud_objects WHERE key LIKE 'snapshots/%'",
    ).first<number>('bytes');
    return json({
      latestBackup: [...times, latestSnapshot || ''].sort().at(-1) || '',
      backupBytes:
        [...ws.files.values()]
          .filter((file) => file.path.startsWith('.studio/backups/') && file.path.endsWith('.gz'))
          .reduce((sum, file) => sum + file.bytes, 0) + (snapshotBytes || 0),
      mediaBytes: [...ws.files.values()]
        .filter((file) => file.path.startsWith('content/media/'))
        .reduce((sum, file) => sum + file.bytes, 0),
      missing: 0,
      unused: 0,
      auditPending: true,
      lastBuild: last?.completedAt || '',
      changedSinceBuild: !last?.build || last.build.sourceRevision !== snapshotRevision(model),
    });
  });
  for (const name of ['content', 'photos', 'trash'] as const)
    app.post('/api/' + name + '/batch', async (c) => {
      const input = (await c.req.raw.clone().json()) as { items?: unknown[] };
      return json(await new Operations(c.get('store'))[name](input));
    });
  app.post('/api/media/uploads', async (c) =>
    json(await new NativeMedia(c.env).start(c.get('actor').id, await c.req.json()), 201),
  );
  app.post('/api/media/uploads/:id/transfer', async (c) =>
    json(
      await new NativeMedia(c.env).transfer(
        c.req.param('id'),
        c.get('actor').id,
        (await c.req.json()).role,
      ),
    ),
  );
  const mediaTransfer = async (c: any) => {
    const service = new CloudTransfers(c.env),
      actor = c.get('actor').id;
    await new NativeMedia(c.env).row(c.req.param('id'), actor);
    const row = await service.row(c.req.param('transfer'), actor);
    if (row.job_id !== c.req.param('id') || row.purpose !== 'file')
      throw new CloudError('Upload does not belong to this media session.', 403);
    return { service, row, actor };
  };
  app.put('/api/media/uploads/:id/transfers/:transfer/parts/:part', async (c) => {
    const { service, row, actor } = await mediaTransfer(c);
    return json(await service.part(row.id, actor, Number(c.req.param('part')), c.req.raw));
  });
  app.post('/api/media/uploads/:id/transfers/:transfer/complete', async (c) => {
    const { service, row, actor } = await mediaTransfer(c);
    await service.finish(row.id, actor);
    return json({ ok: true });
  });
  app.post('/api/media/uploads/:id/commit', async (c) =>
    json(
      await new NativeMedia(c.env).commit(c.req.param('id'), c.get('actor').id, c.get('workspace')),
    ),
  );
  app.get('/api/storage', async (c) =>
    json(await new NativeData(c.env).summary(c.get('workspace'))),
  );
  for (const kind of ['content', 'media'] as const)
    app.post('/api/' + kind + '/export', async (c) =>
      json(
        await new NativeArchive(c.env).select(
          c.get('workspace'),
          c.get('actor').id,
          kind,
          await c.req.json(),
        ),
      ),
    );
  app.get('/api/cloud/exports/:id/manifest', async (c) =>
    json(await new NativeArchive(c.env).manifest(c.req.param('id'), c.get('actor').id)),
  );
  app.get('/api/cloud/exports/:id/file', async (c) => {
    const manifest = await new NativeArchive(c.env).manifest(c.req.param('id'), c.get('actor').id),
      file = manifest.files.find((file) => file.path === c.req.query('path'));
    if (!file) throw new CloudError('File is outside this export.', 404);
    return readObject(c.env, { ...file, path: file.sourcePath || file.path });
  });
  app.get('/api/jobs/:id/artifact/manifest', async (c) =>
    json(await new NativeArchive(c.env).artifact(c.req.param('id'))),
  );
  app.post('/api/jobs/:id/artifact/export', async (c) =>
    json(await new NativeArchive(c.env).artifactExport(c.req.param('id'), c.get('actor').id)),
  );
  app.post('/api/backups/:id/export', async (c) =>
    json(await new NativeArchive(c.env).snapshot(c.req.param('id'), c.get('actor').id)),
  );
  app.get('/api/jobs/:id/artifact/file', async (c) => {
    const manifest = await new NativeArchive(c.env).artifact(c.req.param('id')),
      file = manifest.files.find((file) => file.path === c.req.query('path'));
    if (!file) throw new CloudError('File is outside this artifact.', 404);
    return readObject(c.env, file);
  });
  app.get('/api/cloud/operations', async (c) =>
    json(
      (
        await c.env.DB.prepare(
          "SELECT id,created,expires,state FROM cloud_operations WHERE actor=? AND state='staging' AND expires>? ORDER BY created DESC LIMIT 20",
        )
          .bind(c.get('actor').id, new Date().toISOString())
          .all()
      ).results,
    ),
  );
  app.get('/api/cloud/operations/:id', async (c) =>
    json(await new NativeOperation(c.env).describe(c.req.param('id'), c.get('actor').id)),
  );
  app.put('/api/cloud/operations/:id/file', async (c) =>
    json(
      await new NativeOperation(c.env).upload(
        c.req.param('id'),
        c.get('actor').id,
        c.req.query('path') || '',
        await boundedUploadBody(c.req.raw, BACKUP_CHUNK_BYTES),
      ),
    ),
  );
  app.post('/api/cloud/operations/:id/commit', async (c) =>
    json(await new NativeOperation(c.env).commit(c.req.param('id'), c.get('actor').id)),
  );
  app.put('/api/storage/policy', async (c) =>
    json(await new NativeData(c.env).savePolicy(await c.req.json())),
  );
  app.post('/api/storage/cleanup', async (c) =>
    json(await new NativeData(c.env).cleanup(c.get('workspace'), c.get('actor').id)),
  );
  app.post('/api/storage/cache/purge', async (c) =>
    json({
      ok: true,
      detached: await new NativeData(c.env).expireGenerated(
        c.get('workspace'),
        c.get('actor').id,
        true,
      ),
    }),
  );
  app.get('/api/history', async (c) =>
    json(
      await new NativeData(c.env).history(c.get('workspace'), {
        category: c.req.query('category'),
        query: c.req.query('q'),
        cursor: c.req.query('cursor'),
        deleted: c.req.query('deleted') === 'true',
      }),
    ),
  );
  app.post('/api/history/delete', async (c) =>
    json(await new NativeData(c.env).deleteHistory(c.get('workspace'), await c.req.json())),
  );
  app.post('/api/history/export', async (c) =>
    json(
      await new NativeArchive(c.env).history(
        c.get('workspace'),
        c.get('actor').id,
        await c.req.json(),
      ),
    ),
  );
  app.post('/api/history/:id/restore', async (c) =>
    json(await new NativeData(c.env).restoreHistory(c.get('workspace'), c.req.param('id'))),
  );
  app.delete('/api/history/:id', async (c) => {
    if ((await c.req.json()).confirm !== 'PURGE')
      throw new CloudError('Review permanent deletion before purging.');
    return json(await new NativeData(c.env).purgeHistory(c.req.param('id')));
  });
  app.get('/api/media/metadata', async (c) => {
    const url = c.req.query('url') || '',
      model = await c.get('store').snapshot(),
      file = (await cloudMedia(c.get('workspace'), c.get('store'))).find((f) => f.url === url);
    if (!file) throw new CloudError('Media file not found.', 404);
    const metadata = mediaMetadataSchema.parse({
      ...model.library.mediaDetails[url],
      shortCode: effectiveMediaCode(url, model.library),
    });
    return json({
      url,
      name: file.name,
      metadata,
      shortPath: '/m/' + metadata.shortCode,
      downloadName: mediaDownloadName(file.name, metadata.displayName),
      libraryRevision: model.libraryRevision,
    });
  });
  app.put('/api/media/metadata', async (c) => {
    const data = await c.req.json(),
      model = await c.get('store').snapshot(),
      metadata = mediaMetadataSchema.parse(data.metadata);
    if (!metadata.shortCode) metadata.shortCode = effectiveMediaCode(data.url, model.library);
    const previous = effectiveMediaCode(data.url, model.library);
    if (previous !== metadata.shortCode && !metadata.shortAliases.includes(previous))
      metadata.shortAliases.push(previous);
    const library = {
      ...model.library,
      mediaDetails: { ...model.library.mediaDetails, [data.url]: metadata },
    };
    mediaLinkMap(
      (await cloudMedia(c.get('workspace'), c.get('store'))).map((f) => f.url),
      library,
    );
    await c.get('store').saveJson('library', library, data.revision);
    return json({
      url: data.url,
      metadata,
      libraryRevision: (await c.get('store').snapshot()).libraryRevision,
    });
  });
  app.get('/api/cloud/hosting', (c) =>
    json({ studioOrigin: c.env.STUDIO_ORIGIN, siteOrigin: c.env.SITE_ORIGIN, mode: 'cloud' }),
  );
  const pagesConnection = async (c: any) =>
    new PagesConnection(
      (await c.get('store').snapshot()).site.cloudflare.accountId,
      (await connections(c).values()).CLOUDFLARE_API_TOKEN || '',
      options.connectionFetch || fetch,
    );
  app.get('/api/cloud/pages', async (c) => {
    const site = (await c.get('store').snapshot()).site,
      credentials = await connections(c).values();
    const staged = await c.env.DB.prepare(
      "SELECT id,deployment_url,created,state FROM cloud_releases WHERE state='staged' AND deployment_url IS NOT NULL ORDER BY created DESC LIMIT 1",
    ).first();
    return json({
      account: site.cloudflare.accountId,
      project: c.env.PAGES_PROJECT || site.cloudflare.projectName,
      credential: !!credentials.CLOUDFLARE_API_TOKEN,
      staged,
    });
  });
  app.post('/api/cloud/pages/check', async (c) =>
    json({ projects: await (await pagesConnection(c)).list() }),
  );
  app.post('/api/cloud/pages/project', async (c) => {
    if (c.env.PREVIEW === 'true')
      throw new CloudError('Production setup is disabled in previews.', 403);
    const input = z.object({ project: z.string() }).parse(await c.req.json());
    return json(
      await (
        await pagesConnection(c)
      ).create(input.project, (await c.get('store').snapshot()).site.cloudflare.productionBranch),
    );
  });
  app.put('/api/cloud/pages/target', async (c) => {
    const data = z
      .object({ project: siteSchema.shape.cloudflare.shape.projectName.refine((value) => !!value) })
      .parse(await c.req.json());
    if (c.env.PAGES_PROJECT && c.env.PAGES_PROJECT !== data.project)
      throw new CloudError(
        'GLASS_PAGES_PROJECT is fixed by the deployment environment. Update it there first.',
        409,
      );
    const model = await c.get('store').snapshot();
    return json(
      await c
        .get('store')
        .saveJson(
          'site',
          { ...model.site, cloudflare: { ...model.site.cloudflare, projectName: data.project } },
          model.siteRevision,
        ),
    );
  });
  app.get('/api/cloudflare', async (c) =>
    json(
      await checkCloudflareConnection(
        (await c.get('store').snapshot()).site.cloudflare.accountId,
        await connections(c).values(),
        options.connectionFetch || fetch,
      ),
    ),
  );
  app.get('/api/cloudflare/projects', async (c) => json(await (await pagesConnection(c)).list()));
  app.post('/api/cloudflare/project', async (c) =>
    json(
      await (
        await pagesConnection(c)
      ).create(
        (await c.get('store').snapshot()).site.cloudflare.projectName,
        (await c.get('store').snapshot()).site.cloudflare.productionBranch,
      ),
    ),
  );
  app.get('/api/health', async (c) => {
    const report = await new HealthService(
      c.get('store'),
      {
        connections: connections(c),
        jobs: await history(c.get('workspace'), c.env, await listJobs(c.env)),
      },
      { summary: () => acaSummary(c.env, c.get('store')) } as any,
      edgeFetch,
      { persistIssues: false },
    ).report();
    report.checks = report.checks.filter((check) => check.id !== 'pages');
    const configured = !!(
      c.env.BUILDS_DEPLOY_HOOK ||
      (await connections(c).values()).BUILDS_DEPLOY_HOOK ||
      c.env.BUILDS_TRIGGER_ID
    );
    report.checks.unshift(
      { id: 'cloud-storage', state: 'verified', detail: 'Private D1/R2 workspace is reachable.' },
      { id: 'access', state: 'verified', detail: 'Cloudflare Access identity verified.' },
      {
        id: 'builds',
        state: configured ? 'configured' : 'attention',
        detail: 'Configure and verify Git-connected Workers Builds in Hosting.',
      },
    );
    return json(report);
  });
  app.get('/api/backups', async (c) => {
    const ws = c.get('workspace'),
      records: any[] = await new NativeData(c.env).snapshots();
    for (const path of ws
      .paths()
      .filter((p) => /^\.studio\/backups\/\d+-[a-f0-9-]+\.json$/.test(p))) {
      const raw = new TextDecoder().decode(await ws.read(path)),
        record = JSON.parse(raw),
        archive = ws.files.get(
          path.slice(0, -5) + (record.archiveFormat === 'tar' ? '.tar.gz' : '.json.gz'),
        );
      records.push({
        ...record,
        revision: digest(
          raw + '|' + archive?.bytes + '|' + (archive ? Date.parse(archive.modified) : undefined),
        ),
        available: !!archive,
      });
    }
    return json(records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
  app.post('/api/backups', async (c) =>
    json(await new NativeData(c.env).snapshot(c.get('workspace'))),
  );
  app.post('/api/backups/batch', async (c) => {
    const data = z
      .object({
        action: z.enum(['delete', 'label']),
        items: z
          .array(z.object({ id: z.string(), revision: z.string() }))
          .min(1)
          .max(100),
        label: z.string().max(120).optional(),
      })
      .parse(await c.req.json());
    const service = new NativeData(c.env),
      snapshots = await service.snapshots(),
      ws = c.get('workspace'),
      legacy: {
        path: string;
        raw: string;
        archive?: import('./types.js').FileRecord;
        record: any;
      }[] = [];
    for (const item of data.items.filter(
      (item) => !snapshots.some((record) => record.id === item.id),
    )) {
      if (!/^\d+-[a-f0-9-]+$/.test(item.id)) throw new CloudError('Invalid backup identity.');
      const path = '.studio/backups/' + item.id + '.json';
      if (!ws.has(path)) throw new CloudError('Backup selection changed.', 409);
      const raw = new TextDecoder().decode(await ws.read(path)),
        record = JSON.parse(raw),
        archive = ws.files.get(
          path.slice(0, -5) + (record.archiveFormat === 'tar' ? '.tar.gz' : '.json.gz'),
        );
      if (
        digest(
          raw + '|' + archive?.bytes + '|' + (archive ? Date.parse(archive.modified) : undefined),
        ) !== item.revision
      )
        throw new CloudError('Backup selection changed.', 409);
      legacy.push({ path, raw, archive, record });
    }
    if (
      data.items.some(
        (item) =>
          !legacy.some((record) => record.record.id === item.id) &&
          !snapshots.some((record) => record.id === item.id && record.revision === item.revision),
      )
    )
      throw new CloudError('A selected backup changed. Reload before applying.', 409);
    const now = new Date().toISOString(),
      expires = new Date(Date.now() + 7 * 86400000).toISOString();
    // One transaction; a failed selection cannot partially delete a batch.
    const ids = data.items
      .filter((item) => snapshots.some((record) => record.id === item.id))
      .map((item) => item.id);
    if (ids.length)
      ws.complete(
        data.action === 'label'
          ? 'UPDATE cloud_snapshots SET label=? WHERE id IN (SELECT value FROM json_each(?))'
          : 'UPDATE cloud_snapshots SET deleted=?,expires=? WHERE id IN (SELECT value FROM json_each(?))',
        ...(data.action === 'label'
          ? [data.label || '', JSON.stringify(ids)]
          : [now, expires, JSON.stringify(ids)]),
      );
    if (data.action === 'label')
      for (const item of legacy)
        ws.write(
          item.path,
          new TextEncoder().encode(JSON.stringify({ ...item.record, label: data.label || '' })),
        );
    else if (legacy.length)
      await service.deleteHistory(ws, {
        items: legacy
          .flatMap((item) => [item.path, ...(item.archive ? [item.archive.path] : [])])
          .map((path) => ({ path, revision: ws.files.get(path)!.sha })),
      });
    return json({ ok: true, changed: data.items.length, recoverUntil: expires });
  });
  app.get('/api/backups/deleted', async (c) =>
    json(await new NativeData(c.env).deletedSnapshots()),
  );
  app.post('/api/backups/:id/recover', async (c) =>
    json(await new NativeData(c.env).recoverSnapshot(c.req.param('id'))),
  );
  app.delete('/api/backups/:id/purge', async (c) => {
    if ((await c.req.json()).confirm !== 'PURGE')
      throw new CloudError('Review permanent deletion before purging.');
    return json(await new NativeData(c.env).purgeSnapshot(c.req.param('id')));
  });
  app.get('/api/backups/:id/manifest', async (c) =>
    json(await new NativeData(c.env).manifest(c.req.param('id'))),
  );
  app.get('/api/backups/:id/file', async (c) => {
    const manifest = await new NativeData(c.env).manifest(c.req.param('id'));
    const file = manifest.files.find((file) => file.path === c.req.query('path'));
    if (!file) throw new CloudError('File is outside this backup.', 404);
    return readObject(c.env, file);
  });
  app.post('/api/backups/import/review', async (c) => {
    const input = z
      .object({
        migration: z.uuid(),
        name: z.string().max(300),
        files: z
          .array(
            z.object({
              path: z.string(),
              sha: z.string().regex(/^[a-f0-9]{64}$/),
              bytes: z.number().int().nonnegative(),
            }),
          )
          .min(2)
          .max(30000),
      })
      .parse(await c.req.json());
    const session = await migrationSession(c.env, input.migration, c.get('actor').id),
      ws = await new CloudWorkspace(c.env).load('catalog');
    if (ws.version !== session.version)
      throw new CloudError(
        'The notebook changed. Imported files remain staged; review the current notebook.',
        409,
      );
    const patches = (
      await c.env.DB.prepare(
        "SELECT path,sha,bytes,modified,CASE WHEN (path GLOB 'content/*' AND path NOT GLOB 'content/media/*') OR path GLOB '.studio/media-originals/*/record.json' THEN text ELSE NULL END AS text,encrypted FROM cloud_patches WHERE id=?",
      )
        .bind('migration-' + input.migration)
        .all<import('./types.js').FileRecord>()
    ).results;
    const expected = new Map(input.files.map((file) => [file.path, file]));
    if (
      expected.size !== input.files.length ||
      patches.length !== expected.size ||
      patches.some(
        (file) =>
          expected.get(file.path)?.sha !== file.sha ||
          expected.get(file.path)?.bytes !== file.bytes,
      )
    )
      throw new CloudError('Staged backup differs from its manifest.', 409);
    const validation = new CloudWorkspace(c.env);
    patches.forEach((file) => validation.files.set(file.path, file));
    const store = new NativeStore(validation);
    await store.snapshot();
    await store.validateRecoveryReferences();
    const before = new Map(ws.files),
      id = 'migration-' + input.migration;
    return json({
      id,
      name: input.name,
      createdAt: new Date().toISOString(),
      files: patches.length,
      entries: patches.filter((file) => /^content\/(posts|lab)\//.test(file.path)).length,
      media: patches.filter((file) => file.path.startsWith('content/media/')).length,
      revisions: patches.filter((file) => file.path.startsWith('.studio/revisions/')).length,
      added: patches.filter((file) => !before.has(file.path)).length,
      changed: patches.filter(
        (file) => before.has(file.path) && before.get(file.path)!.sha !== file.sha,
      ).length,
      removed: [...before.keys()].filter(
        (path) => portableNotebookPath(path) && !expected.has(path),
      ).length,
      sourceRevision: String(session.version),
      archiveFormat: 'tar',
    });
  });
  app.post('/api/backups/:id/review', async (c) => {
    const id = c.req.param('id'),
      ws = c.get('workspace'),
      metadata = '.studio/backups/' + id + '.json';
    if (/^\d+-[a-f0-9-]+$/.test(id) && ws.has(metadata)) {
      const record = JSON.parse(new TextDecoder().decode(await ws.read(metadata))),
        suffix = record.archiveFormat === 'tar' ? '.tar.gz' : '.json.gz',
        file = ws.files.get('.studio/backups/' + id + suffix);
      if (!file) throw new CloudError('Saved backup archive is missing.', 404);
      return json({
        legacyBackup: {
          id,
          bytes: file.bytes,
          revision: file.sha,
          name: 'glass-notebook-' + id + suffix,
        },
      });
    }
    return json(await new NativeData(c.env).review(id, ws));
  });
  app.post('/api/backups/:id/restore', async (c) => {
    const id = c.req.param('id'),
      ws = c.get('workspace'),
      input = await c.req.json(),
      actor = c.get('actor').id;
    if (!id.startsWith('migration-'))
      return json(await new NativeData(c.env).restore(id, ws, Number(input.sourceRevision), actor));
    if (ws.version !== Number(input.sourceRevision))
      throw new CloudError('The notebook changed. Review again before restoring.', 409);
    const session = id.slice('migration-'.length),
      safety = await new NativeData(c.env).snapshot(ws, 'before-restore');
    const files = (
      await c.env.DB.prepare('SELECT path,sha,bytes FROM cloud_patches WHERE id=?').bind(id).all()
    ).results;
    return json({
      ...(await finishMigration(c.env, session, actor, { files })),
      safetyBackup: safety.id,
    });
  });
  app.post('/api/backup-settings/run', async (c) => {
    const record = await new NativeData(c.env).snapshot(c.get('workspace'), 'automatic');
    const settings = new PrivateSettings(
        base + '/.studio/backup-settings.json',
        backupSettingsSchema,
      ),
      old = await settings.read();
    await settings.save(
      { ...old.value, lastSuccess: new Date().toISOString(), error: '' },
      old.revision,
    );
    const expired = (
      await c.env.DB.prepare(
        "SELECT id FROM cloud_snapshots WHERE kind='automatic' AND deleted IS NULL ORDER BY created DESC LIMIT -1 OFFSET ?",
      )
        .bind(old.value.keepAutomatic)
        .all<{ id: string }>()
    ).results;
    if (expired.length)
      c.get('workspace').complete(
        'UPDATE cloud_snapshots SET deleted=?,expires=? WHERE id IN (SELECT value FROM json_each(?))',
        new Date().toISOString(),
        new Date(Date.now() + 7 * 86400000).toISOString(),
        JSON.stringify(expired.map((row) => row.id)),
      );
    return json(record);
  });
  app.post('/api/backups/uploads', async (c) =>
    json(await new CloudTransfers(c.env).start(c.get('actor').id, await c.req.json()), 201),
  );
  app.get('/api/backups/uploads/:upload', async (c) => {
    const service = new CloudTransfers(c.env),
      row = await service.row(c.req.param('upload'), c.get('actor').id);
    if (row.purpose !== 'backup') throw new CloudError('This is not a backup upload.', 403);
    return json(await service.status(row.id, row.actor));
  });
  app.put('/api/backups/uploads/:upload/parts/:part', async (c) => {
    const service = new CloudTransfers(c.env),
      row = await service.row(c.req.param('upload'), c.get('actor').id);
    if (row.purpose !== 'backup') throw new CloudError('This is not a backup upload.', 403);
    return json(await service.part(row.id, row.actor, Number(c.req.param('part')), c.req.raw));
  });
  app.delete('/api/backups/uploads/:upload', async (c) =>
    json(await new CloudTransfers(c.env).discard(c.req.param('upload'), c.get('actor').id)),
  );
  app.post('/api/backups/uploads/:upload/complete', async (c) => {
    const service = new CloudTransfers(c.env),
      actor = c.get('actor'),
      row = await service.row(c.req.param('upload'), actor.id);
    if (row.purpose !== 'backup') throw new CloudError('This is not a backup upload.', 403);
    await service.finish(row.id, actor.id);
    return json(
      {
        error:
          'Reload Backups and select the original archive. This version validates archives directly in a browser worker; no build was queued. The previous transfer remains available until discard or expiry.',
      },
      409,
    );
  });
  app.get('/api/backup-settings', async () => {
    const settings = await new PrivateSettings(
      base + '/.studio/backup-settings.json',
      backupSettingsSchema,
    ).read();
    return json({
      ...settings,
      running: false,
      nextDue:
        settings.value.enabled && !settings.value.error
          ? new Date(
              Math.max(
                Date.now(),
                Date.parse(settings.value.lastSuccess || '1970-01-01') + 86400000,
              ),
            ).toISOString()
          : '',
    });
  });
  app.put('/api/backup-settings', async (c) => {
    const data = await c.req.json(),
      settings = new PrivateSettings(base + '/.studio/backup-settings.json', backupSettingsSchema),
      previous = await settings.read();
    return json(
      await settings.save(
        {
          ...previous.value,
          enabled: !!data.enabled,
          keepAutomatic: data.keepAutomatic,
          error: '',
        },
        data.revision,
      ),
    );
  });
  app.get('/api/schedule', async (c) => {
    const { site, entries } = await c.get('store').snapshot();
    return json({
      enabled: site.publishing.scheduleEnabled,
      action: site.publishing.scheduleAction,
      state: { running: false, pendingIds: [] },
      entries: entries.filter((e) => e.status === 'scheduled').map(publicEntry),
    });
  });
  app.post('/api/schedule/run', async (c) => json(await cloudSchedule(c.env, true)));
  app.get('/api/backups/:id/download', async (c) => {
    if (!/^\d+-[a-f0-9-]+$/.test(c.req.param('id'))) throw new CloudError('Invalid backup.');
    const metadata = await readObject(
      c.env,
      await privateFile(c.env, '.studio/backups/' + c.req.param('id') + '.json'),
    );
    const record = (await metadata.json()) as { archiveFormat?: string };
    const suffix = record.archiveFormat === 'tar' ? '.tar.gz' : '.json.gz';
    const file = await privateFile(c.env, '.studio/backups/' + c.req.param('id') + suffix);
    if (!file) throw new CloudError('Backup not found.', 404);
    const response = await readObject(c.env, file);
    return new Response(response.body, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': 'attachment; filename=glass-notebook-' + c.req.param('id') + suffix,
        'Content-Length': String(file.bytes),
        'Cache-Control': 'private, no-store',
      },
    });
  });
  app.get('/api/media/:id/source', async (c) => {
    if (!/^[a-f0-9-]{36}$/.test(c.req.param('id'))) throw new CloudError('Invalid media source.');
    const file = await privateFile(
      c.env,
      '.studio/media-originals/' + c.req.param('id') + '/original',
    );
    if (!file) throw new CloudError('Original not found.', 404);
    const response = await readObject(c.env, file);
    return new Response(response.body, {
      headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store' },
    });
  });
  app.get('/api/content', async (c) =>
    json((await c.get('store').snapshot()).entries.map(publicEntry)),
  );
  app.get('/api/content/:id/download', async (c) => {
    const entry = (await c.get('store').snapshot()).entries.find(
      (entry) => entry.id === c.req.param('id'),
    );
    if (!entry) throw new CloudError('Entry not found.', 404);
    return new Response(
      new Uint8Array(await c.get('workspace').read('content/' + entry.kind + '/' + entry.file)),
      {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition':
            "attachment; filename=entry.md; filename*=UTF-8''" +
            encodeURIComponent(entry.file).replace(/'/g, '%27'),
          'Cache-Control': 'private, no-store',
        },
      },
    );
  });
  app.post('/api/content', async (c) => {
    const data = z
      .object({
        kind: z.enum(['posts', 'lab']),
        title: z.string().min(1).max(160),
        slug: z.string(),
      })
      .parse(await c.req.json());
    return json(publicEntry(await c.get('store').create(data.kind, data.title, data.slug)), 201);
  });
  app.post('/api/content/import/review', async (c) => {
    const length = Number(c.req.header('Content-Length') || 0);
    if (length > 22 * 1024 ** 2)
      throw new CloudError('Import up to 20 MiB of Markdown at once.', 413);
    const data = await c.req.formData(),
      kind = z.enum(['posts', 'lab']).parse(data.get('kind')),
      files = data.getAll('files');
    if (!files.length || files.length > 100 || files.some((file) => typeof file === 'string'))
      throw new CloudError('Choose 1–100 Markdown files.');
    const plans = new Map<string, MarkdownImportPlan>(),
      service = new Operations(c.get('store'), plans),
      review = await service.reviewImport(
        await Promise.all(
          (files as File[]).map(async (file) => ({
            name: file.name,
            text: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()),
          })),
        ),
        kind,
      );
    const key = 'reviews/' + review.id + '/markdown.json';
    await putObject(c.env, key, JSON.stringify(plans.get(review.id)));
    await c.env.DB.prepare('INSERT INTO cloud_reviews VALUES(?,?,?,?)')
      .bind(
        review.id,
        'native-markdown-import',
        c.get('workspace').version,
        JSON.stringify({ key, expiresAt: review.expiresAt }),
      )
      .run();
    return json(review);
  });
  app.post('/api/content/import/:id/commit', async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT response FROM cloud_reviews WHERE id=? AND job_id='native-markdown-import'",
    )
      .bind(z.uuid().parse(c.req.param('id')))
      .first<{ response: string }>();
    if (!row) throw new CloudError('Markdown import review expired.', 409);
    const meta = JSON.parse(row.response);
    if (Date.parse(meta.expiresAt) < Date.now())
      throw new CloudError('Markdown import review expired.', 409);
    const object = await c.env.BUCKET.get(meta.key);
    if (!object) throw new CloudError('Import plan is unavailable.', 503);
    const plan = JSON.parse(await object.text()) as MarkdownImportPlan;
    return json(
      await new Operations(c.get('store'), new Map([[c.req.param('id'), plan]])).import(
        c.req.param('id'),
        (await c.req.json()).sourceRevision,
      ),
    );
  });
  app.put('/api/content/:id', async (c) => {
    const data = z
      .object({ metadata: entrySchema, body: z.string().max(1_000_000), revision: z.string() })
      .parse(await c.req.json());
    return json(publicEntry(await c.get('store').saveEntry(c.req.param('id'), data)));
  });
  app.delete('/api/content/:id', async (c) => {
    await c.get('store').trash(c.req.param('id'), (await c.req.json()).revision);
    return json({ ok: true });
  });
  app.get('/api/content/:id/revisions', async (c) =>
    json(await c.get('store').listRevisions(c.req.param('id'))),
  );
  app.get('/api/content/:id/revisions/:revision', async (c) =>
    json(await c.get('store').getRevision(c.req.param('id'), c.req.param('revision'))),
  );
  app.post('/api/content/:id/revisions/:selected/restore', async (c) =>
    json(
      publicEntry(
        await c
          .get('store')
          .restoreRevision(
            c.req.param('id'),
            c.req.param('selected'),
            (await c.req.json()).revision,
          ),
      ),
    ),
  );
  app.get('/api/trash', async (c) => json(await c.get('store').listTrash()));
  app.post('/api/trash/:id/restore', async (c) => {
    await c.get('store').restore(c.req.param('id'));
    return json({ ok: true });
  });
  for (const name of ['site', 'library'] as const)
    app.put('/api/' + name, async (c) => {
      const data = await c.req.json();
      return json(await c.get('store').saveJson(name, data.value, data.revision));
    });
  app.post('/api/library/undo', async (c) =>
    json(await c.get('store').undoLibrary((await c.req.json()).revision)),
  );
  app.put('/api/projects', async (c) => {
    const data = await c.req.json();
    return json(await saveProjects(c.get('store'), data.value, data.revision));
  });
  app.post('/api/projects/undo', async (c) =>
    json(await undoProjects(c.get('store'), (await c.req.json()).revision)),
  );
  app.post('/api/projects/github', async (c) =>
    json(
      await importGithubProject(
        z.object({ repository: z.string().max(201) }).parse(await c.req.json()).repository,
      ),
    ),
  );
  app.get('/api/pages/about', async (c) => json((await c.get('store').snapshot()).about));
  app.put('/api/pages/about', async (c) => {
    const data = z
      .object({ body: z.string().max(1_000_000), revision: z.string() })
      .parse(await c.req.json());
    inspectMarkdown(data.body);
    return json(await c.get('store').saveAbout(data.body, data.revision));
  });
  app.get('/api/pages/about/revisions', async (c) => json(await c.get('store').aboutRevisions()));
  app.post('/api/pages/about/restore', async (c) => {
    const data = await c.req.json(),
      previous = await c.get('store').aboutRevision(data.selected);
    return json(await c.get('store').saveAbout(previous.body, data.revision, 'restore'));
  });
  app.get('/api/jobs', async (c) =>
    json(await history(c.get('workspace'), c.env, await listJobs(c.env))),
  );
  const selectedJobs = async (c: any, input: unknown) => {
    const chosen = z
        .array(z.object({ id: z.string().regex(/^[\w-]{1,100}$/), revision: z.string() }))
        .min(1)
        .max(100)
        .parse(input),
      records = await history(c.get('workspace'), c.env, await listJobs(c.env));
    return chosen.map((item) => {
      const job = records.find((job) => job.id === item.id);
      if (
        !job ||
        !['succeeded', 'failed'].includes(job.state) ||
        jobRecord(job).revision !== item.revision
      )
        throw new CloudError('Build history changed. Reload the selection.', 409);
      return job;
    });
  };
  app.post('/api/jobs/history/export', async (c) =>
    json({
      version: 1,
      exportedAt: new Date().toISOString(),
      jobs: await selectedJobs(c, (await c.req.json()).items),
    }),
  );
  app.post('/api/jobs/history/remove', async (c) => {
    const jobs = await selectedJobs(c, (await c.req.json()).items),
      ws = c.get('workspace');
    const result = await new NativeData(c.env).deleteHistory(ws, {
      items: jobs.map((job) => {
        const path = '.studio/jobs/' + job.id + '.json';
        return { path, revision: ws.files.get(path)?.sha || '' };
      }),
    });
    return json({ ...result, removed: jobs.map((job) => job.id) });
  });
  app.post('/api/jobs/history/:id/restore', async (c) =>
    json(await new NativeData(c.env).restoreGroup(c.get('workspace'), c.req.param('id'))),
  );
  app.get('/api/history/file', async (c) => {
    const path = filePath(c.req.query('path') || ''),
      file = c.get('workspace').files.get(path);
    if (
      !file ||
      file.sha !== c.req.query('revision') ||
      !/^\.studio\/(?:revisions|pages|history|project-history|jobs|job-history|backups)\//.test(
        path,
      )
    )
      throw new CloudError('History changed or is unavailable.', 409);
    const response = await readObject(c.env, file);
    return new Response(response.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition':
          "attachment; filename=glass-history; filename*=UTF-8''" +
          encodeURIComponent(path.split('/').at(-1)!),
        'Cache-Control': 'private, no-store',
      },
    });
  });
  app.get('/api/notebook/reset', async (c) => {
    const ws = c.get('workspace'),
      recoveries: any[] = (await new NativeData(c.env).snapshots())
        .filter((record) => record.reason === 'before-reset')
        .map((record) => ({
          id: record.id,
          createdAt: record.createdAt,
          bytes: record.bytes,
          url: '/api/backups/' + record.id + '/download',
        }));
    for (const path of ws
      .paths()
      .filter((path) => /^\.studio\/reset-recovery\/[a-f0-9-]+\.json$/.test(path))) {
      const record = JSON.parse(new TextDecoder().decode(await ws.read(path)));
      recoveries.push({
        id: record.id,
        createdAt: record.createdAt,
        bytes: record.bytes,
        url: '/api/notebook/reset/' + record.id + '/backup',
      });
    }
    return json({ recoveries: recoveries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  });
  app.post('/api/notebook/reset/review', async (c) =>
    json(await new NativeReset(c.env).review(c.get('workspace'))),
  );
  app.post('/api/notebook/reset/:id/commit', async (c) =>
    json(
      await new NativeReset(c.env).commit(
        c.req.param('id'),
        c.get('workspace'),
        await c.req.json(),
      ),
    ),
  );
  app.get('/api/notebook/reset/:id/backup', async (c) => {
    z.uuid().parse(c.req.param('id'));
    const file = await privateFile(
      c.env,
      '.studio/reset-recovery/' + c.req.param('id') + '.json.gz',
    );
    if (!file) throw new CloudError('Reset recovery copy not found.', 404);
    const response = await readObject(c.env, file);
    return new Response(response.body, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': 'attachment; filename=glass-reset-recovery.json.gz',
        'Cache-Control': 'private, no-store',
      },
    });
  });
  app.post('/api/jobs', async (c) => {
    const data = await c.req.json();
    if (!['build', 'publish'].includes(data.action)) throw new CloudError('Unknown build action.');
    if (data.action === 'build') {
      const model = await c.get('store').snapshot();
      const diagnostics = model.entries.flatMap((entry) =>
        inspectMarkdown(entry.body).diagnostics.map((issue) => ({ ...issue, title: entry.title })),
      );
      const errors = diagnostics.filter((issue) => issue.severity === 'error');
      const now = new Date().toISOString(),
        job = {
          id: crypto.randomUUID(),
          action: 'build' as const,
          state: errors.length ? ('failed' as const) : ('succeeded' as const),
          startedAt: now,
          completedAt: now,
          logs: [
            'Source schemas, routes and Markdown checked directly in Studio. Full production rendering runs when you Publish.',
            ...diagnostics
              .slice(0, 50)
              .map(
                (issue) =>
                  issue.title + ':' + issue.line + ' ' + issue.severity + ': ' + issue.message,
              ),
          ],
          ...(errors.length ? { error: errors.length + ' Markdown errors found.' } : {}),
        };
      c.get('workspace').write(
        '.studio/jobs/' + job.id + '.json',
        new TextEncoder().encode(JSON.stringify(job)),
      );
      return json(jobRecord(job));
    }
    return json(
      asJob(
        await enqueue(
          new Request(c.req.url, { method: 'POST' }),
          c.env,
          c.get('workspace'),
          c.get('actor'),
          data.action,
        ),
        c.env,
      ),
      202,
    );
  });
  app.get('/api/jobs/:id/log', async (c) => {
    const id = c.req.param('id');
    if (!/^[\w-]+$/.test(id)) throw new CloudError('Invalid job ID.');
    const active = await c.env.DB.prepare(
      'SELECT j.id,j.error,p.logs FROM cloud_jobs j LEFT JOIN cloud_progress p ON p.job_id=j.id WHERE j.id=?',
    )
      .bind(id)
      .first<{ id: string; logs: string | null; error: string | null }>();
    let logs: string[];
    if (active)
      logs = [...JSON.parse(active.logs || '[]'), ...(active.error ? [active.error] : [])];
    else {
      const object = await readObject(
        c.env,
        await privateFile(c.env, '.studio/jobs/' + id + '.json'),
      );
      logs = ((await object.json()) as { logs: string[] }).logs;
    }
    return new Response(logs.join('\n'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="glass-job-' + id + '.log"',
      },
    });
  });
  app.post('/api/cloud-jobs/:id/cancel', async (c) => {
    const job = await c.env.DB.prepare(
      "UPDATE cloud_jobs SET state='failed',error=?,updated=? WHERE id=? AND state='queued' RETURNING *",
    )
      .bind(
        'Cancelled before the build claimed this request.',
        new Date().toISOString(),
        c.req.param('id'),
      )
      .first<CloudJob>();
    if (!job)
      throw new CloudError(
        'Only an unclaimed queued request can be cancelled. Check Cloudflare for a running build.',
        409,
      );
    await persistHistory(c.env, job);
    return json({ ok: true });
  });
  app.get('/api/cloud-jobs/:id', async (c) => {
    const job = await c.env.DB.prepare('SELECT * FROM cloud_jobs WHERE id=?')
      .bind(c.req.param('id'))
      .first<CloudJob>();
    if (!job) throw new CloudError('Job not found.', 404);
    return json(job);
  });
  app.get('/api/cloud-jobs/:id/file/:name', async (c) => {
    const id = c.req.param('id'),
      name = c.req.param('name');
    if (!/^[\w.-]+$/.test(name)) throw new CloudError('Invalid download.');
    const meta = await c.env.BUCKET.get('jobs/' + id + '/objects/' + name + '.headers.json'),
      object = await c.env.BUCKET.get('jobs/' + id + '/objects/' + name);
    if (!meta || !object) throw new CloudError('Download is unavailable.', 404);
    const headers = JSON.parse(await meta.text()) as Record<string, string>;
    headers['Cache-Control'] = 'private, no-store';
    return new Response(object.body, { headers });
  });
  app.get('/api/cloud-jobs/:id/result', async (c) => {
    const job = await c.env.DB.prepare('SELECT * FROM cloud_jobs WHERE id=?')
      .bind(c.req.param('id'))
      .first<CloudJob>();
    if (!job?.result_key)
      throw new CloudError(
        job?.error || 'The job has not produced a result.',
        job?.state === 'failed' ? 400 : 409,
      );
    const object = await c.env.BUCKET.get('jobs/' + job.id + '/objects/' + job.result_key);
    if (!object) throw new CloudError('Job result is missing.', 404);
    return new Response(object.body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    });
  });
  app.on(['GET', 'HEAD'], '/media/:name', async (c) => {
    const record = await privateFile(c.env, 'content/media/' + c.req.param('name'));
    const type: Record<string, string> = {
      webp: 'image/webp',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      svg: 'image/svg+xml',
      gif: 'image/gif',
      avif: 'image/avif',
      pdf: 'application/pdf',
      mp3: 'audio/mpeg',
      mp4: 'video/mp4',
      webm: 'video/webm',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
    };
    const headers: Record<string, string> = {
      'Content-Type':
        type[c.req.param('name').split('.').at(-1)!.toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox",
      'Accept-Ranges': 'bytes',
      'Content-Length': String(record.bytes),
    };
    if (c.req.method === 'HEAD') return new Response(null, { headers });
    const range = c.req.header('Range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1]
        ? Number(match[1])
        : match?.[2]
          ? Math.max(0, record.bytes - Number(match[2]))
          : -1;
      const end =
        match?.[1] && match[2] ? Math.min(Number(match[2]), record.bytes - 1) : record.bytes - 1;
      if (
        !match ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start >= record.bytes ||
        start > end
      )
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': 'bytes */' + record.bytes },
        });
      const object = await c.env.BUCKET.get('workspace/blobs/' + record.sha, {
        range: { offset: start, length: end - start + 1 },
      });
      if (!object) throw new CloudError('A media object is missing.', 503);
      return new Response(object.body, {
        status: 206,
        headers: {
          ...headers,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${record.bytes}`,
        },
      });
    }
    return new Response((await readObject(c.env, record)).body, { headers });
  });
  app.get('/m/:code', async (c) => {
    const object = await readObject(c.env, await privateFile(c.env, 'content/library.json')),
      library = JSON.parse(await object.text()),
      files = await c.env.DB.prepare(
        "SELECT path FROM cloud_files WHERE path GLOB 'content/media/*'",
      ).all<{ path: string }>();
    const target = mediaLinkMap(
      files.results.map(
        (file) => '/media/' + encodeURIComponent(file.path.slice('content/media/'.length)),
      ),
      library,
    ).get('/m/' + c.req.param('code'));
    if (!target) throw new CloudError('Media short link not found.', 404);
    return c.redirect(target, 302);
  });
  app.post('/mcp', (c) =>
    serveMcp(c.req.raw, c.env, c.get('store'), c.get('workspace'), c.get('actor')),
  );
  app.get('/mcp', () => new Response(null, { status: 405 }));
  app.post('/api/cloud/mcp-keys', async (c) => {
    const count = await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM cloud_keys WHERE actor=? AND revoked=0',
    )
      .bind(c.get('actor').id)
      .first<{ count: number }>();
    if ((count?.count || 0) >= 20)
      throw new CloudError('Revoke unused authoring keys before creating another.', 413);
    const token =
        'gsk_' +
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
      id = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO cloud_actors(id,email,role,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,role=excluded.role',
      ).bind(c.get('actor').id, c.get('actor').email, 'owner', new Date().toISOString()),
      c.env.DB.prepare(
        'INSERT INTO cloud_keys(id,digest,actor,scopes,created) VALUES(?,?,?,?,?)',
      ).bind(id, await hash(token), c.get('actor').id, 'draft', new Date().toISOString()),
    ]);
    return json({ id, token });
  });
  app.get('/api/cloud/mcp-keys', async (c) =>
    json(
      (
        await c.env.DB.prepare(
          'SELECT id,created,scopes,revoked FROM cloud_keys WHERE actor=? ORDER BY created DESC LIMIT 100',
        )
          .bind(c.get('actor').id)
          .all()
      ).results,
    ),
  );
  app.delete('/api/cloud/mcp-keys/:id', async (c) => {
    await c.env.DB.prepare('UPDATE cloud_keys SET revoked=1 WHERE id=? AND actor=?')
      .bind(c.req.param('id'), c.get('actor').id)
      .run();
    return json({ ok: true });
  });
  app.get('/api/authoring/connection', (c) =>
    json({
      mcpServers: {
        glass: {
          url: c.env.STUDIO_ORIGIN + '/mcp',
          headers: {
            'CF-Access-Client-Id': '<service-token-id>',
            'CF-Access-Client-Secret': '<service-token-secret>',
            Authorization: 'Bearer <glass-authoring-key>',
          },
        },
      },
    }),
  );
  app.all('/api/*', async (_c) => {
    return json({ error: 'This Studio operation is unavailable. No build was queued.' }, 404);
  });
  app.all('*', async (c) => {
    const url = new URL(c.req.url);
    if (!['GET', 'HEAD'].includes(c.req.method)) return c.notFound();
    if (url.pathname === '/studio' || url.pathname.startsWith('/studio/')) {
      const path = url.pathname.slice('/studio'.length).replace(/^\/+/, '');
      return c.redirect('/' + path + url.search, 308);
    }
    if (
      !['/', '/index.html', '/cloud-reader-assets.json'].includes(url.pathname) &&
      !['/assets/', '/cloud-compiler/', '/authoring/'].some((prefix) =>
        url.pathname.startsWith(prefix),
      )
    )
      return c.notFound();
    const response = await c.env.ASSETS.fetch(c.req.raw);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Robots-Tag', 'noindex,nofollow');
    return new Response(response.body, { status: response.status, headers });
  });
  return app;
}
const app = createCloudApp();
export default {
  fetch: (request: Request, env: CloudEnv) => app.fetch(request, env),
  scheduled: (
    _event: unknown,
    env: CloudEnv,
    context: { waitUntil(promise: Promise<unknown>): void },
  ) =>
    context.waitUntil(
      (async () => {
        if (!(await runDeferredBuild(env))) await cloudSchedule(env);
        await storageMaintenance(env);
      })(),
    ),
};
