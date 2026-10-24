import { hasSegment, segmentSql } from '../shared/aca-segments.js';
import { segmentedAudience, segmentCoverage } from './segment-reports.js';
import type { AcaReport, AcaReportName } from '../shared/aca.js';
import type { AudienceMetadata } from '../shared/audience.js';
import type { D1Database } from './db.js';
import { reportRange } from './reports.js';

export async function audienceReport(
  db: D1Database,
  site: string,
  name: AcaReportName,
  url: URL,
  now: number,
): Promise<AcaReport> {
  const range = reportRange(url, now);
  const { from, to, content, revision, segment } = range,
    segmented = hasSegment(segment),
    filter = segmentSql(segment);
  const report: AcaReport = {
    name,
    segment,
    ...(segmented ? { coverage: await segmentCoverage(db, site, from, to) } : {}),
    from,
    to,
    generatedAt: new Date(now).toISOString(),
    timezone: 'UTC',
    metrics: [],
    rows: [],
    series: [],
    retention: [],
    cohorts: [],
    freshness: null,
    notes: [
      'Locations are approximate IP-derived network locations, not GPS. Markers represent document visits, not identified people. No raw IP addresses are stored.',
      'Older observations without audience metadata remain unknown. Raw visits are retained for 90 days; committed daily aggregates for 730 days.',
    ],
  };
  const where =
    'site=? AND day>=? AND day<=?' +
    (content ? ' AND content=?' : '') +
    (revision ? ' AND revision=?' : '') +
    (name === 'visits' ? filter.clause : '');
  const params = [
    site,
    from,
    to,
    ...(content ? [content] : []),
    ...(revision ? [revision] : []),
    ...(name === 'visits' ? filter.params : []),
  ];
  if (name === 'visits') {
    const rawCursor = url.searchParams.get('cursor');
    let cursor: [number, string] | undefined;
    if (rawCursor) {
      if (rawCursor.length > 200 || !/^[\w=-]+$/.test(rawCursor))
        throw new Error('Invalid visit cursor.');
      try {
        const data = JSON.parse(atob(rawCursor.replace(/-/g, '+').replace(/_/g, '/')));
        if (
          !Array.isArray(data) ||
          data.length !== 2 ||
          !Number.isSafeInteger(data[0]) ||
          typeof data[1] !== 'string' ||
          !/^[\w-]{16,100}$/.test(data[1])
        )
          throw new Error();
        cursor = data as [number, string];
      } catch {
        throw new Error('Invalid visit cursor.');
      }
    }
    const cutoff = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
    const { results } = await db
      .prepare(
        `SELECT id,route,content,first_at,active,depth,consent,source,language,audience FROM views WHERE ${where} AND day>=? ${cursor ? 'AND (first_at,id)<(?,?)' : ''} ORDER BY first_at DESC,id DESC LIMIT 101`,
      )
      .bind(...params, cutoff, ...(cursor || []))
      .all<{
        id: string;
        route: string;
        content: string;
        first_at: number;
        active: number;
        depth: number;
        consent: string;
        source: string;
        language: string;
        audience: string;
      }>();
    report.rows = results.slice(0, 100).map((row) => {
      const a = JSON.parse(row.audience) as Partial<AudienceMetadata>;
      return {
        visit: row.id,
        time: new Date(row.first_at).toISOString(),
        route: row.route,
        content: row.content,
        activeSeconds: Math.round(row.active / 1000),
        depth: row.depth,
        history: row.consent,
        source: row.source,
        language: row.language,
        country: a.country || 'Unknown',
        region: a.region || '',
        city: a.city || '',
        timezone: a.timezone || '',
        latitude: a.latitude ?? null,
        longitude: a.longitude ?? null,
        browser: a.browser || 'Unknown',
        os: a.os || 'Unknown',
        device: a.device || 'Unknown',
        network: a.network || '',
        asn: a.asn || '',
        viewport: a.viewport || '',
        screen: a.screen || '',
      };
    });
    const last = results[99];
    report.nextCursor =
      results.length > 100 && last
        ? btoa(JSON.stringify([last.first_at, last.id]))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
        : null;
    report.metrics = [{ label: 'Visits on this page', value: report.rows.length }];
    report.freshness = results.length ? new Date(results[0].first_at).toISOString() : null;
    return report;
  }
  const { results: allResults } = segmented
    ? await segmentedAudience(db, site, range)
    : await db
        .prepare(
          `SELECT dimension,value,SUM(views) AS views,SUM(qualified) AS qualified,SUM(active) AS active,MAX(refreshed_at) AS refreshed_at FROM daily_audience WHERE ${where} AND ${name === 'geography' ? "dimension='geo'" : "dimension!='geo'"} AND refreshed_at=(SELECT s.refreshed_at FROM summaries s WHERE s.site=daily_audience.site AND s.day=daily_audience.day) GROUP BY dimension,value ORDER BY views DESC LIMIT 2001`,
        )
        .bind(...params)
        .all<{
          dimension: string;
          value: string;
          views: number;
          qualified: number;
          active: number;
          refreshed_at: number;
        }>();
  const results = allResults.filter((row) =>
    name === 'geography' ? row.dimension === 'geo' : row.dimension !== 'geo',
  );
  if (results.length > 2000)
    throw new Error('Audience report is too large. Narrow the dates or select one article.');
  report.rows = results.map((row) =>
    name === 'geography'
      ? {
          ...JSON.parse(row.value),
          views: row.views,
          qualified: row.qualified,
          activeMs: row.active,
          averageSeconds: Math.round(row.active / Math.max(1, row.views) / 1000),
        }
      : {
          dimension: row.dimension,
          value: row.value,
          views: row.views,
          qualified: row.qualified,
          averageSeconds: Math.round(row.active / Math.max(1, row.views) / 1000),
        },
  );
  report.metrics = [
    {
      label: name === 'geography' ? 'Observed locations' : 'Observed device groups',
      value: report.rows.length,
    },
  ];
  report.freshness = results.length
    ? new Date(Math.max(...results.map((r) => r.refreshed_at))).toISOString()
    : null;
  return report;
}
