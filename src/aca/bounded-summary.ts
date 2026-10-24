import type { D1Database } from './db.js';
import type { ViewRow } from './aggregate.js';
import { empty, accumulate, type Accumulator } from './summary-values.js';
import { advanceSegments, type SegmentState } from './segment-summary.js';

type State = {
  phase: 'views' | 'events' | 'vitals' | 'segments' | 'commit';
  segments?: SegmentState;
  segmentsDone?: boolean;
  vitalCursor?: [string, string, string, number];
  after?: [string, string];
  group?: [string, string];
  cursor?: string;
  eventCursor?: [string, string, string, string, string, number];
  accumulator?: Accumulator;
};
/** One leased, retry-safe work unit. At most 32 views or 12 event groups, under 12 queries. */
export async function advanceSummary(db: D1Database, site: string, day: string, now = Date.now()) {
  await db
    .prepare(
      'INSERT OR IGNORE INTO summary_jobs(site,day,version,state) VALUES(?,?,MAX(?,COALESCE((SELECT refreshed_at+1 FROM summaries WHERE site=? AND day=?),0)),?)',
    )
    .bind(site, day, now, site, day, JSON.stringify({ phase: 'views' }))
    .run();
  const lease = crypto.randomUUID();
  const acquired = await db
    .prepare(
      'UPDATE summary_jobs SET lease_until=?,lease_token=? WHERE site=? AND day=? AND lease_until<=?',
    )
    .bind(now + 30000, lease, site, day, now)
    .run();
  if (!acquired.meta.changes) return false;
  try {
    const job = await db
      .prepare('SELECT version,state FROM summary_jobs WHERE site=? AND day=? AND lease_token=?')
      .bind(site, day, lease)
      .first<{ version: number; state: string }>();
    if (!job) return false;
    const state = JSON.parse(job.state) as State,
      version = job.version;
    if (state.phase === 'views') {
      if (!state.group) {
        const next = await db
          .prepare(
            'SELECT content,revision FROM views WHERE site=? AND day=? AND (?=0 OR (content,revision)>(?,?)) GROUP BY content,revision ORDER BY content,revision LIMIT 1',
          )
          .bind(site, day, Number(Boolean(state.after)), ...(state.after || ['', '']))
          .first<{ content: string; revision: string }>();
        if (!next) state.phase = 'events';
        else {
          state.group = [next.content, next.revision];
          state.cursor = '';
          state.accumulator = empty();
        }
      }
      if (state.group) {
        const [content, revision] = state.group;
        const { results } = await db
          .prepare(
            'SELECT * FROM views WHERE site=? AND day=? AND content=? AND revision=? AND id>? ORDER BY id LIMIT 32',
          )
          .bind(site, day, content, revision, state.cursor || '')
          .all<ViewRow>();
        accumulate(state.accumulator!, results);
        if (results.length === 32) state.cursor = results.at(-1)!.id;
        else {
          const a = state.accumulator!;
          await db
            .prepare(
              'INSERT INTO daily(site,day,content,revision,views,active,qualified,completed,optin,unique_browsers,impressions,clicks,retention,sources,interactions,hll,refreshed_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,?,?, ?,?) ON CONFLICT(site,day,content,revision,refreshed_at) DO UPDATE SET views=excluded.views,active=excluded.active,qualified=excluded.qualified,completed=excluded.completed,optin=excluded.optin,unique_browsers=excluded.unique_browsers,retention=excluded.retention,sources=excluded.sources,hll=excluded.hll',
            )
            .bind(
              site,
              day,
              content,
              revision,
              a.views,
              a.active,
              a.qualified,
              a.completed,
              a.optin,
              a.visitors.length,
              JSON.stringify(a.retention),
              JSON.stringify(a.sources),
              '{}',
              JSON.stringify(a.hll),
              version,
            )
            .run();
          await db
            .prepare(
              "INSERT INTO daily_sections(site,day,content,revision,section,active,views,refreshed_at) SELECT ?,?,?,?,key,json_extract(value,'$.active'),json_extract(value,'$.views'),? FROM json_each(?) WHERE 1 ON CONFLICT(site,day,content,revision,section,refreshed_at) DO UPDATE SET active=excluded.active,views=excluded.views",
            )
            .bind(site, day, content, revision, version, JSON.stringify(a.sections))
            .run();
          const audienceRows = Object.entries(a.audience || {}).map(([key, counts]) => {
            const [dimension, value] = JSON.parse(key) as [string, string];
            return { dimension, value, ...counts };
          });
          await db
            .prepare(
              "INSERT INTO daily_audience(site,day,content,revision,dimension,value,views,qualified,active,refreshed_at) SELECT ?,?,?,?,json_extract(value,'$.dimension'),json_extract(value,'$.value'),json_extract(value,'$.views'),json_extract(value,'$.qualified'),json_extract(value,'$.active'),? FROM json_each(?) WHERE 1 ON CONFLICT(site,day,content,revision,dimension,value,refreshed_at) DO UPDATE SET views=excluded.views,qualified=excluded.qualified,active=excluded.active",
            )
            .bind(site, day, content, revision, version, JSON.stringify(audienceRows))
            .run();
          state.after = state.group;
          delete state.group;
          delete state.cursor;
          delete state.accumulator;
        }
      }
    } else if (state.phase === 'events') {
      const { results } = await db
        .prepare(
          'SELECT content,revision,action,target,surface,rank,COUNT(*) AS count,SUM(value) AS total FROM events WHERE site=? AND day=? AND (?=0 OR (content,revision,action,target,surface,rank)>(?,?,?,?,?,?)) GROUP BY content,revision,action,target,surface,rank ORDER BY content,revision,action,target,surface,rank LIMIT 12',
        )
        .bind(
          site,
          day,
          Number(Boolean(state.eventCursor)),
          ...(state.eventCursor || ['', '', '', '', '', 0]),
        )
        .all<{
          content: string;
          revision: string;
          action: string;
          target: string;
          surface: string;
          rank: number;
          count: number;
          total: number;
        }>();
      if (results.length) {
        await db
          .prepare(
            "INSERT INTO daily_events(site,day,content,revision,action,target,surface,rank,count,total,refreshed_at) SELECT ?,?,json_extract(value,'$.content'),json_extract(value,'$.revision'),json_extract(value,'$.action'),json_extract(value,'$.target'),json_extract(value,'$.surface'),json_extract(value,'$.rank'),json_extract(value,'$.count'),json_extract(value,'$.total'),? FROM json_each(?) WHERE 1 ON CONFLICT(site,day,content,revision,action,target,surface,rank,refreshed_at) DO UPDATE SET count=excluded.count,total=excluded.total",
          )
          .bind(site, day, version, JSON.stringify(results))
          .run();
        const last = results.at(-1)!;
        state.eventCursor = [
          last.content,
          last.revision,
          last.action,
          last.target,
          last.surface,
          last.rank,
        ];
      }
      if (results.length < 12) state.phase = 'vitals';
    } else if (state.phase === 'vitals') {
      const { results } = await db
        .prepare(
          "SELECT content,revision,target,bucket,COUNT(*) AS count FROM events WHERE site=? AND day=? AND action='vital' AND bucket>=0 AND (?=0 OR (content,revision,target,bucket)>(?,?,?,?)) GROUP BY content,revision,target,bucket ORDER BY content,revision,target,bucket LIMIT 12",
        )
        .bind(
          site,
          day,
          Number(Boolean(state.vitalCursor)),
          ...(state.vitalCursor || ['', '', '', -1]),
        )
        .all<{
          content: string;
          revision: string;
          target: string;
          bucket: number;
          count: number;
        }>();
      if (results.length) {
        await db
          .prepare(
            "INSERT INTO daily_vitals(site,day,content,revision,target,bucket,count,refreshed_at) SELECT ?,?,json_extract(value,'$.content'),json_extract(value,'$.revision'),json_extract(value,'$.target'),json_extract(value,'$.bucket'),json_extract(value,'$.count'),? FROM json_each(?) WHERE 1 ON CONFLICT(site,day,content,revision,target,bucket,refreshed_at) DO UPDATE SET count=excluded.count",
          )
          .bind(site, day, version, JSON.stringify(results))
          .run();
        const last = results.at(-1)!;
        state.vitalCursor = [last.content, last.revision, last.target, last.bucket];
      }
      if (results.length < 12) state.phase = 'segments';
    } else if (state.phase === 'segments' || !state.segmentsDone) {
      state.phase = 'segments';
      state.segments ||= {};
      if (await advanceSegments(db, site, day, version, state.segments)) {
        state.segmentsDone = true;
        state.phase = 'commit';
        delete state.segments;
      }
    } else {
      await db
        .prepare(
          "UPDATE daily SET impressions=COALESCE((SELECT SUM(count) FROM daily_events e WHERE e.site=daily.site AND e.day=daily.day AND e.content=daily.content AND e.revision=daily.revision AND e.refreshed_at=daily.refreshed_at AND e.action='impression'),0),clicks=COALESCE((SELECT SUM(count) FROM daily_events e WHERE e.site=daily.site AND e.day=daily.day AND e.content=daily.content AND e.revision=daily.revision AND e.refreshed_at=daily.refreshed_at AND e.action='click'),0) WHERE site=? AND day=? AND refreshed_at=?",
        )
        .bind(site, day, version)
        .run();
      // Publish only a complete generation; failures retain the preceding report.
      await db
        .prepare(
          'INSERT INTO summaries(site,day,refreshed_at) VALUES(?,?,?) ON CONFLICT(site,day) DO UPDATE SET refreshed_at=MAX(summaries.refreshed_at,excluded.refreshed_at)',
        )
        .bind(site, day, version)
        .run();
      await db.batch([
        ...[
          'daily',
          'daily_events',
          'daily_sections',
          'daily_audience',
          'daily_vitals',
          'segment_daily',
          'segment_events',
          'segment_coverage',
        ].map((table) =>
          db
            .prepare(
              'DELETE FROM ' +
                table +
                ' WHERE site=? AND day=? AND refreshed_at<(SELECT refreshed_at FROM summaries WHERE site=? AND day=?)',
            )
            .bind(site, day, site, day),
        ),
        db
          .prepare('DELETE FROM segment_event_jobs WHERE site=? AND day=? AND refreshed_at<=?')
          .bind(site, day, version),
        db
          .prepare('DELETE FROM dirty_days WHERE site=? AND day=? AND updated_at<?')
          .bind(site, day, version),
        db
          .prepare('DELETE FROM summary_jobs WHERE site=? AND day=? AND lease_token=?')
          .bind(site, day, lease),
      ]);
      return true;
    }
    await db
      .prepare('UPDATE summary_jobs SET state=? WHERE site=? AND day=? AND lease_token=?')
      .bind(JSON.stringify(state), site, day, lease)
      .run();
    return false;
  } finally {
    await db
      .prepare('UPDATE summary_jobs SET lease_until=0 WHERE site=? AND day=? AND lease_token=?')
      .bind(site, day, lease)
      .run();
  }
}

