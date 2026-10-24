import { proxyAnalytics, analyticsStatus } from './analytics.js';
import { serviceReadiness } from './service-readiness.js';
import { CloudMediaService } from './cloud-media.js';
import { SearchConsoleService } from './search-console.js';
import { HealthService } from './health.js';
import { applicationRoot as installedApplicationRoot } from './configuration.js';
import { AcaDeploymentService } from './aca-deployment.js';
import { projectsSchema } from '../shared/projects.js';
import { saveProjects, undoProjects, importGithubProject } from '../engine/projects.js';
import { resolveEntrySettings } from '../shared/entry-settings.js';
import { createR2Transport, r2Readiness } from './r2.js';
import { LauncherSettings, PrivateSettings } from './configuration.js';
import { savedSegmentsSchema } from '../shared/aca-segments.js';
import { MediaProtectionService } from './media-protection.js';
import { canonicalMediaUrl } from '../shared/media-details.js';
import { mediaMetadataSchema } from '../shared/media-metadata.js';
import { mediaLinkMap } from '../engine/media-links.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE, stream } from 'hono/streaming';
import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs, watch, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import sharp from 'sharp';
import { MediaService, inspectImage } from '../engine/media.js';
import { z, ZodError } from 'zod';
import { Store, ConflictError, contained, digest } from '../engine/store.js';
import { renderMarkdown, renderMathPreviews, renderSourceMathPreviews } from '../engine/markdown.js';
import { mathSettingsSchema } from '../shared/math-authoring.js';
import { entryAliasRoutes } from '../shared/entry-routes.js';
import { mathPreviewLimits } from '../shared/math-preview.js';
import { readReaderAssets } from '../engine/reader-assets.js';
import { resolveResponsiveImages } from '../engine/responsive-images.js';
import { responsiveWidths } from '../shared/utils.js';
import { createRenderer } from '../site/pages.js';
import { serializeEntry } from '../engine/store.js';
import { entrySchema, siteSchema, publicEntry, routeFor, type Job } from '../shared/contracts.js';
import { JobService, authStatus, listPagesProjects, createPagesProject } from './publishing.js';
import { BackupService, backupArchiveName } from '../engine/backup.js';
import { BackupUploads } from './backup-uploads.js';
import { Scheduler } from './scheduler.js';
import { checkDiscussionConfiguration, discussionCheckSchema } from './discussions.js';
import { annotationReader } from '../shared/annotations.js';
import { Operations, OperationConflict, snapshotRevision } from '../engine/operations.js';
import { Exports } from '../engine/exports.js';
import { MediaMaintenance } from '../engine/media-maintenance.js';
import { BackupScheduler } from './backup-scheduler.js';
import { selectedItemsSchema, missingMediaReferences } from '../shared/operations.js';
import { JobHistory, jobRecord } from './job-history.js';
import { collectionRedirect, retainCollectionPaths } from '../shared/collections.js';
import { inspectMarkdown } from '../shared/markdown-analysis.js';
import { MarkdownValidationError } from '../shared/markdown-analysis.js';
import { authoringCapabilities } from '../shared/authoring-capabilities.js';
import { checkMarkdownDocument } from '../engine/authoring.js';
import { renderComponentPreviews } from '../engine/component-previews.js';
import { diagramPresentation } from '../shared/diagram-presentation.js';
import { componentPreviewLimits } from '../shared/source-components.js';
import { attachmentTypes, attachmentFile, imageFile } from '../shared/attachments.js';
import { NotebookReset } from '../engine/notebook-reset.js';
import { discussionThemePreview } from '../engine/discussion-preview.js';
import { AcaConnectionError } from './aca-fetch.js';
import { developmentReloadScript, withDevelopmentReload, type DevelopmentPreview } from './development.js';

