import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { acaServiceFetch } from './aca-fetch.js';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { Store, ConflictError, digest } from '../engine/store.js';
import {
  applicationRoot,
  ConnectionSettings,
  PrivateSettings,
  redactSecrets,
} from './configuration.js';
import { createRunner, type Runner } from './publishing.js';
import { serviceReadiness } from './service-readiness.js';
import {
  acaDeploymentSchema,
  defaultAcaDeployment,
  acaDeploymentStages,
  type AcaDeploymentOptions,
  type AcaDeploymentJob,
  type AcaDeploymentSummary,
  type AcaDeploymentCheck,
} from '../shared/aca-deployment.js';

const optionsSchema = z.object({ options: acaDeploymentSchema.optional() }).strict();
const keys = ['REPORT_TOKEN', 'NETWORK_SECRET', 'IDENTITY_SECRET'] as const;
const targetSchema = z
  .object({
    databaseId: z.string().uuid().optional(),
    secrets: z
      .object({
        REPORT_TOKEN: z.string().min(32),
        NETWORK_SECRET: z.string().min(32).optional(),
        IDENTITY_SECRET: z.string().min(32).optional(),
      })
      .optional(),
    namespace: z.string().regex(/^\d+$/).optional(),
  })
  .strict();
const jobSchema: z.ZodType<AcaDeploymentJob> = z
  .object({
    id: z.string().regex(/^[\w-]+$/),
    action: z.enum(['setup', 'deploy']),
    state: z.enum(['queued', ...acaDeploymentStages, 'succeeded', 'failed']),
    failedAt: z.string().max(40).optional(),
    startedAt: z.string().max(50),
    completedAt: z.string().max(50).optional(),
    accountId: z.string().regex(/^[a-f0-9]{32}$/i),
    options: acaDeploymentSchema,
    siteOrigin: z.string().url(),
    logs: z.array(z.string().max(4000)).max(200),
    databaseId: z.string().uuid().optional(),
    deploymentUrl: z.string().url().optional(),
    verified: z.boolean().optional(),
    error: z.string().max(4000).optional(),
  })
  .strict();
type Snapshot = {
  options: AcaDeploymentOptions;
  accountId: string;
  siteOrigin: string;
  credentials: NodeJS.ProcessEnv;
};

