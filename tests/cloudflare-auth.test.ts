import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  authStatus,
  cloudflareCommandError,
  createRunner,
  createPagesProject,
  deployArtifact,
  JobService,
  listPagesProjects,
  type Runner,
} from '../src/server/publishing.js';
import { createApp } from '../src/server/app.js';
import { Store } from '../src/engine/store.js';

const accountId = 'a'.repeat(32),
  identity = {
    code: 0,
    stdout: JSON.stringify({ loggedIn: true, accounts: [{ id: accountId, name: 'Test account' }] }),
    stderr: '',
  },
  denied = {
    code: 1,
    stdout: '',
    stderr:
      'Proxy environment variables detected. We’ll use your proxy for fetch requests.\n[ERROR] Authentication error [code: 10000]',
  };

describe('Cloudflare Pages authorization', () => {
  it('reports Pages denial even when Wrangler identifies the saved token', async () => {
    const runner = vi.fn<Runner>(async (args) => (args.includes('whoami') ? identity : denied));
    const status = await authStatus(runner, accountId);
    expect(status.authenticated).toBe(true);
    expect(status.pagesAccess).toBe('denied');
    expect(status.projects).toEqual([]);
    expect(status.proxyDetected).toBe(true);
    expect(status.error).toContain('code 10000');
    expect(status.error).toContain('Account → Cloudflare Pages → Edit');
    expect(status.error).toContain('saved token takes precedence');
    expect(
      runner.mock.calls.every(([args]) => !args.includes('create') && !args.includes('deploy')),
    ).toBe(true);
  });

  it('accepts scoped Pages access without requiring unrelated user-profile permissions', async () => {
    const runner: Runner = async (args) =>
      args.includes('whoami')
        ? { code: 1, stdout: '', stderr: 'Forbidden [code: 9109]' }
        : {
            code: 0,
            stdout: JSON.stringify([
              { name: 'notebook', deployment_configs: { vars: { private: 'project-canary' } } },
              { 'Project Name': 'other-notebook' },
            ]),
            stderr: '',
          };
    const status = await authStatus(runner, accountId);
    expect(status.authenticated).toBe(true);
    expect(status.pagesAccess).toBe('verified');
    expect(status.projects).toEqual([{ name: 'notebook' }, { name: 'other-notebook' }]);
    expect(status.error).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain('project-canary');
  });

  it('keeps account discovery separate from an actual Pages authorization check', async () => {
    const runner = vi.fn<Runner>().mockResolvedValue(identity);
    const status = await authStatus(runner);
    expect(status.authenticated).toBe(true);
    expect(status.pagesAccess).toBe('unchecked');
    expect(status.accountId).toBe('');
    expect(runner).toHaveBeenCalledExactlyOnceWith(['whoami', '--json'], '');
    await expect(listPagesProjects(runner, '')).rejects.toThrow('Choose a Cloudflare account');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('does not consider an explicit logged-out response authenticated', async () => {
    const status = await authStatus(async () => ({
      code: 0,
      stdout: JSON.stringify({ loggedIn: false, accounts: [] }),
      stderr: '',
    }));
    expect(status.authenticated).toBe(false);
    expect(status.pagesAccess).toBe('unchecked');
  });

  it('distinguishes a network failure from denied Pages permissions', async () => {
    const status = await authStatus(
      async (args) =>
        args.includes('whoami')
          ? identity
          : {
              code: 1,
              stdout: '',
              stderr: 'Proxy environment variables detected. fetch failed ECONNREFUSED',
            },
      accountId,
    );
    expect(status.pagesAccess).toBe('unavailable');
    expect(status.error).toContain('network and proxy');
    expect(status.error).not.toContain('Pages → Edit');
  });

  it('never verifies access from a malformed project response', async () => {
    for (const stdout of ['{}', '[{}]', '[null]']) {
      const status = await authStatus(
        async (args) => (args.includes('whoami') ? identity : { code: 0, stdout, stderr: '' }),
        accountId,
      );
      expect(status.pagesAccess).toBe('unavailable');
      expect(status.error).toContain('unreadable Pages project list');
    }
  });

  it('uses actionable authentication errors for project creation and publication', () => {
    for (const action of ['create the Pages project', 'publish to Cloudflare Pages'])
      expect(cloudflareCommandError(denied, action).message).toContain(
        'Private connection credentials',
      );
  });

  it('explains a missing Pages project without suggesting a different deployment target', () => {
    const error = cloudflareCommandError(
      {
        code: 1,
        stdout: '',
        stderr:
          'Proxy environment variables detected.\nThe Pages project "missing-notebook" does not exist. Maybe you intended to deploy a Worker project instead? Run `wrangler deploy`.',
      },
      'publish to Cloudflare Pages',
    );
    expect(error.message).toContain('missing-notebook');
    expect(error.message).toContain('Create this Pages project');
    expect(error.message).not.toMatch(/Worker|wrangler deploy|Proxy/);
  });

  it('creates a missing project directly on Pages and verifies its existence', async () => {
    const target = { accountId, projectName: 'new-notebook', productionBranch: 'release' };
    let exists = false;
    const runner = vi.fn<Runner>(async (args) => {
      if (args.includes('create')) {
        exists = true;
        return { code: 0, stdout: 'Created', stderr: '' };
      }
      return {
        code: 0,
        stdout: JSON.stringify(exists ? [{ name: target.projectName }] : []),
        stderr: '',
      };
    });
    await expect(createPagesProject(runner, target)).resolves.toEqual({
      created: true,
      projects: [{ name: target.projectName }],
    });
    expect(runner.mock.calls.map(([args, account]) => [args, account])).toEqual([
      [['pages', 'project', 'list', '--json'], accountId],
      [
        ['pages', 'project', 'create', 'new-notebook', '--production-branch', 'release', '--force'],
        accountId,
      ],
      [['pages', 'project', 'list', '--json'], accountId],
    ]);
  });

  it('keeps creation idempotent for an existing Pages project', async () => {
    const runner = vi.fn<Runner>(async () => ({
      code: 0,
      stdout: '[{"name":"existing"}]',
      stderr: '',
    }));
    await expect(
      createPagesProject(runner, { accountId, projectName: 'existing', productionBranch: 'main' }),
    ).resolves.toMatchObject({ created: false });
    expect(runner).toHaveBeenCalledExactlyOnceWith(
      ['pages', 'project', 'list', '--json'],
      accountId,
    );
  });

  it('does not accept a successful command that created no Pages project', async () => {
    const runner = vi.fn<Runner>(async (args) => ({
      code: 0,
      stdout: args.includes('create') ? 'Deployed a Worker instead' : '[]',
      stderr: '',
    }));
    await expect(
      createPagesProject(runner, { accountId, projectName: 'missing', productionBranch: 'main' }),
    ).rejects.toThrow('does not exist');
    expect(runner).toHaveBeenCalledTimes(3);
  });
});

describe('private Cloudflare endpoints', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-cloudflare-auth-'));
    await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('stops a missing-project publication before building, R2 work, or uploading', async () => {
    const store = new Store(root),
      model = await store.read();
    await store.saveJson(
      'site',
      {
        ...model.site,
        url: 'https://notebook.example',
        cloudflare: { accountId, projectName: 'missing', productionBranch: 'main' },
      },
      model.siteRevision,
    );
    const runner = vi.fn<Runner>(async () => ({
      code: 0,
      stdout: '[{"name":"other-project"}]',
      stderr: '',
    }));
    const builder = vi.fn<typeof import('../src/engine/build.js').buildSite>();
    const media = vi.fn();
    const jobs = new JobService(store, runner, builder, { media });
    await jobs.initialize();
    const job = await jobs.waitFor(jobs.start('publish').id);
    expect(job).toMatchObject({ state: 'failed', failedAt: 'queued' });
    expect(job.error).toContain('Create this Pages project');
    expect(job.error).toContain(accountId);
    expect(job.build).toBeUndefined();
    expect(builder).not.toHaveBeenCalled();
    expect(media).not.toHaveBeenCalled();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toEqual(['pages', 'project', 'list', '--json']);
  });

  it('snapshots credentials through creation and both readiness checks', async () => {
    const store = new Store(root),
      model = await store.read();
    await store.saveJson(
      'site',
      {
        ...model.site,
        cloudflare: { accountId, projectName: 'created-notebook', productionBranch: 'main' },
      },
      model.siteRevision,
    );
    let exists = false;
    const snapshots: unknown[] = [];
    const runner = vi.fn<Runner>(async (args, account, _log, credentials) => {
      expect(account).toBe(accountId);
      snapshots.push(credentials);
      if (args.includes('create')) {
        exists = true;
        expect(args).toContain('--force');
        return { code: 0, stdout: 'Created', stderr: '' };
      }
      return {
        code: 0,
        stdout: JSON.stringify(exists ? [{ name: 'created-notebook', private: 'excluded' }] : []),
        stderr: '',
      };
    });
    const jobs = new JobService(store, runner);
    const context = await createApp(root, { jobs, watchFiles: false });
    try {
      const response = await context.app.request('http://127.0.0.1/api/cloudflare/project', {
        method: 'POST',
        headers: { 'X-Studio-Token': context.token },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        created: true,
        projects: [{ name: 'created-notebook' }],
      });
      expect(snapshots).toHaveLength(3);
      expect(snapshots.every((snapshot) => snapshot === snapshots[0])).toBe(true);
    } finally {
      context.close();
    }
  });

  it('isolates the selected token from legacy keys while preserving proxy settings', async () => {
    const directory = path.join(root, 'node_modules/wrangler/bin');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, 'wrangler.js'),
      `process.stdout.write(JSON.stringify({selected:process.env.CLOUDFLARE_API_TOKEN==='selected-test-token',legacy:Boolean(process.env.CLOUDFLARE_API_KEY||process.env.CF_API_KEY||process.env.CLOUDFLARE_EMAIL||process.env.CF_EMAIL||process.env.CF_API_TOKEN),r2:Boolean(process.env.R2_ACCESS_KEY_ID||process.env.R2_SECRET_ACCESS_KEY),proxy:process.env.https_proxy==='http://127.0.0.1:9999'}));`,
    );
    for (const name of [
      'CLOUDFLARE_API_KEY',
      'CF_API_KEY',
      'CLOUDFLARE_EMAIL',
      'CF_EMAIL',
      'CF_API_TOKEN',
    ])
      vi.stubEnv(name, 'legacy-test-credential');
    vi.stubEnv('https_proxy', 'http://127.0.0.1:9999');
    const runner = createRunner(root, async () => ({
      CLOUDFLARE_API_TOKEN: 'selected-test-token',
      R2_ACCESS_KEY_ID: 'test-r2-access',
      R2_SECRET_ACCESS_KEY: 'test-r2-secret',
    }));
    const result = await runner([]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      selected: true,
      legacy: false,
      r2: false,
      proxy: true,
    });
  });

  it('uses one credential snapshot and preserves denial through checks, listing, and creation', async () => {
    const store = new Store(root),
      model = await store.read();
    await store.saveJson(
      'site',
      {
        ...model.site,
        cloudflare: { accountId, projectName: 'test-notebook', productionBranch: 'main' },
      },
      model.siteRevision,
    );
    const snapshots: unknown[] = [];
    const runner: Runner = async (args, account, _log, credentials) => {
      expect(account).toBe(accountId);
      snapshots.push(credentials);
      return args.includes('whoami') ? identity : denied;
    };
    const jobs = new JobService(store, runner);
    await jobs.connections.update({
      revision: (await jobs.connections.summary()).revision,
      set: { cloudflareApiToken: 'cloudflare-auth-canary-12345' },
    });
    const context = await createApp(root, { jobs, watchFiles: false });
    try {
      const response = await context.app.request('http://127.0.0.1/api/cloudflare');
      const status = await response.json();
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(status.pagesAccess).toBe('denied');
      expect(snapshots[0]).toBe(snapshots[1]);
      expect(JSON.stringify(status)).not.toContain('cloudflare-auth-canary');
      const check = await context.app.request('http://127.0.0.1/api/connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Studio-Token': context.token },
        body: JSON.stringify({ provider: 'cloudflare' }),
      });
      expect((await check.json()).pagesAccess).toBe('denied');
      const listed = await context.app.request('http://127.0.0.1/api/cloudflare/projects');
      expect(listed.status).toBe(400);
      expect((await listed.json()).error).toContain('Cloudflare Pages → Edit');
      const created = await context.app.request('http://127.0.0.1/api/cloudflare/project', {
        method: 'POST',
        headers: { 'X-Studio-Token': context.token },
      });
      expect(created.status).toBe(400);
      expect((await created.json()).error).toContain('code 10000');
      await expect(
        deployArtifact(
          runner,
          {
            ...model.site,
            url: 'https://notebook.pages.dev',
            cloudflare: { accountId, projectName: 'test-notebook', productionBranch: 'main' },
          },
          {
            id: 'fixture',
            outputDir: '/tmp/frozen-public',
            pages: 1,
            manifest: [],
            diagnostics: [],
            sourceRevision: 'fixture',
            completedAt: new Date().toISOString(),
          },
          () => {},
        ),
      ).rejects.toThrow('Cloudflare Pages → Edit');
    } finally {
      context.close();
    }
  });
});
