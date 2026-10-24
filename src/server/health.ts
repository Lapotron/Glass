import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite, type Store } from '../engine/store.js';
import type { JobService } from './publishing.js';
import type { AcaDeploymentService } from './aca-deployment.js';
import { analyticsStatus } from './analytics.js';
import { r2Readiness } from './r2-readiness.js';
import type { HealthReport, HealthIssue } from '../shared/health.js';
export class HealthService {
  private cached?: { key: string; time: number; value: HealthReport };
  private pending?: Promise<HealthReport>;
  constructor(
    private store: Store,
    private jobs: Pick<JobService, 'connections' | 'jobs'>,
    private aca: Pick<AcaDeploymentService, 'summary'>,
    private fetcher?: typeof fetch,
    private options: { persistIssues?: boolean } = {},
  ) {}
  async report() {
    const { siteRevision } = await this.store.snapshot(),
      connections = await this.jobs.connections.summary();
    const key = siteRevision + connections.revision;
    if (this.cached?.key === key && Date.now() - this.cached.time < 60000) return this.cached.value;
    if (this.pending) return this.pending;
    this.pending = this.check()
      .then((value) => {
        this.cached = { key, time: Date.now(), value };
        return value;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private async check(): Promise<HealthReport> {
    const { site } = await this.store.snapshot(),
      credentials = await this.jobs.connections.values(),
      now = Date.now(),
      checkedAt = new Date(now).toISOString();
    const report: HealthReport = { checkedAt, checks: [], issues: [] };
    const add = (id: string, severity: HealthIssue['severity'], message: string, action: string) =>
      report.issues.push({
        id,
        severity,
        message,
        action,
        firstSeen: checkedAt,
        lastSeen: checkedAt,
      });
    const latest = this.jobs.jobs.find(
      (j) =>
        j.state === 'succeeded' &&
        j.action === 'publish' &&
        j.target?.project === site.cloudflare.projectName,
    );
    report.checks.push({
      id: 'pages',
      state: latest ? 'verified' : site.cloudflare.projectName ? 'configured' : 'optional',
      detail: latest
        ? 'A successful Pages publication is recorded.'
        : site.cloudflare.projectName
          ? 'Pages target configured; publication verifies upload access.'
          : 'Set a Pages project when ready to publish.',
    });
    const r2 = r2Readiness(site, credentials);
    report.checks.push({
      id: 'r2',
      state:
        site.mediaDelivery.mode !== 'r2' ? 'optional' : r2.configured ? 'configured' : 'attention',
      detail:
        site.mediaDelivery.mode !== 'r2'
          ? 'Optional: media is served by Pages.'
          : r2.configured
            ? 'R2 is configured. CDN bytes and CORS are verified during publication.'
            : 'R2 connection settings are incomplete.',
    });
    if (site.mediaDelivery.mode === 'r2' && !r2.configured)
      add('r2-settings', 'warning', 'R2 connection settings are incomplete.', 'media');
    if (site.integrations.aca.endpoint) {
      try {
        const status = (await analyticsStatus(
          this.store,
          this.jobs.connections,
          this.fetcher,
        )) as Awaited<ReturnType<typeof analyticsStatus>> & {
          protocol: number;
          usage?: { rows_read: number; rows_written: number };
          limits?: { reads: number; writes: number };
          maintenance?: { last_succeeded: number | null };
          oldestPending?: number | null;
          historyMode?: string;
        };
        report.checks.push({
          id: 'aca',
          state: status.paused ? 'attention' : 'verified',
          detail: status.paused
            ? 'ACA is paused by its configured budget.'
            : status.pendingDays
              ? 'ACA is connected; summaries are processing.'
              : 'ACA is connected and summaries are up to date.',
        });
        if (status.paused)
          add('aca-paused', 'error', 'ACA is paused by its configured budget.', 'analytics');
        if (
          status.pendingDays &&
          (status.maintenance?.last_succeeded || status.oldestPending) &&
          now - (status.maintenance?.last_succeeded || status.oldestPending!) > 15 * 60000
        )
          add(
            'aca-stale',
            'warning',
            'ACA has pending observations and no successful maintenance for over 15 minutes.',
            'analytics',
          );
        if (
          status.usage &&
          status.limits &&
          (status.usage.rows_read / status.limits.reads > 0.8 ||
            status.usage.rows_written / status.limits.writes > 0.8)
        )
          add(
            'aca-quota',
            'warning',
            'ACA has used over 80% of a configured daily database budget.',
            'analytics',
          );
        if (site.integrations.aca.optionalHistory && status.historyMode !== 'optional-consent')
          add(
            'aca-history',
            'warning',
            'The website offers history but the deployed ACA service does not. Deploy matching service controls first.',
            'settings',
          );
        if (status.protocol < 3)
          add(
            'aca-upgrade',
            'warning',
            'Upgrade ACA before publishing audience version-2 clients.',
            'settings',
          );
      } catch {
        report.checks.push({
          id: 'aca',
          state: 'attention',
          detail: 'ACA status could not be read. Check its endpoint, report token and service.',
        });
        add(
          'aca-unavailable',
          'error',
          'ACA status could not be read. Check its endpoint, report token and service.',
          'settings',
        );
      }
      try {
        if (!credentials.CLOUDFLARE_API_TOKEN) throw new Error();
        const target = (await this.aca.summary()).options,
          from = new Date(now - 86400000).toISOString(),
          to = checkedAt;
        const response = await (this.fetcher || fetch)(
          'https://api.cloudflare.com/client/v4/graphql',
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + credentials.CLOUDFLARE_API_TOKEN,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query:
                'query($account:string!,$script:string!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$account}){workersInvocationsAdaptive(limit:1,filter:{scriptName:$script,datetime_geq:$start,datetime_leq:$end}){sum{requests errors}quantiles{cpuTimeP50 cpuTimeP95 cpuTimeP99}}}}}',
              variables: {
                account: site.cloudflare.accountId,
                script: target.workerName,
                start: from,
                end: to,
              },
            }),
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          },
        );
        const result = (await response.json()) as {
          errors?: unknown[];
          data?: {
            viewer: {
              accounts: {
                workersInvocationsAdaptive: {
                  sum: { requests: number; errors: number };
                  quantiles: { cpuTimeP50: number; cpuTimeP95: number; cpuTimeP99: number };
                }[];
              }[];
            };
          };
        };
        const value = result.data?.viewer.accounts[0]?.workersInvocationsAdaptive[0];
        if (!response.ok || result.errors?.length || !value) throw new Error();
        // The provider schema defines cpuTime quantiles in microseconds.
        report.worker = {
          requests: value.sum.requests,
          errors: value.sum.errors,
          cpuP50Ms: value.quantiles.cpuTimeP50 / 1000,
          cpuP95Ms: value.quantiles.cpuTimeP95 / 1000,
          cpuP99Ms: value.quantiles.cpuTimeP99 / 1000,
          from,
          to,
        };
      } catch {
        report.metricsUnavailable =
          'Cloudflare CPU metrics are unavailable. Check Account Analytics Read permission and provider data availability.';
      }
    } else
      report.checks.push({
        id: 'aca',
        state: 'optional',
        detail: 'Optional: configure ACA when you want private audience reports.',
      });
    const file = path.join(this.store.root, '.studio/health/issues.json');
    let previous: HealthIssue[] = [];
    try {
      previous = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      /* A missing issue history does not prevent diagnostics. */
    }
    for (const issue of report.issues) {
      const old = previous.find((i) => i.id === issue.id && !i.resolvedAt);
      if (old) issue.firstSeen = old.firstSeen;
    }
    report.issues.push(
      ...previous
        .filter((old) => !report.issues.some((i) => i.id === old.id))
        .map((old) => ({ ...old, resolvedAt: old.resolvedAt || checkedAt }))
        .filter((old) => Date.parse(old.lastSeen) > now - 30 * 86400000)
        .slice(0, 100),
    );
    if (this.options.persistIssues !== false) {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await atomicWrite(file, JSON.stringify(report.issues));
      await fs.chmod(file, 0o600);
    }
    return report;
  }
}