/** Separate from Pages: captured settings, private keys and resumable cloud resources. */
export class AcaDeploymentService {
  private rollbackReviews = new Map<
    string,
    { snapshot: Snapshot; version: string; fingerprint: string; expires: number }
  >();
  readonly folder: string;
  private settings: PrivateSettings<z.infer<typeof optionsSchema>>;
  private journal: PrivateSettings<{ job?: AcaDeploymentJob }>;
  private busy = false;
  private fetcher: typeof fetch;
  private runner: Runner;
  constructor(
    readonly store: Store,
    readonly connections: ConnectionSettings,
    services: { fetcher?: typeof fetch; runner?: Runner } = {},
  ) {
    this.folder = path.join(store.root, '.studio/services');
    this.settings = new PrivateSettings(path.join(this.folder, 'aca.json'), optionsSchema);
    this.journal = new PrivateSettings(
      path.join(this.folder, 'aca-job.json'),
      z.object({ job: jobSchema.optional() }).strict(),
    );
    this.fetcher = services.fetcher || acaServiceFetch;
    this.runner = services.runner || createRunner(applicationRoot);
  }
  get isBusy() {
    return this.busy;
  }
  async assertIdle() {
    if (this.busy || (await this.lockAlive()))
      throw new ConflictError(
        'Wait for ACA setup or deployment before recovering or resetting the notebook.',
      );
  }
  private async defaults() {
    return defaultAcaDeployment((await this.store.snapshot()).site);
  }
  private target(snapshot: Pick<Snapshot, 'accountId' | 'options'>) {
    const key = digest(
      JSON.stringify([
        snapshot.accountId,
        snapshot.options.workerName,
        snapshot.options.databaseName,
        snapshot.options.siteId,
      ]),
    );
    return new PrivateSettings(path.join(this.folder, 'aca-targets', key + '.json'), targetSchema);
  }
  private async lockAlive() {
    try {
      const lock = JSON.parse(await fs.readFile(path.join(this.folder, 'aca.lock'), 'utf8'));
      if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0) throw new Error('Invalid ACA lock.');
      try {
        process.kill(lock.pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  private async lock(id: string) {
    await fs.mkdir(this.folder, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(this.folder)).isSymbolicLink())
      throw new Error('Private service settings cannot use symbolic links.');
    const file = path.join(this.folder, 'aca.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await fs.writeFile(file, JSON.stringify({ pid: process.pid, id }), {
          flag: 'wx',
          mode: 0o600,
        });
        return async () => {
          if (JSON.parse(await fs.readFile(file, 'utf8')).id === id) await fs.rm(file);
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (await this.lockAlive())
          throw new ConflictError('Another ACA setup or deployment is running.');
        await fs.rm(file);
      }
    }
    throw new ConflictError('Another ACA deployment started. Refresh its status.');
  }
  async summary(): Promise<AcaDeploymentSummary> {
    const [saved, model, journal] = await Promise.all([
      this.settings.read(),
      this.store.snapshot(),
      this.journal.read(),
    ]);
    const options = saved.value.options || (await this.defaults());
    let job = journal.value.job || null;
    if (
      job &&
      !['succeeded', 'failed'].includes(job.state) &&
      !this.busy &&
      !(await this.lockAlive())
    ) {
      job = {
        ...job,
        failedAt: job.state,
        state: 'failed',
        completedAt: new Date().toISOString(),
        error:
          'Studio stopped before ACA finished. Inspect any recorded deployment before deploying again.',
      };
      await this.journal.save({ job }, journal.revision);
    }
    const target = await this.target({
      accountId: model.site.cloudflare.accountId,
      options,
    }).read();
    return {
      busy: this.busy || (await this.lockAlive()),
      revision: saved.revision,
      options,
      accountId: model.site.cloudflare.accountId,
      siteOrigin: new URL(model.site.url).origin,
      databaseId: target.value.databaseId,
      secretsReady: !!target.value.secrets,
      job,
    };
  }
  async save(input: unknown, revision: string) {
    if (this.busy || (await this.lockAlive()))
      throw new ConflictError('Wait for ACA setup or deployment before changing its settings.');
    const options = acaDeploymentSchema.parse(input);
    await this.settings.save({ options }, revision);
    return this.summary();
  }
  private async capture(revision?: string): Promise<Snapshot> {
    const summary = await this.summary();
    if (revision !== undefined && revision !== summary.revision)
      throw new ConflictError(
        'ACA settings changed. Reload their status; your draft is preserved.',
      );
    const credentials = await this.connections.values();
    if (!/^[a-f0-9]{32}$/i.test(summary.accountId) || !credentials.CLOUDFLARE_API_TOKEN)
      throw new Error(
        'Save the Cloudflare account and API token in Site settings → Connections first.',
      );
    if (new URL(summary.siteOrigin).protocol !== 'https:')
      throw new Error('Set the public HTTPS site URL before setting up ACA.');
    if (
      summary.options.domain &&
      !summary.options.domain.endsWith('.' + new URL(summary.siteOrigin).hostname)
    )
      throw new Error(
        'Use an analytics subdomain of the saved public site, or leave the domain empty for workers.dev.',
      );
    return {
      options: summary.options,
      accountId: summary.accountId,
      siteOrigin: summary.siteOrigin,
      credentials,
    };
  }
  private async cloud<T>(snapshot: Snapshot, route: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher('https://api.cloudflare.com/client/v4' + route, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: 'Bearer ' + snapshot.credentials.CLOUDFLARE_API_TOKEN,
        'Content-Type': 'application/json',
      },
    });
    const data = (await response.json().catch(() => {
      throw new Error(
        'Cloudflare returned an unreadable ACA response. Check the service connection before retrying.',
      );
    })) as {
      success?: boolean;
      result?: T;
      errors?: { code?: number }[];
    };
    if (!response.ok || !data.success)
      throw new Error(
        'Cloudflare ACA request failed (' +
          response.status +
          (data.errors?.[0]?.code ? ', code ' + data.errors[0].code : '') +
          '). Check D1 Edit, Workers Scripts Edit and any selected domain permissions.',
      );
    return data.result as T;
  }
  private async databases(snapshot: Snapshot) {
    for (let page = 1; page <= 10; page++) {
      const rows = await this.cloud<{ uuid: string; name: string }[]>(
        snapshot,
        `/accounts/${snapshot.accountId}/d1/database?per_page=100&page=${page}`,
      );
      if (!Array.isArray(rows)) throw new Error('Cloudflare returned an invalid database list.');
      const found = rows.find((row) => row.name === snapshot.options.databaseName);
      if (found) {
        z.string().uuid().parse(found.uuid);
        return found.uuid;
      }
      if (rows.length < 100) return undefined;
    }
    throw new Error(
      'The D1 database list exceeds the setup limit. Choose the database in Cloudflare before continuing.',
    );
  }
  private async inspect(snapshot: Snapshot): Promise<AcaDeploymentCheck> {
    const readiness = await serviceReadiness(
      this.store,
      this.connections,
      this.fetcher,
      ['workers', 'd1', ...(snapshot.options.domain ? ['zone' as const] : [])],
      {
        accountId: snapshot.accountId,
        token: snapshot.credentials.CLOUDFLARE_API_TOKEN!,
        siteUrl: snapshot.siteOrigin,
      },
    );
    if (!readiness.ready) return { readiness };
    const [databaseId, workers] = await Promise.all([
      this.databases(snapshot),
      this.cloud<{ id: string }[]>(snapshot, `/accounts/${snapshot.accountId}/workers/scripts`),
    ]);
    return {
      readiness,
      databaseId,
      workerExists: workers.some((worker) => worker.id === snapshot.options.workerName),
    };
  }
  async check(revision?: string) {
    return this.inspect(await this.capture(revision));
  }
  async start(action: 'setup' | 'deploy', revision?: string) {
    if (this.busy) throw new ConflictError('Another ACA setup or deployment is running.');
    const snapshot = await this.capture(revision);
    const id = Date.now() + '-' + randomUUID().slice(0, 8),
      release = await this.lock(id);
    this.busy = true;
    const job: AcaDeploymentJob = {
      id,
      action,
      state: 'queued',
      startedAt: new Date().toISOString(),
      accountId: snapshot.accountId,
      options: snapshot.options,
      siteOrigin: snapshot.siteOrigin,
      logs: [],
    };
    try {
      await this.persist(job);
    } catch (error) {
      this.busy = false;
      await release();
      throw error;
    }
    void this.run(job, snapshot)
      .finally(async () => {
        try {
          await release();
        } finally {
          this.busy = false;
        }
      })
      .catch(() => undefined);
    return structuredClone(job);
  }
  async versions() {
    const snapshot = await this.capture();
    const result = await this.cloud<{
      items?: { id: string; metadata?: { created_on?: string } }[];
    }>(
      snapshot,
      `/accounts/${snapshot.accountId}/workers/scripts/${snapshot.options.workerName}/versions`,
    );
    return {
      worker: snapshot.options.workerName,
      versions: (result.items || [])
        .slice(0, 30)
        .map((v) => ({ id: v.id, createdAt: v.metadata?.created_on || '' })),
    };
  }
  private async rollbackCandidate(snapshot: Snapshot, version: string) {
    z.string().uuid().parse(version);
    const result = await this.cloud<{
      resources?: { bindings?: { name: string; type: string; text?: string; id?: string }[] };
    }>(
      snapshot,
      `/accounts/${snapshot.accountId}/workers/scripts/${snapshot.options.workerName}/versions/${version}`,
    );
    const bindings = result.resources?.bindings || [];
    const text = (name: string) => bindings.find((b) => b.name === name)?.text;
    const target = await this.target(snapshot).read();
    if (
      text('ACA_PROTOCOL') !== '3' ||
      text('SITE_ID') !== snapshot.options.siteId ||
      text('SITE_ORIGIN') !== snapshot.siteOrigin ||
      text('ENABLED') !== String(snapshot.options.collectionEnabled) ||
      text('DAILY_NETWORKS') !== String(snapshot.options.dailyNetworks) ||
      text('AUDIENCE_DETAILS') !== String(snapshot.options.audienceDetails) ||
      !text('DEPLOYMENT_ID') ||
      text('IDENTITY_MODE') !==
        (snapshot.options.optionalHistory ? 'optional-consent' : 'anonymous') ||
      bindings.find((b) => b.name === 'DB')?.id !== target.value.databaseId
    )
      throw new Error(
        'This version is not verified compatible with the current reader protocol, identity policy and database. Use the matched-build recovery guide.',
      );
    return text('DEPLOYMENT_ID');
  }
  async reviewRollback(version: string) {
    await this.assertIdle();
    const snapshot = await this.capture();
    await this.rollbackCandidate(snapshot, version);
    const id = randomUUID(),
      expires = Date.now() + 10 * 60000;
    if (this.rollbackReviews.size >= 5) this.rollbackReviews.clear();
    this.rollbackReviews.set(id, {
      snapshot,
      version,
      fingerprint: digest(JSON.stringify(snapshot)),
      expires,
    });
    return {
      id,
      version,
      worker: snapshot.options.workerName,
      expiresAt: new Date(expires).toISOString(),
    };
  }
  async rollback(id: string) {
    await this.assertIdle();
    const review = this.rollbackReviews.get(id);
    if (!review || review.expires < Date.now()) throw new Error('Rollback review expired.');
    const current = await this.capture();
    if (digest(JSON.stringify(current)) !== review.fingerprint)
      throw new ConflictError('ACA target or credentials changed. Review rollback again.');
    const release = await this.lock('rollback-' + id);
    this.busy = true;
    const file = path.join(this.folder, 'rollback', id + '.json');
    const journal = {
      id,
      version: review.version,
      worker: current.options.workerName,
      startedAt: new Date().toISOString(),
      state: 'preparing',
    };
    try {
      const expected = await this.rollbackCandidate(current, review.version);
      let endpoint = current.options.domain ? 'https://' + current.options.domain : '';
      if (!endpoint) {
        const account = await this.cloud<{ subdomain?: string }>(
          current,
          `/accounts/${current.accountId}/workers/subdomain`,
        );
        if (!account.subdomain) throw new Error('Configure the Worker domain before recovery.');
        endpoint = `https://${current.options.workerName}.${account.subdomain}.workers.dev`;
      }
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.writeFile(file, JSON.stringify(journal), { mode: 0o600 });
      await this.cloud(
        current,
        `/accounts/${current.accountId}/workers/scripts/${current.options.workerName}/deployments`,
        {
          method: 'POST',
          body: JSON.stringify({
            strategy: 'percentage',
            versions: [{ version_id: review.version, percentage: 100 }],
            annotations: { 'workers/message': 'Reviewed Glass ACA recovery' },
          }),
        },
      );
      journal.state = 'uploaded';
      await fs.writeFile(file, JSON.stringify(journal));
      const response = await this.fetcher(new URL('/v1/status', endpoint), {
        headers: { Authorization: 'Bearer ' + current.credentials.ACA_REPORT_TOKEN },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      const status = (await response.json()) as {
        protocol: number;
        deploymentId: string;
        siteId: string;
        siteOrigin: string;
        capabilities?: string[];
      };
      if (
        !response.ok ||
        status.protocol !== 3 ||
        status.deploymentId !== expected ||
        status.siteId !== current.options.siteId ||
        status.siteOrigin !== current.siteOrigin ||
        !status.capabilities?.includes('audience-v2')
      )
        throw new Error(
          'Rollback was uploaded but live verification failed. Inspect the recorded version before retrying.',
        );
      journal.state = 'verified';
      await fs.writeFile(file, JSON.stringify(journal));
      this.rollbackReviews.delete(id);
      return { verified: true, version: review.version };
    } finally {
      this.busy = false;
      await release();
    }
  }
  async waitFor(id: string) {
    for (;;) {
      const job = (await this.summary()).job;
      if (!job || job.id !== id) throw new Error('The ACA job is no longer available.');
      if (['succeeded', 'failed'].includes(job.state) && !this.busy) return job;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  private async persist(job: AcaDeploymentJob) {
    const saved = await this.journal.read();
    await this.journal.save({ job: structuredClone(job) }, saved.revision);
  }
  private async run(job: AcaDeploymentJob, snapshot: Snapshot) {
    let generated: Record<string, string> = {};
    const safe = (line: string) => {
      let value = redactSecrets(line, snapshot.credentials);
      for (const secret of Object.values(generated))
        if (secret) value = value.split(secret).join('[redacted]');
      return value.slice(0, 4000);
    };
    const log = (line: string) => {
      job.logs.push(safe(line));
      job.logs = job.logs.slice(-200);
    };
    const stage = async (state: AcaDeploymentJob['state'], line: string) => {
      job.state = state;
      log(line);
      await this.persist(job);
    };
    let keyFile = '';
    try {
      await stage('checking', 'Checking ACA account permissions and configured resources…');
      const check = await this.inspect(snapshot);
      if (!check.readiness.ready)
        throw new Error(
          'ACA connection is incomplete: ' +
            check.readiness.checks
              .filter((item) => item.status !== 'ready')
              .map(
                (item) =>
                  item.id +
                  ' ' +
                  item.status +
                  (item.codes.length ? ' (' + item.codes.join(', ') + ')' : ''),
              )
              .join('; ') +
            '. Save a token with D1 Edit and Workers Scripts Edit, plus Zone Read, DNS Edit and Workers Routes Edit for a custom domain. ACA does not require Access permissions.',
        );
      const target = this.target(snapshot),
        saved = await target.read();
      const resource = saved.value;
      if (saved.value.databaseId && check.databaseId !== saved.value.databaseId)
        throw new Error(
          'The saved ACA database no longer matches Cloudflare. No replacement database was created; inspect the selected account and database name.',
        );
      if (check.workerExists && !resource.secrets) {
        const settings = await this.cloud<{ bindings?: { name: string; text?: string }[] }>(
          snapshot,
          `/accounts/${snapshot.accountId}/workers/scripts/${snapshot.options.workerName}/settings`,
        );
        if (
          !settings.bindings?.some(
            (binding) => binding.name === 'SITE_ID' && binding.text === snapshot.options.siteId,
          ) ||
          !settings.bindings.some(
            (binding) => binding.name === 'SITE_ORIGIN' && binding.text === snapshot.siteOrigin,
          )
        )
          throw new Error(
            'This Worker already exists with different site settings. Choose another Worker name to avoid replacing an unrelated service.',
          );
      }
      await stage(
        'database',
        check.databaseId
          ? 'Reusing the existing ACA database.'
          : 'Creating the separate ACA database…',
      );
      const databaseId =
        check.databaseId ||
        (
          await this.cloud<{ uuid: string }>(
            snapshot,
            `/accounts/${snapshot.accountId}/d1/database`,
            { method: 'POST', body: JSON.stringify({ name: snapshot.options.databaseName }) },
          )
        ).uuid;
      z.string().uuid().parse(databaseId);
      resource.databaseId = databaseId;
      job.databaseId = databaseId;
      await target.save(resource, saved.revision);
      const directory = path.join(this.folder, 'aca-runs', job.id);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const configErrors: ParseError[] = [];
      const config = parseJsonc(
        await fs.readFile(path.join(applicationRoot, 'infrastructure/aca/wrangler.jsonc'), 'utf8'),
        configErrors,
        { allowTrailingComma: true },
      );
      if (configErrors.length || !config?.vars || !config.ratelimits?.length)
        throw new Error(
          'The ACA Wrangler template is invalid. Restore its supported configuration before deploying.',
        );
      delete config.$schema;
      config.name = snapshot.options.workerName;
      config.account_id = snapshot.accountId;
      config.main = path.join(applicationRoot, 'src/aca/worker.ts');
      config.workers_dev = !snapshot.options.domain;
      config.routes = snapshot.options.domain
        ? [{ pattern: snapshot.options.domain, custom_domain: true }]
        : [];
      config.vars = {
        ...config.vars,
        ENABLED: String(snapshot.options.collectionEnabled),
        SITE_ID: snapshot.options.siteId,
        SITE_ORIGIN: snapshot.siteOrigin,
        MAX_DAILY_BATCHES: String(snapshot.options.dailyBatches),
        DAILY_NETWORKS: String(snapshot.options.dailyNetworks),
        ACA_PROTOCOL: '3',
        IDENTITY_MODE: snapshot.options.optionalHistory ? 'optional-consent' : 'anonymous',
        AUDIENCE_DETAILS: String(snapshot.options.audienceDetails),
        DEPLOYMENT_ID: job.id,
      };
      config.d1_databases = [
        {
          binding: 'DB',
          database_name: snapshot.options.databaseName,
          database_id: databaseId,
          migrations_dir: path.join(applicationRoot, 'infrastructure/aca/migrations'),
        },
      ];
      resource.namespace ||= String(randomBytes(4).readUInt32LE() + 1);
      config.ratelimits[0].namespace_id = resource.namespace;
      const configFile = path.join(directory, 'wrangler.json');
      await fs.writeFile(configFile, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 });
      await stage(
        'migrating',
        'Applying unapplied ACA migrations; existing statistics are preserved…',
      );
      const migrated = await this.runner(
        [
          'd1',
          'migrations',
          'apply',
          snapshot.options.databaseName,
          '--remote',
          '--config',
          configFile,
        ],
        snapshot.accountId,
        log,
        snapshot.credentials,
      );
      if (migrated.code)
        throw new Error(
          'ACA database migration failed. No Worker upload was attempted. Applied migrations remain recorded for the next attempt.',
        );
      await stage('secrets', 'Preparing private service keys and the Studio report connection…');
      let existing: { name: string }[] = [];
      if (check.workerExists && !resource.secrets)
        existing = await this.cloud(
          snapshot,
          `/accounts/${snapshot.accountId}/workers/scripts/${snapshot.options.workerName}/secrets`,
        );
      const connection = await this.connections.summary();
      const current = await this.connections.values();
      if (
        current.CLOUDFLARE_API_TOKEN !== snapshot.credentials.CLOUDFLARE_API_TOKEN ||
        current.ACA_REPORT_TOKEN !== snapshot.credentials.ACA_REPORT_TOKEN
      )
        throw new ConflictError(
          'Connection credentials changed during ACA setup. Retry with the saved connection; no Worker was uploaded.',
        );
      if (!resource.secrets) {
        if (
          existing.some((item) => item.name === 'REPORT_TOKEN') &&
          !snapshot.credentials.ACA_REPORT_TOKEN
        )
          throw new Error(
            'Save this existing Worker’s matching ACA report token in Connections before connecting it. Existing secrets were preserved.',
          );
        const report = snapshot.credentials.ACA_REPORT_TOKEN || randomBytes(32).toString('hex');
        if (report.length < 32)
          throw new Error(
            'The saved ACA report token needs at least 32 characters. Update it in Connections.',
          );
        resource.secrets = { REPORT_TOKEN: report };
        for (const key of ['NETWORK_SECRET', 'IDENTITY_SECRET'] as const)
          if (!existing.some((item) => item.name === key))
            resource.secrets[key] = randomBytes(32).toString('hex');
      }
      generated = Object.fromEntries(
        keys.flatMap((key) => (resource.secrets![key] ? [[key, resource.secrets![key]!]] : [])),
      );
      if (current.ACA_REPORT_TOKEN && current.ACA_REPORT_TOKEN !== resource.secrets.REPORT_TOKEN)
        throw new Error(
          'The saved report token differs from this managed ACA service. Restore its token before deploying; no keys were rotated.',
        );
      await target.save(resource, (await target.read()).revision);
      if (!current.ACA_REPORT_TOKEN)
        await this.connections.update({
          revision: connection.revision,
          set: { acaReportToken: resource.secrets.REPORT_TOKEN },
        });
      if (job.action === 'deploy') {
        let endpoint = snapshot.options.domain ? 'https://' + snapshot.options.domain : '';
        if (!endpoint) {
          const account = await this.cloud<{ subdomain: string }>(
            snapshot,
            `/accounts/${snapshot.accountId}/workers/subdomain`,
          );
          if (!/^[a-z0-9-]+$/i.test(account.subdomain || ''))
            throw new Error(
              'Choose a Worker custom domain or configure the account’s workers.dev subdomain in Cloudflare.',
            );
          endpoint = `https://${snapshot.options.workerName}.${account.subdomain}.workers.dev`;
        }
        keyFile = path.join(directory, 'secrets.json');
        await fs.writeFile(keyFile, JSON.stringify(generated), { flag: 'wx', mode: 0o600 });
        await stage('uploading', 'Deploying the ACA Worker, private secrets and selected domain…');
        const deployed = await this.runner(
          ['deploy', '--config', configFile, '--secrets-file', keyFile],
          snapshot.accountId,
          log,
          snapshot.credentials,
        );
        if (deployed.code)
          throw new Error(
            'ACA upload failed. Inspect Cloudflare before retrying; database and keys are retained.',
          );
        job.deploymentUrl = endpoint;
        await stage(
          'verifying',
          'Verifying service protocol, reports and the public/private boundary…',
        );
        await this.verify(endpoint, snapshot, resource.secrets.REPORT_TOKEN, job.id);
        if ((await this.connections.values()).ACA_REPORT_TOKEN !== resource.secrets.REPORT_TOKEN)
          throw new Error(
            'ACA is uploaded, but Studio’s report token changed during deployment. Restore the matching connection before verifying again.',
          );
        job.verified = true;
        log('ACA is deployed and verified: ' + endpoint);
      } else
        log(
          'ACA database, migrations and private keys are ready. Deploy ACA to start the service.',
        );
      job.state = 'succeeded';
    } catch (error) {
      job.failedAt = job.state;
      job.state = 'failed';
      job.error = safe((error as Error).message);
      log(job.error);
    } finally {
      if (keyFile) await fs.rm(keyFile, { force: true });
      job.completedAt = new Date().toISOString();
      await this.persist(job);
    }
  }
  private async verify(endpoint: string, snapshot: Snapshot, token: string, deploymentId: string) {
    const read = (pathname: string, auth = true, init: RequestInit = {}) =>
      this.fetcher(new URL(pathname, endpoint), {
        ...init,
        redirect: 'manual',
        credentials: 'omit',
        signal: AbortSignal.timeout(15000),
        headers: auth ? { Authorization: 'Bearer ' + token } : init.headers,
      });
    const response = await read('/v1/status');
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
      throw new Error(
        'ACA was uploaded, but its status endpoint could not be verified. Check the captured deployment before retrying.',
      );
    const status = (await response.json()) as {
      protocol?: number;
      enabled?: boolean;
      pendingDays?: number;
      siteId?: string;
      siteOrigin?: string;
      deploymentId?: string;
    };
    if (
      status.protocol !== 3 ||
      status.siteId !== snapshot.options.siteId ||
      status.siteOrigin !== snapshot.siteOrigin ||
      status.deploymentId !== deploymentId ||
      status.enabled !== snapshot.options.collectionEnabled ||
      !Number.isSafeInteger(status.pendingDays)
    )
      throw new Error('ACA returned an unexpected service protocol or collection setting.');
    const day = new Date().toISOString().slice(0, 10),
      report = await read(`/v1/reports/overview?from=${day}&to=${day}`);
    if (!report.ok)
      throw new Error(
        'ACA report access failed after upload. Check migrations and the report token.',
      );
    const data = (await report.json()) as { name?: string; metrics?: unknown; series?: unknown };
    if (data.name !== 'overview' || !Array.isArray(data.metrics) || !Array.isArray(data.series))
      throw new Error('ACA returned an incompatible report.');
    const denied = await read('/v1/status', false);
    await denied.body?.cancel();
    if (denied.status !== 401) throw new Error('ACA private status is not protected correctly.');
    const deniedReport = await read(`/v1/reports/overview?from=${day}&to=${day}`, false);
    await deniedReport.body?.cancel();
    if (deniedReport.status !== 401)
      throw new Error('ACA private reports are not protected correctly.');
    const cors = await read('/v1/events', false, {
      method: 'OPTIONS',
      headers: { Origin: snapshot.siteOrigin, 'Access-Control-Request-Method': 'POST' },
    });
    if (
      cors.status !== 204 ||
      cors.headers.get('Access-Control-Allow-Origin') !== snapshot.siteOrigin
    )
      throw new Error('ACA ingestion CORS does not match the public site.');
    const rejected = await read('/v1/events', false, {
      method: 'OPTIONS',
      headers: {
        Origin:
          snapshot.siteOrigin === 'https://aca-setup.invalid'
            ? 'https://other.invalid'
            : 'https://aca-setup.invalid',
      },
    });
    await rejected.body?.cancel();
    if (rejected.status !== 403)
      throw new Error('ACA ingestion is accepting an unexpected website origin.');
  }
}
