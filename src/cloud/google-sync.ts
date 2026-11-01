import { GoogleSearchConsole } from '../server/google-search-console.js';
import { siteSchema } from '../shared/contracts.js';
import { withWorkspace } from './filesystem.js';
import { CloudWorkspace } from './workspace.js';
import type { CloudEnv } from './types.js';

/** Refresh only an opted-in connection, using a persisted lease and a private workspace snapshot. */
export async function runGoogleSync(
  env: CloudEnv,
  options: { now?: number; fetcher?: typeof fetch } = {},
) {
  if (env.PREVIEW === 'true') return;
  const now = options.now ?? Date.now(),
    lease = crypto.randomUUID();
  const claim = await env.DB.prepare(
    'UPDATE cloud_search_sync SET lease=?,lease_until=?,last_attempt=? WHERE id=1 AND enabled=1 AND next_due<=? AND lease_until<? RETURNING id',
  )
    .bind(lease, now + 90000, now, now, now)
    .first();
  if (!claim) return;
  try {
    const ws = await new CloudWorkspace(env).load('search-console');
    await withWorkspace(ws, async () => {
      const site = siteSchema.parse(
        JSON.parse(new TextDecoder().decode(await ws.read('content/site.json'))),
      );
      const google = new GoogleSearchConsole('/workspace', options.fetcher || fetch);
      const status = await google.status();
      if (!status.connected || !status.autoSync || !status.property) {
        ws.complete(
          'UPDATE cloud_search_sync SET enabled=0,lease=NULL,lease_until=0,last_error=NULL WHERE id=1 AND lease=?',
          lease,
        );
      } else {
        await google.sync(new URL(site.url).origin, now);
        ws.complete(
          'UPDATE cloud_search_sync SET next_due=?,lease=NULL,lease_until=0,last_error=NULL WHERE id=1 AND lease=? AND enabled=1',
          now + 86400000,
          lease,
        );
      }
      await ws.commit('search-console-auto-sync');
    });
  } catch {
    // Store only a generic failure; provider responses and credentials never enter logs.
    await env.DB.prepare(
      'UPDATE cloud_search_sync SET next_due=?,lease=NULL,lease_until=0,last_error=? WHERE id=1 AND lease=?',
    )
      .bind(now + 3600000, 'sync-failed', lease)
      .run();
  }
}
