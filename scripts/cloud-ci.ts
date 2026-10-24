/** Node-only build/maintenance runner. The Worker never spawns processes or compiles production Markdown. */
import './cloud-settings.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { Store } from '../src/engine/store.js';
import { prepareMediaDelivery } from '../src/engine/media-delivery.js';
import { createR2Transport, synchronizeMedia } from '../src/server/r2.js';
import { ConnectionSettings } from '../src/server/configuration.js';
import { verifyAcaPublication } from '../src/server/aca-publication.js';
import { recordCloudOwnership } from '../src/server/cloud-media.js';
import { buildSite } from '../src/engine/build.js';
import { createApp } from '../src/server/app.js';
import { LauncherSettings } from '../src/server/configuration.js';
import {
  claim,
  cloudFetch,
  materialize,
  filesUnder,
  uploadObject,
  responseToFile,
  uploadCloudFile,
  cloudFileHash,
} from './cloud-client.js';
import { progressReporter } from './cloud-progress.js';
import { mapConcurrent } from '../src/engine/work-cache.js';

if (process.platform === 'linux') process.env.GLASS_CI_CHROMIUM = 'true';
if (
  process.env.WORKERS_CI_BRANCH &&
  process.env.WORKERS_CI_BRANCH !== (process.env.GLASS_PRODUCTION_BRANCH || 'main')
) {
  const previewRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-reader-preview-'));
  try {
    await fs.cp('tests/fixtures/notebook', path.join(previewRoot, 'content'), { recursive: true });
    const prepared = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/cloud-build.ts', 'site'],
      { stdio: 'inherit' },
    );
    if (prepared.status !== 0) throw new Error('Could not prepare preview.');
    const artifact = await buildSite(new Store(previewRoot), { updateDist: false });
    await fs.mkdir('.studio/cloud/site/public', { recursive: true });
    await fs.cp(artifact.outputDir, '.studio/cloud/site/public', { recursive: true });
    for (const name of ['_worker.js', '_routes.json'])
      await fs.rm('.studio/cloud/site/public/' + name, { force: true });
  } finally {
    await fs.rm(previewRoot, { recursive: true, force: true });
  }
  process.exit(0);
}
// Cloud metadata uses millisecond timestamps; normalize CI stat views so selection tokens round-trip.
for (const name of ['stat', 'lstat'] as const) {
  const original = fs[name].bind(fs);
  (fs as any)[name] = async (...args: any[]) => {
    const stat = await (original as any)(...args);
    stat.mtimeMs = stat.mtime.getTime();
    stat.ctimeMs = stat.ctime.getTime();
    return stat;
  };
}
const { job, manifest } = await claim(),
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-cloud-job-'));
const folder = path.resolve('.studio/cloud/site');
await fs.mkdir(folder, { recursive: true });
await fs.writeFile(path.join(folder, 'job.json'), JSON.stringify(job));
let context: Awaited<ReturnType<typeof createApp>> | undefined;
const progress = progressReporter(job.id);
async function captureResponse(name: string, response: Response) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-cloud-download-'));
  const file = path.join(folder, 'download');
  try {
    await responseToFile(response, file);
    await uploadCloudFile(job.id, file, 'object', name);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}
const transient = (name: string) =>
  /^\.studio\/(?:operations|imports|exports|backup-uploads|backup-work)\//.test(name);
