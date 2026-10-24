import { z } from 'zod';
import { audienceMetadata } from './audience.js';
import { vitalBucket } from '../shared/audience.js';
z.config({ jitless: true });
import { acaBatchSchema, acaReports, type AcaReportName } from '../shared/aca.js';
import type { D1Database } from './db.js';
import { analyticsReport, reportRange } from './reports.js';
import { segmentOptions } from './segment-reports.js';
import { advanceMaintenance } from './bounded-summary.js';
import { dailyNetworkHash, networkStatements } from './networks.js';
import { meterDatabase } from './usage.js';
export type AcaEnvironment = {
  DB: D1Database;
  ENABLED: string;
  SITE_ID: string;
  SITE_ORIGIN: string;
  REPORT_TOKEN: string;
  IDENTITY_SECRET: string;
  MAX_DAILY_BATCHES?: string;
  NETWORK_SECRET?: string;
  DAILY_NETWORKS?: string;
  IDENTITY_MODE?: string;
  AUDIENCE_DETAILS?: string;
  DEPLOYMENT_ID?: string;
  DAILY_READ_BUDGET?: string;
  DAILY_WRITE_BUDGET?: string;
  INGEST_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
async function limitedJson(request: Request) {
  if (!request.body || Number(request.headers.get('Content-Length') || 0) > 32768)
    throw new Error('Request too large.');
  const reader = request.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 32768) {
      await reader.cancel();
      throw new Error('Request too large.');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function identityHash(value: string, secret: string) {
  if (!secret || secret.length < 32) throw new Error('Identity secret is not configured.');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const result = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function authenticated(request: Request, token: string) {
  if (!token || token.length < 32) return false;
  const presented = request.headers.get('Authorization') || '';
  const [a, b] = await Promise.all(
    [presented, `Bearer ${token}`].map((value) =>
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  );
  const left = new Uint8Array(a),
    right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
async function databaseUsage(env: AcaEnvironment, day: string) {
  return await env.DB.prepare(
    'SELECT rows_read,rows_written FROM database_usage WHERE site=? AND day=?',
  )
    .bind(env.SITE_ID, day)
    .first<{ rows_read: number; rows_written: number }>();
}
function exhausted(env: AcaEnvironment, value: { rows_read: number; rows_written: number } | null) {
  return Boolean(
    value &&
    (value.rows_read >= (Number(env.DAILY_READ_BUDGET) || 2000000) ||
      value.rows_written >= (Number(env.DAILY_WRITE_BUDGET) || 60000)),
  );
}
const batchLimit = (env: AcaEnvironment) =>
  Math.max(1, Math.min(100000, Number(env.MAX_DAILY_BATCHES) || 1000));
async function dailyLimitReached(env: AcaEnvironment, day: string) {
  const usage = await env.DB.prepare('SELECT accepted FROM health WHERE site=? AND day=?')
    .bind(env.SITE_ID, day)
    .first<{ accepted: number }>();
  return (usage?.accepted || 0) >= batchLimit(env);
}
const dailyNetworksEnabled = (env: AcaEnvironment) =>
  env.DAILY_NETWORKS === 'true' && (env.NETWORK_SECRET?.length || 0) >= 32;
async function handleRequest(request: Request, env: AcaEnvironment): Promise<Response> {
  const url = new URL(request.url),
    now = Date.now(),
    day = new Date(now).toISOString().slice(0, 10);
  const publicPath = ['/v1/events', '/v1/forget'].includes(url.pathname);
  const origin = request.headers.get('Origin'),
    allowed = origin === env.SITE_ORIGIN;
  const finish = (response: Response) => {
    if (publicPath && allowed) {
      response.headers.set('Access-Control-Allow-Origin', env.SITE_ORIGIN);
      response.headers.set('Vary', 'Origin');
    }
    return response;
  };
  if (request.method === 'OPTIONS' && publicPath)
    return finish(
      new Response(null, {
        status: allowed ? 204 : 403,
        headers: {
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
        },
      }),
    );
  if (url.pathname === '/v1/status' || url.pathname === '/v1/maintenance') {
    if (!(await authenticated(request, env.REPORT_TOKEN)))
      return json({ error: 'Unauthorized.' }, 401);
    const current = await databaseUsage(env, day);
    if (url.pathname === '/v1/maintenance') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      if (exhausted(env, current))
        return json({ error: 'Free-tier processing budget reached.' }, 429);
      await advanceMaintenance(env.DB, env.SITE_ID);
    } else if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
    const pending = await env.DB.prepare('SELECT COUNT(*) AS count FROM dirty_days WHERE site=?')
      .bind(env.SITE_ID)
      .first<{ count: number }>();
    return json({
      protocol: 3,
      capabilities: ['audience-v2', 'geography', 'visits', 'vital-percentiles', 'segmentation-v1'],
      historyMode: env.IDENTITY_MODE === 'optional-consent' ? 'optional-consent' : 'anonymous',
      siteId: env.SITE_ID,
      siteOrigin: env.SITE_ORIGIN,
      deploymentId: env.DEPLOYMENT_ID || '',
      enabled: env.ENABLED === 'true',
      paused: exhausted(env, current) || (await dailyLimitReached(env, day)),
      networkMode: dailyNetworksEnabled(env) ? 'daily' : 'off',
      pendingDays: pending?.count || 0,
      maintenance: await env.DB.prepare(
        'SELECT last_started,last_succeeded FROM maintenance_status WHERE site=?',
      )
        .bind(env.SITE_ID)
        .first(),
      oldestPending:
        (
          await env.DB.prepare('SELECT MIN(updated_at) AS value FROM dirty_days WHERE site=?')
            .bind(env.SITE_ID)
            .first<{ value: number }>()
        )?.value ?? null,
      usage: current || { rows_read: 0, rows_written: 0 },
      limits: {
        reads: Number(env.DAILY_READ_BUDGET) || 2000000,
        writes: Number(env.DAILY_WRITE_BUDGET) || 60000,
        batches: batchLimit(env),
      },
    });
  }
  if (url.pathname === '/v1/segment-options') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
    if (!(await authenticated(request, env.REPORT_TOKEN)))
      return json({ error: 'Unauthorized.' }, 401);
    if (exhausted(env, await databaseUsage(env, day)))
      return json({ error: 'Free-tier report budget reached. Retry after UTC midnight.' }, 429);
    try {
      return json(await segmentOptions(env.DB, env.SITE_ID, reportRange(url, now)));
    } catch (error) {
      return json({ error: (error as Error).message }, 400);
    }
  }
  if (url.pathname.startsWith('/v1/reports/')) {
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
    if (!(await authenticated(request, env.REPORT_TOKEN)))
      return json({ error: 'Unauthorized.' }, 401);
    const name = url.pathname.slice('/v1/reports/'.length) as AcaReportName;
    if (!acaReports.includes(name)) return json({ error: 'Unknown report.' }, 404);
    try {
      const current = await databaseUsage(env, day);
      if (exhausted(env, current))
        return json({ error: 'Free-tier report budget reached. Retry after UTC midnight.' }, 429);
      const report = await analyticsReport(
        env.DB,
        env.SITE_ID,
        name,
        url,
        now,
        dailyNetworksEnabled(env),
        env.IDENTITY_MODE === 'optional-consent',
      );
      report.collection = {
        enabled: env.ENABLED === 'true',
        paused: await dailyLimitReached(env, day),
      };
      return json(report);
    } catch (error) {
      return json({ error: (error as Error).message }, 400);
    }
  }
  if (!publicPath) return json({ error: 'Not found.' }, 404);
  if (!allowed) return json({ error: 'Origin not allowed.' }, 403);
  if (
    url.pathname === '/v1/events' &&
    (request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1')
  )
    return finish(new Response(null, { status: 204 }));
  if (request.method !== 'POST') return finish(json({ error: 'Method not allowed.' }, 405));
  if (env.INGEST_LIMITER && !(await env.INGEST_LIMITER.limit({ key: env.SITE_ID })).success)
    return finish(json({ error: 'Collection is temporarily rate limited.' }, 429));
  if (env.ENABLED !== 'true' && url.pathname !== '/v1/forget')
    return finish(json({ error: 'Collection is disabled.' }, 503));
  if (url.pathname !== '/v1/forget' && exhausted(env, await databaseUsage(env, day)))
    return finish(json({ error: 'Free-tier collection budget reached.' }, 429));
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    return finish(json({ error: 'Use application/json.' }, 415));
  try {
    const payload = await limitedJson(request);
    if (url.pathname === '/v1/forget') {
      if (
        Object.keys(payload).some((key) => !['site', 'visitor'].includes(key)) ||
        payload.site !== env.SITE_ID ||
        !/^[a-f\d-]{36}$/i.test(payload.visitor)
      )
        throw new Error('Invalid forgetting request.');
      const hash = await identityHash(payload.visitor, env.IDENTITY_SECRET);
      // Anonymous aggregates contain no reversible identity; retained linkable records are removed.
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO revoked(site,id,expires) VALUES(?,?,?) ON CONFLICT(site,id) DO UPDATE SET expires=excluded.expires',
        ).bind(env.SITE_ID, hash, now + 366 * 86400000),
        env.DB.prepare(
          'DELETE FROM events WHERE site=? AND view_id IN (SELECT id FROM views WHERE site=? AND visitor=?)',
        ).bind(env.SITE_ID, env.SITE_ID, hash),
        env.DB.prepare('DELETE FROM views WHERE site=? AND visitor=?').bind(env.SITE_ID, hash),
        env.DB.prepare('DELETE FROM visitors WHERE site=? AND id=?').bind(env.SITE_ID, hash),
      ]);
      return finish(
        json({
          ok: true,
          scope:
            'Retained identity and raw observations removed. Irreversible anonymous summaries remain.',
        }),
      );
    }
    const batch = acaBatchSchema.parse(payload);
    if (batch.site !== env.SITE_ID) return finish(json({ error: 'Unknown site.' }, 403));
    if (await dailyLimitReached(env, day))
      return finish(json({ error: 'Collection daily limit reached.' }, 429));
    const previous = await env.DB.prepare(
      'SELECT seq,content,revision,day,first_at,active,visitor FROM views WHERE site=? AND id=?',
    )
      .bind(env.SITE_ID, batch.view)
      .first<{
        seq: number;
        content: string;
        revision: string;
        day: string;
        first_at: number;
        active: number;
        visitor: string | null;
      }>();
    if (previous && (previous.content !== batch.content || previous.revision !== batch.revision))
      throw new Error('A page-view identity cannot change content.');
    if (previous && (batch.sequence <= previous.seq || previous.first_at < now - 86400000))
      return finish(json({ ok: true, duplicate: true }));
    const visitor =
      ['legacy-opt-in', 'optional-consent'].includes(env.IDENTITY_MODE || '') && batch.visitor
        ? await identityHash(batch.visitor, env.IDENTITY_SECRET)
        : null;
    if (
      visitor &&
      (await env.DB.prepare('SELECT id FROM revoked WHERE site=? AND id=? AND expires>?')
        .bind(env.SITE_ID, visitor, now)
        .first())
    )
      return finish(json({ error: 'Identity was withdrawn.' }, 403));
    if (
      previous &&
      (previous.visitor !== visitor || batch.active > now - previous.first_at + 10000)
    )
      throw new Error('Invalid cumulative page-view state.');
    const firstAt = previous?.first_at || now - Math.min(30000, batch.active);
    const recordDay = previous?.day || day;
    const statements = [
      env.DB.prepare(
        `INSERT INTO views(site,id,day,content,revision,route,seq,active,depth,buckets,sections,end_seen,ended,consent,visitor,source,campaign,device,language,first_at,updated_at,audience) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (? IS NULL OR NOT EXISTS(SELECT 1 FROM revoked WHERE site=? AND id=? AND expires>?)) ON CONFLICT(site,id) DO UPDATE SET seq=excluded.seq,active=MAX(views.active,excluded.active),depth=MAX(views.depth,excluded.depth),buckets=excluded.buckets,sections=excluded.sections,end_seen=MAX(views.end_seen,excluded.end_seen),ended=MAX(views.ended,excluded.ended),updated_at=excluded.updated_at WHERE excluded.seq>views.seq`,
      ).bind(
        env.SITE_ID,
        batch.view,
        recordDay,
        batch.content,
        batch.revision,
        batch.route,
        batch.sequence,
        batch.active,
        batch.depth,
        JSON.stringify(batch.buckets),
        JSON.stringify(batch.sections),
        Number(batch.end),
        Number(batch.ended),
        visitor ? 'opt-in' : 'anonymous',
        visitor,
        batch.source,
        batch.campaign,
        batch.device,
        batch.language,
        firstAt,
        now,
        env.AUDIENCE_DETAILS === 'false'
          ? '{}'
          : JSON.stringify(audienceMetadata(request, batch.audience)),
        visitor,
        env.SITE_ID,
        visitor,
        now,
      ),
    ];
    const eventCount = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM events WHERE site=? AND view_id=?',
    )
      .bind(env.SITE_ID, batch.view)
      .first<{ total: number }>();
    if ((eventCount?.total || 0) + batch.events.length > 500)
      throw new Error('Page interaction limit reached.');
    for (const event of batch.events)
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO events(site,id,view_id,day,content,revision,action,target,surface,rank,value,bucket) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM views WHERE site=? AND id=? AND seq=?)`,
        ).bind(
          env.SITE_ID,
          event.id,
          batch.view,
          recordDay,
          batch.content,
          batch.revision,
          event.action,
          event.target,
          event.surface,
          event.rank,
          event.value,
          event.action === 'vital' ? vitalBucket(event.value) : 0,
          env.SITE_ID,
          batch.view,
          batch.sequence,
        ),
      );
    if (visitor) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO visitors(site,id,first_day,last_day,days) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM views WHERE site=? AND id=? AND visitor=?) AND NOT EXISTS(SELECT 1 FROM revoked WHERE site=? AND id=? AND expires>?) ON CONFLICT(site,id) DO UPDATE SET first_day=MIN(visitors.first_day,excluded.first_day),last_day=MAX(visitors.last_day,excluded.last_day),days=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(visitors.days) UNION SELECT value FROM json_each(excluded.days) ORDER BY value DESC LIMIT 366))`,
        ).bind(
          env.SITE_ID,
          visitor,
          day,
          day,
          JSON.stringify([day]),
          env.SITE_ID,
          batch.view,
          visitor,
          env.SITE_ID,
          visitor,
          now,
        ),
      );
    }
    statements.push(
      env.DB.prepare(
        'INSERT INTO health(site,day,accepted,rejected,last_at) VALUES(?,?,1,0,?) ON CONFLICT(site,day) DO UPDATE SET accepted=accepted+1,last_at=excluded.last_at',
      ).bind(env.SITE_ID, day, now),
    );
    statements.push(
      env.DB.prepare(
        'INSERT INTO dirty_days(site,day,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM views WHERE site=? AND id=? AND seq=?) ON CONFLICT(site,day) DO UPDATE SET updated_at=MAX(updated_at,excluded.updated_at)',
      ).bind(env.SITE_ID, recordDay, now, env.SITE_ID, batch.view, batch.sequence),
    );
    if (dailyNetworksEnabled(env) && batch.networkEstimate) {
      const address =
        request.headers.get('CF-Connecting-IPv6') || request.headers.get('CF-Connecting-IP') || '';
      const [siteKey, articleKey, revisionKey] = await Promise.all([
        dailyNetworkHash(address, env.SITE_ID, day, env.NETWORK_SECRET || ''),
        dailyNetworkHash(
          address,
          env.SITE_ID,
          day,
          env.NETWORK_SECRET || '',
          JSON.stringify(['article', batch.content]),
        ),
        dailyNetworkHash(
          address,
          env.SITE_ID,
          day,
          env.NETWORK_SECRET || '',
          JSON.stringify(['revision', batch.content, batch.revision]),
        ),
      ]);
      if (siteKey && articleKey && revisionKey)
        statements.push(
          ...networkStatements(
            env.DB,
            env.SITE_ID,
            day,
            batch.content,
            [siteKey, articleKey, revisionKey],
            now,
            batch.revision,
          ),
        );
    }
    await env.DB.batch(statements);
    return finish(json({ ok: true }));
  } catch {
    await env.DB.prepare(
      'INSERT INTO health(site,day,accepted,rejected,last_at) VALUES(?,?,0,1,?) ON CONFLICT(site,day) DO UPDATE SET rejected=rejected+1,last_at=excluded.last_at',
    )
      .bind(env.SITE_ID, day, now)
      .run()
      .catch(() => {});
    return finish(json({ error: 'Invalid or unavailable analytics request.' }, 400));
  }
}
export async function handleAnalytics(request: Request, env: AcaEnvironment): Promise<Response> {
  const meter = meterDatabase(env.DB);
  try {
    return await handleRequest(request, { ...env, DB: meter.db });
  } catch {
    return json({ error: 'Analytics service is unavailable. Check migrations and bindings.' }, 503);
  } finally {
    if (meter.counts().statements) await meter.flush(env.SITE_ID).catch(() => {});
  }
}
export default {
  fetch: handleAnalytics,
  async scheduled(_event: unknown, env: AcaEnvironment) {
    const meter = meterDatabase(env.DB);
    try {
      const current = await databaseUsage(
        { ...env, DB: meter.db },
        new Date().toISOString().slice(0, 10),
      );
      if (!exhausted(env, current)) await advanceMaintenance(meter.db, env.SITE_ID);
      else
        await meter.db
          .prepare(
            'DELETE FROM daily_network_keys WHERE rowid IN (SELECT rowid FROM daily_network_keys WHERE site=? AND expires<=? LIMIT 200)',
          )
          .bind(env.SITE_ID, Date.now())
          .run();
    } finally {
      await meter.flush(env.SITE_ID);
    }
  },
};
