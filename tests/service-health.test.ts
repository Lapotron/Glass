import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/engine/store.js';
import { JobService } from '../src/server/publishing.js';
import { AcaDeploymentService } from '../src/server/aca-deployment.js';
import { HealthService } from '../src/server/health.js';
it('caches private health reads, converts provider CPU units and retains resolution history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-health-'));
  try {
    await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
    const store = new Store(root),
      state = await store.snapshot();
    await store.saveJson(
      'site',
      {
        ...state.site,
        integrations: {
          ...state.site.integrations,
          aca: {
            ...state.site.integrations.aca,
            endpoint: 'https://metrics.example.org',
            siteId: 'test',
            optionalHistory: true,
          },
        },
      },
      state.siteRevision,
    );
    const jobs = new JobService(store);
    await jobs.connections.update({
      revision: (await jobs.connections.summary()).revision,
      set: {
        acaReportToken: 'a-private-test-token-at-least-32-characters',
        cloudflareApiToken: 'a-private-provider-token',
      },
    });
    const aca = new AcaDeploymentService(store, jobs.connections);
    let paused = true,
      requests = 0;
    const fetcher: typeof fetch = async (input) => {
      requests++;
      if (String(input).endsWith('/graphql'))
        return Response.json({
          data: {
            viewer: {
              accounts: [
                {
                  workersInvocationsAdaptive: [
                    {
                      sum: { requests: 23, errors: 1 },
                      quantiles: { cpuTimeP50: 650, cpuTimeP95: 2400, cpuTimeP99: 7600 },
                    },
                  ],
                },
              ],
            },
          },
        });
      return Response.json({
        protocol: 3,
        enabled: true,
        paused,
        pendingDays: 1,
        oldestPending: Date.now() - 20 * 60000,
        maintenance: { last_succeeded: null },
        historyMode: 'optional-consent',
        usage: { rows_read: 90, rows_written: 5 },
        limits: { reads: 100, writes: 100 },
      });
    };
    const service = new HealthService(store, jobs, aca, fetcher);
    const [first, second] = await Promise.all([service.report(), service.report()]);
    expect(second).toEqual(first);
    expect(requests).toBe(2);
    expect(first.worker).toMatchObject({
      requests: 23,
      errors: 1,
      cpuP50Ms: 0.65,
      cpuP95Ms: 2.4,
      cpuP99Ms: 7.6,
    });
    expect(first.issues.map((i) => i.id)).toEqual(
      expect.arrayContaining(['aca-paused', 'aca-quota', 'aca-stale']),
    );
    await service.report();
    expect(requests).toBe(2);
    paused = false;
    const refreshed = await new HealthService(store, jobs, aca, fetcher).report();
    expect(refreshed.issues.find((i) => i.id === 'aca-paused')?.resolvedAt).toBeTruthy();
    expect(refreshed.issues.find((i) => i.id === 'aca-quota')?.firstSeen).toBe(
      first.issues.find((i) => i.id === 'aca-quota')?.firstSeen,
    );
    expect(JSON.stringify(refreshed)).not.toContain('a-private');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
