import type { D1Database } from './db.js';
import { segmentCoverage } from './segment-reports.js';
import { segmentSql, type AcaSegment } from '../shared/aca-segments.js';

type Range = { from: string; to: string; content: string; revision: string; segment: AcaSegment };
type Match = { visitor: string; day: string; days: string };

/** Cohorts use only existing consented observations; no new identity or history is collected. */
export async function segmentCohorts(db: D1Database, site: string, range: Range, now: number) {
  const oldest = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
  if (range.from < oldest)
    return {
      unavailable: 'Segmented cohorts need a date range inside the retained 90-day observations.',
    };
  const coverage = await segmentCoverage(db, site, oldest, range.to);
  const pending = await db
    .prepare('SELECT 1 AS pending FROM dirty_days WHERE site=? AND day>=? AND day<=? LIMIT 1')
    .bind(site, oldest, range.to)
    .first<{ pending: number }>();
  if (pending || coverage.missingDays.length)
    return {
      unavailable:
        'Segmented cohorts are unavailable while retained days lack a complete committed summary.',
    };

  const filter = segmentSql(range.segment, 'v.segment_key');
  const rows = await db
    .prepare(
      `SELECT v.visitor,v.day,p.days FROM views v JOIN visitors p ON p.site=v.site AND p.id=v.visitor JOIN summaries s ON s.site=v.site AND s.day=v.day JOIN segment_coverage c ON c.site=s.site AND c.day=s.day AND c.refreshed_at=s.refreshed_at WHERE v.site=? AND v.day>=? AND v.day<=? AND v.visitor IS NOT NULL AND v.first_at<=s.refreshed_at${range.content ? ' AND v.content=?' : ''}${range.revision ? ' AND v.revision=?' : ''}${filter.clause} LIMIT 50001`,
    )
    .bind(
      site,
      oldest,
      range.to,
      ...(range.content ? [range.content] : []),
      ...(range.revision ? [range.revision] : []),
      ...filter.params,
    )
    .all<Match>();
  if (rows.results.length > 50000)
    return {
      unavailable:
        'Segmented cohorts exceed the 50,000 retained-observation limit. Choose an article or narrower filters.',
    };

  const browsers = new Map<string, { first: string; selected: boolean; days: string[] }>();
  for (const row of rows.results) {
    const browser = browsers.get(row.visitor) || {
      first: row.day,
      selected: false,
      days: JSON.parse(row.days) as string[],
    };
    if (row.day < browser.first) browser.first = row.day;
    if (row.day >= range.from) browser.selected = true;
    browsers.set(row.visitor, browser);
  }
  const selected = [...browsers.values()].filter((v) => v.selected);
  const returning = selected.filter(
    (v) =>
      v.first < range.from ||
      v.days.some((day) => day > v.first && day >= range.from && day <= range.to),
  ).length;
  const groups = new Map<string, typeof selected>();
  for (const browser of selected.filter((v) => v.first >= range.from)) {
    const month = browser.first.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month)!.push(browser);
  }
  const lastDay = [range.to, new Date(now).toISOString().slice(0, 10)].sort()[0];
  const cohorts = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, list]) => {
      const rate = (offset: number) => {
        const eligible = list.filter(
          (v) =>
            new Date(Date.parse(v.first) + offset * 86400000).toISOString().slice(0, 10) <= lastDay,
        );
        return eligible.length >= 10
          ? (eligible.filter((v) =>
              v.days.includes(
                new Date(Date.parse(v.first) + offset * 86400000).toISOString().slice(0, 10),
              ),
            ).length /
              eligible.length) *
              100
          : -1;
      };
      return {
        cohort,
        browsers: list.length,
        day1: rate(1),
        day7: rate(7),
        day30: rate(30),
        day90: rate(90),
        day180: rate(180),
      };
    });
  return { selected: selected.length, returning, cohorts };
}
