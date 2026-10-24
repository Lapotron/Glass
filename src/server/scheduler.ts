import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from '../engine/store.js';
import { JobService } from './publishing.js';
export type ScheduleState = {
  running: boolean;
  pendingIds: string[];
  lastRun?: string;
  jobId?: string;
  error?: string;
};
export class Scheduler {
  state: ScheduleState = { running: false, pendingIds: [] };
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking = false;
  get isBusy() {
    return this.checking || this.state.running;
  }
  constructor(
    readonly jobs: JobService,
    readonly onChange: () => void = () => undefined,
    readonly canRun: () => boolean = () => true,
  ) {}
  private get file() {
    return path.join(this.jobs.store.root, '.studio/scheduler.json');
  }
  private async persist() {
    await atomicWrite(this.file, JSON.stringify(this.state));
    this.onChange();
  }
  async initialize() {
    try {
      const state = JSON.parse(await fs.readFile(this.file, 'utf8')) as ScheduleState;
      this.state = { ...state, running: false };
      if (state.jobId) {
        const job = this.jobs.jobs.find((job) => job.id === state.jobId);
        if (job?.state === 'succeeded') this.state.pendingIds = [];
        else if (job?.state === 'failed')
          this.state.error =
            job.error || 'The previous scheduled job failed. Review it before retrying.';
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  start() {
    this.timer = setInterval(() => {
      void this.runDue().catch((error) => {
        this.state.error = (error as Error).message;
        void this.persist();
      });
    }, 60000);
    this.timer.unref();
  }
  close() {
    if (this.timer) clearInterval(this.timer);
  }
  async runDue(manual = false, now = new Date()) {
    if (this.isBusy || this.jobs.isBusy || !this.canRun()) return this.state;
    this.checking = true;
    try {
      return await this.perform(manual, now);
    } finally {
      this.checking = false;
    }
  }
  async holdAfterRestore() {
    this.state = {
      running: false,
      pendingIds: [],
      error:
        'Review restored scheduled entries, then check due entries to resume automatic scheduling.',
    };
    await this.persist();
  }
  private async perform(manual: boolean, now: Date) {
    const model = await this.jobs.store.snapshot();
    if (!manual && (!model.site.publishing.scheduleEnabled || this.state.error)) return this.state;
    const due = model.entries.filter(
      (entry) => entry.status === 'scheduled' && Date.parse(entry.publishAt) <= now.getTime(),
    );
    const pending = this.state.pendingIds.filter((id) =>
      model.entries.some((entry) => entry.id === id && entry.status === 'published'),
    );
    if (!due.length && !pending.length) {
      if (manual) {
        this.state = { running: false, pendingIds: [], lastRun: now.toISOString() };
        await this.persist();
      }
      return this.state;
    }
    this.state = {
      running: true,
      pendingIds: [...new Set([...pending, ...due.map((entry) => entry.id)])],
      lastRun: now.toISOString(),
    };
    try {
      const action = model.site.publishing.scheduleAction;
      if (
        action === 'publish' &&
        (!model.site.cloudflare.accountId ||
          !model.site.cloudflare.projectName ||
          new URL(model.site.url).hostname === 'example.com')
      )
        throw new Error(
          'Connect Cloudflare Pages and set the canonical URL before scheduled publication.',
        );
      await this.persist();
      await this.jobs.store.publishDue(now);
      const job = this.jobs.start(action);
      this.state.jobId = job.id;
      await this.persist();
      const completed = await this.jobs.waitFor(job.id);
      if (completed.state !== 'succeeded')
        throw new Error(completed.error || 'Scheduled build did not finish.');
      this.state.pendingIds = [];
    } catch (error) {
      this.state.error = (error as Error).message;
    } finally {
      this.state.running = false;
      await this.persist();
    }
    return this.state;
  }
}
