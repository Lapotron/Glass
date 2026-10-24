import type { D1Database } from './db.js';
import {
  segmentDimensions,
  segmentSql,
  type AcaSegment,
  type SegmentCoverage,
  type SegmentOptions,
} from '../shared/aca-segments.js';

export async function segmentCoverage(
  db: D1Database,
  site: string,
  from: string,
  to: string,
): Promise<SegmentCoverage> {
  const { results } = await db
    .prepare(
      `SELECT s.day,c.refreshed_at FROM summaries s LEFT JOIN segment_coverage c ON c.site=s.site AND c.day=s.day AND c.refreshed_at=s.refreshed_at WHERE s.site=? AND s.day>=? AND s.day<=? ORDER BY s.day LIMIT 731`,
    )
    .bind(site, from, to)
    .all<{ day: string; refreshed_at: number | null }>();
  const covered = results.filter((r) => r.refreshed_at !== null);
  return {
    days: results.length,
    coveredDays: covered.length,
    missingDays: results.filter((r) => r.refreshed_at === null).map((r) => r.day),
    from: covered[0]?.day || null,
    to: covered.at(-1)?.day || null,
  };
}
export const committedSegment = (table: string) =>
  `refreshed_at=(SELECT s.refreshed_at FROM summaries s WHERE s.site=${table}.site AND s.day=${table}.day) AND EXISTS(SELECT 1 FROM segment_coverage c WHERE c.site=${table}.site AND c.day=${table}.day AND c.refreshed_at=${table}.refreshed_at)`;
export async function segmentOptions(
  db: D1Database,
  site: string,
  range: { from: string; to: string; content: string; revision: string },
): Promise<SegmentOptions> {
  const { from, to, content, revision } = range;
  const { results } = await db
    .prepare(
      `SELECT DISTINCT segment_key FROM segment_daily WHERE site=? AND day>=? AND day<=?${content ? ' AND content=?' : ''}${revision ? ' AND revision=?' : ''} AND ${committedSegment('segment_daily')} LIMIT 5001`,
    )
    .bind(site, from, to, ...(content ? [content] : []), ...(revision ? [revision] : []))
    .all<{ segment_key: string }>();
  if (results.length > 5000)
    throw new Error('Segment options are too large. Narrow the dates or select an article.');
  const options: SegmentOptions['options'] = {};
  segmentDimensions.forEach(
    (key, index) =>
      (options[key] = [
        ...new Set(results.map((r) => String(JSON.parse(r.segment_key)[index]))),
      ].sort()),
  );
  return { options, coverage: await segmentCoverage(db, site, from, to) };
}
export async function segmentedAudience(
  db: D1Database,
  site: string,
  range: { from: string; to: string; content: string; revision: string; segment: AcaSegment },
) {
  const { from, to, content, revision, segment } = range,
    sql = segmentSql(segment);
  const { results } = await db
    .prepare(
      `SELECT audience,refreshed_at FROM segment_daily WHERE site=? AND day>=? AND day<=?${content ? ' AND content=?' : ''}${revision ? ' AND revision=?' : ''}${sql.clause} AND ${committedSegment('segment_daily')} LIMIT 5001`,
    )
    .bind(
      site,
      from,
      to,
      ...(content ? [content] : []),
      ...(revision ? [revision] : []),
      ...sql.params,
    )
    .all<{ audience: string; refreshed_at: number }>();
  if (results.length > 5000)
    throw new Error('Audience report is too large. Narrow the dates or select one article.');
  const totals = new Map<
    string,
    {
      dimension: string;
      value: string;
      views: number;
      qualified: number;
      active: number;
      refreshed_at: number;
    }
  >();
  for (const record of results)
    for (const [key, counts] of Object.entries(
      JSON.parse(record.audience) as Record<
        string,
        { views: number; qualified: number; active: number }
      >,
    )) {
      const [dimension, value] = JSON.parse(key) as [string, string];
      const row = totals.get(key) || {
        dimension,
        value,
        views: 0,
        qualified: 0,
        active: 0,
        refreshed_at: 0,
      };
      row.views += counts.views;
      row.qualified += counts.qualified;
      row.active += counts.active;
      row.refreshed_at = Math.max(row.refreshed_at, record.refreshed_at);
      totals.set(key, row);
      if (totals.size > 2000)
        throw new Error('Audience report is too large. Narrow the dates or select one article.');
    }
  return { results: [...totals.values()].sort((a, b) => b.views - a.views) };
}