/** A cron invocation performs one work unit and bounded retention cleanup, never a full rebuild. */
export async function advanceMaintenance(db: D1Database, site: string, now = Date.now()) {
  await db
    .prepare(
      'INSERT INTO maintenance_status(site,last_started) VALUES(?,?) ON CONFLICT(site) DO UPDATE SET last_started=excluded.last_started',
    )
    .bind(site, now)
    .run();
  // Identifier expiry takes priority over optional summary refreshes.
  await db
    .prepare(
      'DELETE FROM daily_network_keys WHERE rowid IN (SELECT rowid FROM daily_network_keys WHERE site=? AND expires<=? LIMIT 200)',
    )
    .bind(site, now)
    .run();
  // Recover missing joint generations after a compatible older Worker has run. Never
  // rebuild a partially expired day, or replace a queued live refresh with backfill.
  await db
    .prepare(
      `INSERT OR IGNORE INTO dirty_days(site,day,updated_at) SELECT s.site,s.day,? FROM summaries s WHERE s.site=? AND s.day>=? AND NOT EXISTS(SELECT 1 FROM dirty_days q WHERE q.site=s.site) AND NOT EXISTS(SELECT 1 FROM segment_coverage c WHERE c.site=s.site AND c.day=s.day AND c.refreshed_at=s.refreshed_at) AND EXISTS(SELECT 1 FROM views v WHERE v.site=s.site AND v.day=s.day) AND (SELECT COUNT(*) FROM views v WHERE v.site=s.site AND v.day=s.day)>=COALESCE((SELECT SUM(d.views) FROM daily d WHERE d.site=s.site AND d.day=s.day AND d.refreshed_at=s.refreshed_at),0) ORDER BY s.day LIMIT 1`,
    )
    .bind(now, site, new Date(now - 90 * 86400000).toISOString().slice(0, 10))
    .run();
  const day = await db
    .prepare('SELECT day FROM dirty_days WHERE site=? ORDER BY day LIMIT 1')
    .bind(site)
    .first<{ day: string }>();
  if (day) await advanceSummary(db, site, day.day, now);
  const rawCutoff = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
  const cutoff = new Date(now - 730 * 86400000).toISOString().slice(0, 10);
  const safe =
    'day<? AND EXISTS(SELECT 1 FROM summaries s WHERE s.site=views.site AND s.day=views.day AND s.refreshed_at>=views.updated_at) AND NOT EXISTS(SELECT 1 FROM dirty_days d WHERE d.site=views.site AND d.day=views.day)';
  await db.batch([
    db
      .prepare(
        'DELETE FROM events WHERE rowid IN (SELECT e.rowid FROM events e JOIN views ON e.site=views.site AND e.view_id=views.id WHERE views.site=? AND views.' +
          safe +
          ' LIMIT 200)',
      )
      .bind(site, rawCutoff),
    db
      .prepare(
        'DELETE FROM views WHERE rowid IN (SELECT rowid FROM views WHERE site=? AND ' +
          safe +
          ' AND NOT EXISTS(SELECT 1 FROM events e WHERE e.site=views.site AND e.view_id=views.id) LIMIT 100)',
      )
      .bind(site, rawCutoff),
    ...[
      'daily',
      'daily_events',
      'daily_sections',
      'daily_audience',
      'daily_vitals',
      'segment_daily',
      'segment_events',
      'segment_coverage',
      'segment_event_jobs',
      'summaries',
      'daily_network_totals',
    ].map((table) =>
      db
        .prepare(
          'DELETE FROM ' +
            table +
            ' WHERE rowid IN (SELECT rowid FROM ' +
            table +
            ' WHERE site=? AND day<? LIMIT 200)',
        )
        .bind(site, cutoff),
    ),
    db.prepare('DELETE FROM database_usage WHERE site=? AND day<?').bind(site, rawCutoff),
    db.prepare('DELETE FROM health WHERE site=? AND day<?').bind(site, rawCutoff),
    db.prepare('DELETE FROM revoked WHERE site=? AND expires<?').bind(site, now),
    db
      .prepare('DELETE FROM visitors WHERE site=? AND last_day<?')
      .bind(site, new Date(now - 366 * 86400000).toISOString().slice(0, 10)),
  ]);
  await db
    .prepare('UPDATE maintenance_status SET last_succeeded=? WHERE site=?')
    .bind(now, site)
    .run();
}
