import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createLargeBackup, indexBackupFiles } from '../src/engine/backup-archive.js';

test('backup import resumes confirmed parts after reload and reviews the exact archive', async ({
  page,
}) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-browser-backup-'));
  let release: () => void = () => {};
  try {
    await fs.cp('tests/fixtures/notebook', path.join(fixture, 'content'), { recursive: true });
    await fs.writeFile(
      path.join(fixture, 'content/media/upload-resume.bin'),
      randomBytes(9 * 1024 ** 2),
    );
    const archive = path.join(fixture, 'browser-resume.tar.gz');
    await createLargeBackup(fixture, archive, await indexBackupFiles(fixture));
    const counts = new Map<string, number>();
    let held = false;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/backups/uploads/*/parts/*', async (route) => {
      const part = new URL(route.request().url()).pathname.split('/').pop()!;
      counts.set(part, (counts.get(part) || 0) + 1);
      if (part === '2' && !held) {
        held = true;
        await blocked;
        await route.abort().catch(() => {});
      } else await route.continue();
    });
    await page.goto('/studio/#backups');
    const input = page.getByLabel('Notebook backup', { exact: true });
    await input.setInputFiles(archive);
    await expect.poll(() => held).toBe(true);
    await page.getByRole('button', { name: 'Pause upload', exact: true }).click();
    release();
    await expect(page.getByRole('button', { name: 'Resume upload', exact: true })).toBeVisible();
    expect(counts.get('1')).toBe(1);
    await page.reload();
    await expect(page.getByText('Unfinished backup upload', { exact: true })).toBeVisible();
    await page.getByLabel('Notebook backup', { exact: true }).setInputFiles(archive);
    await expect(page.getByText('Checksums verified', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByRole('button', { name: 'Restore reviewed notebook', exact: true }),
    ).toBeEnabled();
    expect(counts.get('1')).toBe(1);
    await page.setViewportSize({ width: 320, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    // Review only: the shared fixture notebook must not be replaced by a backup from this test.
  } finally {
    release();
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
