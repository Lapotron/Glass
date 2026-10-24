import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Store, atomicWrite } from '../src/engine/store.js';
import { BackupService } from '../src/engine/backup.js';
import { Exports } from '../src/engine/exports.js';
import { JobService } from '../src/server/publishing.js';
import { JobHistory, jobRecord } from '../src/server/job-history.js';
import { createApp } from '../src/server/app.js';
import type { Job } from '../src/shared/contracts.js';

let root: string, store: Store, jobs: JobService, exports: Exports, history: JobHistory;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-job-history-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  await store.snapshot();
  jobs = new JobService(store, async () => {
    throw new Error('No external command expected.');
  });
  await jobs.initialize();
  exports = new Exports(store, new BackupService(store));
  await exports.initialize();
  history = new JobHistory(jobs, exports);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function record(id: string, values: Partial<Job> = {}) {
  const job: Job = {
    id,
    action: 'build',
    state: 'succeeded',
    logs: ['Accepted fixture build.'],
    startedAt: '2026-10-20T01:00:00Z',
    completedAt: '2026-10-20T01:00:13Z',
    target: { canonicalUrl: 'https://old.example.org/', project: 'old-notebook', branch: 'main' },
    ...values,
  };
  await atomicWrite(path.join(root, '.studio/jobs', id + '.json'), JSON.stringify(job, null, 2));
  jobs.jobs.unshift(job);
  return jobRecord(job);
}
async function artifact(id: string) {
  const outputDir = path.join(root, '.studio/builds', id, 'public');
  const files = ['index.html', 'assets/site.js', '文章/index.html'];
  for (const file of files) await atomicWrite(path.join(outputDir, file), 'Public output: ' + file);
  await atomicWrite(
    path.join(path.dirname(outputDir), 'source.json'),
    JSON.stringify({ site: (await store.read()).site, private: 'PRIVATE-SNAPSHOT-CANARY' }),
  );
  return record(id, {
    build: {
      id,
      outputDir,
      pages: 2,
      manifest: files,
      diagnostics: [],
      sourceRevision: 'a'.repeat(64),
      completedAt: '2026-10-20T01:00:12Z',
    },
  });
}

