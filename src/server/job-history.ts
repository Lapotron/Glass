import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Job } from '../shared/contracts.js';
import { selectedItemsSchema } from '../shared/operations.js';
import { contained, digest } from '../engine/store.js';
import { commitFiles, fileDigest, type FileChange } from '../engine/file-transaction.js';
import { OperationConflict } from '../engine/operations.js';
import type { Exports } from '../engine/exports.js';
import type { JobService } from './publishing.js';

export const terminalJob = (job: Job) => ['succeeded', 'failed'].includes(job.state);
export function jobRecord(job: Job): Job & { revision: string } {
  const { revision: _revision, ...record } = job;
  return { ...record, revision: digest(JSON.stringify(record)) };
}
const identity = (id: string) => {
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error('Invalid build job identity.');
  return id;
};

export class JobHistory {
  constructor(
    readonly jobs: JobService,
    readonly exports: Exports,
  ) {}
  get store() {
    return this.jobs.store;
  }
  find(id: string) {
    identity(id);
    const job = this.jobs.jobs.find((job) => job.id === id);
    if (!job) throw new Error('This job is no longer in build history. Refresh the list.');
    return job;
  }
  private async selected(input: unknown, terminal = false) {
    const items = selectedItemsSchema.parse(input);
    const chosen: { job: Job; file: string; expected: string }[] = [];
    const issues = [];
    for (const item of items) {
      identity(item.id);
      const job = this.jobs.jobs.find((job) => job.id === item.id);
      if (!job || jobRecord(job).revision !== item.revision || (terminal && !terminalJob(job))) {
        issues.push({
          id: item.id,
          message: `${item.id} changed or is still running. Refresh the selection.`,
        });
        continue;
      }
      const file = await contained(path.join(this.store.root, '.studio/jobs'), item.id + '.json');
      const expected = await fileDigest(file);
      if (
        !expected ||
        jobRecord(JSON.parse(await fs.readFile(file, 'utf8'))).revision !== item.revision
      )
        issues.push({
          id: item.id,
          message: `${item.id} changed on disk. Refresh Studio before continuing.`,
        });
      else chosen.push({ job, file, expected });
    }
    if (issues.length) throw new OperationConflict(issues);
    return chosen;
  }
  async exportReports(input: unknown) {
    return this.store.exclusive(async () => {
      const chosen = await this.selected(input, true);
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        jobs: chosen.map(({ job }) => jobRecord(job)),
      };
    });
  }
  async remove(input: unknown) {
    return this.store.exclusive(async () => {
      const chosen = await this.selected(input, true),
        undoId = randomUUID();
      const receipt = path.join(this.store.root, '.studio/job-history', undoId + '.json');
      await commitFiles(this.store.root, [
        {
          file: receipt,
          value: JSON.stringify({
            version: 1,
            removedAt: new Date().toISOString(),
            jobs: chosen.map(({ job }) => job),
          }),
          expected: null,
        },
        ...chosen.map(({ file, expected }) => ({ file, value: null, expected })),
      ]);
      const removed = chosen.map(({ job }) => job.id);
      this.jobs.jobs = this.jobs.jobs.filter((job) => !removed.includes(job.id));
      this.jobs.emit('history', { removed, restored: [] });
      return { undoId, removed };
    });
  }
  async restore(id: string) {
    z.uuid().parse(id);
    return this.store.exclusive(async () => {
      const base = path.join(this.store.root, '.studio/job-history');
      const receipt = await contained(base, id + '.json');
      const expected = await fileDigest(receipt);
      if (!expected) throw new Error('This history removal has already been undone.');
      const saved = JSON.parse(await fs.readFile(receipt, 'utf8')) as {
        version: number;
        jobs: Job[];
      };
      if (
        saved.version !== 1 ||
        !Array.isArray(saved.jobs) ||
        !saved.jobs.length ||
        saved.jobs.length > 500
      )
        throw new Error('Invalid build history receipt.');
      const changes: FileChange[] = [];
      const unique = new Set<string>();
      for (const job of saved.jobs) {
        identity(job.id);
        if (
          unique.has(job.id) ||
          !terminalJob(job) ||
          this.jobs.jobs.some((current) => current.id === job.id)
        )
          throw new Error('A job with this identity already exists. Nothing was restored.');
        unique.add(job.id);
        changes.push({
          file: path.join(this.store.root, '.studio/jobs', job.id + '.json'),
          value: JSON.stringify(job, null, 2),
          expected: null,
        });
      }
      await commitFiles(this.store.root, [...changes, { file: receipt, value: null, expected }]);
      this.jobs.jobs = [...this.jobs.jobs, ...saved.jobs].sort((a, b) =>
        b.startedAt.localeCompare(a.startedAt),
      );
      const restored = saved.jobs.map(jobRecord);
      this.jobs.emit('history', { removed: [], restored });
      return { restored };
    });
  }
  async artifact(id: string, revision: string) {
    return this.store.exclusive(async () => {
      const [{ job }] = await this.selected([{ id, revision }], true);
      if (!job.build) throw new Error('This job did not produce an accepted artifact.');
      const build = job.build;
      identity(build.id);
      const root = await contained(path.join(this.store.root, '.studio/builds'), build.id);
      // Only the accepted public directory is exported, never source.json or private journals.
      let output = path.resolve(build.outputDir);
      // A retained notebook can move from disk to hosted storage (or another folder).
      // Rebase only this job's two fixed artifact locations; never trust another path.
      for(const directory of ['public','delivery-public'])if(output.endsWith(`/.studio/builds/${build.id}/${directory}`))output=path.join(root,directory);
      if (![path.join(root, 'public'), path.join(root, 'delivery-public')].includes(output))
        throw new Error('This build has no retained public artifact in this notebook.');
      const real = await fs.realpath(output).catch(() => '');
      if (real !== path.join(await fs.realpath(root), path.basename(output)))
        throw new Error('The accepted artifact is missing or is a symbolic link.');
      if (
        !build.manifest.length ||
        build.manifest.length > 20000 ||
        new Set(build.manifest).size !== build.manifest.length
      )
        throw new Error('The accepted artifact manifest is invalid.');
      const files: { name: string; file: string; bytes: number }[] = [];
      let total = 0;
      for (const name of build.manifest) {
        if (
          name.includes('\\') ||
          name.split('/').some((part) => !part || part === '.' || part === '..')
        )
          throw new Error('The accepted artifact contains an invalid path.');
        const file = await contained(output, name),
          stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error('Artifacts require regular files.');
        total += stat.size;
        if (total > 512 * 1024 * 1024) throw new Error('Artifact downloads support up to 512 MiB.');
        files.push({ name, file, bytes: stat.size });
      }
      const records = async function* () {
        for (const file of files) {
          const bytes = await fs.readFile(file.file);
          if (bytes.length !== file.bytes) throw new Error('The artifact changed while exporting.');
          yield { name: file.name, bytes };
        }
      };
      return this.exports.archive(records(), `glass-build-${build.id}.tar.gz`);
    });
  }
}