try {
  progress.log('Materializing the captured notebook snapshot.');
  await progress.phase('building');
  const selected = await materialize(root, job, manifest);
  const capturedCredentials = await new ConnectionSettings(root).values();
  Object.assign(
    process.env,
    Object.fromEntries(
      Object.entries(capturedCredentials).filter(([, value]) => typeof value === 'string' && value),
    ),
  );
  await fs.writeFile(
    path.join(folder, 'deployment-credentials.json'),
    JSON.stringify({ CLOUDFLARE_API_TOKEN: capturedCredentials.CLOUDFLARE_API_TOKEN }),
    { mode: 0o600 },
  );
  let result: { status: number; body: unknown } = { status: 200, body: { ok: true } };
  if (job.kind === 'api') {
    let descriptor = JSON.parse(job.request) as {
      path: string;
      method: string;
      contentType?: string;
      hasBody?: boolean;
    };
    // Native previews reference the matching private reader assets hosted by Studio.
    const assets = await (await cloudFetch('reader-assets')).text();
    await fs.mkdir(path.join(root, 'dist/assets'), { recursive: true });
    await fs.writeFile(path.join(root, 'dist/assets/reader-assets.json'), assets);
    context = await createApp(root, {
      watchFiles: false,
      applicationRoot: process.cwd(),
      launcher: new LauncherSettings(root, { notebookRoot: root, port: 4399 }),
    });
    context.scheduler.close();
    const execute = async (
      descriptor: { path: string; method: string },
      headers: Record<string, string>,
      body: ArrayBuffer | undefined,
      sourceJob = job.id,
    ) => {
      if (descriptor.path === '/api/backups/review-upload') {
        const input = JSON.parse(new TextDecoder().decode(body));
        if (!/^[a-f0-9-]{36}$/.test(input.uploadId))
          throw new Error('Invalid captured backup upload.');
        const archive = path.join(root, '.studio/backup-uploads', input.uploadId, 'archive');
        await responseToFile(await cloudFetch('jobs/' + sourceJob + '/backup-upload'), archive);
        return Response.json(await context!.backups.inspectFile(archive));
      }
      return context!.app.fetch(
        new Request('http://127.0.0.1:4399' + descriptor.path, {
          method: descriptor.method,
          headers,
          body,
        }),
      );
    };
    const headers: Record<string, string> = {
      Origin: 'http://127.0.0.1:4399',
      'X-Studio-Token': context.token,
    };
    if (descriptor.contentType) headers['Content-Type'] = descriptor.contentType;
    let body = descriptor.hasBody
      ? await (await cloudFetch('jobs/' + job.id + '/request')).arrayBuffer()
      : undefined;
    const replay = await (await cloudFetch('jobs/' + job.id + '/replay')).json();
    if (replay.id) {
      const replayHeaders = { ...headers };
      if (replay.descriptor.contentType)
        replayHeaders['Content-Type'] = replay.descriptor.contentType;
      const replayBody = replay.descriptor.hasBody
        ? await (await cloudFetch('jobs/' + replay.jobId + '/request')).arrayBuffer()
        : undefined;
      const reviewed = await execute(replay.descriptor, replayHeaders, replayBody, replay.jobId);
      const current = await reviewed.json();
      if (!reviewed.ok) throw new Error(current.error || 'The review could not be restored.');
      const nextId = (current.review || current).id;
      if (typeof nextId !== 'string') throw new Error('The restored review has no identity.');
      descriptor = { ...descriptor, path: descriptor.path.replaceAll(replay.id, nextId) };
      if (body && descriptor.contentType?.includes('application/json'))
        body = new TextEncoder().encode(
          new TextDecoder().decode(body).replaceAll(replay.id, nextId),
        ).buffer;
    }
    const response =
      descriptor.path === '/api/schedule/prepare'
        ? Response.json({ promoted: await context.store.publishDue(new Date(job.created)) })
        : await execute(descriptor, headers, body);
    if (response.headers.get('Content-Type')?.includes('application/json'))
      result = { status: response.status, body: await response.json() };
    else {
      await captureResponse('download', response);
      await uploadObject(
        job.id,
        'download.headers.json',
        Buffer.from(
          JSON.stringify({
            'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
            'Content-Disposition':
              response.headers.get('Content-Disposition') || 'attachment; filename=glass-export',
          }),
        ),
      );
      result = {
        status: response.status,
        body: { downloadUrl: '/api/cloud-jobs/' + job.id + '/file/download' },
      };
    }
    const resultBody = result.body as { url?: string; backupUrl?: string };
    for (const field of ['url', 'backupUrl'] as const) {
      const url = resultBody[field];
      if (response.ok && url && /^\/(?:preview|api\/exports|api\/notebook\/reset)\//.test(url)) {
        const exported = await context.app.fetch(new Request('http://127.0.0.1:4399' + url));
        if (!exported.ok) throw new Error('Could not capture the private export.');
        const name = url.startsWith('/preview/')
          ? 'preview.html'
          : field === 'backupUrl'
            ? 'recovery-backup'
            : 'download';
        await captureResponse(name, exported);
        await uploadObject(
          job.id,
          name + '.headers.json',
          Buffer.from(
            JSON.stringify({
              'Content-Type': exported.headers.get('Content-Type') || 'application/octet-stream',
              ...(name !== 'preview.html'
                ? {
                    'Content-Disposition':
                      exported.headers.get('Content-Disposition') ||
                      'attachment; filename=glass-export',
                  }
                : {}),
            }),
          ),
        );
        resultBody[field] = '/api/cloud-jobs/' + job.id + '/file/' + name;
      }
    }
    // Deployment APIs may return before their captured job finishes. Keep the runner alive until terminal.
    while (context.jobs.isBusy || context.acaDeployment.isBusy)
      await new Promise((r) => setTimeout(r, 500));
    if (/^\/api\/aca\/deployment\/(?:setup|deploy)$/.test(descriptor.path)) {
      const summary = await context.acaDeployment.summary();
      result.body = summary.job || result.body;
      if (summary.job?.state === 'failed')
        result = {
          status: 400,
          body: { ...summary.job, error: summary.job.error || 'ACA deployment failed.' },
        };
    }
    await fs.rm(path.join(root, 'dist'), { recursive: true, force: true });
  } else {
    const preparation = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/cloud-build.ts', 'site'],
      { stdio: 'inherit' },
    );
    if (preparation.status !== 0) throw new Error('Could not prepare the public Worker.');
    const store = new Store(root);
    const target = (await store.snapshot()).site;
    if (
      target.cloudflare.accountId !== process.env.CLOUDFLARE_ACCOUNT_ID ||
      new URL(target.url).origin !== new URL(process.env.GLASS_SITE_ORIGIN || target.url).origin
    )
      throw new Error(
        'The notebook account or site URL differs from the configured cloud deployment. Review Hosting before publishing.',
      );
    if (job.kind === 'publish')
      await verifyAcaPublication(
        (await store.snapshot()).site,
        await new ConnectionSettings(root).values(),
      );
    let built = await buildSite(store, {
      id: job.id,
      updateDist: false,
      onLog: (message) => {
        console.log(message);
        progress.log(message);
      },
    });
    const model = await store.snapshot();
    if (job.kind === 'publish' && model.site.mediaDelivery.mode === 'r2') {
      built = await prepareMediaDelivery(built, model.site);
      await progress.phase('syncing-media');
      const transport = createR2Transport(model.site, await new ConnectionSettings(root).values());
      try {
        await recordCloudOwnership(root, model.site, built.media!.assets);
        await synchronizeMedia(transport, built.outputDir, built.media!.assets, (event) => {
          progress.log(JSON.stringify(event));
        });
      } finally {
        transport.close?.();
      }
    }
    await fs.rm(path.join(folder, 'public'), { recursive: true, force: true });
    await fs.cp(built.outputDir, path.join(folder, 'public'), { recursive: true });
    // Pages-specific runtime files do not belong in a Workers Static Assets directory.
    for (const name of ['_worker.js', '_routes.json'])
      await fs.rm(path.join(folder, 'public', name), { force: true });
    result = {
      status: 200,
      body: {
        build: {
          ...built,
          outputDir: '/workspace/.studio/builds/' + job.id + '/' + path.basename(built.outputDir),
        },
        releaseId: job.release_id,
      },
    };
  }
  if (job.kind === 'publish') {
    await mapConcurrent(
      (await filesUnder(root)).filter(
        (name) =>
          name.startsWith('.studio/builds/' + job.id + '/') ||
          name.startsWith('.studio/render-cache/mermaid/') ||
          name.startsWith('.studio/cloud-media/'),
      ),
      8,
      async (name) => {
        await uploadCloudFile(job.id, path.join(root, name), 'file', name);
      },
    );
  }
  if (job.kind !== 'publish') {
    const before = new Map(selected.map((f) => [f.path, f.sha])),
      after = await filesUnder(root),
      changes: { path: string; key: string | null }[] = [];
    await mapConcurrent(after, 8, async (name) => {
      if (
        (name.startsWith('.studio/render-cache/') &&
          !name.startsWith('.studio/render-cache/mermaid/')) ||
        transient(name)
      )
        return;
      if ((await cloudFileHash(path.join(root, name))) !== before.get(name)) {
        await uploadCloudFile(job.id, path.join(root, name), 'file', name);
        changes.push({ path: name, key: 'staged' });
      }
      before.delete(name);
    });
    const deleted = [...before.keys()].filter(
      (name) =>
        !transient(name) &&
        (!name.startsWith('.studio/render-cache/') ||
          name.startsWith('.studio/render-cache/mermaid/')),
    );
    for (let index = 0; index < deleted.length; index += 1000) {
      const batch = deleted.slice(index, index + 1000);
      await cloudFetch('jobs/' + job.id + '/deletions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      changes.push(...batch.map((path) => ({ path, key: null })));
    }
    await uploadObject(job.id, 'result.json', Buffer.from(JSON.stringify(result)));
    await progress.close();
    await cloudFetch('jobs/' + job.id + '/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: result.status,
        resultKey: 'result.json',
        staged: changes.length > 0,
        error: result.status >= 400 ? (result.body as { error?: string })?.error : undefined,
      }),
    });
  } else {
    await uploadObject(
      job.id,
      'result.json',
      Buffer.from(
        JSON.stringify({ ...result, body: { ...(result.body as object), logs: progress.logs } }),
      ),
    );
    await progress.close();
  }
} catch (error) {
  const message = (error as Error).message;
  progress.log(message);
  await progress.close().catch(() => {});
  await cloudFetch('jobs/' + job.id + '/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 500, error: message }),
  }).catch(() => {});
  throw error;
} finally {
  context?.close();
  await fs.rm(root, { recursive: true, force: true });
}
