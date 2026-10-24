import type { D1Database } from './db.js';
import type { ViewRow } from './aggregate.js';
import { empty, accumulate, type Accumulator } from './summary-values.js';
export type SegmentState = {
  phase?: 'views' | 'events';
  after?: [string, string, string];
  group?: [string, string, string];
  cursor?: string;
  accumulator?: Accumulator;
  eventCursor?: [string, string, string, string, string, string, number, number];
};
/** One bounded, retry-safe work unit. Results remain invisible until the day commits. */
export async function advanceSegments(
  db: D1Database,
  site: string,
  day: string,
  version: number,
  state: SegmentState,
) {
  if (state.phase !== 'events') {
    if (!state.group) {
      const next = await db
        .prepare(
          'SELECT content,revision,segment_key FROM views WHERE site=? AND day=? AND (?=0 OR (content,revision,segment_key)>(?,?,?)) GROUP BY content,revision,segment_key ORDER BY content,revision,segment_key LIMIT 1',
        )
        .bind(site, day, Number(!!state.after), ...(state.after || ['', '', '']))
        .first<{ content: string; revision: string; segment_key: string }>();
      if (!next) {
        state.phase = 'events';
        return false;
      }
      state.group = [next.content, next.revision, next.segment_key];
      state.cursor = '';
      state.accumulator = empty();
    }
    const [content, revision, key] = state.group;
    const { results } = await db
      .prepare(
        'SELECT * FROM views WHERE site=? AND day=? AND content=? AND revision=? AND segment_key=? AND id>? ORDER BY id LIMIT 32',
      )
      .bind(site, day, content, revision, key, state.cursor || '')
      .all<ViewRow>();
    accumulate(state.accumulator!, results);
    if (results.length === 32) state.cursor = results.at(-1)!.id;
    else {
      const a = state.accumulator!;
      const dimensions = JSON.parse(key) as string[];
      a.sources = Object.fromEntries(
        [
          ['device', dimensions[1]],
          ['source', dimensions[4]],
          ['campaign', dimensions[5]],
          ['language', dimensions[6]],
        ].map(([dimension, value]) => [dimension + ':' + value, a.views]),
      );
      await db
        .prepare(
          `INSERT INTO segment_daily(site,day,content,revision,segment_key,views,active,qualified,completed,optin,unique_browsers,retention,sources,hll,audience,sections,refreshed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(site,day,content,revision,segment_key,refreshed_at) DO UPDATE SET views=excluded.views,active=excluded.active,qualified=excluded.qualified,completed=excluded.completed,optin=excluded.optin,unique_browsers=excluded.unique_browsers,retention=excluded.retention,sources=excluded.sources,hll=excluded.hll,audience=excluded.audience,sections=excluded.sections`,
        )
        .bind(
          site,
          day,
          content,
          revision,
          key,
          a.views,
          a.active,
          a.qualified,
          a.completed,
          a.optin,
          a.visitors.length,
          JSON.stringify(a.retention),
          JSON.stringify(a.sources),
          JSON.stringify(a.optin ? a.hll : []),
          JSON.stringify(a.audience),
          JSON.stringify(a.sections),
          version,
        )
        .run();
      state.after = state.group;
      delete state.group;
      delete state.accumulator;
      delete state.cursor;
    }
    return false;
  }
  await db
    .prepare('INSERT OR IGNORE INTO segment_event_jobs(site,day,refreshed_at) VALUES(?,?,?)')
    .bind(site, day, version)
    .run();
  const checkpoint = await db
    .prepare('SELECT cursor,done FROM segment_event_jobs WHERE site=? AND day=? AND refreshed_at=?')
    .bind(site, day, version)
    .first<{ cursor: string; done: number }>();
  if (!checkpoint) throw new Error('Segment checkpoint is unavailable.');
  if (!checkpoint.done) {
    const { results } = await db
      .prepare(
        `SELECT e.id,v.content,v.revision,v.segment_key,e.action,e.target,e.surface,e.rank,e.bucket,e.value FROM events e JOIN views v ON v.site=e.site AND v.id=e.view_id WHERE e.site=? AND e.day=? AND e.id>? ORDER BY e.id LIMIT 32`,
      )
      .bind(site, day, checkpoint.cursor)
      .all<{
        id: string;
        content: string;
        revision: string;
        segment_key: string;
        action: string;
        target: string;
        surface: string;
        rank: number;
        bucket: number;
        value: number;
      }>();
    const groups = new Map<
      string,
      {
        content: string;
        revision: string;
        segment_key: string;
        action: string;
        target: string;
        surface: string;
        rank: number;
        bucket: number;
        count: number;
        total: number;
      }
    >();
    for (const event of results) {
      const key = JSON.stringify([
        event.content,
        event.revision,
        event.segment_key,
        event.action,
        event.target,
        event.surface,
        event.rank,
        event.bucket,
      ]);
      const row = groups.get(key) || { ...event, count: 0, total: 0 };
      row.count++;
      row.total += event.value;
      groups.set(key, row);
    }
    // Compare-and-set the cursor and increment totals in one D1 transaction. A crash before
    // the parent job's state write can safely resume from this independent checkpoint.
    await db.batch([
      db
        .prepare(
          'UPDATE segment_event_jobs SET cursor=?,done=? WHERE site=? AND day=? AND refreshed_at=? AND cursor=? AND done=0',
        )
        .bind(
          results.at(-1)?.id || checkpoint.cursor,
          Number(results.length < 32),
          site,
          day,
          version,
          checkpoint.cursor,
        ),
      db
        .prepare(
          `INSERT INTO segment_events(site,day,content,revision,segment_key,action,target,surface,rank,bucket,count,total,refreshed_at) SELECT ?,?,json_extract(value,'$.content'),json_extract(value,'$.revision'),json_extract(value,'$.segment_key'),json_extract(value,'$.action'),json_extract(value,'$.target'),json_extract(value,'$.surface'),json_extract(value,'$.rank'),json_extract(value,'$.bucket'),json_extract(value,'$.count'),json_extract(value,'$.total'),? FROM json_each(?) WHERE changes()>0 ON CONFLICT(site,day,content,revision,segment_key,action,target,surface,rank,bucket,refreshed_at) DO UPDATE SET count=segment_events.count+excluded.count,total=segment_events.total+excluded.total`,
        )
        .bind(site, day, version, JSON.stringify([...groups.values()])),
    ]);
    if (results.length === 32) return false;
  }
  await db
    .prepare(
      `UPDATE segment_daily SET impressions=COALESCE((SELECT SUM(count) FROM segment_events e WHERE e.site=segment_daily.site AND e.day=segment_daily.day AND e.content=segment_daily.content AND e.revision=segment_daily.revision AND e.segment_key=segment_daily.segment_key AND e.refreshed_at=segment_daily.refreshed_at AND e.action='impression'),0),clicks=COALESCE((SELECT SUM(count) FROM segment_events e WHERE e.site=segment_daily.site AND e.day=segment_daily.day AND e.content=segment_daily.content AND e.revision=segment_daily.revision AND e.segment_key=segment_daily.segment_key AND e.refreshed_at=segment_daily.refreshed_at AND e.action='click'),0) WHERE site=? AND day=? AND refreshed_at=?`,
    )
    .bind(site, day, version)
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO segment_coverage(site,day,refreshed_at) SELECT ?,?,? WHERE COALESCE((SELECT SUM(views) FROM segment_daily WHERE site=? AND day=? AND refreshed_at=?),0)=COALESCE((SELECT SUM(views) FROM daily WHERE site=? AND day=? AND refreshed_at=?),0)`,
    )
    .bind(site, day, version, site, day, version, site, day, version)
    .run();
  return true;
}
