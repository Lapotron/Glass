import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState } from 'react';
import { chartSchema, chartStyles, type ChartConfig } from '../shared/chart-schema.js';
import { chartExample } from '../shared/chart-examples.js';
import { importChartData } from '../shared/chart-import.js';
import { chartRows } from '../shared/chart-data.js';
import { cartesianChart } from '../shared/chart-options.js';
import { Field, ErrorBox } from './components.js';
import { Button } from '../shared/ui.js';
function dataFields(c: ChartConfig) {
  return c.style === 'sankey'
    ? { nodes: c.nodes, links: c.links }
    : c.style === 'heatmap'
      ? { labels: c.labels, yLabels: c.yLabels, cells: c.cells }
      : ['treemap', 'sunburst'].includes(c.style)
        ? { tree: c.tree }
        : { labels: c.labels, series: c.series };
}
export function ChartFields({
  config,
  onChange,
  onError,
}: {
  config: ChartConfig;
  onChange: (patch: Record<string, unknown>) => void;
  onError: (error: string) => void;
}) {
  const [data, setData] = useState(JSON.stringify(dataFields(config), null, 2)),
    [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const issues = useRef({ data: '', marks: '' });
  const report = (key: 'data' | 'marks', message: string) => {
    issues.current[key] = message;
    const combined = Object.values(issues.current).filter(Boolean).join('\n');
    setError(combined);
    onError(combined);
  };
  const validate = (patch: Record<string, unknown>) => {
    const result = chartSchema.safeParse({ ...config, ...patch });
    if (!result.success)
      throw new Error(
        result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
      );
    return result.data;
  };
  useEffect(() => {
    onError('');
  }, []);
  const changeData = (text: string) => {
    setData(text);
    try {
      const parsed = JSON.parse(text);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
        throw new Error('Use an object with the data fields shown in the example.');
      const allowed = Object.keys(dataFields(config));
      if (Object.keys(parsed).some((k) => !allowed.includes(k)))
        throw new Error(`Data fields for this chart: ${allowed.join(', ')}.`);
      const patch = Object.fromEntries(allowed.map((key) => [key, parsed[key] ?? []]));
      onChange(validate(patch));
      report('data', '');
    } catch (e) {
      const message = (e as Error).message;
      report('data', message);
    }
  };
  const importData = (text: string) => {
    try {
      const patch = importChartData(text, config.style);
      const valid = validate(patch);
      onChange(valid);
      setData(JSON.stringify(dataFields(valid), null, 2));
      report('data', '');
    } catch (e) {
      report('data', (e as Error).message);
    }
  };
  const summary = chartRows(config);
  return (
    <div className="chart-fields">
      <div className="field-row">
        <Field label={t("Chart type")}>
          <select
            value={config.style}
            onChange={(e) => {
              onError('');
              onChange({
                ...chartExample(e.target.value as ChartConfig['style']),
                title: config.title,
                caption: config.caption,
              });
            }}
          >
            {chartStyles.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Tooltip")}>
          <select value={config.tooltip} onChange={(e) => onChange({ tooltip: e.target.value })}>
            <option value="shared" data-ui={"Shared axis values"}>{t("Shared axis values")}</option>
            <option value="item" data-ui={"Individual data point"}>{t("Individual data point")}</option>
          </select>
        </Field>
      </div>
      <div className="chart-data-actions">
        <Button className="small" icon="Upload" onClick={() => file.current?.click()}>
          <UiText message={"Import CSV / TSV"}/></Button>
        <Button
          className="small"
          icon="Copy"
          onClick={() =>
            void navigator.clipboard
              .readText()
              .then(importData)
              .catch(() => setError('Clipboard access is unavailable. Import a file instead.'))
          }
        >
          <UiText message={"Paste data"}/></Button>
        <span className="muted">
          {summary.rows.length} <UiText message={" rows · "}/>{summary.headers.length} <UiText message={" columns"}/></span>
        <input
          ref={file}
          hidden
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              if (f.size > 2_000_000) setError('Use a data file smaller than 2 MB.');
              else void f.text().then(importData);
            }
            e.target.value = '';
          }}
        />
      </div>
      <Field
        label={t("Chart data")}
        help={
          ['treemap', 'sunburst'].includes(config.style)
            ? t("Tree nodes use name, optional value and children. CSV columns: path, value.")
            : config.style === 'sankey'
              ? t("Use nodes and acyclic links. CSV columns: source, target, value.")
              : config.style === 'heatmap'
                ? t("Cells are [x index, y index, value]. CSV columns: x, y, value.")
                : ['scatter', 'bubble'].includes(config.style)
                  ? t("Points use x, y and optional r, label, low and high. CSV needs x and y headers.")
                  : t("Each series needs one value per label. CSV: first column labels, remaining columns series.")
        }
      >
        <textarea
          className="mono chart-json"
          rows={9}
          value={data}
          onChange={(e) => changeData(e.target.value)}
          spellCheck={false}
          aria-invalid={!!error}
        />
      </Field>
      <ErrorBox error={error} />
      <div className="field-row">
        <Field label={t("Value precision")}>
          <input
            type="number"
            min={0}
            max={10}
            value={config.format.precision}
            onChange={(e) =>
              onChange({ format: { ...config.format, precision: Number(e.target.value) } })
            }
          />
        </Field>
        <Field label={t("Value suffix / unit")}>
          <input
            value={config.format.suffix}
            placeholder={t(" ms, %, kg…")}
            onChange={(e) => onChange({ format: { ...config.format, suffix: e.target.value } })}
           data-ui-attrs={"{\"placeholder\":\" ms, %, kg…\"}"} />
        </Field>
      </div>
      <div className="chart-option-toggles">
        <label className="check-label">
          <input
            type="checkbox"
            checked={config.legend}
            onChange={(e) => onChange({ legend: e.target.checked })}
          />
          <UiText message={"Show legend"}/></label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={config.format.compact}
            onChange={(e) => onChange({ format: { ...config.format, compact: e.target.checked } })}
          />
          <UiText message={"Compact numbers"}/></label>
        {cartesianChart(config) && (
          <>
            <label className="check-label">
              <input
                type="checkbox"
                checked={config.zoom}
                onChange={(e) => onChange({ zoom: e.target.checked })}
              />
              <UiText message={"Range and zoom controls"}/></label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={config.horizontal}
                onChange={(e) => onChange({ horizontal: e.target.checked })}
              />
              <UiText message={"Horizontal orientation"}/></label>
          </>
        )}
      </div>
      {['line', 'area', 'bar', 'mixed'].includes(config.style) && (
        <Field label={t("Stacking")}>
          <select value={config.stacking} onChange={(e) => onChange({ stacking: e.target.value })}>
            <option value="none" data-ui={"Separate series"}>{t("Separate series")}</option>
            <option value="normal" data-ui={"Stacked"}>{t("Stacked")}</option>
            <option value="percent" data-ui={"100% stacked"}>{t("100% stacked")}</option>
          </select>
        </Field>
      )}
      {cartesianChart(config) && (
        <details className="chart-axis-fields">
          <summary data-ui={"Axes, references and synchronization"}>{t("Axes, references and synchronization")}</summary>
          {(['xAxis', 'yAxis', 'rightAxis'] as const).map((key) => (
            <div className="field-row" key={key}>
              <Field
                label={t("{value0} axis title", {value0: key === 'xAxis' ? 'X' : key === 'yAxis' ? 'Y' : 'Right Y'})}
              >
                <input
                  value={config[key]?.title || ''}
                  onChange={(e) =>
                    onChange({
                      [key]: {
                        type:
                          key === 'xAxis'
                            ? config.series.some((s) => s.points?.length)
                              ? 'value'
                              : 'category'
                            : 'value',
                        ...config[key],
                        title: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field
                label={t("{value0} axis scale", {value0: key === 'xAxis' ? 'X' : key === 'yAxis' ? 'Y' : 'Right Y'})}
              >
                <select
                  value={
                    config[key]?.type ||
                    (key === 'xAxis' && config.labels.length ? 'category' : 'value')
                  }
                  onChange={(e) =>
                    onChange({ [key]: { title: '', ...config[key], type: e.target.value } })
                  }
                >
                  {(key === 'xAxis' ? ['category', 'value', 'time', 'log'] : ['value', 'log']).map(
                    (s) => (
                      <option key={s}>{s}</option>
                    ),
                  )}
                </select>
              </Field>
            </div>
          ))}
          <Field
            label={t("Synchronized cursor group")}
            help={t("Charts with matching domains and the same group share a cursor.")}
          >
            <input
              value={config.syncGroup || ''}
              placeholder={t("experiment")}
              onChange={(e) => onChange({ syncGroup: e.target.value || undefined })}
             data-ui-attrs={"{\"placeholder\":\"experiment\"}"} />
          </Field>
          <Field
            label={t("Reference marks (JSON)")}
            help={
              t("For example: [{\"type\":\"line\",\"axis\":\"y\",\"value\":20,\"label\":\"Target\"}]. Points can specify x; bands need end.")
            }
          >
            <textarea
              rows={3}
              className="mono"
              defaultValue={JSON.stringify(config.annotations, null, 2)}
              onChange={(e) => {
                try {
                  const marks = JSON.parse(e.target.value);
                  if (!Array.isArray(marks)) throw new Error('Use an array for reference marks.');
                  onChange(validate({ annotations: marks }));
                  report('marks', '');
                } catch (issue) {
                  report('marks', (issue as Error).message);
                }
              }}
            />
          </Field>
        </details>
      )}
    </div>
  );
}
