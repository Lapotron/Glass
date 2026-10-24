import { prepareMediaDelivery } from '../engine/media-delivery.js';
import { createR2Transport, synchronizeMedia, type MediaTransport } from './r2.js';
import { recordCloudOwnership } from './cloud-media.js';
import { verifyAcaPublication } from './aca-publication.js';
import { verifyPublishedDeployment } from './deployment-check.js';
import { jobRecord } from './job-history.js';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import type { Job, SiteConfig, PublishResult } from '../shared/contracts.js';
import type { CloudflareConnection, CloudflareProject } from '../shared/local-settings.js';
import { buildSite } from '../engine/build.js';
import { Store, atomicWrite, contained } from '../engine/store.js';
import { applicationRoot, ConnectionSettings, redactSecrets } from './configuration.js';

export type CommandResult = { code: number; stdout: string; stderr: string };
export type Runner = (
  args: string[],
  accountId?: string,
  onLog?: (line: string) => void,
  credentials?: NodeJS.ProcessEnv,
) => Promise<CommandResult>;
export function createRunner(
  root: string,
  credentialsProvider: () => Promise<NodeJS.ProcessEnv> = async () => process.env,
): Runner {
  return async (args, accountId, onLog, snapshot) => {
    const credentials = snapshot || (await credentialsProvider());
    return new Promise((resolve, reject) => {
      const childEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        CLOUDFLARE_API_TOKEN: credentials.CLOUDFLARE_API_TOKEN,
      };
      delete childEnvironment.R2_ACCESS_KEY_ID;
      delete childEnvironment.R2_SECRET_ACCESS_KEY;
      // Maintenance in a connected site build may target the independent ACA service.
      // Its captured config/token remain authoritative rather than the enclosing build's Worker name.
      delete childEnvironment.CLOUDFLARE_WORKER_NAME;
      delete childEnvironment.WRANGLER_CI_OVERRIDE_NAME;
      if (credentials.CLOUDFLARE_API_TOKEN)
        for (const name of [
          'CLOUDFLARE_API_KEY',
          'CLOUDFLARE_EMAIL',
          'CF_API_KEY',
          'CF_EMAIL',
          'CF_API_TOKEN',
        ])
          delete childEnvironment[name];
      const child = spawn(
        process.execPath,
        [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args],
        {
          cwd: root,
          shell: false,
          env: {
            ...childEnvironment,
            ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}),
            CI: 'true',
            NO_COLOR: '1',
            WRANGLER_SEND_METRICS: 'false',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const output = { stdout: { value: '', tail: '' }, stderr: { value: '', tail: '' } };
      const timer = setTimeout(
        () => {
          child.kill('SIGTERM');
          reject(
            new Error('Cloudflare did not respond in time. Your built files are still available.'),
          );
        },
        args.includes('deploy') ? 180000 : 30000,
      );
      const capture = (chunk: Buffer, error = false) => {
        const buffer = error ? output.stderr : output.stdout;
        buffer.tail += chunk.toString();
        if (buffer.tail.length > 65536) {
          child.kill('SIGTERM');
          reject(new Error('Cloudflare returned too much output.'));
          return;
        }
        const lines = buffer.tail.split(/\r?\n/);
        buffer.tail = lines.pop()!;
        for (const line of lines) {
          const safe = redactSecrets(stripVTControlCharacters(line), credentials);
          buffer.value += safe + '\n';
          if (safe) onLog?.(safe);
        }
      };
      child.stdout.on('data', (chunk) => capture(chunk));
      child.stderr.on('data', (chunk) => capture(chunk, true));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(redactSecrets(error.message, credentials)));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        for (const buffer of Object.values(output))
          if (buffer.tail) {
            const safe = redactSecrets(stripVTControlCharacters(buffer.tail), credentials);
            buffer.value += safe;
            onLog?.(safe);
          }
        resolve({ code: code ?? 1, stdout: output.stdout.value, stderr: output.stderr.value });
      });
    });
  };
}
export function parseCommandJson(text: string) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('{') && !line.startsWith('[')) continue;
    try {
      return JSON.parse(lines.slice(i).join('\n'));
    } catch {}
  }
  throw new Error('Cloudflare returned an unreadable response');
}
class CloudflareCommandError extends Error {
  constructor(
    message: string,
    readonly kind: 'authentication' | 'network' | 'command',
    readonly proxyDetected: boolean,
  ) {
    super(message);
  }
}
export function cloudflareCommandError(result: CommandResult, action: string) {
  const output = stripVTControlCharacters(result.stderr + '\n' + result.stdout),
    code = output.match(/\[code:\s*(\d+)\]/i)?.[1],
    proxy = /Proxy environment variables detected/i.test(output);
  if (
    /Authentication error|Unauthorized|Forbidden|not authenticated|not logged in/i.test(output) ||
    (code && ['10000', '10001', '9109', '1000', '9106'].includes(code))
  )
    return new CloudflareCommandError(
      `Cloudflare denied Pages access${code ? ` (code ${code})` : ''}. Save an API token with Account → Cloudflare Pages → Edit for the selected account in Studio’s Private connection credentials. Check the token’s account scope, expiry and IP restrictions. A saved token takes precedence over Wrangler login.`,
      'authentication',
      proxy,
    );
  if (/fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|UND_ERR|certificate|TLS|network/i.test(output))
    return new CloudflareCommandError(
      'Could not reach Cloudflare. Check your network and proxy settings, then try again.',
      'network',
      proxy,
    );
  const missingProject = output.match(/The Pages project "([^"]+)" does not exist/i);
  if (missingProject)
    return new CloudflareCommandError(
      missingPagesProjectMessage(missingProject[1]),
      'command',
      proxy,
    );
  return new CloudflareCommandError(
    `Could not ${action}. ${output.trim().slice(-1500) || 'Cloudflare returned no error details.'}`,
    'command',
    proxy,
  );
}
function missingPagesProjectMessage(project: string, accountId?: string) {
  return `Pages project “${project}” does not exist in the selected account${accountId ? ` (${accountId})` : ''}. In Studio → Site settings → Cloudflare Pages, choose an existing project or use “Create this Pages project”, then publish again.`;
}
export async function listPagesProjects(
  runner: Runner,
  accountId: string,
): Promise<CloudflareProject[]> {
  if (!accountId) throw new Error('Choose a Cloudflare account, save it, then check Pages access.');
  const result = await runner(['pages', 'project', 'list', '--json'], accountId);
  if (result.code) throw cloudflareCommandError(result, 'list Pages projects');
  const rows: unknown = parseCommandJson(result.stdout);
  if (!Array.isArray(rows))
    throw new Error('Cloudflare returned an unreadable Pages project list.');
  return rows.map((row: unknown) => {
    if (!row || typeof row !== 'object')
      throw new Error('Cloudflare returned an unreadable Pages project list.');
    const value = row as Record<string, unknown>;
    const name = value.name || value['Project Name'] || value.Name;
    if (typeof name !== 'string' || !name)
      throw new Error('Cloudflare returned an unreadable Pages project list.');
    return { name };
  });
}
export async function requirePagesProject(runner: Runner, target: SiteConfig['cloudflare']) {
  const projects = await listPagesProjects(runner, target.accountId);
  if (!projects.some((project) => project.name === target.projectName))
    throw new Error(missingPagesProjectMessage(target.projectName, target.accountId));
  return projects;
}
export async function createPagesProject(runner: Runner, target: SiteConfig['cloudflare']) {
  if (!target.projectName || !target.accountId)
    throw new Error('Save your account ID and project name first.');
  const projects = await listPagesProjects(runner, target.accountId);
  if (projects.some((project) => project.name === target.projectName))
    return { created: false, projects };
  const result = await runner(
    [
      'pages',
      'project',
      'create',
      target.projectName,
      '--production-branch',
      target.productionBranch,
      '--force',
    ],
    target.accountId,
  );
  if (result.code) throw cloudflareCommandError(result, 'create the Pages project');
  // Wrangler can exit successfully after delegating to Workers. Only an actual Pages
  // listing establishes that the configured Direct Upload target is ready.
  return { created: true, projects: await requirePagesProject(runner, target) };
}
export async function authStatus(runner: Runner, accountId = ''): Promise<CloudflareConnection> {
  const [identity, pages] = await Promise.allSettled([
    (async () => {
      const result = await runner(['whoami', '--json'], accountId);
      if (result.code) throw cloudflareCommandError(result, 'check Cloudflare authentication');
      const data = parseCommandJson(result.stdout);
      if (data.loggedIn === false || (data.loggedIn !== true && !Array.isArray(data.accounts)))
        throw new Error(
          'Save a Cloudflare API token in Studio or use Wrangler login, then check again.',
        );
      return (Array.isArray(data.accounts) ? data.accounts : []).flatMap((account: unknown) => {
        if (!account || typeof account !== 'object') return [];
        const { id, name } = account as Record<string, unknown>;
        return typeof id === 'string' && typeof name === 'string' ? [{ id, name }] : [];
      });
    })(),
    accountId ? listPagesProjects(runner, accountId) : Promise.resolve([]),
  ]);
  const status: CloudflareConnection = {
    authenticated: identity.status === 'fulfilled',
    accounts: identity.status === 'fulfilled' ? identity.value : [],
    accountId,
    pagesAccess: 'unchecked',
    projects: [],
  };
  if (!accountId) {
    status.error = identity.status === 'rejected' ? identity.reason.message : undefined;
  } else if (pages.status === 'fulfilled') {
    // Account-scoped tokens can use Pages without user-profile/account-list permissions.
    status.authenticated = true;
    status.pagesAccess = 'verified';
    status.projects = pages.value;
  } else {
    const error = pages.reason as Error;
    status.pagesAccess =
      error instanceof CloudflareCommandError && error.kind === 'authentication'
        ? 'denied'
        : 'unavailable';
    status.error = error.message;
    status.proxyDetected = error instanceof CloudflareCommandError && error.proxyDetected;
  }
  return status;
}
export async function deployArtifact(
  runner: Runner,
  config: SiteConfig,
  build: NonNullable<Job['build']>,
  onLog: (line: string) => void,
): Promise<PublishResult> {
  if (!config.cloudflare.projectName || !config.cloudflare.accountId)
    throw new Error('Set your Cloudflare account and Pages project in Settings first.');
  if (/^https:\/\/(?:www\.)?example\.com\/?$/.test(config.url))
    throw new Error('Set your real canonical site URL before publishing.');
  const result = await runner(
    [
      'pages',
      'deploy',
      build.outputDir,
      '--project-name',
      config.cloudflare.projectName,
      '--branch',
      config.cloudflare.productionBranch,
      '--commit-dirty=true',
    ],
    config.cloudflare.accountId,
    onLog,
  );
  if (result.code) throw cloudflareCommandError(result, 'publish to Cloudflare Pages');
  const urls = result.stdout.match(/https:\/\/[a-z0-9.-]+\.pages\.dev\/?/gi);
  if (!urls?.length)
    throw new Error(
      'Cloudflare finished without a deployment URL. Check the Pages dashboard before retrying.',
    );
  return {
    url: urls[urls.length - 1],
    project: config.cloudflare.projectName,
    buildId: build.id,
    completedAt: new Date().toISOString(),
  };
}
export class JobService extends EventEmitter {
  externalBusy?: () => boolean;
  jobs: Job[] = [];
  private busy = false;
  private running = new Map<string, Promise<void>>();
  get isBusy() {
    return this.busy;
  }
  clearHistoryAfterReset() {
    if (this.busy) throw new Error('Wait for the active build before clearing history.');
    const removed = this.jobs.map((job) => job.id);
    this.jobs = [];
    this.running.clear();
    this.emit('history', { removed, restored: [] });
  }
  readonly runner: Runner;
  readonly connections: ConnectionSettings;
  constructor(
    readonly store: Store,
    runner: Runner | undefined = undefined,
    readonly builder = buildSite,
    readonly services: {
      media?: (site: SiteConfig) => MediaTransport;
      verify?: typeof verifyPublishedDeployment;
    } = {},
  ) {
    super();
    this.connections = new ConnectionSettings(store.root);
    this.runner = runner || createRunner(applicationRoot, () => this.connections.values());
  }
  async initialize() {
    const folder = path.join(this.store.root, '.studio/jobs');
    await fs.mkdir(folder, { recursive: true });
    const files = (await fs.readdir(folder)).filter((f) => f.endsWith('.json'));
    this.jobs = (
      await Promise.all(
        files.map(async (file) => {
          try {
            return JSON.parse(await fs.readFile(path.join(folder, file), 'utf8')) as Job;
          } catch {
            return null;
          }
        }),
      )
    )
      .filter((job): job is Job => !!job)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    for (const job of this.jobs) {
      let recoveredTarget = false;
      // Recover the historical target from its own snapshot, never today's settings.
      if (!job.target && job.build && /^[\w-]+$/.test(job.build.id)) {
        try {
          const source = await contained(
            path.join(this.store.root, '.studio/builds'),
            job.build.id + '/source.json',
          );
          const { site } = JSON.parse(await fs.readFile(source, 'utf8'));
          const canonical = new URL(site.url);
          if (['https:', 'http:'].includes(canonical.protocol)) {
            job.target = {
              canonicalUrl: canonical.href,
              project: site.cloudflare?.projectName || '',
              branch: site.cloudflare?.productionBranch || 'main',
            };
            recoveredTarget = true;
          }
        } catch {
          // Legacy records without snapshots keep their target explicitly unknown.
        }
      }
      if (job.state !== 'succeeded' && job.state !== 'failed') {
        job.failedAt = job.state;
        job.state = 'failed';
        job.error = 'Studio stopped before this job finished. Start a new build.';
        await this.persist(job);
      } else if (recoveredTarget) await this.persist(job);
    }
  }
  private async persist(job: Job) {
    await atomicWrite(
      path.join(this.store.root, '.studio/jobs', `${job.id}.json`),
      JSON.stringify(job, null, 2),
    );
  }
  start(action: Job['action']) {
    if (this.externalBusy?.()) throw new Error('Wait for cloud media maintenance to finish.');
    if (this.busy) throw new Error('A build or publish job is already running.');
    this.busy = true;
    const job: Job = {
      id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
      action,
      state: 'queued',
      logs: [],
      startedAt: new Date().toISOString(),
    };
    this.jobs.unshift(job);
    const running = this.run(job);
    this.running.set(job.id, running);
    void running.then(
      () => this.running.delete(job.id),
      () => this.running.delete(job.id),
    );
    this.emit('update', job);
    return job;
  }
  async waitFor(id: string) {
    await this.running.get(id);
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Unknown build job: ${id}`);
    return job;
  }
  async recheckUploaded(id: string, revision: string) {
    if (this.busy || this.externalBusy?.())
      throw new Error('Wait for active operations to finish.');
    this.busy = true;
    let job: Job | undefined;
    let credentials: NodeJS.ProcessEnv = {};
    try {
      job = await this.store.exclusive(async () => {
        const selected = this.jobs.find((item) => item.id === id);
        if (!selected || jobRecord(selected).revision !== revision)
          throw new Error('This build changed. Refresh history before rechecking.');
        if (
          selected.state !== 'failed' ||
          !selected.deployment ||
          !selected.build ||
          selected.failedAt !== 'verifying-deployment'
        )
          throw new Error('Choose an uploaded build that failed deployment verification.');
        const file = await contained(
          path.join(this.store.root, '.studio/jobs'),
          selected.id + '.json',
        );
        if (jobRecord(JSON.parse(await fs.readFile(file, 'utf8'))).revision !== revision)
          throw new Error('This build changed on disk. Refresh history before rechecking.');
        const previous = structuredClone(selected);
        try {
          selected.state = 'verifying-deployment';
          selected.logs.push('Rechecking the recorded deployment without uploading files…');
          delete selected.error;
          await this.persist(selected);
        } catch (error) {
          Object.assign(selected, previous);
          throw error;
        }
        this.emit('update', selected);
        return selected;
      });
      credentials = await this.connections.values();
      await (this.services.verify || verifyPublishedDeployment)(
        job.deployment!,
        job.build!,
        undefined,
        {
          canonicalUrl: job.target?.canonicalUrl,
          onLog: (message) => job!.logs.push(redactSecrets(message, credentials)),
        },
      );
      job.state = 'succeeded';
      delete job.failedAt;
      job.logs.push('Recorded deployment verified successfully; no files were uploaded.');
      return job;
    } catch (error) {
      if (job) {
        job.state = 'failed';
        job.failedAt = 'verifying-deployment';
        job.error = redactSecrets((error as Error).message, credentials);
        job.logs.push(job.error);
      }
      throw error;
    } finally {
      try {
        if (job) {
          job.completedAt = new Date().toISOString();
          job.logs = job.logs.slice(-500);
          await this.persist(job);
          this.emit('update', job);
        }
      } finally {
        this.busy = false;
      }
    }
  }
  private async run(job: Job) {
    let credentials: NodeJS.ProcessEnv = {};
    const log = (message: string) => {
      job.logs.push(redactSecrets(message, credentials));
      if (job.logs.length > 500) job.logs.shift();
      if (!['succeeded', 'failed'].includes(job.state)) this.emit('update', job);
    };
    try {
      await this.persist(job);
      const model = await this.store.exclusive(() => this.store.read());
      job.mediaDelivery = model.site.mediaDelivery.mode;
      job.target = {
        canonicalUrl: new URL(model.site.url).href,
        project: model.site.cloudflare.projectName,
        branch: model.site.cloudflare.productionBranch,
      };
      credentials = job.action === 'publish' ? await this.connections.values() : {};
      if (job.action === 'publish') {
        if (!model.site.cloudflare.projectName || !model.site.cloudflare.accountId)
          throw new Error('Connect a Cloudflare Pages project in Settings before publishing.');
        if (new URL(model.site.url).hostname === 'example.com')
          throw new Error('Set your real canonical site URL before publishing.');
        log('Checking the configured Pages project in the selected account…');
        await requirePagesProject(
          (args, account, onLog) => this.runner(args, account, onLog, credentials),
          model.site.cloudflare,
        );
        log(`Pages project “${model.site.cloudflare.projectName}” is ready.`);
        if (model.site.integrations.aca.enabled) {
          await verifyAcaPublication(model.site,credentials);
          log('ACA reader protocol and site boundary verified.');
        }
      }
      job.state = 'building';
      log('Starting a fresh build from saved files.');
      job.build = await this.builder(this.store, { model, id: job.id, onLog: log });
      job.state = 'validating';
      log('The generated public artifact passed validation.');
      if (job.action === 'publish') {
        if (model.site.mediaDelivery.mode === 'r2') {
          const transport = this.services.media
            ? this.services.media(model.site)
            : createR2Transport(model.site, credentials);
          try {
            job.build = await prepareMediaDelivery(job.build, model.site);
          } catch (error) {
            transport.close?.();
            throw error;
          }
          await this.persist(job);
          const assets = job.build.media!.assets;
          await recordCloudOwnership(this.store.root, model.site, assets);
          log('Synchronizing ' + assets.length + ' versioned public images with R2…');
          await synchronizeMedia(
            transport,
            job.build.outputDir,
            assets,
            (stage, done, uploaded) => {
              job.state = stage;
              job.mediaProgress = {
                total: assets.length,
                done,
                uploaded,
                bytes: assets.reduce((total, asset) => total + asset.bytes, 0),
              };
              this.emit('update', job);
            },
          );
          log('All CDN images passed checksum, delivery and CORS verification.');
        }
        job.state = 'uploading';
        log('Uploading the validated artifact to Cloudflare Pages…');
        job.deployment = await deployArtifact(
          (args, account, onLog) => this.runner(args, account, onLog, credentials),
          model.site,
          job.build,
          log,
        );
        job.state = 'verifying-deployment';
        await this.persist(job);
        log('Verifying the returned Pages deployment…');
        await (this.services.verify || verifyPublishedDeployment)(
          job.deployment,
          job.build,
          undefined,
          { canonicalUrl: job.target?.canonicalUrl, onLog: log },
        );
        log(`Published and verified: ${job.deployment.url}`);
      }
      job.state = 'succeeded';
      job.completedAt = new Date().toISOString();
    } catch (error) {
      if (job.state !== 'succeeded' && job.state !== 'failed') job.failedAt = job.state;
      job.state = 'failed';
      job.error = redactSecrets((error as Error).message, credentials);
      job.completedAt = new Date().toISOString();
      log(job.error);
    } finally {
      await this.persist(job);
      this.busy = false;
      this.emit('update', job);
    }
  }
}