describe('private build history operations', () => {
  it('removes a group atomically, keeps accepted artifacts and notebook bytes, and restores after restart', async () => {
    const first = await artifact('first'),
      second = await record('second', { state: 'failed' });
    const source = await fs.readFile(path.join(root, 'content/site.json'));
    await atomicWrite(path.join(root, 'dist/index.html'), 'Last local site');
    const removed = await history.remove(
      [first, second].map(({ id, revision }) => ({ id, revision })),
    );
    expect(jobs.jobs).toHaveLength(0);
    expect(await fs.readFile(first.build!.outputDir + '/index.html', 'utf8')).toContain(
      'Public output',
    );
    expect(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8')).toBe('Last local site');
    expect(await fs.readFile(path.join(root, 'content/site.json'))).toEqual(source);
    const restarted = new JobService(store);
    await restarted.initialize();
    await new JobHistory(restarted, exports).restore(removed.undoId);
    expect(restarted.jobs.map((job) => job.id).sort()).toEqual(['first', 'second']);
    await expect(history.restore(removed.undoId)).rejects.toThrow('already been undone');
    // Job receipts must never be mistaken for portable notebook/collection history.
    const backup = new BackupService(store);
    await expect(backup.create()).resolves.toBeDefined();
  });
  it('rejects stale groups, external edits, duplicate selections and active jobs without partial removal', async () => {
    const first = await record('first'),
      second = await record('second'),
      active = await record('running', { state: 'building', completedAt: undefined });
    const selected = [first, second].map(({ id, revision }) => ({ id, revision }));
    await atomicWrite(
      path.join(root, '.studio/jobs/second.json'),
      JSON.stringify({
        ...jobs.jobs.find((job) => job.id === 'second'),
        logs: ['External change'],
      }),
    );
    await expect(history.remove(selected)).rejects.toThrow('changed on disk');
    expect(await fs.readFile(path.join(root, '.studio/jobs/first.json'), 'utf8')).toContain(
      'first',
    );
    await expect(history.remove([{ id: active.id, revision: active.revision }])).rejects.toThrow(
      'still running',
    );
    await expect(history.remove([selected[0], selected[0]])).rejects.toThrow(
      'Choose each item once',
    );
    await expect(history.remove([{ id: '../outside', revision: first.revision }])).rejects.toThrow(
      'Invalid build job identity',
    );
    expect(jobs.jobs).toHaveLength(3);
  });
  it('exports only manifest-listed public files with Unicode paths and reports the captured destination', async () => {
    const job = await artifact('retained');
    const ticket = await history.artifact(job.id, job.revision);
    const download = exports.download(ticket.url.split('/').pop()!);
    const chunks: Buffer[] = [];
    for await (const chunk of download.stream) chunks.push(Buffer.from(chunk));
    const archive = path.join(root, 'artifact.tar.gz');
    await fs.writeFile(archive, Buffer.concat(chunks));
    const list = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    expect(list).toContain('文章/index.html');
    expect(list).not.toMatch(/source\.json|jobs|content\/|connections/);
    const report = await history.exportReports([{ id: job.id, revision: job.revision }]);
    expect(report.jobs[0].target?.canonicalUrl).toBe('https://old.example.org/');
    expect(report.jobs[0].logs).toEqual(['Accepted fixture build.']);
  });
  it('rejects artifact traversal, symbolic links, missing files and oversized downloads before issuing tickets', async () => {
    const job = await artifact('unsafe');
    const raw = jobs.jobs.find((item) => item.id === job.id)!;
    const save = async () => {
      await atomicWrite(path.join(root, '.studio/jobs/unsafe.json'), JSON.stringify(raw));
      return jobRecord(raw).revision;
    };
    raw.build!.manifest = ['../source.json'];
    await expect(history.artifact(job.id, await save())).rejects.toThrow('invalid path');
    raw.build!.manifest = ['assets/link.js'];
    await fs.symlink(
      path.join(root, 'content/site.json'),
      path.join(raw.build!.outputDir, 'assets/link.js'),
    );
    await expect(history.artifact(job.id, await save())).rejects.toThrow(
      /Symbolic link|regular files/,
    );
    raw.build!.manifest = ['missing.html'];
    await expect(history.artifact(job.id, await save())).rejects.toThrow();
    raw.build!.manifest = ['large.bin'];
    const large = path.join(raw.build!.outputDir, 'large.bin');
    await fs.writeFile(large, '');
    await fs.truncate(large, 513 * 1024 * 1024);
    await expect(history.artifact(job.id, await save())).rejects.toThrow('512 MiB');
  });
  it('captures each new run target and recovers a legacy target from its own snapshot', async () => {
    const legacy = await artifact('legacy'),
      raw = jobs.jobs.find((job) => job.id === legacy.id)!;
    delete raw.target;
    const snapshot = await store.read();
    await atomicWrite(
      path.join(root, '.studio/builds/legacy/source.json'),
      JSON.stringify({
        site: {
          ...snapshot.site,
          url: 'https://historical.example.org',
          cloudflare: {
            ...snapshot.site.cloudflare,
            projectName: 'historical',
            productionBranch: 'archive',
          },
        },
      }),
    );
    await atomicWrite(path.join(root, '.studio/jobs/legacy.json'), JSON.stringify(raw));
    const rebuilt = new JobService(store, undefined, async (_store, options) => ({
      id: options!.id!,
      outputDir: '/tmp/unused',
      pages: 1,
      manifest: [],
      diagnostics: [],
      sourceRevision: 'a'.repeat(64),
      completedAt: new Date().toISOString(),
    }));
    await rebuilt.initialize();
    expect(rebuilt.jobs[0].target).toEqual({
      canonicalUrl: 'https://historical.example.org/',
      project: 'historical',
      branch: 'archive',
    });
    const started = rebuilt.start('build');
    await rebuilt.waitFor(started.id);
    expect(started.target?.canonicalUrl).toBe(new URL(snapshot.site.url).href);
  });
  it('exposes all history and protects writes with session/origin checks', async () => {
    for (let i = 0; i < 34; i++) await record('history-' + i);
    const context = await createApp(root, { jobs, watchFiles: false });
    try {
      const response = await context.app.request('http://localhost/api/bootstrap');
      const bootstrap = await response.json();
      expect(bootstrap.jobs).toHaveLength(34);
      expect(bootstrap.jobs[0].revision).toMatch(/^[a-f0-9]{64}$/);
      const body = JSON.stringify({
        items: [jobRecord(jobs.jobs[0])].map(({ id, revision }) => ({ id, revision })),
      });
      expect(
        (
          await context.app.request('http://localhost/api/jobs/history/remove', {
            method: 'POST',
            body,
            headers: { 'Content-Type': 'application/json' },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await context.app.request('http://localhost/api/jobs/history/remove', {
            method: 'POST',
            body,
            headers: {
              'Content-Type': 'application/json',
              'X-Studio-Token': bootstrap.token,
              Origin: 'https://outside.example',
            },
          })
        ).status,
      ).toBe(403);
    } finally {
      context.close();
    }
  });
});
