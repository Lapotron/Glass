import { parseSegment, hasSegment, segmentSql } from '../shared/aca-segments.js';
import { committedSegment, segmentCoverage } from './segment-reports.js';
import type { D1Database } from './db.js';
import type { AcaReport, AcaReportName } from '../shared/aca.js';
import { mergeCardinality } from './cardinality.js';
import { audienceReport } from './audience-reports.js';
import { vitalQuantile } from '../shared/audience.js';
type Daily = {
  day: string;
  content: string;
  revision: string;
  views: number;
  active: number;
  qualified: number;
  completed: number;
  optin: number;
  unique_browsers: number;
  impressions: number;
  clicks: number;
  retention: string;
  sources: string;
  interactions: string;
  hll: string;
  refreshed_at: number;
};
const sum = (rows: Daily[], key: keyof Daily) => rows.reduce((n, row) => n + Number(row[key]), 0);
export function reportRange(url: URL, now = Date.now()) {
  const to = url.searchParams.get('to') || new Date(now).toISOString().slice(0, 10),
    from = url.searchParams.get('from') || new Date(now - 27 * 86400000).toISOString().slice(0, 10);
  for (const day of [from, to])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      Number.isNaN(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day
    )
      throw new Error('Use real UTC dates.');
  if (
    from > to ||
    Date.parse(to) - Date.parse(from) > 729 * 86400000 ||
    Date.parse(to) > now + 86400000
  )
    throw new Error('Choose an ordered date range of up to 730 days.');
  const content = url.searchParams.get('content') || '',
    revision = url.searchParams.get('revision') || '';
  if (content.length > 240 || !/^[a-f0-9]{0,64}$/.test(revision))
    throw new Error('Invalid content filter.');
  return { from, to, content, revision, segment: parseSegment(url.searchParams.get('segment')) };
}
export async function analyticsReport(
  db: D1Database,
  site: string,
  name: AcaReportName,
  url: URL,
  now = Date.now(),
  networkEstimates = false,
  optionalHistory = false,
): Promise<AcaReport> {
  if (['geography', 'technology', 'visits'].includes(name))
    return audienceReport(db, site, name, url, now);
  const { from, to, content, revision, segment } = reportRange(url, now);
  const segmented = hasSegment(segment),
    filter = segmentSql(segment),
    dailyTable = segmented ? 'segment_daily' : 'daily',
    eventTable = segmented ? 'segment_events' : 'daily_events';
  const where =
    'site=? AND day>=? AND day<=?' +
    (content ? ' AND content=?' : '') +
    (revision ? ' AND revision=?' : '') +
    filter.clause;
  const values = [
    site,
    from,
    to,
    ...(content ? [content] : []),
    ...(revision ? [revision] : []),
    ...filter.params,
  ];
  const projection =
    'day,content,revision,views,active,qualified,completed,optin,unique_browsers,impressions,clicks,refreshed_at,' +
    (name === 'engagement' && content ? 'retention' : "'[]' AS retention") +
    ',' +
    (name === 'reach' ? 'sources' : "'{}' AS sources") +
    ",'{}' AS interactions," +
    (networkEstimates && !optionalHistory && !segmented ? "'[]' AS hll" : 'hll');
  const { results: rows } = await db
    .prepare(
      `SELECT ${projection} FROM ${dailyTable} WHERE ${where} AND ${segmented ? committedSegment(dailyTable) : 'refreshed_at=(SELECT s.refreshed_at FROM summaries s WHERE s.site=daily.site AND s.day=daily.day)'} ORDER BY day LIMIT 5001`,
    )
    .bind(...values)
    .all<Daily>();
  if (rows.length > 5000)
    throw new Error('This report is too large. Choose a shorter range or one article.');
  const views = sum(rows, 'views'),
    active = sum(rows, 'active'),
    qualified = sum(rows, 'qualified'),
    optin = sum(rows, 'optin');
  const recent = from >= new Date(now - 90 * 86400000).toISOString().slice(0, 10);
  const uniques = segmented
    ? mergeCardinality(rows.map((row) => JSON.parse(row.hll)))
    : networkEstimates && !optionalHistory
      ? 0
      : recent
        ? Number(
            (
              await db
                .prepare(
                  `SELECT COUNT(DISTINCT visitor) AS total FROM views WHERE ${where} AND visitor IS NOT NULL`,
                )
                .bind(...values)
                .first<{ total: number }>()
            )?.total || 0,
          )
        : mergeCardinality(rows.map((row) => JSON.parse(row.hll)));
  const eventWhere = content
    ? `site=? AND day>=? AND day<=? AND ((action IN ('impression','click') AND target=?) OR (action NOT IN ('impression','click') AND content=?))` +
      (revision ? ` AND (action IN ('impression','click') OR revision=?)` : '') +
      filter.clause
    : where;
  const eventValues = content
    ? [site, from, to, content, content, ...(revision ? [revision] : []), ...filter.params]
    : values;
  const { results: eventRows } = await db
    .prepare(
      `SELECT action,target,surface,rank,SUM(count) AS count,SUM(total) AS total FROM ${eventTable} WHERE ${eventWhere} AND ${segmented ? committedSegment(eventTable) : 'refreshed_at=(SELECT s.refreshed_at FROM summaries s WHERE s.site=daily_events.site AND s.day=daily_events.day)'} GROUP BY action,target,surface,rank ORDER BY count DESC LIMIT 2000`,
    )
    .bind(...eventValues)
    .all<{
      action: string;
      target: string;
      surface: string;
      rank: number;
      count: number;
      total: number;
    }>();
  const impressions = eventRows
      .filter((row) => row.action === 'impression')
      .reduce((n, row) => n + row.count, 0),
    clicks = eventRows.filter((row) => row.action === 'click').reduce((n, row) => n + row.count, 0);
  const report: AcaReport = {
    segment,
    ...(segmented ? { coverage: await segmentCoverage(db, site, from, to) } : {}),
    networkMode: networkEstimates ? 'daily' : 'off',
    historyMode: optionalHistory ? 'optional-consent' : 'anonymous',
    name,
    from,
    to,
    generatedAt: new Date(now).toISOString(),
    timezone: 'UTC',
    metrics: [],
    rows: [],
    series: [],
    retention: [],
    cohorts: [],
    freshness: rows.length
      ? new Date(Math.max(...rows.map((row) => row.refreshed_at))).toISOString()
      : null,
    notes: [
      'Browser events are observations, not a census: blocking, disabled JavaScript, network loss, and bots affect totals. No historical backfill.',
      'Unique browsers and audience metrics cover explicitly opted-in browsers only; they are not people or all visitors.',
      'A qualified read means at least 10 seconds of foreground active time. Idle after 60 seconds. Hidden tabs pause.',
      'Impressions require at least 50% visibility for one second. CTR measures observed on-site card/result clicks, including clicks without a qualified impression.',
      recent
        ? 'Range unique browsers are deduplicated exactly from retained records.'
        : 'Range unique browsers use merged HyperLogLog summaries (about 3.25% standard error). Daily uniques are never summed.',
    ],
  };
  const byDay = new Map<string, Daily[]>();
  rows.forEach((row) => {
    if (!byDay.has(row.day)) byDay.set(row.day, []);
    byDay.get(row.day)!.push(row);
  });
  for (let cursor = Date.parse(from); cursor <= Date.parse(to); cursor += 86400000) {
    const day = new Date(cursor).toISOString().slice(0, 10),
      group = byDay.get(day) || [];
    if (segmented && report.coverage?.missingDays.includes(day)) continue;
    report.series.push({
      day,
      views: sum(group, 'views'),
      active: sum(group, 'active') / 1000,
      qualified: sum(group, 'qualified'),
      impressions: sum(group, 'impressions'),
      clicks: sum(group, 'clicks'),
      ...(networkEstimates && !optionalHistory && !segmented
        ? {}
        : { visitors: mergeCardinality(group.map((row) => JSON.parse(row.hll))) }),
    });
  }
  report.metrics = [
    { label: 'Page views', value: views },
    { label: 'Qualified reads', value: qualified },
    { label: 'Active reading', value: active / 60000, unit: 'min' },
    {
      label: 'Opt-in unique browsers',
      value: uniques,
      note:
        recent && !segmented
          ? 'Observed opted-in browsers'
          : 'HLL estimate · ~3.25% standard error',
    },
    { label: 'Impressions', value: impressions },
    {
      label: 'On-site CTR',
      value: impressions ? (clicks / impressions) * 100 : null,
      unit: '%',
      note: `${clicks} clicks / ${impressions} qualified impressions`,
    },
  ];
  if (networkEstimates && !segmented) {
    if (!optionalHistory)
      report.notes = report.notes.filter(
        (note) => !note.startsWith('Unique browsers') && !note.startsWith('Range unique browsers'),
      );
    const { results: networks } = await db
      .prepare(
        'SELECT day,networks FROM daily_network_totals WHERE site=? AND day>=? AND day<=? AND content=? AND revision=? ORDER BY day',
      )
      .bind(site, from, to, content, content ? revision : '')
      .all<{ day: string; networks: number }>();
    const byDay = new Map(networks.map((row) => [row.day, row.networks]));
    for (const point of report.series) point.networks = byDay.get(point.day) ?? null;
    if (!optionalHistory)
      report.metrics = report.metrics.filter((metric) => metric.label !== 'Opt-in unique browsers');
    report.metrics.push({
      label: 'Average daily networks',
      value: networks.length
        ? networks.reduce((sum, row) => sum + row.networks, 0) / networks.length
        : null,
      note: 'Average of days with network observations. Daily estimates are networks, not people, and are never summed as range unique visitors.',
    });
    report.notes.push(
      'Network estimates use site-specific daily keyed address hashes. Raw addresses are not stored. Identifiers expire after 48 hours; only daily counts remain. Shared and changing addresses affect accuracy. These daily network estimates do not link visits across days. Optional consented browser histories are reported separately.',
    );
  }
  if (name === 'content' || name === 'overview') {
    const groups = new Map<string, Daily[]>();
    rows.forEach((row) => {
      const key = `${row.content}\0${row.revision}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    });
    report.rows = [...groups.values()]
      .map((group) => ({
        content: group[0].content,
        revision: group[0].revision,
        views: sum(group, 'views'),
        qualified: sum(group, 'qualified'),
        activeMinutes: Math.round(sum(group, 'active') / 60000),
        averageSeconds: Math.round(sum(group, 'active') / Math.max(1, sum(group, 'views')) / 1000),
        completion: sum(group, 'views')
          ? Math.round((sum(group, 'completed') / sum(group, 'views')) * 100)
          : 0,
      }))
      .sort((a, b) => b.views - a.views);
  }
  if (name === 'reach') {
    const groups = new Map<
      string,
      { target: string; surface: string; rank: number; impressions: number; clicks: number }
    >();
    for (const row of eventRows.filter((r) => ['impression', 'click'].includes(r.action))) {
      const key = `${row.target}\0${row.surface}\0${row.rank}`;
      if (!groups.has(key))
        groups.set(key, {
          target: row.target,
          surface: row.surface,
          rank: row.rank,
          impressions: 0,
          clicks: 0,
        });
      const group = groups.get(key)!;
      if (row.action === 'impression') group.impressions += row.count;
      else group.clicks += row.count;
    }
    report.rows = [...groups.values()].map((row) => ({
      ...row,
      ctr: row.impressions ? Math.round((row.clicks / row.impressions) * 10000) / 100 : null,
    }));
    const sources: Record<string, number> = {};
    rows.forEach((row) =>
      Object.entries(JSON.parse(row.sources) as Record<string, number>).forEach(
        ([source, count]) => {
          sources[source] = (sources[source] || 0) + count;
        },
      ),
    );
    report.breakdowns = ['source', 'device', 'campaign', 'language'].map((name) => ({
      name,
      rows: Object.entries(sources)
        .filter(([key]) => key.startsWith(name + ':'))
        .map(([key, views]) => ({ [name]: key.slice(name.length + 1), views }))
        .sort((a, b) => Number(b.views) - Number(a.views)),
    }));
    if (content)
      report.notes.push(
        'Discovery measures where this stable content ID was shown or clicked across the site. Its target revision is not inferred from the source card page.',
      );
  }
  if (name === 'engagement') {
    const revisions = new Set(rows.map((row) => `${row.content}\0${row.revision}`));
    if (content && revisions.size === 1 && qualified >= 10) {
      report.retention = Array.from({ length: 20 }, (_, index) => ({
        progress: (index + 1) * 5,
        reached: 0,
        activeMs: 0,
        dropoffs: 0,
      }));
      for (const row of rows)
        (
          JSON.parse(row.retention) as { reached: number; activeMs: number; dropoffs: number }[]
        ).forEach((bucket, i) => {
          report.retention[i].reached += bucket.reached;
          report.retention[i].activeMs += bucket.activeMs;
          report.retention[i].dropoffs += bucket.dropoffs;
        });
    } else
      report.notes.push(
        'Select one content revision with at least 10 qualified reads to display a meaningful retention curve.',
      );
    const sections = await db
      .prepare(
        segmented
          ? `SELECT content,revision,key AS section,SUM(json_extract(value,'$.active')) AS activeMs,SUM(json_extract(value,'$.views')) AS observations FROM segment_daily,json_each(segment_daily.sections) WHERE ${where} AND ${committedSegment('segment_daily')} GROUP BY content,revision,key ORDER BY activeMs DESC LIMIT 200`
          : `SELECT content,revision,section,SUM(active) AS activeMs,SUM(views) AS observations FROM daily_sections WHERE ${where} AND refreshed_at=(SELECT s.refreshed_at FROM summaries s WHERE s.site=daily_sections.site AND s.day=daily_sections.day) GROUP BY content,revision,section ORDER BY activeMs DESC LIMIT 200`,
      )
      .bind(...values)
      .all<Record<string, string | number>>();
    report.rows = sections.results;
    report.notes.push(
      'Retention marks sampled buckets with at least one second of dwell. Skipped buckets are not inferred as read. Completion requires end visibility and dwell in at least 16 of 20 buckets. Drop-offs are the last sampled buckets of incomplete reads; a missing final beacon can look like abandonment.',
    );
  }
  if (name === 'audience' && segmented) {
    report.metrics = report.metrics.filter(
      (metric) => !['Impressions', 'On-site CTR'].includes(metric.label),
    );
    report.rows = report.series.map((row) => ({
      day: row.day,
      views: row.views,
      qualified: row.qualified,
    }));
    report.notes.push(
      'Cohorts, returning-browser rates and daily network estimates are unavailable with segment filters. Clear the segment to view them.',
    );
  }
  if (name === 'audience' && !segmented) {
    if (networkEstimates && !optionalHistory) {
      report.metrics = report.metrics.filter((metric) =>
        ['Page views', 'Average daily networks', 'Qualified reads', 'Active reading'].includes(
          metric.label,
        ),
      );
      report.rows = report.series.map((row) => ({
        day: row.day,
        networks: row.networks ?? null,
        views: row.views,
        qualified: row.qualified,
      }));
      report.notes.push(
        'Returning-reader rates and cohorts are unavailable in daily network mode. Missing daily observations are unavailable, not measured zero.',
      );
    } else {
      const audienceFilter = content
        ? ` AND id IN (SELECT visitor FROM views WHERE ${where} AND visitor IS NOT NULL)`
        : '';
      const { results: visitors } = await db
        .prepare(
          'SELECT first_day,last_day,days FROM visitors WHERE site=? AND first_day<=? AND last_day>=?' +
            audienceFilter +
            ' LIMIT 50001',
        )
        .bind(site, to, from, ...(content ? values : []))
        .all<{ first_day: string; last_day: string; days: string }>();
      if (visitors.length > 50000)
        throw new Error('Audience report exceeds its bounded query limit.');
      const selected = visitors.filter((v) =>
        (JSON.parse(v.days) as string[]).some((day) => day >= from && day <= to),
      );
      const returning = selected.filter(
        (v) =>
          v.first_day < from ||
          (JSON.parse(v.days) as string[]).filter((day) => day >= from && day <= to).length > 1,
      ).length;
      report.metrics = [
        { label: 'Opt-in active browsers', value: selected.length },
        { label: 'Returning browsers', value: returning },
        {
          label: 'Returning rate',
          value: selected.length ? (returning / selected.length) * 100 : null,
          unit: '%',
        },
        {
          label: 'Consent coverage',
          value: views ? (optin / views) * 100 : null,
          unit: '%',
          note: 'Opted-in page views / all observed page views',
        },
      ];
      const cohorts = new Map<string, typeof visitors>();
      for (const visitor of visitors.filter((v) => v.first_day >= from && v.first_day <= to)) {
        const cohort = visitor.first_day.slice(0, 7);
        if (!cohorts.has(cohort)) cohorts.set(cohort, []);
        cohorts.get(cohort)!.push(visitor);
      }
      report.cohorts = [...cohorts].map(([cohort, list]) => {
        const rate = (offset: number) => {
          const eligible = list.filter((v) => Date.parse(v.first_day) + offset * 86400000 <= now);
          return eligible.length >= 10
            ? (eligible.filter((v) =>
                (JSON.parse(v.days) as string[]).includes(
                  new Date(Date.parse(v.first_day) + offset * 86400000).toISOString().slice(0, 10),
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
      if (content)
        report.notes.push(
          'Article audience is restricted to the retained 90-day observations. Cohorts describe the first site visit of these observed browsers; older article visits are not reconstructed.',
        );
      report.notes.push(
        'Cohort values are exact-day return rates within each first-observed month. -1 means fewer than 10 eligible browsers or the window is not mature. Identity rotates after 12 months; activity state expires after 366 idle days.',
      );
    }
  }
  if (name === 'quality') {
    const health = await db
      .prepare(
        'SELECT SUM(accepted) AS accepted,SUM(rejected) AS rejected,MAX(last_at) AS last_at FROM health WHERE site=? AND day>=? AND day<=?',
      )
      .bind(site, from, to)
      .first<{ accepted: number; rejected: number; last_at: number }>();
    report.metrics = [
      { label: 'Accepted batches', value: health?.accepted || 0 },
      { label: 'Rejected batches', value: health?.rejected || 0 },
      {
        label: 'Estimated ingestion writes',
        value: (health?.accepted || 0) * 3,
        note: 'Lower-bound row estimate; event and summary writes add to this. Check Cloudflare billing for actual usage.',
      },
      {
        label: 'Observed errors',
        value: eventRows.filter((e) => e.action === 'error').reduce((n, e) => n + e.count, 0),
      },
    ];
    const observed = await db
      .prepare(
        'SELECT SUM(rows_read) AS reads,SUM(rows_written) AS writes FROM database_usage WHERE site=? AND day>=? AND day<=?',
      )
      .bind(site, from, to)
      .first<{ reads: number; writes: number }>();
    report.metrics = report.metrics.filter(
      (metric) => metric.label !== 'Estimated ingestion writes',
    );
    report.metrics.push(
      { label: 'Observed D1 rows read', value: observed?.reads || 0 },
      {
        label: 'Observed D1 rows written',
        value: observed?.writes || 0,
        note: 'Observed service queries including indexes; accounting overhead is approximate. Account-wide Cloudflare usage is authoritative.',
      },
    );
    report.rows = eventRows
      .filter((e) => ['vital', 'error'].includes(e.action))
      .map((e) => ({
        metric: e.target,
        observations: e.count,
        average: e.count ? e.total / e.count / (e.target === 'CLS' ? 1000 : 1) : 0,
        unit: e.action === 'vital' ? (e.target === 'CLS' ? 'score' : 'ms') : 'count',
      }));
    const { results: histogram } = await db
      .prepare(
        segmented
          ? `SELECT target,bucket,SUM(count) AS count FROM segment_events WHERE ${where} AND action='vital' AND bucket>=0 AND ${committedSegment('segment_events')} GROUP BY target,bucket LIMIT 256`
          : `SELECT target,bucket,SUM(count) AS count FROM daily_vitals WHERE ${where} AND refreshed_at=(SELECT s.refreshed_at FROM summaries s WHERE s.site=daily_vitals.site AND s.day=daily_vitals.day) GROUP BY target,bucket LIMIT 256`,
      )
      .bind(...values)
      .all<{ target: string; bucket: number; count: number }>();
    report.rows = report.rows.map((row) => {
      const bins = histogram.filter((bin) => bin.target === row.metric);
      if (!bins.length) return row;
      const divisor = row.metric === 'CLS' ? 1000 : 1;
      return {
        ...row,
        p50: (vitalQuantile(bins, 0.5) || 0) / divisor,
        p75: (vitalQuantile(bins, 0.75) || 0) / divisor,
        p95: (vitalQuantile(bins, 0.95) || 0) / divisor,
        percentileSamples: bins.reduce((n, b) => n + b.count, 0),
      };
    });
    report.notes.push(
      'Performance percentiles are approximate upper bounds from mergeable logarithmic histograms; averages remain exact for accepted observations. Missing historical histograms are unavailable, not zero.',
    );
    report.notes.push(
      'Vitals are browser-supported observations and arithmetic means, not field p75 scores. Error categories omit messages and URLs. Request counters omit rejects before site validation. Usage estimates exclude Worker CPU and read costs.',
    );
    if (health?.last_at) report.freshness = new Date(health.last_at).toISOString();
  }
  if (segmented) {
    report.notes = report.notes.filter((note) => !note.startsWith('Range unique browsers'));
    report.notes.push(
      'Segment unique browsers use merged opt-in HyperLogLog summaries (about 3.25% standard error). Daily uniques are never summed.',
    );
    if (report.coverage?.missingDays.length)
      report.notes.push(
        'Segment history is incomplete. Missing days have no joint summary and are unavailable, not zero.',
      );
    if (name === 'quality')
      for (const metric of report.metrics)
        if (
          [
            'Accepted batches',
            'Rejected batches',
            'Observed D1 rows read',
            'Observed D1 rows written',
          ].includes(metric.label)
        )
          metric.note = 'Site-wide service health; segment filters do not apply to this counter.';
  }
  return report;
}
