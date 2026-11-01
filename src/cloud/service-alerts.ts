import { ConnectionSettings } from '../server/configuration.js';
import { siteSchema } from '../shared/contracts.js';
import { validAlertWebhook } from '../shared/service-alerts.js';
import { CloudWorkspace } from './workspace.js';
import { withWorkspace } from './filesystem.js';
import { hash, type CloudEnv, type FileRecord } from './types.js';

type AlertSource = { url: string; token?: string; issues: string[] };
type AlertRow = {
  enabled: number;
  endpoint_hash: string;
  sent: string;
  pending: string | null;
  pending_id: string | null;
  attempts: number;
  next_check: number;
  lease: string | null;
  last_status: number | null;
  last_attempt: number | null;
};
type AlertEvent = {
  version: 1;
  id: string;
  kind: 'issue' | 'recovery';
  occurredAt: string;
  issues: string[];
};
const interval = 5 * 60000;

async function boundedStatus(response: Response) {
  if (Number(response.headers.get('Content-Length') || 0) > 65536 || !response.body)
    throw new Error('Invalid service status');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let text = '',
    size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) throw new Error('Invalid service status');
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as {
      siteId?: string;
      siteOrigin?: string;
      enabled?: boolean;
      paused?: boolean;
    };
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Load only the two files required by the monitor, rather than the author's notebook. */
async function source(env: CloudEnv): Promise<AlertSource> {
  const ws = new CloudWorkspace(env);
  const files = await env.DB.prepare(
    "SELECT path,sha,bytes,modified,text,encrypted FROM cloud_files WHERE path IN ('content/site.json','.studio/connections.json')",
  ).all<FileRecord>();
  for (const file of files.results) ws.files.set(file.path, file);
  return withWorkspace(ws, async () => {
    const site = siteSchema.parse(
      JSON.parse(new TextDecoder().decode(await ws.read('content/site.json'))),
    );
    const environment = Object.fromEntries(
      Object.entries(env).filter(([, value]) => typeof value === 'string'),
    ) as NodeJS.ProcessEnv;
    const credentials = await new ConnectionSettings('/workspace', environment).values();
    const issues: string[] = [];
    const storage = await env.DB.prepare(
      'SELECT bytes,budget FROM cloud_storage WHERE id=1',
    ).first<{ bytes: number; budget: number }>();
    if (storage && storage.budget > 0 && storage.bytes / storage.budget >= 0.85)
      issues.push('storage-near-budget');
    const latest = await env.DB.prepare(
      "SELECT state FROM cloud_jobs WHERE kind='publish' AND state IN ('failed','succeeded') ORDER BY updated DESC LIMIT 1",
    ).first<{ state: string }>();
    if (latest?.state === 'failed') issues.push('latest-publication-failed');
    if (site.integrations.aca.enabled) {
      try {
        if (!credentials.ACA_REPORT_TOKEN) throw new Error('Unavailable');
        const response = await fetch(new URL('/v1/status', site.integrations.aca.endpoint), {
          headers: { Authorization: 'Bearer ' + credentials.ACA_REPORT_TOKEN },
          redirect: 'manual',
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error('Unavailable');
        const data = await boundedStatus(response);
        if (
          data.siteId !== site.integrations.aca.siteId ||
          data.siteOrigin !== new URL(site.url).origin
        )
          throw new Error('Unavailable');
        if (!data.enabled || data.paused) issues.push('aca-paused');
      } catch {
        issues.push('aca-unavailable');
      }
    }
    return {
      url: credentials.GLASS_ALERT_WEBHOOK_URL || '',
      token: credentials.GLASS_ALERT_WEBHOOK_TOKEN,
      issues,
    };
  });
}

/** A persisted lease and idempotency key bound retries without exposing destination credentials. */
export async function runServiceAlerts(
  env: CloudEnv,
  options: { now?: number; source?: () => Promise<AlertSource>; fetcher?: typeof fetch } = {},
) {
  if (env.PREVIEW === 'true') return;
  const now = options.now ?? Date.now(),
    lease = crypto.randomUUID();
  const row = await env.DB.prepare(
    'UPDATE cloud_service_alerts SET lease=?,lease_until=? WHERE id=1 AND enabled=1 AND next_check<=? AND lease_until<? RETURNING *',
  )
    .bind(lease, now + 30000, now, now)
    .first<AlertRow>();
  if (!row) return;
  try {
    const config = await (options.source || (() => source(env)))();
    if (!config.url) {
      await env.DB.prepare(
        'UPDATE cloud_service_alerts SET enabled=0,pending=NULL,lease=NULL,lease_until=0 WHERE id=1 AND lease=?',
      )
        .bind(lease)
        .run();
      return;
    }
    if (!validAlertWebhook(config.url)) throw new Error('Invalid alert destination');
    const endpoint = await hash(config.url + '\n' + (config.token || ''));
    let previous = JSON.parse(row.sent) as string[];
    let pending = row.pending ? (JSON.parse(row.pending) as AlertEvent) : null;
    let attempts = row.attempts;
    if (row.endpoint_hash !== endpoint) {
      previous = [];
      pending = null;
      attempts = 0;
    }
    const issues = [...new Set(config.issues)].sort();
    if (!pending && JSON.stringify(previous) !== JSON.stringify(issues)) {
      pending = {
        version: 1,
        id: crypto.randomUUID(),
        kind: issues.length ? 'issue' : 'recovery',
        occurredAt: new Date(now).toISOString(),
        issues,
      };
      // Persist before transmission so a crash retries with the same idempotency key.
      await env.DB.prepare(
        'UPDATE cloud_service_alerts SET endpoint_hash=?,sent=?,pending=?,pending_id=?,attempts=0 WHERE id=1 AND lease=?',
      )
        .bind(endpoint, JSON.stringify(previous), JSON.stringify(pending), pending.id, lease)
        .run();
    }
    if (!pending) {
      await env.DB.prepare(
        'UPDATE cloud_service_alerts SET endpoint_hash=?,sent=?,pending=NULL,pending_id=NULL,attempts=0,next_check=?,lease=NULL,lease_until=0 WHERE id=1 AND lease=?',
      )
        .bind(endpoint, JSON.stringify(previous), now + interval, lease)
        .run();
      return;
    }
    let status = 0;
    try {
      const response = await (options.fetcher || fetch)(config.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': pending.id,
          ...(config.token ? { Authorization: 'Bearer ' + config.token } : {}),
        },
        body: JSON.stringify(pending),
      });
      status = response.status;
      await response.body?.cancel().catch(() => {});
      if (!response.ok) throw new Error('Delivery failed');
      await env.DB.prepare(
        'UPDATE cloud_service_alerts SET sent=?,pending=NULL,pending_id=NULL,attempts=0,next_check=?,lease=NULL,lease_until=0,last_status=?,last_attempt=? WHERE id=1 AND lease=?',
      )
        .bind(JSON.stringify(pending.issues), now + interval, status, now, lease)
        .run();
    } catch {
      attempts = Math.min(attempts + 1, 20);
      const delay = Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6));
      await env.DB.prepare(
        'UPDATE cloud_service_alerts SET attempts=?,next_check=?,lease=NULL,lease_until=0,last_status=?,last_attempt=? WHERE id=1 AND lease=?',
      )
        .bind(attempts, now + delay, status, now, lease)
        .run();
    }
  } catch {
    // Provider errors and destinations can contain secrets. Persist only a generic failure.
    await env.DB.prepare(
      'UPDATE cloud_service_alerts SET next_check=?,lease=NULL,lease_until=0,last_status=0,last_attempt=? WHERE id=1 AND lease=?',
    )
      .bind(now + interval, now, lease)
      .run();
  }
}
