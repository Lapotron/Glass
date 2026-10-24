import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState, createContext, useContext } from 'react';
import type { MathSettings } from '../shared/math-authoring.js';
import { Compartment, StateEffect, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Button, Icon } from '../shared/ui.js';
import {
  componentLabels,
  type SourceComponent,
  type ComponentPreviewResult,
} from '../shared/source-components.js';
import {
  parseSourceTable,
  writeSourceTable,
  changeSourceTable,
  tableDelimited,
} from '../shared/source-table.js';
import { parseMarkdown } from '../shared/markdown-analysis.js';
import { readDelimited } from '../shared/tabular-data.js';
import { interactiveSchema, type InteractiveConfig } from '../shared/interactives.js';
import { ErrorBox, Field, Modal, MediaPicker } from './components.js';
import { ChartFields } from './ChartFields.js';
import { MermaidSourceField } from './MermaidSourceField.js';
import { api } from './api.js';
import { componentPreviewFragment } from './source-components.js';
import { registerDiagramViewers } from '../shared/diagram-viewer.js';
import { diagramFromFigure, diagramSvgBlob, diagramFilename } from '../shared/diagram-svg.js';
import '../site/markdown-components.css';
import '../site/scholarly.css';
import '../site/charts.css';
import '../site/mindmap.css';
import './source-components.css';
const MathContext = createContext<MathSettings | undefined>(undefined);

