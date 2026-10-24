import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/engine/store.js';
import { JobService } from '../src/server/publishing.js';
import { jobRecord } from '../src/server/job-history.js';
import type { Job } from '../src/shared/contracts.js';
it('rechecks the captured upload without building or deploying, preserves failures and rejects stale history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-recheck-'));
  try {
    await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
    let fail = true,
      checks = 0;
    const service = new JobService(
      new Store(root),
      async () => {
        throw new Error('Recheck must not deploy.');
      },
      async () => {
        throw new Error('Recheck must not rebuild.');
      },
      {
        verify: async (deployment, build, _request, options) => {
          checks++;
          expect(deployment.url).toBe('https://saved.project.pages.dev');
          expect(build.id).toBe('saved-build');
          expect(options?.canonicalUrl).toBe('https://saved.example.org');
          if (fail) throw new Error('The public domain still serves an older build.');
        },
      },
    );
    await service.initialize();
    const job: Job = {
      id: 'recorded-upload',
      action: 'publish',
      state: 'failed',
      failedAt: 'verifying-deployment',
      error: 'Initial verification failed.',
      logs: ['Initial verification failed.'],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      target: { canonicalUrl: 'https://saved.example.org', project: 'project', branch: 'main' },
      build: {
        id: 'saved-build',
        outputDir: path.join(root, 'dist'),
        pages: 2,
        manifest: ['index.html', 'assets/deployment.json'],
        diagnostics: [],
        sourceRevision: 'a'.repeat(64),
        completedAt: new Date().toISOString(),
      },
      deployment: {
        url: 'https://saved.project.pages.dev',
        project: 'project',
        buildId: 'saved-build',
        completedAt: new Date().toISOString(),
      },
    };
    service.jobs = [job];
    await fs.writeFile(path.join(root, '.studio/jobs', job.id + '.json'), JSON.stringify(job));
    await expect(service.recheckUploaded(job.id, 'stale-revision')).rejects.toThrow('changed');
    expect(checks).toBe(0);
    await expect(service.recheckUploaded(job.id, jobRecord(job).revision)).rejects.toThrow(
      'older build',
    );
    expect(job.state).toBe('failed');
    expect(job.deployment?.url).toBe('https://saved.project.pages.dev');
    expect(service.isBusy).toBe(false);
    fail = false;
    const result = await service.recheckUploaded(job.id, jobRecord(job).revision);
    expect(result.state).toBe('succeeded');
    expect(result.failedAt).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.logs).toContain('Initial verification failed.');
    expect(result.logs.at(-1)).toContain('no files were uploaded');
    expect(
      JSON.parse(await fs.readFile(path.join(root, '.studio/jobs', job.id + '.json'), 'utf8'))
        .state,
    ).toBe('succeeded');
    await expect(service.recheckUploaded(job.id, jobRecord(job).revision)).rejects.toThrow(
      'Choose an uploaded build',
    );
    expect(service.isBusy).toBe(false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
