import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { serve } from '@hono/node-server';
import { Store } from '../src/engine/store.js';
import { buildAssets, buildSite } from '../src/engine/build.js';
import { createApp } from '../src/server/app.js';
import { JobService, type Runner } from '../src/server/publishing.js';
import { AcaDeploymentService } from '../src/server/aca-deployment.js';
import { LauncherSettings } from '../src/server/configuration.js';
import { AcaCloudflareFixture } from '../tests/fixtures/aca-cloudflare.js';

delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.ACA_REPORT_TOKEN;
// Browser tests mutate only this temporary notebook. They never write to the author's source.
const project = process.cwd(),
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-browser-'));
await fs.cp(path.join(project, 'tests/fixtures/notebook'), path.join(root, 'content'), {
  recursive: true,
});
await fs.cp(path.join(project, '.studio/console'), path.join(root, '.studio/console'), {
  recursive: true,
});
const store = new Store(root);
// Provider calls require an explicit fixture in a test, regardless of the author's settings.
const initial = await store.read();
await store.saveJson(
  'site',
  {
    ...initial.site,
    mediaDelivery: { ...initial.site.mediaDelivery, mode: 'pages' },
    home: { ...initial.site.home, slides: null },
    about: { guestbook: { ...initial.site.about.guestbook, enabled: false } },
    integrations: {
      ...initial.site.integrations,
      comments: { ...initial.site.integrations.comments, enabled: false, onDemand: true },
      analytics: { ...initial.site.integrations.analytics, enabled: false },
    },
  },
  initial.siteRevision,
);
const assets = await buildAssets(project);
await buildSite(store, { assets });
const projects = new Set(['fixture']);
const controlledRunner: Runner = async (args) => {
  if (args.includes('list'))
    return { code: 0, stdout: JSON.stringify([...projects].map((name) => ({ name }))), stderr: '' };
  if (args.includes('create')) {
    if (!args.includes('--force')) throw new Error('Pages creation must bypass Worker delegation.');
    projects.add(args[3]);
    return { code: 0, stdout: 'Controlled Pages project created.', stderr: '' };
  }
  if (args.includes('whoami'))
    return {
      code: 0,
      stdout: JSON.stringify({ accounts: [{ id: 'a'.repeat(32), name: 'Browser test account' }] }),
      stderr: '',
    };
  if (args.includes('deploy'))
    return {
      code: 0,
      stdout: 'Controlled test upload complete: https://controlled.fixture.pages.dev',
      stderr: '',
    };
  return { code: 0, stdout: '[]', stderr: '' };
};
const jobs = new JobService(
  store,
  controlledRunner,
  (s, options) => buildSite(s, { ...options, assets }),
  { verify: async () => {} },
);
const newAcaCloud = new AcaCloudflareFixture();
const context = await createApp(root, {
  activePort: 4387,
  applicationRoot: project,
  launcher: new LauncherSettings(root, { notebookRoot: root, port: 4387 }),
  analyticsFetch: newAcaCloud.fetch,
  jobs,
  acaDeployment: new AcaDeploymentService(store, jobs.connections, {
    runner: newAcaCloud.runner,
    fetcher: newAcaCloud.fetch,
  }),
  annotationFetch: async () =>
    new Response('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
      headers: { 'Content-Type': 'application/atom+xml' },
    }),
  discussionFetch: async (input) => {
    const repo = new URL(String(input)).searchParams.get('repo');
    if (repo === 'unreachable/notebook') return new Response('{}', { status: 503 });
    if (repo !== 'example/notebook') return new Response('{}', { status: 403 });
    return Response.json({
      repositoryId: 'R_test',
      categories: [
        { id: 'DIC_test', name: 'General', emoji: '💬' },
        { id: 'DIC_notes', name: 'Notes', emoji: '📝' },
      ],
    });
  },
});
const server = serve({ fetch: context.app.fetch, hostname: '127.0.0.1', port: 4387 });
console.log('Isolated browser fixture listening at http://127.0.0.1:4387');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    context.close();
    server.close(() => {
      void fs.rm(root, { recursive: true, force: true }).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 2000).unref();
  });
