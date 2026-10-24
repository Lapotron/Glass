import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../engine/store.js';

type Owner = { pid: number; workspace: string; nonce: string; origin?: string };
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

// One Studio or offline scheduler owns a notebook's job journal at a time.
export async function acquireRuntime(root: string, origin?: string) {
  const workspace = digest(await fs.realpath(root)),
    folder = path.join(root, '.studio/runtime.lock'),
    reaping = path.join(root, '.studio/runtime-reaping.lock');
  await fs.mkdir(path.dirname(folder), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.mkdir(folder);
      const owner: Owner = { pid: process.pid, workspace, nonce: randomUUID(), origin };
      await fs.writeFile(path.join(folder, 'owner.json'), JSON.stringify(owner));
      return {
        owner,
        release: async () => {
          const current = JSON.parse(await fs.readFile(path.join(folder, 'owner.json'), 'utf8'));
          if (current.nonce === owner.nonce) await fs.rm(folder, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    let owner: Owner | undefined;
    const raw = await fs.readFile(path.join(folder, 'owner.json'), 'utf8').catch(() => '');
    try {
      owner = JSON.parse(raw);
    } catch {}
    if (owner && Number.isInteger(owner.pid) && owner.pid > 0 && alive(owner.pid))
      return { owner, release: null };
    // Another process may still be writing its ownership record.
    const info = await fs.stat(folder).catch(() => null);
    if (!info) continue;
    if (!owner && Date.now() - info.mtimeMs < 30000)
      throw new Error('Another notebook process is starting. Try again shortly.');
    let guard;
    try {
      guard = await fs.open(reaping, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('Another process is recovering the notebook lock. Try again shortly.', {
          cause: error,
        });
      throw error;
    }
    try {
      // Re-read under the recovery guard; another contender may have acquired it.
      const current = await fs.readFile(path.join(folder, 'owner.json'), 'utf8').catch(() => '');
      const infoNow = await fs.stat(folder).catch(() => null);
      if (infoNow?.ino === info.ino && current === raw)
        await fs.rm(folder, { recursive: true, force: true });
    } finally {
      await guard.close();
      await fs.rm(reaping, { force: true });
    }
  }
  throw new Error('The notebook is already in use. Try again shortly.');
}