export function fencedValue(block: SourceComponent) {
  const tree: any = parseMarkdown(block.source);
  return tree.children[0]?.value || '';
}
export function replaceFence(source: string, body: string) {
  const first = source.split('\n', 1)[0];
  const match = /^(`{3,}|~{3,})(.*)$/.exec(first);
  if (!match) throw new Error('Reopen a complete fenced component before editing.');
  const char = match[1][0];
  const longest = Math.max(
    match[1].length,
    ...[...body.matchAll(new RegExp(char + '+', 'g'))].map((m) => m[0].length + 1),
  );
  const fence = char.repeat(longest);
  return fence + match[2] + '\n' + body.replace(/\n$/, '') + '\n' + fence;
}
/** Track edits outside an open component, but refuse an edit into changed source. */
function useCapturedComponent(view: EditorView, block: SourceComponent) {
  const range = useRef({ from: block.from, to: block.to });
  const invalid = useRef(false),
    [stale, setStale] = useState(false);
  useEffect(() => {
    const compartment = new Compartment();
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        compartment.of(
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.changes.touchesRange(range.current.from, range.current.to)) {
              invalid.current = true;
              setStale(true);
            }
            range.current = {
              from: update.changes.mapPos(range.current.from),
              to: update.changes.mapPos(range.current.to),
            };
          }),
        ),
      ),
    });
    return () => {
      if (view.dom.isConnected) view.dispatch({ effects: compartment.reconfigure([]) });
    };
  }, [view]);
  const apply = (source: string) => {
    if (
      !view.dom.isConnected ||
      invalid.current ||
      view.state.doc.sliceString(range.current.from, range.current.to) !== block.source
    )
      throw new Error('This component changed. Close and reopen its tools before applying.');
    view.dispatch({
      changes: { ...range.current, insert: source },
      effects: view.scrollSnapshot(),
      annotations: Transaction.userEvent.of('input.component'),
    });
  };
  return { stale, apply, range };
}

function Preview({
  source,
  from,
  to,
  interactive = false,
  onResult,
}: {
  source: string;
  from: number;
  to: number;
  interactive?: boolean;
  onResult?: (result: ComponentPreviewResult, renderedSource: string) => void;
}) {
  const math = useContext(MathContext);
  const host = useRef<HTMLDivElement>(null),
    callback = useRef(onResult);
  callback.current = onResult;
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    let disposeDiagrams: (() => void) | undefined;
    const timer = setTimeout(
      () => {
        setBusy(true);
        setError('');
        void api<{ results: ComponentPreviewResult[] }>('authoring/component-preview', {
          method: 'POST',
          signal: abort.signal,
          body: JSON.stringify({ source, blocks: [{ from, to }], math }),
        })
          .then(async ({ results }) => {
            if (!alive) return;
            const result = results[0];
            callback.current?.(result, source);
            if (!result || typeof result.html !== 'string')
              throw new Error(result?.error || 'Incomplete preview.');
            const node = host.current!;
            node.replaceChildren(componentPreviewFragment(result.html, interactive));
            disposeDiagrams = registerDiagramViewers(node);
            if (interactive) {
              if (node.querySelector('.md-mindmap'))
                (await import('../site/mindmap.js')).enhanceMindmap(node);
              const { enhanceWidget } = await import('../site/widgets.js');
              if (!alive) return;
              await Promise.all(
                [...node.querySelectorAll<HTMLElement>('[data-interactive]')].map((element) =>
                  enhanceWidget(element),
                ),
              );
            }
          })
          .catch((e) => {
            if (alive && e.name !== 'AbortError') {
              setError(e.message);
              callback.current?.({ error: e.message }, source);
            }
          })
          .finally(() => {
            if (alive) setBusy(false);
          });
      },
      interactive ? 0 : 180,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      abort.abort();
      disposeDiagrams?.();
    };
  }, [source, from, to, interactive]);
  return (
    <>
      <ErrorBox error={error} />
      <div ref={host} className="source-component-expanded prose" aria-busy={busy} />
      {busy && (
        <p className="help" role="status" data-ui={'Rendering preview…'}>
          {t('Rendering preview…')}
        </p>
      )}
    </>
  );
}

export function SourceComponentTools({
  view,
  block,
  mode,
  cell,
  onClose,
  math,
}: {
  view: EditorView;
  block: SourceComponent;
  mode: 'edit' | 'expand';
  cell?: { row: number; column: number };
  onClose: () => void;
  math?: MathSettings;
}) {
  return (
    <MathContext.Provider value={math}>
      {block.kind === 'table' ? (
        <SourceTableEditor view={view} block={block} cell={cell} onClose={onClose} />
      ) : (
        <VisualComponentTools view={view} block={block} mode={mode} onClose={onClose} />
      )}
    </MathContext.Provider>
  );
}
function SourceTableEditor({
  view,
  block,
  cell,
  onClose,
}: {
  view: EditorView;
  block: SourceComponent;
  cell?: { row: number; column: number };
  onClose: () => void;
}) {
  const capture = useCapturedComponent(view, block);
  const [table, setTable] = useState(() => parseSourceTable(block.source));
  const [selected, setSelected] = useState(
    cell || { row: Math.min(1, table.rows.length - 1), column: 0 },
  );
  const [page, setPage] = useState(Math.floor(Math.max(0, (cell?.row || 1) - 1) / 50));
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [importing, setImporting] = useState(false),
    [data, setData] = useState('');
  const [fallback, setFallback] = useState('');
  const pages = Math.max(1, Math.ceil((table.rows.length - 1) / 50)),
    current = Math.min(page, pages - 1);
  const indices = [
    0,
    ...Array.from(
      { length: Math.min(50, Math.max(0, table.rows.length - 1 - current * 50)) },
      (_, i) => 1 + current * 50 + i,
    ),
  ];
  const action = (name: string) => {
    try {
      const next = changeSourceTable(table, name, selected.row, selected.column);
      setTable(next);
      setSelected({
        row: Math.min(selected.row, next.rows.length - 1),
        column: Math.min(selected.column, next.rows[0].length - 1),
      });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copy = async (delimiter: ',' | '\t') => {
    const text = tableDelimited(table, delimiter);
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Table copied.');
    } catch {
      setFallback(text);
      setNotice('Clipboard unavailable. Select and copy the data below.');
    }
  };
  const close = () => {
    onClose();
    requestAnimationFrame(() => {
      if (view.dom.isConnected) view.focus();
    });
  };
  const columnName = (column: number) =>
    (column >= 26 ? String.fromCharCode(64 + Math.floor(column / 26)) : '') +
    String.fromCharCode(65 + (column % 26));
  const alignments = [
    { value: null, label: t('Default alignment'), icon: 'Table2' },
    { value: 'left', label: t('Align left'), icon: 'AlignLeft' },
    { value: 'center', label: t('Align center'), icon: 'AlignCenter' },
    { value: 'right', label: t('Align right'), icon: 'AlignRight' },
  ] as const;
  return (
    <Modal
      title={t('Edit table')}
      wide
      className="source-table-dialog"
      onClose={close}
      footer={
        <>
          <span className="help">{t('Changes apply as one undoable source edit.')}</span>
          <Button onClick={close}>
            <UiText message={'Cancel'} />
          </Button>
          <Button
            variant="primary"
            icon="Check"
            disabled={capture.stale}
            onClick={() => {
              try {
                capture.apply(writeSourceTable(table));
                close();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <UiText message={'Apply table'} />
          </Button>
        </>
      }
    >
      <ErrorBox
        error={
          capture.stale
            ? 'The source table changed. Close and reopen this dialog. Your table draft is retained here.'
            : error
        }
      />
      <div className="source-table-context">
        <Icon name="Table2" size={18} />
        <div>
          <strong>
            {t('Selected cell: {value0}', {
              value0: columnName(selected.column) + (selected.row + 1),
            })}
          </strong>
          <span>
            {t('{value0} rows · {value1} columns', {
              value0: table.rows.length - 1,
              value1: table.rows[0].length,
            })}
          </span>
        </div>
        <p>{t('Cells contain Markdown. Click a cell to choose its row and column.')}</p>
      </div>
      <div className="source-table-tools">
        <div className="source-table-actions">
          <div className="source-table-action-group" role="group" aria-label={t('Row actions')}>
            <Button className="small" icon="Plus" onClick={() => action('row')}>
              <UiText message={'Add row'} />
            </Button>
            <Button
              className="small"
              icon="Trash2"
              disabled={!selected.row}
              onClick={() => action('delete-row')}
            >
              <UiText message={'Remove row'} />
            </Button>
          </div>
          <div className="source-table-action-group" role="group" aria-label={t('Column actions')}>
            <Button className="small" icon="Plus" onClick={() => action('column')}>
              <UiText message={'Add column'} />
            </Button>
            <Button
              className="small"
              icon="Trash2"
              disabled={table.rows[0].length === 1}
              onClick={() => action('delete-column')}
            >
              <UiText message={'Remove column'} />
            </Button>
          </div>
          <div
            className="source-table-align segmented"
            role="group"
            aria-label={t('Selected column alignment')}
          >
            {alignments.map((item) => (
              <button
                key={item.label}
                type="button"
                aria-label={item.label}
                title={item.label}
                aria-pressed={(table.align[selected.column] || null) === item.value}
                onClick={() => {
                  const align = [...table.align];
                  align[selected.column] = item.value;
                  setTable({ ...table, align });
                }}
              >
                <Icon name={item.icon} size={15} />
              </button>
            ))}
          </div>
          <details className="source-table-data">
            <summary>
              <Icon name="Import" size={14} />
              <span>{t('Table data')}</span>
              <Icon name="ChevronDown" size={12} />
            </summary>
            <div>
              <Button
                className="small"
                icon="Upload"
                onClick={(event) => {
                  setImporting(!importing);
                  event.currentTarget.closest('details')?.removeAttribute('open');
                }}
              >
                <UiText message="Import CSV / TSV" />
              </Button>
              <Button className="small" icon="Copy" onClick={() => void copy(',')}>
                <UiText message="Copy CSV" />
              </Button>
              <Button className="small" icon="Copy" onClick={() => void copy('\t')}>
                <UiText message="Copy TSV" />
              </Button>
            </div>
          </details>
        </div>
      </div>
      {importing && (
        <div className="source-table-import">
          <Field
            label={t('CSV / TSV data')}
            help={t('The first row becomes the header. Import replaces this dialog’s table draft.')}
          >
            <textarea rows={5} value={data} onChange={(event) => setData(event.target.value)} />
          </Field>
          <Button
            className="small"
            onClick={() => {
              try {
                const rows = readDelimited(data);
                setTable({ rows, align: rows[0].map(() => null), cells: [] });
                setSelected({ row: 0, column: 0 });
                setPage(0);
                setImporting(false);
                setError('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <UiText message={'Use imported data'} />
          </Button>
        </div>
      )}
      <div
        className="source-table-grid"
        role="region"
        aria-label={t('Markdown table cells')}
        tabIndex={0}
        data-ui-attrs={'{"aria-label":"Markdown table cells"}'}
      >
        <table>
          <caption className="sr-only" data-ui={'Editable table, header followed by data rows'}>
            {t('Editable table, header followed by data rows')}
          </caption>
          <thead>
            <tr>
              <th>
                <span className="sr-only">{t('Row')}</span>
              </th>
              {table.rows[0].map((_, column) => (
                <th scope="col" key={column} data-selected={selected.column === column}>
                  {columnName(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {indices.map((row) => (
              <tr key={row} data-header={row === 0}>
                <th scope="row">{row === 0 ? t('Header') : row}</th>
                {table.rows[row].map((value, column) => (
                  <td
                    key={column}
                    data-selected={selected.row === row && selected.column === column}
                  >
                    <textarea
                      aria-label={t('{value0} column {value1}', {
                        value0: row === 0 ? 'Header' : `Row ${row}`,
                        value1: column + 1,
                      })}
                      rows={2}
                      value={value}
                      onFocus={() => setSelected({ row, column })}
                      onChange={(event) => {
                        const rows = table.rows.map((r) => [...r]);
                        rows[row][column] = event.target.value;
                        setTable({ ...table, rows });
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="source-table-pagination">
          <Button className="small" disabled={current === 0} onClick={() => setPage(current - 1)}>
            <UiText message={'Previous rows'} />
          </Button>
          <span className="help">
            {current + 1} / {pages}
          </span>
          <Button
            className="small"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <UiText message={'Next rows'} />
          </Button>
        </div>
      )}
      <p role="status" className="help">
        {notice}
      </p>
      {fallback && (
        <Field label={t('Copy table data')}>
          <textarea
            readOnly
            value={fallback}
            rows={5}
            onFocus={(event) => event.currentTarget.select()}
          />
        </Field>
      )}
    </Modal>
  );
}

function VisualComponentTools({
  view,
  block,
  mode,
  onClose,
}: {
  view: EditorView;
  block: SourceComponent;
  mode: 'edit' | 'expand';
  onClose: () => void;
}) {
  const capture = useCapturedComponent(view, block);
  const [raw, setRaw] = useState(block.kind === 'mindmap' ? block.source : fencedValue(block));
  const [config, setConfig] = useState<InteractiveConfig | null>(() => {
    try {
      return interactiveSchema.parse(JSON.parse(fencedValue(block)));
    } catch {
      return null;
    }
  });
  const [rawMode, setRawMode] = useState(!config),
    [error, setError] = useState(''),
    [chartError, setChartError] = useState('');
  const [result, setResult] = useState<ComponentPreviewResult>(),
    [renderedSource, setRenderedSource] = useState(''),
    [picker, setPicker] = useState<'before' | 'after' | null>(null);
  const kind = block.kind,
    edit = mode === 'edit';
  const draft =
    kind === 'mindmap'
      ? raw
      : replaceFence(block.source, config && !rawMode ? JSON.stringify(config, null, 2) : raw);
  const full = view.state.doc.toString(),
    source =
      full.slice(0, capture.range.current.from) + draft + full.slice(capture.range.current.to);
  const close = () => {
    onClose();
    requestAnimationFrame(() => {
      if (view.dom.isConnected) view.focus();
    });
  };
  const patch = (value: Record<string, unknown>) =>
    setConfig((current) => ({ ...current, ...value }) as InteractiveConfig);
  const exportSvg = () => {
    if (!result?.html) return;
    const fragment = componentPreviewFragment(result.html);
    const figure = fragment.querySelector<HTMLElement>('figure[data-mermaid]');
    if (figure) {
      const diagram = diagramFromFigure(figure);
      const url = URL.createObjectURL(diagramSvgBlob(diagram));
      const link = document.createElement('a');
      link.href = url;
      link.download = diagramFilename(diagram);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    const svg = fragment.querySelector(
      '[data-diagram-variant="light"] svg, [data-chart-variant="light"] svg, svg',
    );
    if (!svg) {
      setError('This component has no SVG drawing.');
      return;
    }
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${kind}.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Modal
      title={t('{value0} {value1}', {
        value0: edit ? 'Edit' : 'Explore',
        value1: componentLabels[kind].toLowerCase(),
      })}
      wide
      className="source-visual-dialog"
      onClose={close}
      footer={
        <>
          {kind !== 'image-compare' && kind !== 'pseudocode' && (
            <Button
              icon="Download"
              disabled={!result?.html || renderedSource !== source}
              onClick={exportSvg}
            >
              <UiText message={'Download SVG'} />
            </Button>
          )}
          <Button onClick={close}>{edit ? t('Cancel') : t('Close')}</Button>
          {edit && (
            <Button
              variant="primary"
              icon="Check"
              disabled={capture.stale || !result?.html || renderedSource !== source || !!chartError}
              onClick={() => {
                try {
                  capture.apply(draft);
                  close();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <UiText message={'Apply changes'} />
            </Button>
          )}
        </>
      }
    >
      <ErrorBox
        error={
          capture.stale ? 'This component changed in source. Close and reopen its tools.' : error
        }
      />
      {edit && (
        <div className="source-visual-fields">
          {config && (
            <Button
              className="small"
              onClick={() => {
                if (!rawMode) setRaw(JSON.stringify(config, null, 2));
                else {
                  try {
                    setConfig(interactiveSchema.parse(JSON.parse(raw)));
                    setError('');
                  } catch (e) {
                    setError((e as Error).message);
                    return;
                  }
                }
                setRawMode(!rawMode);
              }}
            >
              {rawMode ? t('Use form') : t('Edit JSON')}
            </Button>
          )}
          {rawMode || !config ? (
            <Field
              label={
                kind === 'mindmap'
                  ? t('Mindmap Markdown')
                  : kind === 'mermaid'
                    ? t('Mermaid source')
                    : kind === 'pseudocode'
                      ? t('Pseudocode source')
                      : t('Component JSON')
              }
            >
              {kind === 'mermaid' ? (
                <MermaidSourceField
                  value={raw}
                  onChange={(value) => {
                    setRaw(value);
                    setResult(undefined);
                  }}
                />
              ) : (
                <textarea
                  className="mono"
                  rows={10}
                  value={raw}
                  onChange={(event) => {
                    setRaw(event.target.value);
                    setResult(undefined);
                  }}
                />
              )}
            </Field>
          ) : (
            <>
              <Field label={t('Title')}>
                <input
                  value={config.title}
                  onChange={(event) => patch({ title: event.target.value })}
                />
              </Field>
              {config.type === 'chart' && (
                <ChartFields
                  key={config.style}
                  config={config}
                  onChange={patch}
                  onError={setChartError}
                />
              )}
              {config.type === 'function-plot' && (
                <>
                  <Field label={t('Function')}>
                    <select
                      value={config.preset}
                      onChange={(event) => patch({ preset: event.target.value })}
                    >
                      <option value="sine" data-ui={'Sine wave'}>
                        {t('Sine wave')}
                      </option>
                      <option value="gaussian" data-ui={'Gaussian'}>
                        {t('Gaussian')}
                      </option>
                      <option value="polynomial" data-ui={'Cubic polynomial'}>
                        {t('Cubic polynomial')}
                      </option>
                    </select>
                  </Field>
                  <div className="field-row">
                    <Field label={t('Amplitude')}>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="3"
                        value={config.amplitude}
                        onChange={(event) => patch({ amplitude: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label={t('Frequency')}>
                      <input
                        type="number"
                        step="0.1"
                        min="0.2"
                        max="4"
                        value={config.frequency}
                        onChange={(event) => patch({ frequency: Number(event.target.value) })}
                      />
                    </Field>
                  </div>
                </>
              )}
              {config.type === 'image-compare' && (
                <>
                  <div className="field-row">
                    {(['before', 'after'] as const).map((side) => (
                      <div key={side}>
                        <Field
                          label={t('{value0} image', {
                            value0: side === 'before' ? 'Before' : 'After',
                          })}
                        >
                          <input
                            value={config[side]}
                            onChange={(event) => patch({ [side]: event.target.value })}
                          />
                        </Field>
                        <Field
                          label={t('{value0} label', {
                            value0: side === 'before' ? 'Before' : 'After',
                          })}
                        >
                          <input
                            value={config[`${side}Label`]}
                            onChange={(event) => patch({ [`${side}Label`]: event.target.value })}
                          />
                        </Field>
                        <Button className="small" icon="Image" onClick={() => setPicker(side)}>
                          <UiText message={'Choose image'} />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    className="small"
                    onClick={() =>
                      patch({
                        before: config.after,
                        after: config.before,
                        beforeLabel: config.afterLabel,
                        afterLabel: config.beforeLabel,
                      })
                    }
                  >
                    <UiText message={'Swap images'} />
                  </Button>
                </>
              )}
              <Field label={t('Caption')}>
                <input
                  value={config.caption}
                  onChange={(event) => patch({ caption: event.target.value })}
                />
              </Field>
            </>
          )}
          {kind === 'mindmap' && (
            <Field label={t('Mindmap layout')}>
              <select
                value={/layout=["']?tree/.test(raw.split('\n')[0]) ? 'tree' : 'map'}
                onChange={(event) => {
                  const [head, ...lines] = raw.split('\n');
                  const value = event.target.value;
                  const next = /layout=/.test(head)
                    ? head.replace(/layout=(?:"[^"]*"|'[^']*'|[^}\s]+)/, `layout="${value}"`)
                    : head.includes('{')
                      ? head.replace(/}\s*$/, ` layout="${value}"}`)
                      : head + `{layout="${value}"}`;
                  setRaw([next, ...lines].join('\n'));
                }}
              >
                <option value="map" data-ui={'Map'}>
                  {t('Map')}
                </option>
                <option value="tree" data-ui={'Tree'}>
                  {t('Tree')}
                </option>
              </select>
            </Field>
          )}
        </div>
      )}
      <Preview
        source={source}
        from={capture.range.current.from}
        to={capture.range.current.from + draft.length}
        interactive={!edit}
        onResult={(value, rendered) => {
          setResult(value);
          setRenderedSource(rendered);
        }}
      />
      {picker && (
        <MediaPicker
          onClose={() => setPicker(null)}
          onSelect={(url) => {
            patch({ [picker]: url });
            setPicker(null);
          }}
        />
      )}
    </Modal>
  );
}
