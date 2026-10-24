import path from 'node:path';
import { PrivateSettings } from './configuration.js';
import { backupSettingsSchema } from '../shared/operations.js';
import { BackupService } from '../engine/backup.js';
export class BackupScheduler {
  private settings: PrivateSettings<import('../shared/operations.js').BackupSettings>;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  get isBusy() {
    return this.running;
  }
  constructor(
    readonly backups: BackupService,
    readonly idle: () => boolean,
    readonly changed: () => void,
  ) {
    this.settings = new PrivateSettings(
      path.join(backups.store.root, '.studio/backup-settings.json'),
      backupSettingsSchema,
    );
  }
  async summary() {
    const saved = await this.settings.read();
    return {
      ...saved,
      running: this.running,
      nextDue: saved.value.lastSuccess
        ? new Date(Date.parse(saved.value.lastSuccess) + 86400000).toISOString()
        : '',
    };
  }
  async update(input: { enabled: boolean; keepAutomatic: number; revision: string }) {
    const current = await this.settings.read();
    await this.settings.save(
      { ...current.value, enabled: input.enabled, keepAutomatic: input.keepAutomatic, error: '' },
      input.revision,
    );
    return this.summary();
  }
  start() {
    this.timer = setInterval(() => void this.run(false).catch(() => {}), 60000);
    this.timer.unref();
    void this.run(false).catch(() => {});
  }
  close() {
    clearInterval(this.timer);
  }
  async run(manual = true, now = new Date()) {
    if (this.running || !this.idle()) return { deferred: true };
    const saved = await this.settings.read();
    if (!this.idle()) return { deferred: true };
    if (
      !manual &&
      (!saved.value.enabled ||
        saved.value.error ||
        (saved.value.lastSuccess && now.getTime() - Date.parse(saved.value.lastSuccess) < 86400000))
    )
      return { skipped: true };
    this.running = true;
    try {
      const record = await this.backups.create('automatic');
      const latest = await this.settings.read();
      await this.settings.save(
        {
          ...latest.value,
          lastAttempt: now.toISOString(),
          lastSuccess: now.toISOString(),
          error: '',
        },
        latest.revision,
      );
      const automatic = (await this.backups.list()).filter((item) => item.reason === 'automatic');
      const stale = automatic.slice(latest.value.keepAutomatic);
      // Pruning shares the same validation and transaction as explicit deletion.
      for (let offset = 0; offset < stale.length; offset += 500)
        await this.backups.batch({
          action: 'delete',
          items: stale.slice(offset, offset + 500).map(({ id, revision }) => ({ id, revision })),
        });
      this.changed();
      return { backup: record };
    } catch (error) {
      const latest = await this.settings.read();
      await this.settings.save(
        { ...latest.value, lastAttempt: now.toISOString(), error: (error as Error).message },
        latest.revision,
      );
      this.changed();
      throw error;
    } finally {
      this.running = false;
    }
  }
}
