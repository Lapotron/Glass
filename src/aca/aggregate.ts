import type { D1Database } from './db.js';
import { addCardinality, cardinalitySize } from './cardinality.js';
export type ViewRow = {
  id: string;
  day: string;
  content: string;
  revision: string;
  route: string;
  active: number;
  depth: number;
  buckets: string;
  sections: string;
  end_seen: number;
  ended: number;
  visitor: string | null;
  consent: string;
  source: string;
  device: string;
  campaign: string;
  language: string;
  updated_at: number;
  audience?: string;
};
export type EventRow = {
  action: string;
  target: string;
  surface: string;
  rank: number;
  value: number;
  content: string;
  revision: string;
  view_id: string;
  day: string;
};
export async function summarizeDay(db: D1Database, site: string, day: string, now = Date.now()) {
  const { results: views } = await db
    .prepare('SELECT * FROM views WHERE site=? AND day=? LIMIT 100001')
    .bind(site, day)
    .all<ViewRow>();
  if (views.length > 100000)
    throw new Error(
      'Daily aggregation limit exceeded. Increase capacity before removing raw data.',
    );
  const { results: events } = await db
    .prepare('SELECT * FROM events WHERE site=? AND day=? LIMIT 500001')
    .bind(site, day)
    .all<EventRow>();
  if (events.length > 500000) throw new Error('Daily event limit exceeded. Raw data retained.');
  const groups = new Map<string, ViewRow[]>();
  for (const view of views) {
    const key = `${view.content}\0${view.revision}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(view);
  }
  const statements = [];
  for (const rows of groups.values()) {
    const { content, revision } = rows[0],
      ids = new Set(rows.map((v) => v.id));
    const actions = events.filter((e) => ids.has(e.view_id));
    const retention = Array.from({ length: 20 }, () => ({ reached: 0, activeMs: 0, dropoffs: 0 })),
      hll = Array<number>(cardinalitySize).fill(0);
    const sources: Record<string, number> = {},
      interactions: Record<string, number> = {};
    for (const row of rows) {
      const buckets = JSON.parse(row.buckets) as number[];
      buckets.forEach((ms, i) => {
        retention[i].activeMs += ms;
        if (ms >= 1000) retention[i].reached++;
      });
      let last = 0;
      buckets.forEach((ms, i) => {
        if (ms >= 1000) last = i;
      });
      const observed = buckets.filter((ms) => ms >= 1000).length;
      if (row.active >= 10000 && observed > 0 && !(row.end_seen && observed >= 16))
        retention[last].dropoffs++;
      if (row.visitor) addCardinality(hll, row.visitor);
      for (const key of [
        `source:${row.source || 'direct'}`,
        `device:${row.device}`,
        `campaign:${row.campaign || '(none)'}`,
        `language:${row.language}`,
      ])
        sources[key] = (sources[key] || 0) + 1;
    }
    for (const event of actions) interactions[event.action] = (interactions[event.action] || 0) + 1;
    statements.push(
      db
        .prepare(
          `INSERT INTO daily(site,day,content,revision,views,active,qualified,completed,optin,unique_browsers,impressions,clicks,retention,sources,interactions,hll,refreshed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(site,day,content,revision,refreshed_at) DO UPDATE SET views=excluded.views,active=excluded.active,qualified=excluded.qualified,completed=excluded.completed,optin=excluded.optin,unique_browsers=excluded.unique_browsers,impressions=excluded.impressions,clicks=excluded.clicks,retention=excluded.retention,sources=excluded.sources,interactions=excluded.interactions,hll=excluded.hll,refreshed_at=excluded.refreshed_at`,
        )
        .bind(
          site,
          day,
          content,
          revision,
          rows.length,
          rows.reduce((sum, row) => sum + row.active, 0),
          rows.filter((row) => row.active >= 10000).length,
          rows.filter(
            (row) =>
              row.end_seen &&
              JSON.parse(row.buckets).filter((ms: number) => ms >= 1000).length >= 16,
          ).length,
          rows.filter((row) => row.visitor).length,
          new Set(rows.map((row) => row.visitor).filter(Boolean)).size,
          interactions.impression || 0,
          interactions.click || 0,
          JSON.stringify(retention),
          JSON.stringify(sources),
          JSON.stringify(interactions),
          JSON.stringify(hll),
          now,
        ),
    );
  }
  const eventGroups = new Map<string, { event: EventRow; count: number; total: number }>();
  for (const event of events) {
    const key = JSON.stringify([
      event.content,
      event.revision,
      event.action,
      event.target,
      event.surface,
      event.rank,
    ]);
    const group = eventGroups.get(key) || { event, count: 0, total: 0 };
    group.count++;
    group.total += event.value;
    eventGroups.set(key, group);
  }
  for (const { event, count, total } of eventGroups.values())
    statements.push(
      db
        .prepare(
          'INSERT INTO daily_events(site,day,content,revision,action,target,surface,rank,count,total,refreshed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(site,day,content,revision,action,target,surface,rank,refreshed_at) DO UPDATE SET count=excluded.count,total=excluded.total',
        )
        .bind(
          site,
          day,
          event.content,
          event.revision,
          event.action,
          event.target,
          event.surface,
          event.rank,
          count,
          total,
          now,
        ),
    );
  const sectionGroups = new Map<
    string,
    { content: string; revision: string; section: string; active: number; views: number }
  >();
  for (const view of views)
    for (const [section, active] of Object.entries(
      JSON.parse(view.sections) as Record<string, number>,
    )) {
      const key = JSON.stringify([view.content, view.revision, section]);
      const group = sectionGroups.get(key) || {
        content: view.content,
        revision: view.revision,
        section,
        active: 0,
        views: 0,
      };
      group.active += active;
      group.views++;
      sectionGroups.set(key, group);
    }
  for (const group of sectionGroups.values())
    statements.push(
      db
        .prepare(
          'INSERT INTO daily_sections(site,day,content,revision,section,active,views,refreshed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(site,day,content,revision,section,refreshed_at) DO UPDATE SET active=excluded.active,views=excluded.views',
        )
        .bind(
          site,
          day,
          group.content,
          group.revision,
          group.section,
          group.active,
          group.views,
          now,
        ),
    );
  if (statements.length)
    for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  await db
    .prepare(
      'INSERT INTO summaries(site,day,refreshed_at) VALUES(?,?,?) ON CONFLICT(site,day) DO UPDATE SET refreshed_at=MAX(summaries.refreshed_at,excluded.refreshed_at)',
    )
    .bind(site, day, now)
    .run();
  for (const table of ['daily', 'daily_events', 'daily_sections'])
    await db
      .prepare(
        `DELETE FROM ${table} WHERE site=? AND day=? AND refreshed_at < (SELECT refreshed_at FROM summaries WHERE site=? AND day=?)`,
      )
      .bind(site, day, site, day)
      .run();
}
export async function maintainAnalytics(db: D1Database, site: string, now = Date.now()) {
  const oldest = new Date(now - 90 * 86400000).toISOString().slice(0, 10),
    cutoff = new Date(now - 730 * 86400000).toISOString().slice(0, 10);
  const { results: days } = await db
    .prepare(
      'SELECT day,MAX(updated_at) AS latest FROM views WHERE site=? GROUP BY day ORDER BY day LIMIT 1000',
    )
    .bind(site)
    .all<{ day: string; latest: number }>();
  const { results: summaries } = await db
    .prepare('SELECT day,refreshed_at FROM summaries WHERE site=?')
    .bind(site)
    .all<{ day: string; refreshed_at: number }>();
  const complete = new Map(summaries.map((row) => [row.day, row.refreshed_at]));
  // Catch up after outages, with bounded work per hourly invocation. Only committed days may expire.
  for (const { day } of days.filter((row) => (complete.get(row.day) || 0) < row.latest).slice(0, 5))
    await summarizeDay(db, site, day, now);
  await db.batch([
    db
      .prepare(
        'DELETE FROM events WHERE site=? AND day<? AND day IN (SELECT s.day FROM summaries s WHERE s.site=? AND s.refreshed_at >= (SELECT COALESCE(MAX(v.updated_at),0) FROM views v WHERE v.site=s.site AND v.day=s.day))',
      )
      .bind(site, oldest, site),
    db
      .prepare(
        'DELETE FROM views WHERE site=? AND day<? AND day IN (SELECT s.day FROM summaries s WHERE s.site=? AND s.refreshed_at >= (SELECT COALESCE(MAX(v.updated_at),0) FROM views v WHERE v.site=s.site AND v.day=s.day))',
      )
      .bind(site, oldest, site),
    db.prepare('DELETE FROM daily_events WHERE site=? AND day<?').bind(site, cutoff),
    db.prepare('DELETE FROM daily_sections WHERE site=? AND day<?').bind(site, cutoff),
    db.prepare('DELETE FROM summaries WHERE site=? AND day<?').bind(site, cutoff),
    db.prepare('DELETE FROM daily WHERE site=? AND day<?').bind(site, cutoff),
    db.prepare('DELETE FROM health WHERE site=? AND day<?').bind(site, oldest),
    db.prepare('DELETE FROM revoked WHERE site=? AND expires<?').bind(site, now),
    db
      .prepare('DELETE FROM visitors WHERE site=? AND last_day<?')
      .bind(site, new Date(now - 366 * 86400000).toISOString().slice(0, 10)),
  ]);
}
