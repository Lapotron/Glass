import { t, uiDate, uiNumber } from '../shared/i18n.js';
import { useUiLocale } from './LanguageControl.js';
import { analyticsColumns, analyticsTrendTooltip } from '../shared/analytics-presentation.js';
import { useEffect, useRef, useState } from 'react';
import type { AcaReport } from '../shared/aca.js';
export function AnalyticsChart({
  report,
  metric = 'views',
  comparison,
}: {
  report: AcaReport;
  metric?: 'views' | 'active' | 'qualified' | 'impressions' | 'visitors' | 'networks';
  comparison?: AcaReport | null;
}) {
  const locale = useUiLocale();
  const ref = useRef<HTMLDivElement>(null);
  const reset = useRef<(() => void) | undefined>(undefined);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    let cancelled = false,
      dispose: (() => void) | undefined;
    void Promise.all([
      import('../site/widgets/echarts-core.js'),
      import('../site/widgets/echarts-cartesian.js'),
    ])
      .then(([ec, cartesian]) => {
        if (cancelled || !ref.current) return;
        cartesian.register();
        const chart = ec.init(ref.current, undefined, { renderer: 'svg' });
        setZoomed(false);
        reset.current = () => chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
        chart.on('datazoom', (value: unknown) => {
          const event = value as {
            start?: number;
            end?: number;
            batch?: { start?: number; end?: number }[];
          };
          const range = event.batch?.[0] || event;
          setZoomed((range.start ?? 0) > 0 || (range.end ?? 100) < 100);
        });
        const draw = () => {
          const style = getComputedStyle(ref.current!);
          chart.setOption({
            animation:
              !matchMedia('(prefers-reduced-motion: reduce)').matches &&
              document.documentElement.dataset.reduceMotion !== 'true',
            aria: {
              enabled: true,
              label: {
                description: t('{metric} by day. Use the data table for exact values.', {
                  metric: t(analyticsColumns[metric] || metric),
                }),
              },
            },
            color: [style.getPropertyValue('--accent-text'), style.getPropertyValue('--muted')],
            textStyle: {
              color: style.getPropertyValue('--muted'),
              fontFamily: style.getPropertyValue('--font'),
            },
            tooltip: {
              trigger: 'axis',
              renderMode: 'richText',
              formatter: (points: unknown) => {
                const point = (Array.isArray(points) ? points[0] : points) as {
                  dataIndex?: number;
                };
                return analyticsTrendTooltip(report, comparison, metric, point?.dataIndex ?? 0);
              },
              confine: true,
              backgroundColor: style.getPropertyValue('--surface-solid'),
              borderColor: style.getPropertyValue('--glass-border'),
              textStyle: { color: style.getPropertyValue('--text') },
            },
            legend: { bottom: 0, textStyle: { color: style.getPropertyValue('--muted') } },
            grid: { left: 48, right: 22, top: 20, bottom: 75 },
            xAxis: {
              type: 'category',
              data: report.series.map((r) => r.day),
              axisLabel: {
                hideOverlap: true,
                color: style.getPropertyValue('--muted'),
                formatter: (value: string) => uiDate(value, { month: 'short', day: 'numeric' }),
              },
              axisLine: { lineStyle: { color: style.getPropertyValue('--line') } },
            },
            yAxis: {
              type: 'value',
              minInterval: 1,
              axisLabel: {
                color: style.getPropertyValue('--muted'),
                formatter: (value: number) =>
                  uiNumber(value, { notation: 'compact', maximumFractionDigits: 1 }),
              },
              splitLine: { lineStyle: { color: style.getPropertyValue('--line') } },
            },
            dataZoom: [
              { type: 'inside', zoomOnMouseWheel: false, moveOnMouseWheel: false },
              {
                type: 'slider',
                bottom: 28,
                height: 16,
                borderColor: 'transparent',
                fillerColor: style.getPropertyValue('--accent-soft'),
              },
            ],
            series: [
              {
                name: t(analyticsColumns[metric] || metric),
                type: 'line',
                data: report.series.map((r) => r[metric]),
                smooth: 0.2,
                showSymbol: false,
                lineStyle: { width: 3 },
                areaStyle: { opacity: 0.08 },
              },
              ...(comparison
                ? [
                    {
                      name: t('Previous period'),
                      type: 'line',
                      data: comparison.series.map((r) => r[metric]),
                      showSymbol: false,
                      lineStyle: { type: 'dashed', width: 2 },
                    },
                  ]
                : []),
            ],
          });
        };
        draw();
        const resize = new ResizeObserver(() => chart.resize());
        resize.observe(ref.current);
        const theme = new MutationObserver(draw);
        theme.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme', 'style', 'data-background'],
        });
        dispose = () => {
          resize.disconnect();
          theme.disconnect();
          chart.dispose();
          reset.current = undefined;
        };
      })
      .catch(() => {
        if (ref.current)
          ref.current.textContent = t(
            'Chart could not load. The data table remains available below.',
          );
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [report, metric, comparison, locale]);
  return (
    <div className="aca-chart-frame">
      <div className="aca-chart-actions">
        <button
          type="button"
          className="text-link"
          disabled={!zoomed}
          onClick={() => reset.current?.()}
        >
          {t('Reset zoom')}
        </button>
      </div>
      <div
        className="aca-chart"
        ref={ref}
        role="img"
        aria-label={t('{metric} by day. Use the data table for exact values.', {
          metric: t(analyticsColumns[metric] || metric),
        })}
      />
    </div>
  );
}
export function RetentionChart({ report }: { report: AcaReport }) {
  const locale = useUiLocale();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dispose: (() => void) | undefined,
      cancelled = false;
    void Promise.all([
      import('../site/widgets/echarts-core.js'),
      import('../site/widgets/echarts-cartesian.js'),
    ])
      .then(([ec, cartesian]) => {
        if (cancelled || !ref.current) return;
        cartesian.register();
        const chart = ec.init(ref.current, undefined, { renderer: 'svg' });
        const draw = () => {
          const style = getComputedStyle(ref.current!);
          const axis = { color: style.getPropertyValue('--muted') };
          chart.setOption({
            animation: false,
            aria: {
              enabled: true,
              label: {
                description: t(
                  'Observed reading retention, dwell and drop-offs by 5% progress bucket',
                ),
              },
            },
            textStyle: { ...axis, fontFamily: style.getPropertyValue('--font') },
            tooltip: {
              trigger: 'axis',
              confine: true,
              backgroundColor: style.getPropertyValue('--surface-solid'),
              borderColor: style.getPropertyValue('--glass-border'),
              textStyle: { color: style.getPropertyValue('--text') },
            },
            legend: { bottom: 0, textStyle: axis },
            grid: { left: 50, right: 30, bottom: 55 },
            xAxis: {
              type: 'category',
              data: report.retention.map((r) => `${r.progress}%`),
              axisLabel: { ...axis, hideOverlap: true },
              axisLine: { lineStyle: { color: style.getPropertyValue('--line') } },
            },
            yAxis: [
              {
                type: 'value',
                name: t('Readers'),
                axisLabel: {
                  ...axis,
                  formatter: (value: number) =>
                    uiNumber(value, { notation: 'compact', maximumFractionDigits: 1 }),
                },
                nameTextStyle: axis,
                splitLine: { lineStyle: { color: style.getPropertyValue('--line') } },
              },
              {
                type: 'value',
                name: t('Dwell (s)'),
                axisLabel: {
                  ...axis,
                  formatter: (value: number) =>
                    uiNumber(value, { notation: 'compact', maximumFractionDigits: 1 }),
                },
                nameTextStyle: axis,
                splitLine: { show: false },
              },
            ],
            series: [
              {
                name: t('Observed readers'),
                type: 'line',
                data: report.retention.map((r) => r.reached),
                color: style.getPropertyValue('--accent-text'),
              },
              {
                name: t('Drop-offs'),
                type: 'bar',
                data: report.retention.map((r) => r.dropoffs),
                color: style.getPropertyValue('--faint'),
              },
              {
                name: t('Dwell'),
                type: 'line',
                yAxisIndex: 1,
                data: report.retention.map((r) => Math.round(r.activeMs / 1000)),
                color: style.getPropertyValue('--success'),
              },
            ],
          });
        };
        draw();
        const resize = new ResizeObserver(() => chart.resize());
        resize.observe(ref.current);
        const theme = new MutationObserver(draw);
        theme.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme', 'style', 'data-background'],
        });
        dispose = () => {
          resize.disconnect();
          theme.disconnect();
          chart.dispose();
        };
      })
      .catch(() => {
        if (ref.current)
          ref.current.textContent = t(
            'Chart could not load. The data table remains available below.',
          );
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [report, locale]);
  return (
    <div
      className="aca-chart"
      ref={ref}
      role="img"
      aria-label={t('Observed reading retention, dwell and drop-offs by 5% progress bucket')}
      data-ui-attrs={
        '{"aria-label":"Observed reading retention, dwell and drop-offs by 5% progress bucket"}'
      }
    />
  );
}
