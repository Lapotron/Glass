import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useId, useRef, useState } from 'react';
import { Button, Icon } from '../shared/ui.js';
import {
  diffDefaults,
  downloadText,
  markdownPatch,
  type DiffMode,
  type DiffOptions,
  type DiffSummary,
} from './diff-model.js';
import type { createMarkdownDiff } from './codemirror-diff.js';

const loading: DiffSummary = { state: 'loading', regions: [], active: 0, added: 0, removed: 0 };
const lineRange = (start: number, end: number) =>
  end === 0 ? `after line ${start}` : start === end ? `line ${start}` : `lines ${start}–${end}`;

export function MarkdownDiff({ earlier, current }: { earlier: string; current: string }) {
  const sourceId = useId();
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<ReturnType<typeof createMarkdownDiff> | null>(null),
    accessibleButton = useRef<HTMLButtonElement>(null),
    previousMode = useRef<DiffMode>('auto');
  const [summary, setSummary] = useState(loading),
    [options, setOptions] = useState<DiffOptions>({ ...diffDefaults }),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [sources, setSources] = useState(false),
    [retry, setRetry] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useEffect(() => {
    let cancelled = false;
    const element = host.current!;
    setSummary(loading);
    setError('');
    setMessage('');
    delete element.dataset.ready;
    void import('./codemirror-diff.js')
      .then(({ createMarkdownDiff }) => {
        if (cancelled) return;
        editor.current = createMarkdownDiff(element, earlier, current, (next) => {
          if (!cancelled) {
            setSummary(next);
            if (next.state === 'unavailable') setSources(true);
          }
        });
        editor.current.setOptions(optionsRef.current);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'The comparison could not load.');
          setSources(true);
          setSummary({ ...loading, state: 'unavailable' });
        }
      });
    return () => {
      cancelled = true;
      editor.current?.dispose();
      editor.current = null;
    };
  }, [earlier, current, retry]);
  useEffect(() => {
    editor.current?.setOptions(options);
  }, [options]);
  const changeMode = (mode: DiffMode) => {
    if (mode === 'accessible' && options.mode !== 'accessible') previousMode.current = options.mode;
    setOptions((value) => ({ ...value, mode }));
  };
  const exitAccessible = () => {
    changeMode(previousMode.current);
    requestAnimationFrame(() => accessibleButton.current?.focus());
  };
  const copy = async (value: string, name: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${name} copied.`);
    } catch {
      setSources(true);
      setMessage('Clipboard unavailable. Select and copy the complete source below.');
    }
  };
  const count = summary.regions.length,
    ready = summary.state === 'ready',
    accessible = options.mode === 'accessible';
  return (
    <div
      className="markdown-diff"
      onKeyDownCapture={(event) => {
        if (accessible && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          exitAccessible();
        }
      }}
    >
      <div className="diff-toolbar">
        <span className="diff-status" role="status">
          <Icon name="FileText" size={14} />
          {error || summary.state === 'unavailable'
            ? t("Comparison unavailable")
            : !ready
              ? t("Preparing comparison…")
              : count
                ? t("{value0} changed {value1}", {value0: count, value1: count === 1 ? 'region' : 'regions'})
                : t("No Markdown changes")}
          {ready && count > 0 && (
            <span className="diff-line-counts">
              <span>+{summary.added}</span> / <span>−{summary.removed}</span> <UiText message={" lines"}/></span>
          )}
        </span>
        <div className="diff-navigation" role="group" aria-label={t("Navigate Markdown changes")} data-ui-attrs={"{\"aria-label\":\"Navigate Markdown changes\"}"} >
          <Button
            className="small"
            icon="ArrowUp"
            disabled={!ready || !count}
            onClick={() => editor.current?.goToChange('previous')}
          >
            <UiText message={"Previous"}/></Button>
          <Button
            className="small"
            icon="ArrowDown"
            disabled={!ready || !count}
            onClick={() => editor.current?.goToChange('next')}
          >
            <UiText message={"Next"}/></Button>
          {ready && count > 0 && (
            <span className="diff-position">
              {summary.active + 1} / {count}
            </span>
          )}
        </div>
      </div>
      <div className="diff-view-toolbar">
        <div className="diff-view-modes" role="group" aria-label={t("Comparison layout")} data-ui-attrs={"{\"aria-label\":\"Comparison layout\"}"} >
          {(['auto', 'split', 'inline'] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              aria-pressed={options.mode === mode}
              onClick={() => changeMode(mode)}
            >
              {mode === 'auto' ? t("Auto") : mode === 'split' ? t("Split") : t("Inline")}
            </button>
          ))}
          <button
            ref={accessibleButton}
            type="button"
            className="diff-accessible"
            aria-pressed={accessible}
            onClick={() => (accessible ? exitAccessible() : changeMode('accessible'))}
          >
            <Icon name="ListTree" size={14} />
            <UiText message={"Accessible view"}/></button>
        </div>
        <Button
          className="small"
          icon="Search"
          disabled={!ready || accessible}
          onClick={() => editor.current?.find()}
        >
          <UiText message={"Find"}/></Button>
        <details className="diff-options">
          <summary>
            <Icon name="Settings2" size={14} />
            <UiText message={"View options"}/></summary>
          <div>
            {(
              [
                ['wrap', 'Wrap long lines'],
                ['showWhitespace', 'Show whitespace'],
                ['ignoreWhitespace', 'Ignore edge whitespace'],
                ['collapse', 'Collapse unchanged regions'],
                ['minimap', 'Show diff minimap'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(event) =>
                    setOptions((value) => ({ ...value, [key]: event.target.checked }))
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </details>
      </div>
      {summary.message && summary.state === 'ready' && (
        <p className="diff-notice" role="status">
          {summary.message}
        </p>
      )}
      {accessible && (
        <div className="diff-accessible-hint">
          <span data-ui={"Read each change with the arrow keys. Escape returns to the comparison."}>{t("Read each change with the arrow keys. Escape returns to the comparison.")}</span>
          <Button className="small" icon="ChevronLeft" onClick={exitAccessible}>
            <UiText message={"Return to comparison"}/></Button>
        </div>
      )}
      {(error || summary.state === 'unavailable') && (
        <div className="diff-load-error" role="alert">
          <p>{error || summary.message} <UiText message={" Your saved revisions are still available."}/></p>
          <Button className="small" icon="RotateCcw" onClick={() => setRetry((value) => value + 1)}>
            <UiText message={"Retry comparison"}/></Button>
        </div>
      )}
      <div
        ref={host}
        className="markdown-diff-editor"
        role="region"
        aria-label={t("Markdown differences")}
        aria-busy={summary.state === 'loading'}
        hidden={!!error}
       data-ui-attrs={"{\"aria-label\":\"Markdown differences\"}"} />
      {ready && count > 0 && (
        <details className="diff-change-list">
          <summary><UiText message={"Changes by line · "}/>{count}</summary>
          <ol>
            {summary.regions.map((region, index) => (
              <li key={index}>
                <button
                  type="button"
                  aria-current={summary.active === index ? 'true' : undefined}
                  onClick={() => editor.current?.revealChange(index)}
                >
                  <span><UiText message={"Change "}/>{index + 1}</span>
                  <span>
                    <UiText message={"Earlier"}/>{' '}
                    {lineRange(region.originalStartLineNumber, region.originalEndLineNumber)} <UiText message={" → Current"}/>{' '}
                    {lineRange(region.modifiedStartLineNumber, region.modifiedEndLineNumber)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="diff-export-actions">
        <Button
          className="small"
          icon="Copy"
          onClick={() => void copy(earlier, 'Earlier Markdown')}
        >
          <UiText message={"Copy earlier"}/></Button>
        <Button
          className="small"
          icon="Copy"
          onClick={() => void copy(current, 'Current Markdown')}
        >
          <UiText message={"Copy current"}/></Button>
        <Button
          className="small"
          icon="Download"
          onClick={() =>
            downloadText(
              markdownPatch(earlier, current),
              'markdown-comparison.patch',
              'text/x-diff;charset=utf-8',
            )
          }
        >
          <UiText message={"Download patch"}/></Button>
      </div>
      <details
        className="diff-source-views"
        open={sources}
        onToggle={(event) => setSources(event.currentTarget.open)}
      >
        <summary data-ui={"Complete Markdown sources"}>{t("Complete Markdown sources")}</summary>
        <div className="diff-source-grid">
          <div>
            <label htmlFor={`${sourceId}-earlier`} data-ui={"Earlier Markdown source"}>{t("Earlier Markdown source")}</label>
            <textarea
              id={`${sourceId}-earlier`}
              readOnly
              value={earlier}
              rows={10}
              spellCheck={false}
            />
            <Button
              className="small"
              icon="Download"
              onClick={() => downloadText(earlier, 'earlier.md')}
            >
              <UiText message={"Download earlier"}/></Button>
          </div>
          <div>
            <label htmlFor={`${sourceId}-current`} data-ui={"Current Markdown source"}>{t("Current Markdown source")}</label>
            <textarea
              id={`${sourceId}-current`}
              readOnly
              value={current}
              rows={10}
              spellCheck={false}
            />
            <Button
              className="small"
              icon="Download"
              onClick={() => downloadText(current, 'current.md')}
            >
              <UiText message={"Download current"}/></Button>
          </div>
        </div>
      </details>
      <p className="diff-export-status" role="status">
        {message}
      </p>
    </div>
  );
}
