import { SegmentControls, segmentValueLabel } from './SegmentControls.js';
import {
  parseSegment,
  hasSegment,
  segmentDimensions,
  type AcaSegment,
  type SegmentDimension,
} from '../shared/aca-segments.js';
import { UiText } from '../shared/UiText.js';
import { useUiLocale } from './LanguageControl.js';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { acaReports, type AcaReport, type AcaReportName } from '../shared/aca.js';
import {
  analyticsColumns,
  analyticsComparison,
  analyticsMetricIds,
  analyticsReports,
  analyticsValue,
  validAnalyticsRange,
} from '../shared/analytics-presentation.js';
import { t, uiDate, uiNumber } from '../shared/i18n.js';
import { routeFor, type PublicEntry, type SiteConfig, type Library } from '../shared/contracts.js';
import { defaultCollections, collectionIndexRoute } from '../shared/collections.js';
import { resolveAlbums, albumRoute } from '../shared/albums.js';
import { api } from './api.js';
import { Button, Icon } from '../shared/ui.js';
import { Field, ErrorBox, PageHeading, Modal } from './components.js';
import './analytics.css';
const SearchConsole = lazy(() =>
  import('./SearchConsole.js').then((m) => ({ default: m.SearchConsole })),
);
const AudienceGlobe = lazy(() =>
  import('./AudienceGlobe.js').then((m) => ({ default: m.AudienceGlobe })),
);
const AnalyticsChart = lazy(() =>
  import('./AnalyticsChart.js').then((m) => ({ default: m.AnalyticsChart })),
);
const RetentionChart = lazy(() =>
  import('./AnalyticsChart.js').then((m) => ({ default: m.RetentionChart })),
);
const day = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
type SeriesMetric = 'views' | 'active' | 'qualified' | 'impressions' | 'visitors' | 'networks';
type Filters = {
  from: string;
  to: string;
  content: string;
  revision: string;
  compare: boolean;
  segment: AcaSegment;
};
type Snapshot = {
  comparisonUnavailable?: boolean;
  report: AcaReport;
  comparison: AcaReport | null;
  filters: Filters;
  tab: AcaReportName;
};
function initialFilters(): Filters {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const from = params.get('from') || day(Date.now() - 27 * 86400000),
    to = params.get('to') || day(Date.now());
  const valid = !validAnalyticsRange(from, to);
  return {
    from: valid ? from : day(Date.now() - 27 * 86400000),
    to: valid ? to : day(Date.now()),
    content: params.get('content') || '',
    revision: params.get('revision') || '',
    compare: params.get('compare') === '1',
    segment: (() => {
      try {
        return parseSegment(params.get('segment'));
      } catch {
        return {};
      }
    })(),
  };
}
function downloadCsv(rows: Record<string, unknown>[], name: string) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value: unknown) =>
    '"' +
    (typeof value === 'string' ? value.replace(/^[=+@-]/, "'$&") : String(value ?? '')).replaceAll(
      '"',
      '""',
    ) +
    '"';
  const value = [
    keys.map(cell).join(','),
    ...rows.map((row) => keys.map((key) => cell(row[key])).join(',')),
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + value], { type: 'text/csv;charset=utf-8' }));
  Object.assign(document.createElement('a'), {
    href: url,
    download: 'aca-' + name + '.csv',
  }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function DataTable({
  rows,
  onContent,
  onSegment,
  titles = {},
  routes = {},
}: {
  rows: Record<string, string | number | null>[];
  onContent?: (content: string, revision: string) => void;
  onSegment?: (key: SegmentDimension, value: string) => void;
  titles?: Record<string, string>;
  routes?: Record<string, string>;
}) {
  const locale = useUiLocale();
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [limit, setLimit] = useState(25),
    [identifiers, setIdentifiers] = useState(false),
    [sort, setSort] = useState({ key: '', descending: false });
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter(
    (key) => identifiers || key !== 'revision',
  );
  const filtered = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim();
    const values = rows.filter(
      (row) =>
        !terms ||
        Object.values(row).some((value) =>
          String(titles[String(value)] || value || '')
            .toLocaleLowerCase()
            .includes(terms),
        ),
    );
    if (sort.key)
      values.sort((a, b) => {
        const left = a[sort.key],
          right = b[sort.key];
        const result =
          typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left ?? '').localeCompare(String(right ?? ''));
        return sort.descending ? -result : result;
      });
    return values;
  }, [rows, query, sort, titles]);
  const pages = Math.max(1, Math.ceil(filtered.length / limit));
  const currentPage = Math.min(page, pages - 1);
  const cohorts = keys.includes('cohort');
  if (!rows.length)
    return (
      <div className="aca-no-data">
        <Icon name="ChartNoAxesCombined" size={24} />
        <p>{t('No observations for these filters yet.')}</p>
      </div>
    );
  return (
    <>
      <div className="aca-table-tools">
        <label className="search-field">
          <Icon name="Search" size={14} />
          <input
            type="search"
            placeholder={t('Filter rows…')}
            aria-label={t('Filter report rows')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <span className="help">{t('{count} rows', { count: uiNumber(filtered.length) })}</span>
        {rows.some((row) => 'revision' in row) && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={identifiers}
              onChange={(event) => setIdentifiers(event.target.checked)}
            />
            {t('Show revision IDs')}
          </label>
        )}
      </div>
      <div
        className="aca-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={t(cohorts ? 'Returning-browser cohort table' : 'Report data table')}
      >
        <table className={'aca-table' + (cohorts ? ' aca-cohorts' : '')}>
          <thead>
            <tr>
              {keys.map((key) => (
                <th
                  key={key}
                  aria-sort={
                    sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none'
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSort({ key, descending: sort.key === key ? !sort.descending : true });
                      setPage(0);
                    }}
                  >
                    {t(analyticsColumns[key] || key)}
                    <Icon
                      name={
                        sort.key === key
                          ? sort.descending
                            ? 'ChevronDown'
                            : 'ChevronUp'
                          : 'ChevronsUpDown'
                      }
                      size={12}
                    />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(currentPage * limit, (currentPage + 1) * limit).map((row, index) => (
              <tr key={index}>
                {keys.map((key) => {
                  const value = row[key];
                  const content = key === 'content' || key === 'target';
                  const heat =
                    cohorts && /^day\d/.test(key) && typeof value === 'number' && value >= 0;
                  return (
                    <td
                      key={key}
                      className={key === 'revision' ? 'aca-identifier' : undefined}
                      style={
                        heat
                          ? {
                              background:
                                'color-mix(in srgb, var(--accent) ' +
                                Math.min(32, Number(value) * 0.32) +
                                '%, transparent)',
                            }
                          : undefined
                      }
                      title={
                        value === -1
                          ? t('Insufficient data or an incomplete observation window')
                          : key === 'revision'
                            ? String(value || '')
                            : undefined
                      }
                    >
                      {content && onContent ? (
                        <span className="aca-content-cell">
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => onContent(String(value), String(row.revision || ''))}
                          >
                            {titles[String(value)] || value}
                          </button>
                          {routes[String(value)] && (
                            <a
                              className="icon-button"
                              href={routes[String(value)]}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={t('Open published page')}
                            >
                              <Icon name="ArrowUpRight" size={13} />
                            </a>
                          )}
                        </span>
                      ) : key === 'section' && routes[String(row.content)] ? (
                        <a
                          className="text-link"
                          href={
                            routes[String(row.content)] + '#' + encodeURIComponent(String(value))
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          {String(value)}
                          <Icon name="ArrowUpRight" size={12} />
                        </a>
                      ) : value === -1 ? (
                        <span className="aca-unavailable">{t('Insufficient data')}</span>
                      ) : typeof value === 'number' ? (
                        analyticsValue(value, key, key === 'average' ? String(row.unit || '') : '')
                      ) : onSegment &&
                        value &&
                        segmentDimensions.includes(key as SegmentDimension) ? (
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => onSegment(key as SegmentDimension, String(value))}
                        >
                          {segmentValueLabel(key as SegmentDimension, String(value))}
                        </button>
                      ) : onSegment &&
                        key === 'value' &&
                        value &&
                        segmentDimensions.includes(row.dimension as SegmentDimension) ? (
                        <button
                          type="button"
                          className="text-link"
                          onClick={() =>
                            onSegment(row.dimension as SegmentDimension, String(value))
                          }
                        >
                          {segmentValueLabel(row.dimension as SegmentDimension, String(value))}
                        </button>
                      ) : key === 'revision' ? (
                        String(value || '—').slice(0, 12)
                      ) : key === 'device' ? (
                        t(
                          (
                            { phone: 'Phone', tablet: 'Tablet', desktop: 'Desktop' } as Record<
                              string,
                              string
                            >
                          )[String(value)] || String(value),
                        )
                      ) : key === 'country' && /^[A-Z]{2}$/.test(String(value)) ? (
                        new Intl.DisplayNames([locale], { type: 'region' }).of(String(value)) ||
                        String(value)
                      ) : key === 'dimension' ? (
                        t(analyticsColumns[String(value)] || String(value))
                      ) : key === 'unit' ? (
                        t(String(value ?? '—'))
                      ) : (
                        String(value ?? '—')
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <p className="aca-table-empty">{t('No matching rows.')}</p>}
      </div>
      {(filtered.length > 25 || page > 0) && (
        <div className="aca-pagination">
          <label>
            {t('Rows per page')}
            <select
              aria-label={t('Rows per page')}
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setPage(0);
              }}
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span>{t('Page {page} of {pages}', { page: currentPage + 1, pages })}</span>
          <Button
            className="small"
            icon="ChevronLeft"
            disabled={!currentPage}
            aria-label={t('Previous page')}
            onClick={() => setPage(currentPage - 1)}
          />
          <Button
            className="small"
            icon="ChevronRight"
            disabled={currentPage >= pages - 1}
            aria-label={t('Next page')}
            onClick={() => setPage(currentPage + 1)}
          />
        </div>
      )}
    </>
  );
}
export function Analytics({
  entries,
  onSettings,
  site,
  library,
}: {
  entries: PublicEntry[];
  onSettings: () => void;
  site?: SiteConfig;
  library?: Library;
}) {
  const locale = useUiLocale();
  const [service, setService] = useState<{
    enabled: boolean;
    paused: boolean;
    pendingDays: number;
    networkMode: string;
    capabilities?: string[];
  } | null>(null);
  const [tab, setTab] = useState<AcaReportName>(() => {
    const value = location.hash.split('/')[1]?.split('?')[0];
    return acaReports.includes(value as AcaReportName) ? (value as AcaReportName) : 'overview';
  });
  const [filters, setFilters] = useState(initialFilters),
    [draftFrom, setDraftFrom] = useState(filters.from),
    [draftTo, setDraftTo] = useState(filters.to),
    [rangeError, setRangeError] = useState('');
  const [metric, setMetric] = useState<SeriesMetric>('views'),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0),
    [chartView, setChartView] = useState<'chart' | 'table'>('chart');
  const [picker, setPicker] = useState(false),
    [contentQuery, setContentQuery] = useState(''),
    [revisions, setRevisions] = useState<string[]>([]);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ enabled: boolean; paused: boolean; pendingDays: number; networkMode: string }>(
      'analytics-status',
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setService(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setService(null);
      });
    return () => controller.abort();
  }, [reload, site?.integrations.aca.endpoint]);
  const collections = site?.collections || defaultCollections;
  const catalog = useMemo(() => {
    const pages = [
      { id: 'page:/', title: t('Homepage'), route: '/' },
      { id: 'page:/archive/', title: t('Archive'), route: '/archive/' },
      { id: 'page:/projects/', title: t('Projects'), route: '/projects/' },
      { id: 'page:/about/', title: t('About'), route: '/about/' },
      {
        id: 'page:' + collectionIndexRoute('life', collections),
        title: collections.life.name,
        route: collectionIndexRoute('life', collections),
      },
    ];
    if (library)
      for (const album of resolveAlbums(library).filter((item) => item.photos.length))
        pages.push({
          id: 'page:' + albumRoute(album, collections),
          title: album.name,
          route: albumRoute(album, collections),
        });
    return [
      ...entries
        .filter((entry) => entry.status === 'published')
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          route: routeFor(entry, collections),
        })),
      ...pages,
    ];
  }, [entries, collections, library, locale]);
  const titles = useMemo(
    () => Object.fromEntries(catalog.map((item) => [item.id, item.title])),
    [catalog],
  );
  const routes = useMemo(
    () => Object.fromEntries(catalog.map((item) => [item.id, item.route])),
    [catalog],
  );
  const requestKey = JSON.stringify({ tab, ...filters });
  useEffect(() => {
    const id = ++sequence.current;
    const controller = new AbortController();
    const invalid = validAnalyticsRange(filters.from, filters.to);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError('');
    const query = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      ...(filters.content ? { content: filters.content } : {}),
      ...(filters.revision ? { revision: filters.revision } : {}),
      ...(hasSegment(filters.segment) ? { segment: JSON.stringify(filters.segment) } : {}),
    });
    const previousTo = Date.parse(filters.from) - 86400000;
    const previousQuery = new URLSearchParams(query);
    previousQuery.set('to', day(previousTo));
    previousQuery.set(
      'from',
      day(previousTo - (Date.parse(filters.to) - Date.parse(filters.from))),
    );
    history.replaceState(
      null,
      '',
      '#analytics/' + tab + '?' + query + (filters.compare ? '&compare=1' : ''),
    );
    void Promise.all([
      api<AcaReport>('analytics/' + tab + '?' + query, { signal: controller.signal }),
      filters.compare
        ? api<AcaReport>('analytics/' + tab + '?' + previousQuery, { signal: controller.signal })
        : Promise.resolve(null),
    ])
      .then(([report, comparison]) => {
        const comparisonUnavailable =
          filters.compare &&
          !!(report.coverage?.missingDays.length || comparison?.coverage?.missingDays.length);
        if (id === sequence.current)
          setSnapshot({
            report,
            comparison: comparisonUnavailable ? null : comparison,
            comparisonUnavailable,
            filters: { ...filters },
            tab,
          });
      })
      .catch((failure) => {
        if (id === sequence.current && !controller.signal.aborted)
          setError((failure as Error).message);
      })
      .finally(() => {
        if (id === sequence.current) setBusy(false);
      });
    return () => controller.abort();
  }, [requestKey, reload]);
  useEffect(() => {
    setRevisions([]);
    if (!filters.content || filters.content.startsWith('page:')) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      content: filters.content,
    });
    void api<AcaReport>('analytics/content?' + query, { signal: controller.signal })
      .then((report) => {
        if (!controller.signal.aborted)
          setRevisions([
            ...new Set(report.rows.map((row) => String(row.revision || '')).filter(Boolean)),
          ]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [filters.content, filters.from, filters.to]);
  const selected = entries.find((entry) => entry.id === filters.content);
  const revisionOptions = [
    ...new Set(
      [...revisions, ...(selected ? [selected.revision] : []), filters.revision].filter(Boolean),
    ),
  ];
  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const drill = (content: string, revision: string) => {
    update({ content, revision });
    setTab('engagement');
  };
  const report = snapshot?.report;
  useEffect(() => {
    if (metric === 'networks' && hasSegment(report?.segment || {})) setMetric('views');
  }, [metric, report]);
  const exportRows = (rows: Record<string, unknown>[], name: string) =>
    downloadCsv(
      rows.map((row) => ({
        ...row,
        from: report?.from,
        to: report?.to,
        segment: JSON.stringify(report?.segment || {}),
        ...(report?.coverage ? { segmentCoverage: JSON.stringify(report.coverage) } : {}),
      })),
      name,
    );
  const shown = snapshot?.filters;
  const stale =
    !!snapshot && JSON.stringify({ tab: snapshot.tab, ...snapshot.filters }) !== requestKey;
  const canTrend =
    !!snapshot &&
    (['overview', 'content', 'engagement', 'audience'].includes(snapshot.tab) ||
      (snapshot.tab === 'reach' && !snapshot.filters.content));
  const choosePreset = (days: number) => {
    const from = day(Date.now() - (days - 1) * 86400000),
      to = day(Date.now());
    setDraftFrom(from);
    setDraftTo(to);
    setRangeError('');
    update({ from, to });
  };
  const addSegment = (key: SegmentDimension, value: string) =>
    update({ segment: { ...filters.segment, [key]: [value] } });
  const table = (rows: Record<string, string | number | null>[]) => (
    <DataTable
      rows={rows}
      onContent={drill}
      onSegment={service?.capabilities?.includes('segmentation-v1') ? addSegment : undefined}
      titles={titles}
      routes={routes}
    />
  );
  return (
    <div className="studio-page aca-dashboard">
      <PageHeading
        eyebrow={t('Advanced Customized Analytics')}
        title={t('Analytics')}
        description={t(analyticsReports[tab].description)}
      >
        <Button icon="Settings2" onClick={onSettings}>
          {t('Configure ACA')}
        </Button>
        <Button
          icon={busy ? 'LoaderCircle' : 'RotateCcw'}
          disabled={busy}
          onClick={() => setReload((value) => value + 1)}
        >
          {t('Refresh reports')}
        </Button>
      </PageHeading>
      <div className="aca-status-line">
        <span className={'aca-service-status' + (error ? ' unavailable' : '')}>
          <Icon name={error ? 'AlertCircle' : report ? 'CheckCircle2' : 'Circle'} size={14} />
          {t(
            error
              ? 'Report service unavailable'
              : report
                ? 'Report service connected'
                : 'Private reports',
          )}
        </span>
        <span>
          {report?.freshness
            ? t('Updated {time}', {
                time: uiDate(report.freshness, { dateStyle: 'medium', timeStyle: 'short' }),
              })
            : t('No observations yet')}
          <span className="aca-utc" data-ui={'UTC'}>
            {t('UTC')}
          </span>
        </span>
        {service && (
          <span className="aca-collection-status">
            {t(
              service.paused
                ? 'Collection paused at free-tier budget'
                : service.enabled
                  ? 'Collection enabled'
                  : 'Collection disabled',
            )}
            {service.pendingDays > 0 && (
              <span>
                {' '}
                · {t('Summaries updating: {count} days', { count: service.pendingDays })}
              </span>
            )}
          </span>
        )}
      </div>
      <section className="aca-filter-panel glass-panel" aria-label={t('Report filters')}>
        <div className="aca-presets" role="group" aria-label={t('Date range presets')}>
          {[7, 28, 90, 365].map((days) => (
            <button
              type="button"
              key={days}
              aria-pressed={
                filters.from === day(Date.now() - (days - 1) * 86400000) &&
                filters.to === day(Date.now())
              }
              onClick={() => choosePreset(days)}
            >
              {t('{days} days', { days })}
            </button>
          ))}
        </div>
        <div className="aca-filter-fields">
          <Field label={t('From (UTC)')}>
            <input
              type="date"
              value={draftFrom}
              max={day(Date.now())}
              onChange={(event) => setDraftFrom(event.target.value)}
            />
          </Field>
          <Field label={t('To (UTC)')}>
            <input
              type="date"
              value={draftTo}
              max={day(Date.now())}
              onChange={(event) => setDraftTo(event.target.value)}
            />
          </Field>
          <Button
            className="small aca-apply-range"
            disabled={draftFrom === filters.from && draftTo === filters.to}
            onClick={() => {
              const invalid = validAnalyticsRange(draftFrom, draftTo);
              setRangeError(invalid);
              if (!invalid) update({ from: draftFrom, to: draftTo });
            }}
          >
            {t('Apply range')}
          </Button>
          <Field label={t('Content')}>
            <button
              type="button"
              className="aca-content-picker"
              aria-haspopup="dialog"
              onClick={() => {
                setContentQuery('');
                setPicker(true);
              }}
            >
              <Icon name={filters.content ? 'FileText' : 'Globe'} size={15} />
              <span>
                {filters.content ? titles[filters.content] || filters.content : t('Entire site')}
              </span>
              <Icon name="ChevronsUpDown" size={13} />
            </button>
          </Field>
          <Field label={t('Revision')}>
            <select
              aria-label={t('Revision')}
              value={filters.revision}
              disabled={!filters.content || filters.content.startsWith('page:')}
              onChange={(event) => update({ revision: event.target.value })}
            >
              <option value="">{t('All revisions')}</option>
              {revisionOptions.map((value) => (
                <option key={value} value={value}>
                  {value === selected?.revision ? t('Current revision') : value.slice(0, 12)}
                </option>
              ))}
            </select>
          </Field>
          <label className="check-row aca-compare">
            <input
              type="checkbox"
              checked={filters.compare}
              onChange={(event) => update({ compare: event.target.checked })}
            />
            {t('Compare previous period')}
          </label>
        </div>
        {rangeError && (
          <p className="field-error" role="alert">
            {t(rangeError)}
          </p>
        )}
        {filters.to === day(Date.now()) && (
          <p className="aca-period-note">
            <Icon name="Info" size={12} />
            {t('Today is still in progress. Dates and comparisons use UTC.')}
          </p>
        )}
        <SegmentControls
          range={{
            from: filters.from,
            to: filters.to,
            content: filters.content,
            revision: filters.revision,
          }}
          segment={filters.segment}
          onApply={(segment) => update({ segment })}
          siteId={site?.integrations.aca.siteId || ''}
          enabled={!!service?.capabilities?.includes('segmentation-v1')}
        />
      </section>
      <nav
        className="aca-tabs"
        role="tablist"
        aria-label={t('Analytics reports')}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = acaReports.indexOf(tab);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? acaReports.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + acaReports.length) %
                  acaReports.length;
          setTab(acaReports[next]);
          document.getElementById('aca-tab-' + acaReports[next])?.focus();
        }}
      >
        {acaReports
          .filter((name) => !['geography', 'technology', 'visits'].includes(name))
          .map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={'aca-tab-' + name}
              aria-selected={
                tab === name ||
                (name === 'audience' && ['geography', 'technology', 'visits'].includes(tab))
              }
              aria-controls="aca-report"
              tabIndex={tab === name ? 0 : -1}
              onClick={() => setTab(name)}
            >
              {t(analyticsReports[name].title)}
            </button>
          ))}
      </nav>
      {['audience', 'geography', 'technology', 'visits'].includes(tab) && (
        <nav className="aca-audience-tabs segmented" aria-label={t('Audience reports')}>
          {(['audience', 'geography', 'technology', 'visits'] as AcaReportName[]).map((name) => (
            <button
              type="button"
              id={name === 'audience' ? 'aca-subtab-audience' : 'aca-tab-' + name}
              key={name}
              aria-pressed={tab === name}
              onClick={() => setTab(name)}
            >
              {t(name === 'audience' ? 'History' : analyticsReports[name].title)}
            </button>
          ))}
        </nav>
      )}
      {tab === 'reach' && (
        <Suspense fallback={<p>{t('Loading…')}</p>}>
          <SearchConsole property={site?.url || location.origin} />
        </Suspense>
      )}
      <ErrorBox error={t(error)} />
      <div id="aca-report" role="tabpanel" aria-labelledby={'aca-tab-' + tab} aria-busy={busy}>
        {snapshot && (stale || busy || error) && (
          <div className="aca-stale" role="status">
            <Icon name="Info" size={16} />
            <div>
              <strong>{t('Showing the last successful report')}</strong>
              <span>
                {t(analyticsReports[snapshot.tab].title)} · {snapshot.filters.from} —{' '}
                {snapshot.filters.to} ·{' '}
                {snapshot.filters.content
                  ? titles[snapshot.filters.content] || snapshot.filters.content
                  : t('Entire site')}
              </span>
            </div>
            {error && (
              <Button
                className="small"
                icon="RotateCcw"
                onClick={() => setReload((value) => value + 1)}
              >
                {t('Retry')}
              </Button>
            )}
          </div>
        )}
        {report && snapshot && shown ? (
          <>
            {shown.content && (
              <div className="aca-content-context">
                <Button
                  className="small"
                  icon="ChevronLeft"
                  onClick={() => update({ content: '', revision: '' })}
                >
                  {t('Entire site')}
                </Button>
                <strong>{titles[shown.content] || shown.content}</strong>
                {shown.revision && (
                  <code title={shown.revision}>{shown.revision.slice(0, 12)}</code>
                )}
              </div>
            )}
            {report.coverage && (
              <p className="aca-coverage" role="status">
                <Icon name="Info" size={14} />
                {t('Segment history: {covered} of {total} observed days available.', {
                  covered: report.coverage.coveredDays,
                  total: report.coverage.days,
                })}
                {!!report.coverage.missingDays.length &&
                  ' ' + t('Missing days are unavailable, not zero.')}
              </p>
            )}
            {snapshot.comparisonUnavailable && (
              <p className="aca-coverage" role="status">
                {t(
                  'Period comparison is unavailable until both periods have complete segment history.',
                )}
              </p>
            )}
            <div className="aca-metrics">
              {report.metrics.map((item) => {
                const id = analyticsMetricIds[item.label] || item.label;
                const previous = snapshot.comparison?.metrics.find(
                  (value) => (analyticsMetricIds[value.label] || value.label) === id,
                );
                const change = analyticsComparison(item, previous);
                const selectable =
                  canTrend &&
                  ['views', 'active', 'qualified', 'impressions', 'visitors', 'networks'].includes(
                    id,
                  );
                return (
                  <article
                    className={
                      'glass-panel aca-metric' + (selectable && metric === id ? ' selected' : '')
                    }
                    key={id}
                  >
                    {selectable ? (
                      <button
                        className="aca-metric-select"
                        type="button"
                        aria-pressed={metric === id}
                        onClick={() => setMetric(id as SeriesMetric)}
                        aria-label={t('Show {metric} over time', { metric: t(item.label) })}
                      >
                        <span>{t(item.label)}</span>
                        <strong>{analyticsValue(item.value, id, item.unit)}</strong>
                      </button>
                    ) : (
                      <>
                        <span>{t(item.label)}</span>
                        <strong>{analyticsValue(item.value, id, item.unit)}</strong>
                      </>
                    )}
                    {change && <span className="aca-comparison">{change}</span>}
                    <p>{item.note ? t(item.note) : t('Observed in the selected date range')}</p>
                  </article>
                );
              })}
            </div>
            {['geography', 'visits'].includes(snapshot.tab) && (
              <Suspense fallback={<p className="help">{t('Preparing Earth…')}</p>}>
                <AudienceGlobe
                  rows={report.rows}
                  visits={snapshot.tab === 'visits'}
                  countryFilter={
                    service?.capabilities?.includes('segmentation-v1')
                      ? shown.segment.country || []
                      : undefined
                  }
                  onCountry={
                    service?.capabilities?.includes('segmentation-v1')
                      ? (value) => {
                          const next = { ...filters.segment };
                          if (value) next.country = [value];
                          else delete next.country;
                          update({ segment: next });
                        }
                      : undefined
                  }
                />
              </Suspense>
            )}
            {canTrend && (
              <section className="settings-card glass-panel aca-trend">
                <div className="aca-section-head">
                  <div>
                    <h2>
                      <Icon name="ChartNoAxesCombined" size={19} />
                      {t('Performance over time')}
                    </h2>
                    <p className="help">
                      {shown.from} — {shown.to} <UiText message={' · UTC'} />
                    </p>
                  </div>
                  <div className="aca-chart-tools">
                    <select
                      aria-label={t('Chart metric')}
                      value={metric}
                      onChange={(event) => setMetric(event.target.value as SeriesMetric)}
                    >
                      {Object.entries({
                        views: 'Page views',
                        active: 'Active reading (s)',
                        qualified: 'Qualified reads',
                        impressions: 'Impressions',
                        ...(report.historyMode === 'optional-consent'
                          ? { visitors: 'Opt-in unique browsers' }
                          : {}),
                        ...(report.networkMode === 'daily' && !hasSegment(report.segment || {})
                          ? { networks: 'Estimated daily networks' }
                          : { visitors: 'Opt-in unique browsers' }),
                      }).map(([key, label]) => (
                        <option key={key} value={key}>
                          {t(label)}
                        </option>
                      ))}
                    </select>
                    <div className="aca-view-toggle" role="group" aria-label={t('Data view')}>
                      <button
                        type="button"
                        aria-pressed={chartView === 'chart'}
                        onClick={() => setChartView('chart')}
                      >
                        <Icon name="ChartNoAxesCombined" size={14} />
                        {t('Chart')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={chartView === 'table'}
                        onClick={() => setChartView('table')}
                      >
                        <Icon name="Table2" size={14} />
                        {t('Table')}
                      </button>
                    </div>
                  </div>
                </div>
                {chartView === 'chart' ? (
                  <>
                    <Suspense
                      fallback={<div className="aca-chart-loading">{t('Loading chart…')}</div>}
                    >
                      <AnalyticsChart
                        report={report}
                        metric={
                          metric === 'visitors' &&
                          report.networkMode === 'daily' &&
                          !hasSegment(report.segment || {}) &&
                          report.historyMode !== 'optional-consent'
                            ? 'networks'
                            : metric
                        }
                        comparison={snapshot.comparison}
                      />
                    </Suspense>
                    <details className="aca-exact-data">
                      <summary>{t('Daily observations')}</summary>
                      <Button
                        className="small"
                        icon="Download"
                        onClick={() =>
                          exportRows(report.series, 'daily-' + report.from + '-' + report.to)
                        }
                      >
                        {t('Export daily CSV')}
                      </Button>
                      {table(report.series)}
                    </details>
                  </>
                ) : (
                  table(report.series)
                )}
              </section>
            )}
            {snapshot.tab === 'reach' && !!report.breakdowns?.length && (
              <div className="aca-breakdowns">
                {report.breakdowns.map((breakdown) => (
                  <section className="settings-card glass-panel" key={breakdown.name}>
                    <h2>{t(analyticsColumns[breakdown.name] || breakdown.name)}</h2>
                    <div className="aca-distribution">
                      {breakdown.rows.slice(0, 5).map((row, index) => (
                        <div key={index}>
                          <button
                            className="text-link"
                            onClick={() =>
                              addSegment(
                                breakdown.name as SegmentDimension,
                                String(row[breakdown.name] || 'direct'),
                              )
                            }
                          >
                            {segmentValueLabel(
                              breakdown.name as SegmentDimension,
                              String(row[breakdown.name] || 'direct'),
                            )}
                          </button>
                          <strong>{uiNumber(Number(row.views || 0))}</strong>
                          <i
                            style={{
                              width:
                                (Math.max(0, Number(row.views || 0)) /
                                  Math.max(
                                    1,
                                    ...breakdown.rows.map((value) => Number(value.views || 0)),
                                  )) *
                                  100 +
                                '%',
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <details className="aca-exact-data">
                      <summary>{t('View all observations')}</summary>
                      {table(breakdown.rows)}
                    </details>
                  </section>
                ))}
              </div>
            )}
            {snapshot.tab === 'engagement' && (
              <section className="settings-card glass-panel">
                <div className="aca-section-head">
                  <h2>
                    <Icon name="ChartNoAxesCombined" size={19} />
                    {t('Reading retention')}
                  </h2>
                  <span className="help">{t('5% progress buckets')}</span>
                </div>
                {report.retention.length ? (
                  <>
                    <Suspense fallback={<p>{t('Loading retention…')}</p>}>
                      <RetentionChart report={report} />
                    </Suspense>
                    <details className="aca-exact-data">
                      <summary>{t('Retention observations')}</summary>
                      {table(report.retention)}
                    </details>
                  </>
                ) : (
                  <div className="aca-no-data">
                    <Icon name="BookOpen" size={25} />
                    <p>
                      {t(
                        'Select one content revision with at least 10 qualified reads to display a meaningful retention curve.',
                      )}
                    </p>
                  </div>
                )}
              </section>
            )}
            {snapshot.tab === 'audience' &&
              (report.networkMode !== 'daily' || report.historyMode === 'optional-consent') && (
                <section className="settings-card glass-panel">
                  <div className="aca-section-head">
                    <h2>{t('Returning-browser cohorts')}</h2>
                    {!!report.cohorts.length && (
                      <Button
                        className="small"
                        icon="Download"
                        onClick={() =>
                          exportRows(report.cohorts, 'cohorts-' + report.from + '-' + report.to)
                        }
                      >
                        {t('Export cohort CSV')}
                      </Button>
                    )}
                  </div>
                  <p className="help">
                    {t(
                      'Exact-day returns among opted-in browsers. Incomplete windows and small cohorts remain unavailable.',
                    )}
                  </p>
                  {table(report.cohorts)}
                </section>
              )}
            {(report.rows.length > 0 || snapshot.tab !== 'audience') && (
              <section className="settings-card glass-panel">
                <div className="aca-section-head">
                  <h2>{t(analyticsReports[snapshot.tab].table)}</h2>
                  <Button
                    className="small"
                    icon="Download"
                    onClick={() =>
                      exportRows(report.rows, report.name + '-' + report.from + '-' + report.to)
                    }
                  >
                    {t('Export report CSV')}
                  </Button>
                </div>
                {table(report.rows)}
              </section>
            )}
            {snapshot.tab === 'visits' && report.nextCursor && report.rows.length < 1000 && (
              <Button
                disabled={busy}
                onClick={async () => {
                  const request = ++sequence.current;
                  setBusy(true);
                  const query = new URLSearchParams({
                    from: snapshot.filters.from,
                    to: snapshot.filters.to,
                    cursor: report.nextCursor!,
                  });
                  if (snapshot.filters.content) query.set('content', snapshot.filters.content);
                  if (snapshot.filters.revision) query.set('revision', snapshot.filters.revision);
                  try {
                    const next = await api<AcaReport>('analytics/visits?' + query);
                    if (request === sequence.current)
                      setSnapshot({
                        ...snapshot,
                        report: { ...next, rows: [...report.rows, ...next.rows] },
                      });
                  } catch (failure) {
                    if (request === sequence.current) setError((failure as Error).message);
                  } finally {
                    if (request === sequence.current) setBusy(false);
                  }
                }}
              >
                {t('Load more visits')}
              </Button>
            )}
            <details className="aca-methodology glass-panel">
              <summary>
                <Icon name="CircleHelp" size={17} />
                {t('How to read these numbers')}
              </summary>
              <p>
                {t('Data freshness')}:{' '}
                {report.freshness
                  ? uiDate(report.freshness, { dateStyle: 'medium', timeStyle: 'short' }) + ' · UTC'
                  : t('No observations yet')}
              </p>
              <ul>
                {report.notes.map((note, index) => (
                  <li key={index}>{t(note)}</li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <div className="empty-state glass-panel">
            <Icon name="ChartNoAxesCombined" size={32} />
            <h2>
              {t(
                busy
                  ? 'Connecting to ACA…'
                  : error
                    ? 'Reports could not load'
                    : 'Connect your analytics service',
              )}
            </h2>
            <p>
              {t(
                error
                  ? 'Check the report connection or retry. Your notebook and collected observations are unchanged.'
                  : 'Configure the independent Worker and private report token to begin. Collection stays off until you enable ACA and rebuild.',
              )}
            </p>
            <div className="page-actions">
              <Button icon="Settings2" onClick={onSettings}>
                {t('Configure ACA')}
              </Button>
              {error && (
                <Button icon="RotateCcw" onClick={() => setReload((value) => value + 1)}>
                  {t('Retry')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      {picker && (
        <Modal title={t('Choose content')} onClose={() => setPicker(false)}>
          <label className="search-field">
            <Icon name="Search" size={16} />
            <input
              type="search"
              value={contentQuery}
              placeholder={t('Search pages and articles…')}
              aria-label={t('Search content')}
              data-modal-focus
              onChange={(event) => setContentQuery(event.target.value)}
            />
          </label>
          <div className="aca-content-options">
            <button
              type="button"
              onClick={() => {
                update({ content: '', revision: '' });
                setPicker(false);
              }}
            >
              <Icon name="Globe" size={16} />
              <strong>{t('Entire site')}</strong>
            </button>
            {catalog
              .filter((item) =>
                (item.title + ' ' + item.route)
                  .toLocaleLowerCase()
                  .includes(contentQuery.trim().toLocaleLowerCase()),
              )
              .map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    update({ content: item.id, revision: '' });
                    setPicker(false);
                  }}
                >
                  <Icon name="FileText" size={16} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.route}</small>
                  </span>
                  {filters.content === item.id && <Icon name="Check" size={15} />}
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
