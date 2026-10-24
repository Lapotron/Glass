import { t, uiNumber, uiDate } from './i18n.js';
import type { AcaReport } from './aca.js';
export const analyticsMetricIds: Record<string, string> = {
  'Page views': 'views',
  'Qualified reads': 'qualified',
  'Active reading': 'active',
  'Opt-in unique browsers': 'visitors',
  Impressions: 'impressions',
  'On-site CTR': 'ctr',
  'Opt-in active browsers': 'activeBrowsers',
  'Returning browsers': 'returning',
  'Returning rate': 'returningRate',
  'Consent coverage': 'consent',
  'Accepted batches': 'accepted',
  'Rejected batches': 'rejected',
  'Estimated ingestion writes': 'writes',
  'Observed errors': 'errors',
  'Average daily networks': 'networks',
  'Observed D1 rows read': 'rowsRead',
  'Observed D1 rows written': 'rowsWritten',
};
export const analyticsColumns: Record<string, string> = {
  engine:'Browser engine', continent:'Continent', density:'Pixel density', cores:'CPU core bucket', memory:'Memory bucket', orientation:'Orientation', theme:'Theme', motion:'Motion preference', edge:'Edge location', protocol:'HTTP protocol', tls:'TLS version',
  p50: 'Approx. p50', p75: 'Approx. p75', p95: 'Approx. p95', percentileSamples: 'Percentile samples', country: 'Country', region: 'Region', city: 'City', browser: 'Browser', os: 'Operating system', dimension: 'Dimension', value: 'Value', visit: 'Visit', time: 'Time', history: 'History', latitude: 'Latitude', longitude: 'Longitude', network: 'Network', asn: 'ASN', viewport: 'Viewport', screen: 'Screen', activeSeconds: 'Active reading (s)', timezone: 'Timezone',
  content: 'Content',
  target: 'Content',
  revision: 'Revision',
  day: 'Date',
  views: 'Page views',
  qualified: 'Qualified reads',
  active: 'Active reading (s)',
  activeMinutes: 'Active reading (min)',
  averageSeconds: 'Average reading (s)',
  completion: 'Completion',
  impressions: 'Impressions',
  clicks: 'Clicks',
  visitors: 'Opt-in unique browsers',
  networks: 'Estimated daily networks',
  ctr: 'On-site CTR',
  surface: 'Surface',
  rank: 'Position',
  section: 'Section',
  activeMs: 'Active reading',
  observations: 'Observations',
  source: 'Traffic source',
  device: 'Device',
  campaign: 'Campaign',
  language: 'Language',
  cohort: 'First visit',
  browsers: 'Opt-in browsers',
  day1: 'Day 1',
  day7: 'Day 7',
  day30: 'Day 30',
  day90: 'Day 90',
  day180: 'Day 180',
  metric: 'Metric',
  average: 'Average',
  unit: 'Unit',
  progress: 'Reading progress',
  reached: 'Observed readers',
  dropoffs: 'Drop-offs',
};
export const analyticsReports = {
  geography: { title: 'Geography', description: 'Explore approximate audience locations around the world.', table: 'Location observations' },
  technology: { title: 'Devices', description: 'Browsers, operating systems and coarse device capabilities.', table: 'Device observations' },
  visits: { title: 'Visits', description: 'Private document observations, not identified people.', table: 'Recent visits' },
  overview: {
    title: 'Overview',
    description: 'A clear view of observed reach and reading.',
    table: 'Leading content',
  },
  reach: {
    title: 'Reach',
    description: 'Where your work is discovered across the site.',
    table: 'Discovery surfaces',
  },
  engagement: {
    title: 'Engagement',
    description: 'How readers spend time with your work.',
    table: 'Section dwell',
  },
  audience: {
    title: 'Audience',
    description: 'Daily network estimates and available audience observations.',
    table: 'Detailed observations',
  },
  content: {
    title: 'Content',
    description: 'Compare published articles and their revisions.',
    table: 'Article performance',
  },
  quality: {
    title: 'Quality',
    description: 'Collection health and observed browser performance.',
    table: 'Browser observations',
  },
} as const;
export function analyticsTrendTooltip(
  report: AcaReport,
  comparison: AcaReport | null | undefined,
  metric: keyof AcaReport['series'][number],
  index: number,
) {
  return [report, comparison]
    .flatMap((period, i) => {
      const row = period?.series[index];
      if (!row) return [];
      const value = row[metric];
      return [
        t(i ? 'Previous period' : 'Selected period') +
          ' · ' +
          uiDate(row.day, { dateStyle: 'medium' }),
        t(analyticsColumns[metric] || metric) +
          ': ' +
          analyticsValue(
            typeof value === 'number' ? value : null,
            metric,
            metric === 'active' ? 's' : '',
          ),
      ];
    })
    .join('\n');
}
const rates = new Set([
  'ctr',
  'returningRate',
  'consent',
  'completion',
  'day1',
  'day7',
  'day30',
  'day90',
  'day180',
  'progress',
]);
export function analyticsValue(value: number | null, key = '', unit = '') {
  if (value === null || value === -1) return '—';
  const number = uiNumber(value, {
    maximumFractionDigits: rates.has(key) || unit === '%' ? 1 : Number.isInteger(value) ? 0 : 2,
  });
  if (rates.has(key) || unit === '%') return number + '%';
  if (key === 'activeMs')
    return t('{value} s', { value: uiNumber(value / 1000, { maximumFractionDigits: 1 }) });
  return unit ? `${number} ${t(unit)}` : number;
}
export function analyticsComparison(
  current: AcaReport['metrics'][number],
  previous?: AcaReport['metrics'][number],
) {
  if (current.value === null || previous?.value === null || previous?.value === undefined)
    return '';
  const difference = current.value - previous.value;
  if (current.unit === '%')
    return t('{value} pp vs previous', {
      value: (difference >= 0 ? '+' : '') + uiNumber(difference, { maximumFractionDigits: 1 }),
    });
  if (!previous.value) return current.value ? t('New activity') : t('No change');
  const percent = (difference / previous.value) * 100;
  return t('{value}% vs previous', {
    value: (percent >= 0 ? '+' : '') + uiNumber(percent, { maximumFractionDigits: 1 }),
  });
}
export function validAnalyticsRange(from: string, to: string, now = Date.now()) {
  for (const value of [from, to])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    )
      return 'Choose real start and end dates.';
  if (from > to) return 'The start date must be before the end date.';
  if (Date.parse(to) - Date.parse(from) > 729 * 86400000)
    return 'Choose a date range of up to 730 days.';
  if (to > new Date(now).toISOString().slice(0, 10)) return 'The end date cannot be in the future.';
  return '';
}
