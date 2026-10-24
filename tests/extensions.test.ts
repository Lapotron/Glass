import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { Store } from '../src/engine/store.js';
import { buildSite } from '../src/engine/build.js';
import { JobService, type Runner } from '../src/server/publishing.js';
import { Scheduler } from '../src/server/scheduler.js';
import { siteSchema, routeFor } from '../src/shared/contracts.js';
import { createRenderer } from '../src/site/pages.js';
import { contentSecurityPolicy } from '../src/shared/security.js';
import { renderMarkdown } from '../src/engine/markdown.js';
import { renderInteractive } from '../src/shared/interactives.js';
import { acquireRuntime } from '../src/server/runtime.js';
import { createApp } from '../src/server/app.js';
let root: string, store: Store, assets: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-extensions-'));
  await fs.cp(path.join(process.cwd(), 'tests/fixtures/notebook'), path.join(root, 'content'), {
    recursive: true,
  });
  store = new Store(root);
  assets = path.join(root, 'assets');
  await fs.mkdir(assets);
  for (const file of ['site.js', 'site.css', 'appearance.js', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, file), '/* fixture */');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const runner: Runner = async () => {
  throw new Error('An upload was not expected.');
};
async function scheduled(slug: string, time: string) {
  const entry = await store.create('posts', slug, slug);
  return store.saveEntry(entry.id, {
    metadata: { ...entry, status: 'scheduled', publishAt: time },
    body: 'A scheduled thought.',
    revision: entry.revision,
  });
}
describe('scheduled static publication', () => {
  it('keeps scheduled content private until due, builds once, and records the prior source', async () => {
    const due = await scheduled('due-entry', '2030-01-01T09:00:00.000Z'),
      future = await scheduled('future-entry', '2030-01-03T09:00:00.000Z');
    const jobs = new JobService(
      store,
      runner,
      (source, options) => buildSite(source, { ...options, assets }),
      { verify: async () => {} },
    );
    await jobs.initialize();
    const scheduler = new Scheduler(jobs);
    await scheduler.initialize();
    const now = new Date('2030-01-02T09:00:00.000Z');
    await scheduler.runDue(false, now);
    expect(jobs.jobs).toHaveLength(0);
    const before = await createRenderer(await store.read());
    expect(before.routes).not.toContain(routeFor(due));
    const result = await scheduler.runDue(true, now);
    expect(result.error).toBeUndefined();
    expect(result.pendingIds).toEqual([]);
    expect(jobs.jobs).toHaveLength(1);
    const model = await store.read();
    expect(model.entries.find((entry) => entry.id === due.id)?.status).toBe('published');
    expect(model.entries.find((entry) => entry.id === future.id)?.status).toBe('scheduled');
    const after = await createRenderer(model);
    expect(after.routes).toContain(routeFor(due));
    expect(after.routes).not.toContain(routeFor(future));
    expect(await fs.readFile(path.join(root, 'dist/feed.xml'), 'utf8')).not.toContain(future.title);
    expect((await store.getRevision(due.id, due.revision)).entry.status).toBe('scheduled');
    await scheduler.runDue(true, now);
    expect(jobs.jobs).toHaveLength(1);
  });
  it('retains pending work after a failed build and retries only after review', async () => {
    const due = await scheduled('retry-entry', '2030-01-01T09:00:00.000Z'),
      model = await store.read();
    await store.saveJson(
      'site',
      { ...model.site, publishing: { scheduleEnabled: true, scheduleAction: 'build' } },
      model.siteRevision,
    );
    let fail = true;
    const builder: typeof buildSite = async (source, options) => {
      if (fail) throw new Error('A controlled build failure');
      return buildSite(source, { ...options, assets });
    };
    const jobs = new JobService(store, runner, builder);
    await jobs.initialize();
    const scheduler = new Scheduler(jobs);
    await scheduler.initialize();
    const now = new Date('2030-01-02T09:00:00.000Z');
    await scheduler.runDue(false, now);
    expect(scheduler.state.error).toContain('controlled build failure');
    expect(scheduler.state.pendingIds).toContain(due.id);
    fail = false;
    await scheduler.runDue(false, now);
    expect(jobs.jobs).toHaveLength(1);
    await scheduler.runDue(true, now);
    expect(scheduler.state.error).toBeUndefined();
    expect(scheduler.state.pendingIds).toEqual([]);
    expect(jobs.jobs).toHaveLength(2);
  });
  it('checks the publish target before promoting entries and serializes concurrent checks', async () => {
    const due = await scheduled('guarded-entry', '2030-01-01T09:00:00.000Z'),
      model = await store.read();
    await store.saveJson(
      'site',
      {
        ...model.site,
        url: 'https://example.com',
        cloudflare: { ...model.site.cloudflare, accountId: '', projectName: '' },
        publishing: { scheduleEnabled: true, scheduleAction: 'publish' },
      },
      model.siteRevision,
    );
    const controlled = vi.fn<Runner>(async () => ({
      code: 0,
      stdout: 'https://test.pages.dev',
      stderr: '',
    }));
    const jobs = new JobService(
      store,
      controlled,
      (source, options) => buildSite(source, { ...options, assets }),
      { verify: async () => {} },
    );
    await jobs.initialize();
    const scheduler = new Scheduler(jobs);
    await scheduler.initialize();
    await Promise.all([
      scheduler.runDue(true, new Date('2030-01-02T09:00:00Z')),
      scheduler.runDue(true, new Date('2030-01-02T09:00:00Z')),
    ]);
    expect(scheduler.state.error).toContain('Connect Cloudflare');
    expect(jobs.jobs).toHaveLength(0);
    expect(controlled).not.toHaveBeenCalled();
    expect((await store.read()).entries.find((entry) => entry.id === due.id)?.status).toBe(
      'scheduled',
    );
  });
  it('runs the documented scheduling command against an isolated notebook', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/cli.ts', 'schedule', '--root', root],
      {
        cwd: process.cwd(),
        env: { ...process.env, BLOG_ROOT: root },
        encoding: 'utf8',
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('No entries are due.');
  });
  it('owns runtime state exclusively, recovers a dead owner, and forwards CLI work to live Studio', async () => {
    const lock = path.join(root, '.studio/runtime.lock');
    await fs.mkdir(lock, { recursive: true });
    await fs.writeFile(
      path.join(lock, 'owner.json'),
      JSON.stringify({ pid: 2147483647, nonce: 'old' }, null, 2),
    );
    const jobs = new JobService(
      store,
      runner,
      (source, options) => buildSite(source, { ...options, assets }),
      { verify: async () => {} },
    );
    const context = await createApp(root, { watchFiles: false, jobs });
    const server = createServer(getRequestListener(context.app.fetch));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server port');
    const origin = `http://127.0.0.1:${address.port}`;
    const lease = await acquireRuntime(root, origin);
    try {
      expect(lease.release).toBeTypeOf('function');
      expect((await acquireRuntime(root)).release).toBeNull();
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'scripts/cli.ts', 'schedule', '--root', root],
        {
          cwd: process.cwd(),
          env: { ...process.env, BLOG_ROOT: root },
          timeout: 20000,
        },
      );
      expect(stdout).toContain('completed in Studio');
      expect(jobs.jobs).toHaveLength(0);
      expect(context.scheduler.state.lastRun).toBeTruthy();
    } finally {
      await lease.release?.();
      context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect((await acquireRuntime(root)).release).toBeTypeOf('function');
  });
});
describe('customization and optional integrations', () => {
  it('keeps portable imports separate from the media upload limit and sends protective file headers', async () => {
    const context = await createApp(root, { watchFiles: false });
    try {
      await fs.mkdir(path.join(root, 'dist/assets'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'dist/index.html'),
        '<!doctype html><title>Fixture</title>',
      );
      await fs.writeFile(path.join(root, 'dist/assets/theme.css'), 'body{color:inherit}');
      await fs.writeFile(
        path.join(root, 'dist/_headers'),
        "/*\n  Content-Security-Policy: default-src 'self'\n",
      );
      const response = await context.app.request('http://localhost/');
      expect(response.headers.get('content-security-policy')).toBe("default-src 'self'");
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      const asset = await context.app.request('http://localhost/assets/theme.css');
      expect(asset.headers.get('access-control-allow-origin')).toBe('*');
      await fs.writeFile(
        path.join(root, 'content/media/imported.html'),
        '<script>throw new Error("unsafe")</script>',
      );
      const media = await context.app.request('http://localhost/media/imported.html');
      expect(media.headers.get('content-type')).toBe('application/octet-stream');
      expect(media.headers.get('content-security-policy')).toContain('sandbox');
      const form = new FormData();
      form.set(
        'file',
        new File([new Uint8Array(22 * 1024 * 1024)], 'invalid.json.gz', {
          type: 'application/gzip',
        }),
      );
      const imported = await context.app.request('http://localhost/api/backups/review', {
        method: 'POST',
        headers: { 'X-Studio-Token': context.token },
        body: form,
      });
      expect(imported.status).toBe(400);
      expect(await imported.json()).toMatchObject({
        error: expect.stringContaining('not a readable'),
      });
    } finally {
      context.close();
    }
  });
  it('defaults old settings and applies article visibility choices without partitioning Markdown', async () => {
    const model = await store.read(),
      raw = JSON.parse(await fs.readFile(path.join(root, 'content/site.json'), 'utf8'));
    delete raw.theme.fontFamily;
    expect(siteSchema.parse(raw).theme.fontFamily).toBe('system');
    model.site = siteSchema.parse({
      ...model.site,
      reading: {
        outline: false,
        progress: false,
        readingTime: false,
        publishedDate: false,
        author: false,
        relatedCount: 0,
        codeLineNumbers: true,
      },
      theme: { ...model.site.theme, fontFamily: 'serif', articleWidth: 720, lineHeight: 2 },
    });
    const renderer = await createRenderer(model),
      entry = renderer.entries.find((entry) => entry.kind === 'posts')!,
      html = renderer.render(routeFor(entry));
    expect(html.match(/class="article-body prose reading-surface glass-panel"/g)).toHaveLength(1);
    expect(html).not.toContain('class="post-outline"');
    expect(html).not.toContain('class="article-progress"');
    expect(html).not.toContain('min read');
    expect(html).not.toContain('class="article-related"');
    expect(html).toContain('data-code-lines="true"');
    expect(html).toContain('--article-width:720px');
  });
  it('scopes provider permissions to enabled integrations and exposes stable discussion mappings', async () => {
    const model = await store.read();
    model.site.integrations.comments.enabled = false;
    model.site.integrations.analytics.enabled = false;
    expect(contentSecurityPolicy(model.site)).not.toContain('giscus.app');
    expect(contentSecurityPolicy(model.site)).not.toContain('cloudflareinsights.com');
    model.site = siteSchema.parse({
      ...model.site,
      integrations: {
        comments: {
          enabled: true,
          repo: 'example/notebook',
          repoId: 'R_test',
          categoryId: 'DIC_test',
        },
        analytics: { enabled: true, token: 'a'.repeat(32) },
        newsletter: { enabled: true, url: 'https://example.org/subscribe' },
      },
    });
    const renderer = await createRenderer(model),
      entry = renderer.entries.find((entry) => entry.kind === 'posts')!,
      html = renderer.render(routeFor(entry));
    expect(html).toContain(`data-comment-term="${routeFor(entry)}"`);
    expect(html).toContain('data-analytics');
    expect(html).toContain('https://example.org/subscribe');
    expect(contentSecurityPolicy(model.site)).toContain("frame-src 'self' https://giscus.app");
    const preview = await createRenderer(model, { preview: true });
    expect(preview.render(routeFor(entry))).not.toContain('data-analytics');
    expect(() =>
      siteSchema.parse({
        ...model.site,
        integrations: {
          ...model.site.integrations,
          newsletter: { enabled: true, url: 'javascript:alert(1)' },
        },
      }),
    ).toThrow();
  });
  it('gives repeated tabs and quizzes independent identities and usable static explanations', async () => {
    const tab = {
        type: 'tabs',
        title: 'Two views',
        tabs: [
          { label: 'First', body: 'Read the first view.' },
          { label: 'Second', body: 'Read the second view.' },
        ],
      },
      quiz = {
        type: 'quiz',
        prompt: 'Which choice?',
        choices: ['One', 'Two'],
        answer: 1,
        explanation: 'The second choice.',
      };
    const fence = (config: unknown) => '```interactive\n' + JSON.stringify(config) + '\n```';
    const result = await renderMarkdown(
      [fence(tab), fence(tab), fence(quiz), fence(quiz)].join('\n\n'),
    );
    const ids = [...result.html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      new Set([...result.html.matchAll(/name="([^"]+)-answer"/g)].map((match) => match[1])).size,
    ).toBe(2);
    expect(result.html).toContain('Read the first view.');
    expect(result.html).toContain('Read the second view.');
    expect(result.html).toContain('Reveal explanation');
    expect(() => renderInteractive({ ...quiz, answer: 2 })).toThrow();
    expect(() => renderInteractive({ ...tab, active: 2 })).toThrow();
  });
});