const mime: Record<string, string> = {
  ...attachmentTypes,
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};
export async function createApp(
  root: string,
  options: {
    watchFiles?: boolean;
    jobs?: JobService;
    discussionFetch?: typeof fetch;
    annotationFetch?: typeof fetch;
    analyticsFetch?: typeof fetch;
    protectionFetch?: typeof fetch;
    launcher?: LauncherSettings;
    applicationRoot?: string;
    activePort?: number;
    connectionTest?: () => Promise<void>;
    acaDeployment?: AcaDeploymentService;
    development?: DevelopmentPreview;
  } = {},
) {
  const app = new Hono();
  const publicDirectory = () => options.development?.directory || path.join(root, 'dist');
  const store = options.jobs?.store || new Store(root);
  await store.snapshot();
  const jobs = options.jobs || new JobService(store);
  const acaDeployment = options.acaDeployment || new AcaDeploymentService(store, jobs.connections);
  async function checkCloudflareAccount(accountId: string) {
    const credentials = await jobs.connections.values();
    return authStatus(
      (args, account, onLog) => jobs.runner(args, account, onLog, credentials),
      accountId,
    );
  }
  const launcher =
    options.launcher ||
    new LauncherSettings(options.applicationRoot || root, {
      notebookRoot: root,
      port: options.activePort || 4310,
    });
  await jobs.initialize();
  const token = randomBytes(32).toString('hex');
  const changes = new EventEmitter();
  changes.setMaxListeners(100);
  const previews = new Map<string, string>();
  const backups = new BackupService(store);
  const backupUploads = new BackupUploads(backups);
  const media = new MediaService(store);
  const readAnnotations = annotationReader(options.annotationFetch);
  const scheduler: Scheduler = new Scheduler(
    jobs,
    () => changes.emit('filesystem'),
    () => !backups.restoring && !notebookReset?.busy,
  );
  await scheduler.initialize();
  const operations = new Operations(store);
  const exports = new Exports(store, backups);
  await exports.initialize();
  const history = new JobHistory(jobs, exports);
  const idle = (): boolean =>
    !jobs.isBusy &&
    !cloudMedia.busy &&
    !acaDeployment.isBusy &&
    !scheduler.isBusy &&
    !backups.restoring &&
    !notebookReset?.busy;
  const maintenance = new MediaMaintenance(store, media, backups, idle);
  const cloudMedia = new CloudMediaService(store, jobs, idle);
  const mediaProtection = new MediaProtectionService(
    store,
    jobs.connections,
    options.protectionFetch,
  );
  const searchConsole = new SearchConsoleService(root);
  const health = new HealthService(store, jobs, acaDeployment, options.analyticsFetch);
  jobs.externalBusy = () => cloudMedia.busy;
  const automaticBackups = new BackupScheduler(backups, idle, () => changes.emit('filesystem'));
  const notebookReset: NotebookReset = new NotebookReset(
    store,
    backups,
    () =>
      !jobs.isBusy &&
      !acaDeployment.isBusy &&
      !scheduler.isBusy &&
      !backups.restoring &&
      !automaticBackups.isBusy,
    () => {
      jobs.clearHistoryAfterReset();
      scheduler.state = { running: false, pendingIds: [] };
      previews.clear();
      operations.discardReviews();
      backups.discardReviews();
      maintenance.discardReviews();
      exports.discardTickets();
    },
  );
  if (options.watchFiles !== false) scheduler.start();
  if (options.watchFiles !== false) automaticBackups.start();
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      return c.json({ error: 'Studio only accepts local connections.' }, 403);
    const origin = c.req.header('Origin');
    if (origin && origin !== url.origin)
      return c.json({ error: 'Cross-origin access is not allowed.' }, 403);
    if (c.req.header('Sec-Fetch-Site') === 'cross-site')
      return c.json({ error: 'Open Studio directly on this computer.' }, 403);
    if (
      c.req.path.startsWith('/api/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      c.req.header('X-Studio-Token') !== token
    )
      return c.json({ error: 'Your Studio session expired. Reload this page.' }, 403);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    await next();
  });
  if (options.development) {
    const development = options.development;
    app.get('/__dev/reload.js', (c) => c.body(developmentReloadScript, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }));
    app.get('/__dev/events', (c) => streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        const send = () => { void stream.writeSSE({ data: JSON.stringify({ generation: development.generation, error: development.error }) }).catch(cleanup); };
        const heartbeat = setInterval(send, 10_000);
        function cleanup() { clearInterval(heartbeat); development.events.off('update', send); development.events.off('close', cleanup); resolve(); }
        development.events.on('update', send); development.events.on('close', cleanup); stream.onAbort(cleanup); send();
      });
    }));
  }
  app.use('/api/*', (c, next) =>
    c.req.path === '/api/backups/review'
      ? next()
      : bodyLimit({
          maxSize: 21 * 1024 * 1024,
          onError: (c) => c.json({ error: 'Files must be smaller than 20 MiB.' }, 413),
        })(c, next),
  );
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (cloudMedia.busy && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method))
      return c.json({ error: 'Wait for cloud media maintenance to finish.' }, 409);
    if (notebookReset.busy)
      return c.json({ error: 'The notebook is being reset. Wait for the reset to finish.' }, 409);
    await next();
  });
  app.onError((error, c) => {
    const message =
      error instanceof ZodError
        ? error.issues.map((i) => `${i.path.join('.') || 'Content'}: ${i.message}`).join('\n')
        : error.message;
    return c.json(
      {
        error: message,
        ...(error instanceof AcaConnectionError
          ? { messageKey: error.messageKey, messageParams: error.messageParams }
          : {}),
        ...(error instanceof OperationConflict ? { issues: error.issues } : {}),
        ...(error instanceof MarkdownValidationError ? { diagnostics: error.diagnostics } : {}),
      },
      error instanceof ConflictError ? 409 : error instanceof AcaConnectionError ? 503 : 400,
    );
  });
  app.get('/api/authoring/connection', (c) =>
    c.json({
      mcpServers: {
        glass: {
          command: process.execPath,
          args: [
            '--import',
            path.join(
              options.applicationRoot || installedApplicationRoot,
              'node_modules/tsx/dist/loader.mjs',
            ),
            path.join(options.applicationRoot || installedApplicationRoot, 'scripts/mcp.ts'),
            '--root',
            root,
            '--port',
            String(options.activePort || 4310),
          ],
        },
      },
    }),
  );
  app.get('/api/health', async (c) => c.json(await health.report()));
  app.get('/api/search-console', async (c) => c.json(await searchConsole.list()));
  app.get('/api/search-console/:id', async (c) =>
    c.json(await searchConsole.read(c.req.param('id'))),
  );
  app.post('/api/search-console/review', async (c) => {
    const data = z
      .object({
        source: z.string().max(2000000),
        name: z.string().min(1).max(200),
        property: z.string().url(),
        from: z.string(),
        to: z.string(),
      })
      .strict()
      .parse(await c.req.json());
    if (new URL(data.property).origin !== new URL((await store.snapshot()).site.url).origin)
      throw new Error('Import data for the current site property.');
    return c.json(await searchConsole.prepare(data));
  });
  app.post('/api/search-console/import', async (c) => {
    const { id } = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await c.req.json());
    return c.json(await searchConsole.commit(id));
  });
  app.delete('/api/search-console/:id', async (c) => {
    const { revision } = z
      .object({ revision: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(await searchConsole.remove(c.req.param('id'), revision));
  });
  app.get('/api/cloud-media', async (c) => c.json(await cloudMedia.inventory()));
  app.get('/api/cloud-media/protection', async (c) => c.json(await mediaProtection.status()));
  app.post('/api/cloud-media/protection/check', async (c) => c.json(await mediaProtection.check()));
  app.post('/api/cloud-media/protection/apply', async (c) => {
    const data = z
      .object({ id: z.uuid(), revision: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(await mediaProtection.apply(data.id, data.revision));
  });
  app.post('/api/cloud-media/health', async (c) => c.json(await cloudMedia.health()));
  app.post('/api/cloud-media/review', async (c) => {
    const input = z
      .object({ revision: z.string(), keys: z.array(z.string()).min(1).max(100) })
      .strict()
      .parse(await c.req.json());
    return c.json(await cloudMedia.review(input.revision, input.keys));
  });
  app.post('/api/cloud-media/cleanup', async (c) => {
    const input = z
      .object({ id: z.string().uuid(), revision: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(await cloudMedia.cleanup(input.id, input.revision));
  });
  app.get('/api/authoring/capabilities', (c) => c.json(authoringCapabilities()));
  app.notFound((c) =>
    c.req.path.startsWith('/api/')
      ? c.json(
          {
            error:
              'This Studio API is unavailable (404). Restart Studio after updating, then retry.',
          },
          404,
        )
      : c.text('404 Not Found', 404),
  );
  app.post('/api/authoring/draft', async (c) => {
    const data = z
      .object({
        kind: z.enum(['posts', 'lab']),
        title: z.string().min(1).max(160),
        slug: z.string(),
        body: z.string().max(1000000),
        metadata: z.record(z.string(), z.unknown()).default({}),
        targetId: z.string().optional(),
        revision: z.string().optional(),
      })
      .strict()
      .parse(await c.req.json());
    const existing = data.targetId
      ? (await store.snapshot()).entries.find((e) => e.id === data.targetId)
      : undefined;
    if (data.targetId && !existing) throw new Error('Draft not found.');
    if (existing && (existing.status !== 'draft' || existing.kind !== data.kind || !data.revision))
      throw new ConflictError(
        'Only an existing draft with its current revision can be revised through MCP.',
      );
    const metadata = entrySchema.parse({
      ...existing,
      ...data.metadata,
      id: existing?.id || randomUUID(),
      title: data.title,
      slug: data.slug,
      status: 'draft',
      publishedAt:
        data.metadata.publishedAt || existing?.publishedAt || new Date().toISOString().slice(0, 10),
    });
    const validation = await checkMarkdownDocument(serializeEntry(metadata, data.body));
    if (validation.diagnostics.some((d) => d.severity === 'error'))
      return c.json({ ...validation, error: 'Draft validation failed.' }, 422);
    const result = existing
      ? await store.saveEntry(existing.id, {
          metadata,
          body: data.body,
          revision: data.revision!,
          draftOnly: true,
        })
      : await store.create(data.kind, data.title, data.slug, { metadata, body: data.body });
    changes.emit('filesystem');
    return c.json(publicEntry(result), existing ? 200 : 201);
  });
  app.post('/api/authoring/math-preview', async (c) => {
    const request = await c.req.json();
    if (typeof request.source === 'string') {
      const input = z.object({
        source: z.string().max(2 * 1024 * 1024),
        ranges: z.array(z.object({from:z.number().int().nonnegative(),to:z.number().int().nonnegative()}).strict()).max(mathPreviewLimits.count),
        math: mathSettingsSchema.optional(),
      }).strict().parse(request);
      return c.json({results:await renderSourceMathPreviews(input.source,input.ranges,input.math)});
    }
    const { expressions, math } = z
      .object({
        math: mathSettingsSchema.optional(),
        expressions: z
          .array(
            z
              .object({
                source: z.string().max(mathPreviewLimits.expression),
                display: z.boolean(),
              })
              .strict(),
          )
          .max(mathPreviewLimits.count),
      })
      .strict()
      .parse(request);
    return c.json({ results: await renderMathPreviews(expressions, math) });
  });
  app.post('/api/authoring/validate', async (c) => {
    const input = z
      .object({ source: z.string().max(2_000_000), full: z.boolean().default(false) })
      .parse(await c.req.json());
    const result = input.full
      ? await checkMarkdownDocument(input.source)
      : inspectMarkdown(input.source);
    return c.json({ ...result, ok: !result.diagnostics.some((d) => d.severity === 'error') });
  });
  app.post('/api/authoring/component-preview', async (c) => {
    const input = z
      .object({
        source: z.string().max(componentPreviewLimits.source),
        math: mathSettingsSchema.optional(),
        blocks: z
          .array(
            z
              .object({ from: z.number().int().nonnegative(), to: z.number().int().positive() })
              .strict(),
          )
          .max(componentPreviewLimits.count),
      })
      .strict()
      .parse(await c.req.json());
    return c.json({
      results: await renderComponentPreviews(input.source, input.blocks, root, c.req.raw.signal, input.math, diagramPresentation((await store.read()).site.theme)),
    });
  });
  app.post('/api/content/batch', async (c) => {
    const result = await operations.content(await c.req.json());
    changes.emit('filesystem');
    return c.json(result);
  });
  app.post('/api/trash/batch', async (c) => {
    const result = await operations.trash(await c.req.json());
    changes.emit('filesystem');
    return c.json(result);
  });
  app.post('/api/backups/batch', async (c) => {
    const result = await backups.batch(await c.req.json());
    changes.emit('filesystem');
    return c.json(result);
  });
  app.post('/api/photos/batch', async (c) => {
    const result = await operations.photos(await c.req.json());
    changes.emit('filesystem');
    return c.json(result);
  });
  for (const kind of ['content', 'backups', 'media'] as const)
    app.post('/api/' + kind + '/export', async (c) =>
      c.json(await exports.prepare(kind, selectedItemsSchema.parse((await c.req.json()).items))),
    );
  app.get('/api/exports/:id', (c) => {
    const download = exports.download(c.req.param('id'));
    c.header('Content-Type', 'application/gzip');
    c.header('Content-Disposition', 'attachment; filename="' + download.name + '"');
    return stream(c, async (response) => {
      try {
        for await (const chunk of download.stream) await response.write(new Uint8Array(chunk));
      } finally {
        download.stream.destroy();
        await exports.release(c.req.param('id'));
      }
    });
  });
  app.get('/api/content/:id/download', async (c) => {
    const result = await store.exclusive(async () => {
      const entry = (await store.read()).entries.find((entry) => entry.id === c.req.param('id'));
      if (!entry) throw new Error('Entry not found.');
      return {
        entry,
        raw: await fs.readFile(await contained(path.join(store.content, entry.kind), entry.file)),
      };
    });
    return c.newResponse(result.raw, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition':
          'attachment; filename="entry.md"; filename*=UTF-8\'\'' +
          encodeURIComponent(result.entry.file).replace(/'/g, '%27'),
      },
    });
  });
  app.post('/api/content/import/review', async (c) => {
    const body = await c.req.formData(),
      kind = z.enum(['posts', 'lab']).parse(body.get('kind'));
    const files = body.getAll('files');
    if (files.some((file) => !(file instanceof File))) throw new Error('Choose Markdown files.');
    const values = await Promise.all(
      (files as File[]).map(async (file) => ({
        name: file.name,
        text: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()),
      })),
    );
    return c.json(await operations.reviewImport(values, kind));
  });
  app.post('/api/content/import/:id/commit', async (c) => {
    const { sourceRevision } = z.object({ sourceRevision: z.string() }).parse(await c.req.json());
    const result = await operations.import(c.req.param('id'), sourceRevision);
    changes.emit('filesystem');
    return c.json(result);
  });
  app.get('/api/backup-settings', async (c) => c.json(await automaticBackups.summary()));
  app.put('/api/backup-settings', async (c) =>
    c.json(
      await automaticBackups.update(
        z
          .object({
            enabled: z.boolean(),
            keepAutomatic: z.number().int().min(1).max(100),
            revision: z.string(),
          })
          .strict()
          .parse(await c.req.json()),
      ),
    ),
  );
  app.post('/api/backup-settings/run', async (c) => c.json(await automaticBackups.run()));
  app.get('/api/media/usage', async (c) => c.json(await maintenance.audit()));
  app.post('/api/media/cleanup/review', async (c) =>
    c.json(await maintenance.review((await c.req.json()).urls)),
  );
  app.post('/api/media/cleanup/:id/commit', async (c) => {
    const { revision } = z.object({ revision: z.string() }).parse(await c.req.json());
    const result = await maintenance.cleanup(c.req.param('id'), revision);
    changes.emit('filesystem');
    return c.json(result);
  });
  app.get('/api/maintenance', async (c) => {
    const { model, records, files } = await store.exclusive(async () => ({
      model: await store.read(),
      records: await backups.list(),
      files: await media.list(),
    }));
    const last = jobs.jobs.find((job) => job.state === 'succeeded' && job.build);
    let missing = 0,
      missingRecovery = 0,
      unused = 0,
      error: string;
    try {
      const audit = await maintenance.audit();
      const unresolved = missingMediaReferences(audit.items);
      missing = unresolved.current.length;
      missingRecovery = unresolved.recovery.length;
      unused = audit.items.filter(
        (item) => !item.missing && !item.active.length && !item.history.length,
      ).length;
      error = audit.issues.join('\n');
    } catch (issue) {
      error = (issue as Error).message;
    }
    return c.json({
      latestBackup: records[0]?.createdAt || '',
      backupBytes: records.reduce((sum, record) => sum + record.bytes, 0),
      mediaBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      missing,
      missingRecovery,
      unused,
      error,
      lastBuild: last?.completedAt || '',
      changedSinceBuild: !last?.build || last.build.sourceRevision !== snapshotRevision(model),
    });
  });
  app.get('/api/bootstrap', async (c) => {
    const model = await store.snapshot();
    return c.json({
      ...model,
      entries: model.entries.map(publicEntry),
      token,
      workspaceId: digest(await fs.realpath(root)),
      jobs: jobs.jobs.map(jobRecord),
    });
  });
  app.get('/api/content', async (c) => c.json((await store.snapshot()).entries.map(publicEntry)));
  app.get('/api/annotations/:id', async (c) => {
    const model = await store.snapshot(),
      comments = model.site.integrations.comments;
    return readAnnotations(c.req.raw, {
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
  app.get('/api/content/:id/revisions', async (c) =>
    c.json(await store.exclusive(() => store.listRevisions(c.req.param('id')))),
  );
  app.get('/api/content/:id/revisions/:revision', async (c) =>
    c.json(
      await store.exclusive(() => store.getRevision(c.req.param('id'), c.req.param('revision'))),
    ),
  );
  app.post('/api/content/:id/revisions/:selected/restore', async (c) => {
    const { revision } = z.object({ revision: z.string() }).parse(await c.req.json());
    const entry = await store.restoreRevision(c.req.param('id'), c.req.param('selected'), revision);
    changes.emit('filesystem');
    return c.json(publicEntry(entry));
  });
  app.post('/api/content', async (c) => {
    const data = z
      .object({
        kind: z.enum(['posts', 'lab']),
        title: z.string().min(1).max(160),
        slug: z.string(),
      })
      .parse(await c.req.json());
    const entry = await store.create(data.kind, data.title, data.slug);
    changes.emit('filesystem');
    return c.json(publicEntry(entry), 201);
  });
  app.put('/api/content/:id', async (c) => {
    const data = z
      .object({ metadata: entrySchema, body: z.string().max(1000000), revision: z.string() })
      .parse(await c.req.json());
    const entry = await store.saveEntry(c.req.param('id'), data);
    changes.emit('filesystem');
    return c.json(publicEntry(entry));
  });
  app.delete('/api/content/:id', async (c) => {
    const data = z.object({ revision: z.string() }).parse(await c.req.json());
    await store.trash(c.req.param('id'), data.revision);
    changes.emit('filesystem');
    return c.json({ ok: true });
  });
  app.get('/api/trash', async (c) => c.json(await store.exclusive(() => store.listTrash())));
  app.post('/api/trash/:id/restore', async (c) => {
    await store.restore(c.req.param('id'));
    changes.emit('filesystem');
    return c.json({ ok: true });
  });
  app.put('/api/projects', async (c) => {
    const { value, revision } = await c.req.json();
    const saved = await saveProjects(store, value, revision);
    changes.emit('filesystem');
    return c.json(saved);
  });
  app.post('/api/projects/undo', async (c) => {
    const { revision } = z.object({ revision: z.string() }).parse(await c.req.json());
    const saved = await undoProjects(store, revision);
    changes.emit('filesystem');
    return c.json(saved);
  });
  app.post('/api/projects/github', async (c) => {
    const { repository } = z
      .object({ repository: z.string().max(201) })
      .strict()
      .parse(await c.req.json());
    return c.json(await importGithubProject(repository));
  });
  app.put('/api/site', async (c) => {
    const { value, revision } = await c.req.json();
    const saved = await store.saveJson('site', value, revision);
    changes.emit('filesystem');
    return c.json(saved);
  });
  app.post('/api/integrations/giscus/check', async (c) => {
    const value = discussionCheckSchema.parse(await c.req.json());
    return c.json(await checkDiscussionConfiguration(value, options.discussionFetch));
  });
  app.post('/api/integrations/giscus/theme-preview', async (c) => {
    const { theme, mode } = z
      .object({ theme: siteSchema.shape.theme, mode: z.enum(['light', 'dark']) })
      .strict()
      .parse(await c.req.json());
    const { site } = await store.snapshot();
    return c.json({ html: discussionThemePreview({ ...site, theme }, mode) });
  });
  app.put('/api/library', async (c) => {
    const { value, revision } = await c.req.json();
    const saved = await store.saveJson('library', value, revision);
    changes.emit('filesystem');
    return c.json(saved);
  });
  app.post('/api/library/undo', async (c) => {
    const data = z.object({ revision: z.string() }).parse(await c.req.json());
    const result = await store.undoLibrary(data.revision);
    changes.emit('filesystem');
    return c.json(result);
  });
  app.get('/api/pages/about', async (c) => c.json((await store.snapshot()).about));
  app.put('/api/pages/about', async (c) => {
    const data = z
      .object({ body: z.string().max(1000000), revision: z.string() })
      .parse(await c.req.json());
    await renderMarkdown(data.body);
    const saved = await store.saveAbout(data.body, data.revision);
    changes.emit('filesystem');
    return c.json(saved);
  });
  app.get('/api/pages/about/revisions', async (c) =>
    c.json(await store.exclusive(() => store.aboutRevisions())),
  );
  app.post('/api/pages/about/restore', async (c) => {
    const data = z.object({ selected: z.string(), revision: z.string() }).parse(await c.req.json());
    const previous = await store.aboutRevision(data.selected);
    const saved = await store.saveAbout(previous.body, data.revision, 'restore');
    changes.emit('filesystem');
    return c.json(saved);
  });
  app.get('/api/media/metadata', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await store.exclusive(() => media.metadata(c.req.query('url') || '')));
  });
  app.put('/api/media/metadata', async (c) => {
    const data = z
      .object({ url: z.string().max(1000), metadata: mediaMetadataSchema, revision: z.string() })
      .strict()
      .parse(await c.req.json());
    const result = await media.saveMetadata(data.url, data.metadata, data.revision);
    changes.emit('filesystem');
    return c.json(result);
  });
  app.get('/api/media/details', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await store.exclusive(() => media.details(c.req.query('url') || '')));
  });
  app.put('/api/media/details', async (c) => {
    const data = z
      .object({ url: z.string().max(1000), publishCameraExif: z.boolean(), revision: z.string() })
      .parse(await c.req.json());
    const url = canonicalMediaUrl(data.url);
    await media.details(url);
    const model = await store.snapshot();
    const result = await store.saveJson(
      'library',
      {
        ...model.library,
        mediaDetails: {
          ...model.library.mediaDetails,
          [url]: { ...model.library.mediaDetails[url], publishCameraExif: data.publishCameraExif },
        },
      },
      data.revision,
    );
    changes.emit('filesystem');
    return c.json(result);
  });
  app.get('/api/media', async (c) => c.json(await store.exclusive(() => media.list())));
  app.post('/api/media/inspect', async (c) => {
    const body = await c.req.parseBody();
    if (!(body.file instanceof File)) throw new Error('Choose an image.');
    return c.json(await inspectImage(Buffer.from(await body.file.arrayBuffer())));
  });
  app.get('/api/media/:id/inspect', async (c) =>
    c.json(
      await store.exclusive(async () =>
        inspectImage((await media.source(c.req.param('id'))).bytes),
      ),
    ),
  );
  app.get('/api/media/:id/source', async (c) => {
    const { bytes, record } = await store.exclusive(() => media.source(c.req.param('id')));
    return c.newResponse(bytes, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition':
          'attachment; filename="original-image"; filename*=UTF-8\'\'' +
          encodeURIComponent(record.name).replace(/'/g, '%27'),
        'Cache-Control': 'no-store',
      },
    });
  });
  app.post('/api/media/:id/variants', async (c) => {
    const { transform } = z.object({ transform: z.unknown() }).parse(await c.req.json());
    const result = await media.variant(c.req.param('id'), transform);
    changes.emit('filesystem');
    return c.json(result, 201);
  });
  app.post('/api/media', async (c) => {
    const body = await c.req.parseBody();
    if (!(body.file instanceof File)) throw new Error('Choose an image or supported attachment.');
    const result = await media.upload(
      body.file,
      body.transform ? JSON.parse(String(body.transform)) : {},
    );
    changes.emit('filesystem');
    return c.json(result, 201);
  });
  app.post('/api/preview', async (c) => {
    const data = z
      .object({
        entryId: z.string().optional(),
        draft: z
          .object({
            kind: z.enum(['posts', 'lab']),
            metadata: entrySchema,
            body: z.string().max(1000000),
          })
          .optional(),
        metadata: entrySchema.optional(),
        body: z.string().max(1000000).optional(),
        site: siteSchema.optional(),
        projects: projectsSchema.optional(),
        route: z.string().optional(),
      })
      .parse(await c.req.json());
    const model = await store.snapshot();
    if (data.projects) model.projects = data.projects;
    if (data.site) {
      data.site.collections = retainCollectionPaths(data.site.collections, model.site.collections);
      model.site = data.site;
    }
    if (data.route === '/about/' && data.body !== undefined) model.about.body = data.body;
    if (data.draft) {
      if (data.entryId || model.entries.some((e) => e.id === data.draft!.metadata.id))
        throw new Error('Preview identity must be new.');
      const metadata = { ...data.draft.metadata, status: 'draft' as const };
      model.entries.push({
        ...metadata,
        body: data.draft.body,
        kind: data.draft.kind,
        file: 'temporary-preview.md',
        revision: digest(serializeEntry(metadata, data.draft.body)),
      });
      data.entryId = metadata.id;
    }
    let route = data.route || '/';
    if (data.entryId) {
      const entry = model.entries.find((e) => e.id === data.entryId);
      if (!entry) throw new Error('Content not found');
      if (data.metadata)
        Object.assign(
          entry,
          Object.fromEntries(
            Object.keys(entrySchema.shape).map((key) => [
              key,
              data.metadata![key as keyof typeof data.metadata],
            ]),
          ),
          { id: entry.id },
        );
      if (data.body !== undefined) entry.body = data.body;
      route = routeFor(entry, model.site.collections);
    }
    // Only the explicitly edited draft joins published content in an article preview.
    model.entries = model.entries.filter(
      (entry) => entry.status === 'published' || entry.id === data.entryId,
    );
    route = entryAliasRoutes(model.entries,model.site.collections).get(route) || collectionRedirect(route, model.site.collections) || route;
    const renderer = await createRenderer(model, {
      includeDrafts: !!data.entryId || !!data.projects,
      preview: true,
      diagramCacheDir: path.join(root, '.studio/render-cache/mermaid'),
      readerAssets: await readReaderAssets(publicDirectory()),
    });
    const imageSizes = new Map(
      (await media.list())
        .filter((image) => image.width && image.height)
        .map((image) => [
          decodeURIComponent(image.url),
          { width: image.width!, height: image.height! },
        ]),
    );
    const renderedHtml = resolveResponsiveImages(renderer.render(route), imageSizes);
    const html = options.development ? withDevelopmentReload(renderedHtml) : renderedHtml;
    const id = randomUUID();
    if (previews.size >= 40) previews.delete(previews.keys().next().value!);
    previews.set(id, html);
    return c.json({ url: `/preview/${id}/` });
  });
  app.get('/preview/:id/', (c) => {
    const html = previews.get(c.req.param('id'));
    c.header('Cache-Control', 'no-store');
    return html ? c.html(html) : c.html('<p>This preview expired. Refresh it in Studio.</p>', 404);
  });
  app.get('/api/jobs', (c) => c.json(jobs.jobs.map(jobRecord)));
  app.post('/api/jobs/history/remove', async (c) =>
    c.json(await history.remove((await c.req.json()).items)),
  );
  app.post('/api/jobs/history/:id/restore', async (c) =>
    c.json(await history.restore(c.req.param('id'))),
  );
  app.post('/api/jobs/history/export', async (c) =>
    c.json(await history.exportReports((await c.req.json()).items)),
  );
  app.post('/api/jobs/:id/artifact', async (c) => {
    const { revision } = z
      .object({ revision: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(await history.artifact(c.req.param('id'), revision));
  });
  app.get('/api/jobs/:id/log', (c) => {
    const job = history.find(c.req.param('id'));
    c.header('Content-Disposition', `attachment; filename="glass-job-${job.id}.log"`);
    return c.text(job.logs.join('\n'));
  });
  app.get('/api/schedule', async (c) =>
    c.json({
      ...scheduler.state,
      entries: (await store.snapshot()).entries
        .filter((entry) => entry.status === 'scheduled')
        .map(publicEntry),
    }),
  );
  app.post('/api/schedule/run', async (c) => c.json(await scheduler.runDue(true)));
  app.get('/api/backups', async (c) => c.json(await store.exclusive(() => backups.list())));
  app.post('/api/backups', async (c) => {
    const input = z
      .object({ format: z.enum(['large', 'legacy']).default('large') })
      .parse(c.req.raw.body ? await c.req.json() : {});
    return c.json(await backups.create('manual', input.format), 201);
  });
  app.post('/api/backups/uploads', async (c) =>
    c.json(await backupUploads.start(await c.req.json()), 201),
  );
  app.get('/api/backups/uploads/:upload', async (c) =>
    c.json(await backupUploads.status(c.req.param('upload'))),
  );
  app.put('/api/backups/uploads/:upload/parts/:part', async (c) =>
    c.json(await backupUploads.part(c.req.param('upload'), Number(c.req.param('part')), c.req.raw)),
  );
  app.post('/api/backups/uploads/:upload/complete', async (c) => {
    const input=z.object({requestId:z.uuid().optional()}).parse(c.req.raw.body ? await c.req.json() : {});
    return c.json(await backupUploads.complete(c.req.param('upload'),!!input.requestId));
  });
  app.delete('/api/backups/uploads/:upload', async (c) =>
    c.json(await backupUploads.discard(c.req.param('upload'))),
  );
  app.get('/api/backups/:id/download', async (c) => {
    const { file, record } = await store.exclusive(() => backups.downloadFile(c.req.param('id')));
    return c.newResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="glass-${backupArchiveName(record)}"`,
        'Content-Length': String(record.bytes),
        'Cache-Control': 'no-store',
      },
    });
  });
  app.post('/api/backups/review', bodyLimit({ maxSize: 130 * 1024 * 1024 }), async (c) => {
    const data = await c.req.formData(),
      file = data.get('file');
    if (!(file instanceof File)) throw new Error('Choose a .json.gz notebook backup.');
    return c.json(await backups.inspect(new Uint8Array(await file.arrayBuffer())));
  });
  app.post('/api/backups/:id/review', async (c) =>
    c.json(await backups.inspectSaved(c.req.param('id'))),
  );
  app.post('/api/backups/:id/restore', async (c) => {
    await acaDeployment.assertIdle();
    if (jobs.isBusy || scheduler.isBusy)
      throw new Error(
        'Wait for the active build, publication, or schedule check before restoring.',
      );
    const { sourceRevision } = z.object({ sourceRevision: z.string() }).parse(await c.req.json());
    try {
      await scheduler.holdAfterRestore();
      const result = await backups.restore(c.req.param('id'), sourceRevision);
      changes.emit('filesystem');
      return c.json(result);
    } finally {
      resetWatcher();
    }
  });
  app.get('/api/notebook/reset', async (c) =>
    c.json({ recoveries: await notebookReset.recoveries() }),
  );
  app.post('/api/notebook/reset/review', async (c) => c.json(await notebookReset.review()));
  app.get('/api/notebook/reset/:id/backup', async (c) =>
    c.newResponse(new Uint8Array(await notebookReset.download(c.req.param('id'))), {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="glass-before-reset-${c.req.param('id')}.json.gz"`,
      },
    }),
  );
  app.post('/api/notebook/reset/:id/commit', async (c) => {
    await acaDeployment.assertIdle();
    try {
      const result = await notebookReset.commit(c.req.param('id'), await c.req.json());
      changes.emit('filesystem');
      return c.json(result);
    } finally {
      resetWatcher();
    }
  });
  app.post('/api/jobs', async (c) => {
    if (backups.restoring)
      throw new Error('Wait for notebook restoration to finish before building.');
    const { action } = z.object({ action: z.enum(['build', 'publish']) }).parse(await c.req.json());
    return c.json(jobRecord(jobs.start(action)), 202);
  });
  app.post('/api/jobs/:id/recheck', async (c) => {
    if (!idle()) throw new Error('Wait for active operations to finish.');
    const { revision } = z
      .object({ revision: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(jobRecord(await jobs.recheckUploaded(c.req.param('id'), revision)));
  });
  app.get('/api/cloudflare/media', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(r2Readiness((await store.snapshot()).site, await jobs.connections.values()));
  });
  app.get('/api/analytics-status', async (c) =>
    c.json(await analyticsStatus(store, jobs.connections, options.analyticsFetch)),
  );
  app.get('/api/aca/versions', async (c) => c.json(await acaDeployment.versions()));
  app.post('/api/aca/rollback/review', async (c) => {
    if (!idle()) throw new Error('Wait for active operations to finish.');
    const { version } = z
      .object({ version: z.string().uuid() })
      .strict()
      .parse(await c.req.json());
    return c.json(await acaDeployment.reviewRollback(version));
  });
  app.post('/api/aca/rollback', async (c) => {
    if (!idle()) throw new Error('Wait for active operations to finish.');
    const { id } = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await c.req.json());
    return c.json(await acaDeployment.rollback(id));
  });
  app.get('/api/aca/deployment', async (c) => c.json(await acaDeployment.summary()));
  app.put('/api/aca/deployment', async (c) => {
    const { value, revision } = z
      .object({ value: z.unknown(), revision: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(await acaDeployment.save(value, revision));
  });
  app.post('/api/aca/deployment/check', async (c) => {
    const { revision } = z
      .object({ revision: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(await acaDeployment.check(revision));
  });
  for (const action of ['setup', 'deploy'] as const)
    app.post('/api/aca/deployment/' + action, async (c) => {
      if (backups.restoring || notebookReset.busy)
        throw new ConflictError('Wait for notebook recovery to finish before setting up ACA.');
      const { revision } = z
        .object({ revision: z.string() })
        .strict()
        .parse(await c.req.json());
      return c.json(await acaDeployment.start(action, revision), 202);
    });
  app.get('/api/services/readiness', async (c) =>
    c.json(await serviceReadiness(store, jobs.connections)),
  );
  const savedSegments = new PrivateSettings(
    path.join(root, '.studio/analytics/segments.json'),
    savedSegmentsSchema,
  );
  app.get('/api/analytics/segments', async (c) => c.json(await savedSegments.read()));
  app.put('/api/analytics/segments', async (c) => {
    const data = z
      .object({ value: savedSegmentsSchema, revision: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(await savedSegments.save(data.value, data.revision));
  });
  app.get('/api/analytics/:name', async (c) =>
    c.json(
      await proxyAnalytics(
        store,
        jobs.connections,
        c.req.param('name'),
        new URL(c.req.url).searchParams,
        options.analyticsFetch,
      ),
    ),
  );
  app.get('/api/connections', async (c) => c.json(await jobs.connections.summary()));
  app.put('/api/connections', async (c) =>
    c.json(await jobs.connections.update(await c.req.json())),
  );
  app.post('/api/connections/import-environment', async (c) => {
    const { revision } = z
      .object({ revision: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(await jobs.connections.importEnvironment(revision));
  });
  app.post('/api/connections/test', async (c) => {
    const { provider } = z
      .object({ provider: z.enum(['cloudflare', 'r2']) })
      .strict()
      .parse(await c.req.json());
    if (provider === 'cloudflare')
      return c.json(
        await checkCloudflareAccount((await store.snapshot()).site.cloudflare.accountId),
      );
    if (options.connectionTest) await options.connectionTest();
    else {
      const transport = createR2Transport(
        (await store.snapshot()).site,
        await jobs.connections.values(),
      );
      try {
        await transport.inspect?.();
      } finally {
        transport.close?.();
      }
    }
    return c.json({
      ok: true,
      message:
        'Bucket read access verified. Upload permission and CDN delivery are checked during publication.',
    });
  });
  app.get('/api/runtime-settings', async (c) => c.json(await launcher.summary()));
  app.put('/api/runtime-settings', async (c) => {
    const { value, revision } = z
      .object({
        value: z.object({ port: z.number(), notebookRoot: z.string() }).strict(),
        revision: z.string(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(await launcher.update(value, revision));
  });
  app.get('/api/cloudflare', async (c) => {
    const model = await store.snapshot();
    return c.json(await checkCloudflareAccount(model.site.cloudflare.accountId));
  });
  app.get('/api/cloudflare/projects', async (c) => {
    const model = await store.snapshot();
    return c.json(await listPagesProjects(jobs.runner, model.site.cloudflare.accountId));
  });
  app.post('/api/cloudflare/project', async (c) => {
    const model = await store.snapshot();
    const credentials = await jobs.connections.values();
    const result = await createPagesProject(
      (args, account, onLog) => jobs.runner(args, account, onLog, credentials),
      model.site.cloudflare,
    );
    return c.json({ ok: true, ...result });
  });
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'ready', data: '{}' });
      await new Promise<void>((resolve) => {
        const send = (event: string, data: unknown) => {
          void stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => cleanup());
        };
        const onChange = () => send('filesystem', {});
        const onJob = (job: Job) => send('job', jobRecord(job));
        const onHistory = (update: { removed: string[]; restored: Job[] }) =>
          send('job-history', update);
        const heartbeat = setInterval(() => send('heartbeat', {}), 20000);
        const cleanup = () => {
          clearInterval(heartbeat);
          changes.off('filesystem', onChange);
          jobs.off('update', onJob);
          jobs.off('history', onHistory);
          resolve();
        };
        changes.on('filesystem', onChange);
        jobs.on('update', onJob);
        jobs.on('history', onHistory);
        stream.onAbort(cleanup);
      });
    }),
  );
  app.get('/__components/', async (c) => {
    const renderer = await createRenderer(await store.snapshot(), {
      preview: true,
      diagramCacheDir: path.join(root, '.studio/render-cache/mermaid'),
      readerAssets: await readReaderAssets(publicDirectory()),
    });
    const sizes = new Map(
      (await media.list())
        .filter((image) => image.width && image.height)
        .map((image) => [
          decodeURIComponent(image.url),
          { width: image.width!, height: image.height! },
        ]),
    );
    const html = resolveResponsiveImages(renderer.render('/__components/'), sizes);
    return c.html(options.development ? withDevelopmentReload(html) : html);
  });
  app.get('/studio', (c) => c.redirect('/studio/'));
  app.get('/news', (c) => c.redirect('/archive/', 301));
  app.get('/news/', (c) => c.redirect('/archive/', 301));
  for (const route of ['/s/:code', '/s/:code/'])
    app.get(route, async (c, next) => {
      const code = c.req.param('code');
      const model = await store.snapshot();
      const target = model.entries.find(
        (entry) =>
          entry.status === 'published' &&
          (entry.shortCode === code || entry.shortAliases.includes(code || '')),
      );
      if (target) return c.redirect(routeFor(target, model.site.collections), 302);
      return next();
    });
  for (const route of ['/m/:code', '/m/:code/'])
    app.get(route, async (c, next) => {
      const model = await store.snapshot(),
        files = await media.list();
      const target = mediaLinkMap(
        files.map((file) => file.url),
        model.library,
      ).get('/m/' + c.req.param('code'));
      if (target) return c.redirect(target, 302);
      return next();
    });
  app.get('/media/*', async (c) => {
    const name = decodeURIComponent(c.req.path.slice('/media/'.length));
    const base = path.join(root, 'content/media');
    let file = await contained(base, name);
    try {
      const bytes = await fs.readFile(file),
        range = c.req.header('Range');
      const contentType =
        imageFile(file) || attachmentFile(file) || /\.(?:woff2?|ttf)$/i.test(file)
          ? mime[path.extname(file).toLowerCase()] || 'application/octet-stream'
          : 'application/octet-stream';
      if (range && /^(?:audio|video)\//.test(contentType)) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const start = match?.[1]
          ? Number(match[1])
          : match?.[2]
            ? Math.max(0, bytes.length - Number(match[2]))
            : -1;
        const end =
          match?.[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
        if (!match || start < 0 || start >= bytes.length || start > end)
          return c.newResponse(null, 416, { 'Content-Range': `bytes */${bytes.length}` });
        return c.newResponse(bytes.subarray(start, end + 1), 206, {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
        });
      }
      return c.newResponse(bytes, {
        headers: {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Security-Policy':
            "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox",
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const match = name.match(/^(.*)-(\d{1,4})\.webp$/);
      if (!match) return c.notFound();
      const originals = await fs.readdir(base);
      const original = originals.find(
        (n) => n.replace(/\.[^.]+$/, '') === match[1] && /\.(png|jpe?g|webp|avif)$/i.test(n),
      );
      if (!original) return c.notFound();
      file = await contained(base, original);
      const metadata = await sharp(file, { limitInputPixels: 40000000 }).metadata();
      if (
        !metadata.width ||
        !responsiveWidths(metadata.autoOrient.width).includes(Number(match[2]))
      )
        return c.notFound();
      const image = await sharp(file, { animated: true, limitInputPixels: 40000000 })
        .autoOrient()
        .resize({ width: Number(match[2]), withoutEnlargement: true })
        .webp({ quality: 84 })
        .toBuffer();
      return c.newResponse(image, { headers: { 'Content-Type': 'image/webp' } });
    }
  });
  app.get('*', async (c) => {
    const requestPath = decodeURIComponent(c.req.path);
    if (requestPath.startsWith('/studio/')) {
      const base = path.join(options.applicationRoot || root, '.studio/console');
      const name = requestPath.slice('/studio/'.length) || 'index.html';
      try {
        const file = await contained(base, name);
        return c.newResponse(await fs.readFile(file), {
          headers: { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' },
        });
      } catch {
        try {
          return c.html(await fs.readFile(path.join(base, 'index.html'), 'utf8'));
        } catch {
          return c.text('Run npm run build:console first.', 503);
        }
      }
    }
    const base = publicDirectory();
    // Follow the accepted artifact until its replacement succeeds, even while paths are edited.
    if (!requestPath.startsWith('/assets/')) {
      const redirects = await fs.readFile(path.join(base, '_redirects'), 'utf8').catch(() => '');
      for (const match of redirects.matchAll(/^(\/\S+) (\/\S+) (301|302)$/gm)) {
        if (
          !match[1].includes('*') &&
          !match[1].includes(':') &&
          decodeURIComponent(match[1]) === requestPath
        )
          return c.redirect(match[2] + new URL(c.req.url).search, Number(match[3]) as 301 | 302);
      }
      for (const match of redirects.matchAll(
        /^\/([a-z][a-z0-9-]*)\/\* (\/[a-z][a-z0-9-]*\/):splat 301$/gm,
      )) {
        const prefix = `/${match[1]}/`;
        if (c.req.path === prefix.slice(0, -1) || c.req.path.startsWith(prefix))
          return c.redirect(
            match[2] + c.req.path.slice(prefix.length) + new URL(c.req.url).search,
            301,
          );
      }
    }
    if (requestPath.startsWith('/assets/')) c.header('Access-Control-Allow-Origin', '*');
    try {
      const policy = (await fs.readFile(path.join(base, '_headers'), 'utf8')).match(
        /^\s*Content-Security-Policy:\s*(.+)$/m,
      )?.[1];
      if (policy) c.header('Content-Security-Policy', policy);
    } catch {}
    const name =
      requestPath === '/'
        ? 'index.html'
        : requestPath.endsWith('/')
          ? requestPath.slice(1) + 'index.html'
          : requestPath.slice(1);
    if (
      name.split('/').some((segment) => segment.startsWith('.')) ||
      ['_headers', '_redirects', '_worker.js', '_routes.json'].includes(name)
    )
      return c.notFound();
    try {
      const file = await contained(base, name);
      const stat = await fs.stat(file);
      if (stat.isDirectory()) return c.redirect(c.req.path + '/');
      const bytes = await fs.readFile(file);
      return c.newResponse(options.development && path.extname(file) === '.html' ? withDevelopmentReload(bytes.toString('utf8')) : bytes, {
        headers: {
          'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        },
      });
    } catch {
      try {
        return c.html(await fs.readFile(path.join(base, '404.html'), 'utf8'), 404);
      } catch {
        return c.text('Build your notebook in Studio to preview the public site.', 503);
      }
    }
  });
  let watcher: ReturnType<typeof watch> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function resetWatcher() {
    watcher?.close();
    if (options.watchFiles === false) return;
    options.development?.watchContent(store);
    watcher = watch(store.content, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => changes.emit('filesystem'), 250);
    });
  }
  resetWatcher();
  return {
    app,
    store,
    jobs,
    acaDeployment,
    scheduler,
    backups,
    token,
    close: () => {
      scheduler.close();
      automaticBackups.close();
      watcher?.close();
      clearTimeout(timer);
      changes.removeAllListeners();
    },
  };
}
