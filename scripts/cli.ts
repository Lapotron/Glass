import path from 'node:path';
import { Store } from '../src/engine/store.js';
import { buildSite } from '../src/engine/build.js';
import { publicEntry } from '../src/shared/contracts.js';
import { JobService } from '../src/server/publishing.js';
import { Scheduler } from '../src/server/scheduler.js';
import { acquireRuntime } from '../src/server/runtime.js';
import { resolveLaunchOptions } from '../src/server/configuration.js';
const launch = await resolveLaunchOptions(process.argv.slice(2));
const store = new Store(launch.notebookRoot);
const [command, ...args] = launch.args;
try {
  if (command === 'build') {
    if(process.env.WORKERS_CI==='1'||process.env.WORKERS_CI_BUILD_UUID)throw new Error('Hosted Workers Builds must use cloud:build:site (approved cloud release) or cloud:build:studio. Git content is never an implicit hosted publication source.');
    const result = await buildSite(store, { onLog: console.log });
    console.log(`Public output: ${path.join(store.root, 'dist')}`);
    for (const diagnostic of result.diagnostics) console.log(diagnostic);
  } else if (command === 'schedule') {
    const runtime = await acquireRuntime(store.root);
    try {
      if (!runtime.release) {
        if (!runtime.owner.origin) {
          console.log('Another schedule check is already running.');
        } else {
          const origin = new URL(runtime.owner.origin);
          if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1')
            throw new Error('The notebook runtime address is invalid.');
          const response = await fetch(new URL('/api/bootstrap', origin), {
            signal: AbortSignal.timeout(5000),
          });
          const bootstrap = await response.json();
          if (!response.ok || bootstrap.workspaceId !== runtime.owner.workspace)
            throw new Error('The running Studio belongs to a different notebook.');
          const result = await fetch(new URL('/api/schedule/run', origin), {
            method: 'POST',
            headers: { Origin: origin.origin, 'X-Studio-Token': bootstrap.token },
          });
          const state = await result.json();
          if (!result.ok || state.error) throw new Error(state.error || 'Schedule check failed.');
          console.log(
            state.running
              ? 'A schedule check is already running.'
              : 'Schedule check completed in Studio.',
          );
        }
      } else {
        const jobs = new JobService(store);
        await jobs.initialize();
        const scheduler = new Scheduler(jobs);
        await scheduler.initialize();
        const state = await scheduler.runDue(true);
        if (state.error) throw new Error(state.error);
        console.log(
          state.jobId ? `Scheduled work completed: ${state.jobId}` : 'No entries are due.',
        );
      }
    } finally {
      await runtime.release?.();
    }
  } else if (command === 'new') {
    const [kind, slug, ...title] = args;
    if (!['posts', 'lab'].includes(kind) || !slug || !title.length)
      throw new Error('Usage: npm run content:new -- posts|lab my-slug A title for the entry');
    const entry = await store.create(kind as 'posts' | 'lab', title.join(' '), slug);
    console.log(JSON.stringify(publicEntry(entry), null, 2));
  } else throw new Error('Usage: npm run build | npm run content:new -- posts|lab slug Title');
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
