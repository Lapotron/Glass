import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from 'react';
import { Button, Icon } from '../shared/ui.js';
import {
  entrySchema,
  routeFor,
  type EntryMeta,
  type PublicEntry,
  type SiteConfig,
} from '../shared/contracts.js';
import {
  interactiveRegistry,
  interactiveSchema,
  type InteractiveConfig,
} from '../shared/interactives.js';
import { send, metadataOf, ApiError } from './api.js';
import { ErrorBox, Field, Modal, MediaPicker } from './components.js';
import { downloadUrl } from './Selection.js';
import { EntrySettings } from './EntrySettings.js';
import { EditorDivider } from './EditorDivider.js';
import { RevisionHistory } from './RevisionHistory.js';
import { markdownSnippets, instantiateSnippet } from '../shared/markdown-snippets.js';
import { CodeEditor } from './SourceEditor.js';
export { CodeEditor } from './SourceEditor.js';
import type { EditorView } from '@codemirror/view';
import { wrapSource, prefixSource } from './source-commands.js';
import { ChartFields } from './ChartFields.js';
import { AdvancedWidgetFields } from './AdvancedWidgetFields.js';
import { FollowEditor, LivePreview, PreviewError, useLivePreview } from './LivePreview.js';
import './editor-workspace.css';
import { componentBrowserItems, type ComponentCategory } from './component-browser.js';
import './component-browser.css';
import { ConversionDialog } from './ConversionDialog.js';

export type FlushRef = MutableRefObject<(() => Promise<void>) | null>;
const modeIcons = {
  write: 'PenLine',
  split: 'Columns2',
  preview: 'Eye',
  settings: 'Settings2',
} as const;
type EditorMode = keyof typeof modeIcons;
const localTime = (value: string) =>
  value
    ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : '';
const sourceKey = (value: { metadata: EntryMeta; body: string }) =>
  JSON.stringify({
    metadata: entrySchema.parse(value.metadata),
    body: value.body.endsWith('\n') ? value.body : value.body + '\n',
  });
type EditorProps = {
  entry: PublicEntry;
  site: SiteConfig;
  onDuplicated: (entry: PublicEntry) => Promise<void>;
  onConverted?: (entry: PublicEntry) => Promise<void>;
  onSaved: (entry: PublicEntry) => void;
  onBack: () => void;
  onTrash: (entry: PublicEntry) => Promise<void>;
  flushRef: FlushRef;
  onStatus: (value: string) => void;
};
export function Composer({
  onInsert,
  onClose,
}: {
  onInsert: (value: string) => void;
  onClose: () => void;
}) {
  const browserId = useId();
  const [type, setType] = useState('function-plot');
  const [config, setConfig] = useState<InteractiveConfig>(
    interactiveRegistry.find((definition) => definition.type === 'function-plot')!.example,
  );
  const [formula, setFormula] = useState('y(x) = A\\sin(\\omega x)'),
    [display, setDisplay] = useState(true),
    [diagram, setDiagram] = useState(
      'flowchart LR\n  A[An interesting question] --> B[A small experiment]\n  B --> C[A little understanding]',
    );
  const [error, setError] = useState(''),
    [picker, setPicker] = useState<'before' | 'after' | null>(null);
  const [chartError, setChartError] = useState(''),
    [componentSearch, setComponentSearch] = useState('');
  const [category, setCategory] = useState<ComponentCategory | 'all'>('all');
  const componentDrafts = useRef(new Map<string, InteractiveConfig>());
  const categories: { id: ComponentCategory | 'all'; label: string }[] = [
    { id: 'all', label: t('All components') },
    { id: 'writing', label: t('Writing') },
    { id: 'academic', label: t('Academic') },
    { id: 'media', label: t('Media') },
    { id: 'interactive', label: t('Interactive') },
    { id: 'diagrams', label: t('Diagrams & math') },
  ];
  const query = componentSearch.trim().toLocaleLowerCase();
  const choices = componentBrowserItems.filter(
    (item) =>
      (category === 'all' || item.category === category) &&
      `${t(item.label)} ${t(item.description)} ${item.label} ${item.type}`
        .toLocaleLowerCase()
        .includes(query),
  );
  const selectedComponent = componentBrowserItems.find((item) => item.type === type)!;
  function update(patch: Record<string, unknown>) {
    setConfig((c) => ({ ...c, ...patch }) as InteractiveConfig);
  }
  function insert() {
    try {
      const snippet = markdownSnippets.find((s) => s.type === type);
      if (snippet) {
        onInsert(`\n\n${instantiateSnippet(snippet.value)}\n`);
      } else if (type === 'math') {
        if (!formula.trim()) throw new Error('Enter an equation.');
        onInsert(display ? `\n\n$$\n${formula}\n$$\n\n` : `$${formula}$`);
      } else if (type === 'mermaid') {
        if (!diagram.trim()) throw new Error('Enter a diagram.');
        onInsert(`\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\n`);
      } else {
        if (config.type === 'chart' && chartError) throw new Error(chartError);
        const validation = interactiveSchema.safeParse(config);
        if (!validation.success)
          throw new Error(
            validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
          );
        const parsed = validation.data;
        onInsert(`\n\n\`\`\`interactive\n${JSON.stringify(parsed, null, 2)}\n\`\`\`\n\n`);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={t('Bring an idea to life')}
      wide
      className="component-browser-dialog"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>
            <UiText message={'Cancel'} />
          </Button>
          <Button
            variant="primary"
            icon="Plus"
            onClick={insert}
            disabled={type === 'chart' && !!chartError}
          >
            <UiText message={'Insert into Markdown'} />
          </Button>
        </>
      }
    >
      <p className="modal-intro" data-ui={'A little interaction can make an explanation click.'}>
        {t('A little interaction can make an explanation click.')}
      </p>
      <div className="component-browser-layout">
        <section className="component-browser-library" aria-label={t('Component library')}>
          <div className="search-field component-search">
            <Icon name="Search" size={15} />
            <input
              type="search"
              data-modal-focus
              aria-label={t('Find a Markdown component')}
              placeholder={t('Find a component…')}
              value={componentSearch}
              onChange={(e) => setComponentSearch(e.target.value)}
              data-ui-attrs={
                '{"aria-label":"Find a Markdown component","placeholder":"Find a component…"}'
              }
            />
          </div>
          <div
            className="component-browser-categories"
            role="group"
            aria-label={t('Component categories')}
          >
            {categories.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={category === item.id}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="composer-types" aria-label={t('Available components')}>
            {choices.map((item) => (
              <button
                type="button"
                key={item.type}
                className={`component-browser-choice ${type === item.type ? 'active' : ''}`}
                aria-label={t(item.label)}
                aria-describedby={`${browserId}-${item.type}-description`}
                aria-pressed={type === item.type}
                onClick={() => {
                  componentDrafts.current.set(config.type, config);
                  setType(item.type);
                  setError('');
                  setChartError('');
                  const definition = interactiveRegistry.find((d) => d.type === item.type);
                  if (definition)
                    setConfig(
                      componentDrafts.current.get(item.type) || structuredClone(definition.example),
                    );
                }}
              >
                <span className="component-browser-icon">
                  <Icon name={item.icon} size={17} />
                </span>
                <span>
                  <strong>{t(item.label)}</strong>
                  <small id={`${browserId}-${item.type}-description`}>{t(item.description)}</small>
                </span>
                {type === item.type && (
                  <Icon name="Check" size={14} className="component-browser-check" />
                )}
              </button>
            ))}
          </div>
          {!choices.length && (
            <p className="component-browser-empty" role="status">
              {t('No components match this search.')}
            </p>
          )}
        </section>
        <section className="component-browser-detail" aria-label={t('Component configuration')}>
          <header className="component-browser-detail-heading">
            <Icon name={selectedComponent.icon} size={20} />
            <div>
              <h3>{t(selectedComponent.label)}</h3>
              <p>{t(selectedComponent.description)}</p>
            </div>
          </header>
          {markdownSnippets.some((s) => s.type === type) ? (
            <>
              <p
                className="help"
                data-ui={'Insert a Markdown starting point, then edit its text in the source.'}
              >
                {t('Insert a Markdown starting point, then edit its text in the source.')}
              </p>
              <pre className="snippet-preview">
                {markdownSnippets
                  .find((s) => s.type === type)
                  ?.value.replace('SECTION_KEY', 'your-stable-key')}
              </pre>
            </>
          ) : type === 'math' ? (
            <>
              <Field label={t('LaTeX equation')}>
                <textarea rows={5} value={formula} onChange={(e) => setFormula(e.target.value)} />
              </Field>
              <label className="toggle-row">
                <span data-ui={'Display on its own line'}>{t('Display on its own line')}</span>
                <input
                  type="checkbox"
                  checked={display}
                  onChange={(e) => setDisplay(e.target.checked)}
                />
              </label>
              <p
                className="help"
                data-ui={'MathJax renders equations into the finished page during the build.'}
              >
                {t('MathJax renders equations into the finished page during the build.')}
              </p>
            </>
          ) : type === 'mermaid' ? (
            <Field label={t('Mermaid diagram')}>
              <textarea
                className="mono"
                rows={7}
                value={diagram}
                onChange={(e) => setDiagram(e.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field label={t('Title')}>
                <input value={config.title} onChange={(e) => update({ title: e.target.value })} />
              </Field>
              {config.type === 'function-plot' && (
                <>
                  <Field label={t('Function')}>
                    <select
                      value={config.preset}
                      onChange={(e) => update({ preset: e.target.value })}
                    >
                      <option value="sine" data-ui={'Sine wave'}>
                        {t('Sine wave')}
                      </option>
                      <option value="gaussian" data-ui={'Gaussian curve'}>
                        {t('Gaussian curve')}
                      </option>
                      <option value="polynomial" data-ui={'Cubic polynomial'}>
                        {t('Cubic polynomial')}
                      </option>
                    </select>
                  </Field>
                  <div className="field-row">
                    <Field label={t('Amplitude · {value0}', { value0: config.amplitude })}>
                      <input
                        type="range"
                        min="0.1"
                        max="3"
                        step="0.1"
                        value={config.amplitude}
                        onChange={(e) => update({ amplitude: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label={t('Frequency · {value0}', { value0: config.frequency })}>
                      <input
                        type="range"
                        min="0.2"
                        max="4"
                        step="0.1"
                        value={config.frequency}
                        onChange={(e) => update({ frequency: Number(e.target.value) })}
                      />
                    </Field>
                  </div>
                </>
              )}
              {config.type === 'chart' && (
                <ChartFields
                  key={config.style}
                  config={config}
                  onChange={update}
                  onError={setChartError}
                />
              )}
              {config.type === 'image-compare' && (
                <>
                  {(['before', 'after'] as const).map((key) => (
                    <div key={key} className="field-row">
                      <Field
                        label={key === 'before' ? t('First image URL') : t('Second image URL')}
                      >
                        <div className="input-with-button">
                          <input
                            value={config[key]}
                            onChange={(e) => update({ [key]: e.target.value })}
                          />
                          <Button className="small" icon="Image" onClick={() => setPicker(key)}>
                            <UiText message={'Choose'} />
                          </Button>
                        </div>
                      </Field>
                      <Field label={t('Label')}>
                        <input
                          value={config[`${key}Label`]}
                          onChange={(e) => update({ [`${key}Label`]: e.target.value })}
                        />
                      </Field>
                    </div>
                  ))}
                </>
              )}
              {(config.type === 'quiz' || config.type === 'tabs') && (
                <AdvancedWidgetFields config={config} onChange={update} />
              )}
              <Field label={t('Caption')}>
                <textarea
                  rows={2}
                  value={config.caption}
                  onChange={(e) => update({ caption: e.target.value })}
                />
              </Field>
            </>
          )}
          <ErrorBox error={error} />
        </section>
      </div>
      {picker && (
        <MediaPicker
          onClose={() => setPicker(null)}
          onSelect={(url) => update({ [picker]: url })}
        />
      )}
    </Modal>
  );
}
export function Editor({
  entry,
  site,
  onDuplicated,
  onConverted,
  onSaved,
  onBack,
  onTrash,
  flushRef,
  onStatus,
}: EditorProps) {
  const collections = site.collections;
  const [duplicating, setDuplicating] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false),
    [duplicateError, setDuplicateError] = useState('');
  const [conversion, setConversion] = useState<PublicEntry | null>(null);
  const duplicatePending = useRef(false);
  const [metadata, setMetadata] = useState<EntryMeta>(metadataOf(entry)),
    [body, setBody] = useState(entry.body);
  const [mode, setMode] = useState<EditorMode>('split'),
    [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 1100px)').matches);
  const editingMode = useRef<Exclude<EditorMode, 'settings'>>('split');
  const modeList = useRef<HTMLDivElement>(null),
    id = useId();
  const panes = useRef<HTMLDivElement>(null);
  const [sourceShare, setSourceShare] = useState(0.5),
    [resizing, setResizing] = useState(false);
  const visibleMode = mode === 'split' && compact ? 'write' : mode;
  const [composer, setComposer] = useState(false),
    [media, setMedia] = useState(false),
    [confirmTrash, setConfirmTrash] = useState(false);
  const [history, setHistory] = useState(false);
  const [error, setError] = useState(''),
    [conflict, setConflict] = useState(false);
  const viewRef = useRef<EditorView | null>(null),
    sourceScroll = useRef<ReturnType<EditorView['scrollSnapshot']> | null>(null),
    revision = useRef(entry.revision),
    baseline = useRef(JSON.stringify({ metadata: metadataOf(entry), body: entry.body }));
  const latest = useRef({ metadata, body });
  latest.current = { metadata, body };
  const pending = useRef<Promise<void> | null>(null),
    blocked = useRef(false),
    onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const savingSnapshot = useRef<{ metadata: EntryMeta; body: string } | null>(null);
  const serialized = JSON.stringify({ metadata, body });
  const dirty = serialized !== baseline.current;
  const previewController = useLivePreview({
    identity: entry.id,
    source: body,
    request: { entryId: entry.id, metadata, body },
    enabled: !history && (visibleMode === 'split' || visibleMode === 'preview'),
    delay: 650,
  });
  const preview = previewController.snapshot?.url || '';
  const previewBusy = previewController.busy;
  useEffect(() => {
    const query = matchMedia('(max-width: 1100px)'),
      update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  function changeMode(next: EditorMode) {
    rememberSourceScroll();
    setHistory(false);
    if (next !== 'settings') editingMode.current = next;
    setMode(next);
    if (next === 'write' || next === 'split') restoreSourceScroll();
  }
  function rememberSourceScroll() {
    const view = viewRef.current;
    if (
      !history &&
      view?.scrollDOM.clientHeight &&
      (visibleMode === 'write' || visibleMode === 'split')
    )
      sourceScroll.current = view.scrollSnapshot();
  }
  function restoreSourceScroll() {
    const saved = sourceScroll.current;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const view = viewRef.current;
        if (saved && view?.scrollDOM.clientHeight) {
          view.dispatch({ effects: saved });
        }
      }),
    );
  }
  function returnToEditor() {
    const next = compact && editingMode.current === 'split' ? 'write' : editingMode.current;
    changeMode(next);
    requestAnimationFrame(() =>
      modeList.current?.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus(),
    );
  }
  async function flush() {
    if (pending.current) await pending.current;
    const payload = latest.current,
      value = JSON.stringify(payload);
    if (value === baseline.current) return;
    if (blocked.current)
      throw new Error('Resolve the external file change before saving or building.');
    const parsed = entrySchema.safeParse(payload.metadata);
    if (!parsed.success)
      throw new Error(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
      );
    onStatus('Saving…');
    savingSnapshot.current = payload;
    const operation = (async () => {
      try {
        const saved = await send<PublicEntry>(`content/${entry.id}`, 'PUT', {
          metadata: parsed.data,
          body: payload.body,
          revision: revision.current,
        });
        revision.current = saved.revision;
        baseline.current = value;
        onSavedRef.current(saved);
        setError('');
        onStatus('All changes saved');
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          blocked.current = true;
          setConflict(true);
        }
        setError((e as Error).message);
        onStatus('Changes need attention');
        throw e;
      }
    })();
    pending.current = operation;
    try {
      await operation;
    } finally {
      pending.current = null;
      savingSnapshot.current = null;
    }
    if (JSON.stringify(latest.current) !== baseline.current) await flush();
  }
  const flushLatest = useRef(flush);
  flushLatest.current = flush;
  useEffect(() => {
    flushRef.current = () => flushLatest.current();
    return () => {
      flushRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!dirty || conflict) return;
    onStatus('Unsaved changes');
    const timeout = setTimeout(() => {
      void flushLatest.current().catch((e) => {
        setError(e.message);
        onStatus('Changes need attention');
      });
    }, 900);
    return () => clearTimeout(timeout);
  }, [serialized, conflict]);
  useEffect(() => {
    if (entry.revision === revision.current) return;
    if (
      savingSnapshot.current &&
      sourceKey({ metadata: metadataOf(entry), body: entry.body }) ===
        sourceKey(savingSnapshot.current)
    )
      return;
    if (JSON.stringify(latest.current) !== baseline.current || pending.current) {
      blocked.current = true;
      setConflict(true);
      setError(
        'This file changed outside Studio. Your text is still here. Copy it before reloading the latest version.',
      );
    } else {
      revision.current = entry.revision;
      const next = metadataOf(entry);
      baseline.current = JSON.stringify({ metadata: next, body: entry.body });
      setMetadata(next);
      setBody(entry.body);
    }
  }, [entry.revision]);
  useEffect(() => {
    const save = () => {
      void flushLatest.current().catch((e) => setError(e.message));
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current) !== baseline.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('studio-save', save);
    window.addEventListener('beforeunload', unload);
    return () => {
      document.removeEventListener('studio-save', save);
      window.removeEventListener('beforeunload', unload);
    };
  }, []);
  function insert(value: string) {
    const view = viewRef.current;
    if (view) {
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: value },
        selection: { anchor: selection.from + value.length },
      });
      view.focus();
    } else setBody((current) => current + value);
  }
  function reload() {
    const next = metadataOf(entry);
    revision.current = entry.revision;
    baseline.current = JSON.stringify({ metadata: next, body: entry.body });
    blocked.current = false;
    setMetadata(next);
    setBody(entry.body);
    setConflict(false);
    setError('');
    onStatus('All changes saved');
  }
  const updateMeta = (patch: Partial<EntryMeta>) => setMetadata((m) => ({ ...m, ...patch }));
  async function duplicateEntry() {
    if (duplicatePending.current) return;
    duplicatePending.current = true;
    setDuplicating(true);
    setDuplicateError('');
    try {
      await flush();
      const result = await send<{ entries: PublicEntry[] }>('content/batch', 'POST', {
        action: 'duplicate',
        items: [{ id: entry.id, revision: revision.current }],
      });
      setConfirmDuplicate(false);
      try {
        await onDuplicated(result.entries[0]);
      } catch (e) {
        setError(`The draft was created, but could not be opened. ${(e as Error).message}`);
      }
    } catch (e) {
      setDuplicateError((e as Error).message);
    } finally {
      duplicatePending.current = false;
      setDuplicating(false);
    }
  }
  return (
    <div className={`editor-workspace mode-${visibleMode}`}>
      <div className="editor-toolbar">
        <div className="toolbar-group editor-heading">
          <button
            className="icon-button"
            onClick={onBack}
            aria-label={t('Back to content')}
            data-ui-attrs={'{"aria-label":"Back to content"}'}
          >
            <Icon name="ArrowRight" className="rotate" />
          </button>
          <span className="editor-breadcrumb">
            {collections[entry.kind].name}
            <Icon name="ChevronRight" size={12} />
            <span>{metadata.title}</span>
          </span>
        </div>
        <div className="editor-toolbar-controls">
          <div
            className="segmented editor-view-modes"
            ref={modeList}
            role="group"
            aria-label={t('Editor view')}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
              ];
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (current + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) %
                      buttons.length;
              buttons[next].click();
              buttons[next].focus();
            }}
            data-ui-attrs={'{"aria-label":"Editor view"}'}
          >
            {(['write', 'split', 'preview', 'settings'] as const)
              .filter((m) => m !== 'split' || !compact)
              .map((m) => (
                <button
                  key={m}
                  type="button"
                  data-mode={m}
                  aria-pressed={!history && visibleMode === m}
                  aria-controls={m === 'settings' ? `${id}-settings` : `${id}-panes`}
                  onClick={() => changeMode(m)}
                >
                  <Icon name={modeIcons[m]} size={13} />
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
          </div>
          <div className="toolbar-group editor-entry-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={t('Move between collections')}
              title={t('Move between collections')}
              onClick={() => {
                void flush()
                  .then(() =>
                    setConversion({
                      ...entry,
                      ...latest.current.metadata,
                      body: latest.current.body,
                      revision: revision.current,
                    }),
                  )
                  .catch((error) => setError(error.message));
              }}
            >
              <Icon name="MoveHorizontal" size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Export Markdown')}
              title={t('Export Markdown')}
              onClick={() => {
                void flush()
                  .then(() => downloadUrl('/api/content/' + entry.id + '/download'))
                  .catch((error) => setError(error.message));
              }}
              data-ui-attrs={'{"aria-label":"Export Markdown","title":"Export Markdown"}'}
            >
              <Icon name="Download" size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Duplicate entry')}
              title={t('Duplicate as a draft')}
              disabled={duplicating}
              onClick={(event) => {
                event.currentTarget.focus();
                setDuplicateError('');
                setConfirmDuplicate(true);
              }}
              data-ui-attrs={'{"aria-label":"Duplicate entry","title":"Duplicate as a draft"}'}
            >
              <Icon name="Copy" size={17} />
            </button>
            <button
              type="button"
              className="editor-history-tab"
              aria-pressed={history}
              aria-controls={`${id}-history`}
              aria-label={t('Revision history')}
              onClick={() => {
                void flush()
                  .then(() => setHistory((value) => !value))
                  .catch((error) => setError(error.message));
              }}
              data-ui-attrs={'{"aria-label":"Revision history"}'}
            >
              <Icon name="History" size={16} />
              <span data-ui={'History'}>{t('History')}</span>
            </button>
          </div>
        </div>
      </div>
      {(error || conflict) && (
        <div className="editor-alert">
          <ErrorBox error={error} />
          {conflict && (
            <div className="toolbar-group">
              <Button
                className="small"
                icon="Copy"
                onClick={() => {
                  void navigator.clipboard.writeText(body);
                }}
              >
                <UiText message={'Copy my Markdown'} />
              </Button>
              <Button className="small" icon="RotateCcw" onClick={reload}>
                <UiText message={'Reload latest file'} />
              </Button>
            </div>
          )}
        </div>
      )}
      <div
        hidden={history}
        className="editor-panes"
        id={`${id}-panes`}
        ref={panes}
        data-resizing={resizing || undefined}
        style={{ '--source-share': sourceShare } as CSSProperties}
      >
        <section className="source-pane" id={`${id}-source`}>
          <CodeEditor
            value={body}
            math={metadata.math}
            onChange={setBody}
            viewRef={viewRef}
            onUpdate={previewController.onEditorUpdate}
            saving={dirty}
            header={
              <div className="editor-source-tools">
                <div className="writing-tools">
                  <button
                    onClick={() => viewRef.current && wrapSource(viewRef.current, '**')}
                    title={t('Bold')}
                    data-ui-attrs={'{"title":"Bold"}'}
                  >
                    <Icon name="Bold" size={15} />
                    <span className="sr-only" data-ui={'Insert bold text'}>
                      {t('Insert bold text')}
                    </span>
                  </button>
                  <button
                    onClick={() => viewRef.current && wrapSource(viewRef.current, '*')}
                    title={t('Italic')}
                    data-ui-attrs={'{"title":"Italic"}'}
                  >
                    <Icon name="Italic" size={15} />
                    <span className="sr-only" data-ui={'Insert italic text'}>
                      {t('Insert italic text')}
                    </span>
                  </button>
                  <button
                    onClick={() => viewRef.current && prefixSource(viewRef.current, '## ')}
                    title={t('Heading')}
                    data-ui-attrs={'{"title":"Heading"}'}
                  >
                    <Icon name="Heading2" size={16} />
                    <span className="sr-only" data-ui={'Insert heading'}>
                      {t('Insert heading')}
                    </span>
                  </button>
                  <span className="tool-divider" />
                  <button
                    onClick={() =>
                      viewRef.current &&
                      viewRef.current.dom.dispatchEvent(new Event('studio-insert-link'))
                    }
                    aria-label={t('Insert link')}
                    data-ui-attrs={'{"aria-label":"Insert link"}'}
                  >
                    <Icon name="LinkIcon" size={15} />
                  </button>
                  <button
                    onClick={() => setMedia(true)}
                    aria-label={t('Insert image')}
                    data-ui-attrs={'{"aria-label":"Insert image"}'}
                  >
                    <Icon name="Image" size={15} />
                  </button>
                  <button
                    onClick={() =>
                      viewRef.current &&
                      wrapSource(viewRef.current, '```typescript\n', '\n```', '// A small idea')
                    }
                    aria-label={t('Insert code')}
                    data-ui-attrs={'{"aria-label":"Insert code"}'}
                  >
                    <Icon name="Code2" size={16} />
                  </button>
                  <span className="tool-divider" />
                  <button
                    className="insert-interactive"
                    aria-label={t('Insert component')}
                    aria-haspopup="dialog"
                    title={t('Insert component')}
                    onClick={() => setComposer(true)}
                    data-ui-attrs={'{"aria-label":"Insert component","title":"Insert component"}'}
                  >
                    <Icon name="Sparkles" size={14} />
                    <span data-ui={'Insert component'}>{t('Insert component')}</span>
                  </button>
                </div>
                <select
                  className={`status-select ${metadata.status}`}
                  aria-label={t('Publication status')}
                  value={metadata.status}
                  onChange={(e) => {
                    const status = e.target.value as EntryMeta['status'];
                    if (status === 'scheduled' && !metadata.publishAt) {
                      const next = new Date();
                      next.setDate(next.getDate() + 1);
                      next.setHours(9, 0, 0, 0);
                      updateMeta({
                        status,
                        publishAt: next.toISOString(),
                        publishedAt: localTime(next.toISOString()).slice(0, 10),
                      });
                      changeMode('settings');
                    } else updateMeta({ status });
                  }}
                  data-ui-attrs={'{"aria-label":"Publication status"}'}
                >
                  <option value="draft" data-ui={'Draft'}>
                    {t('Draft')}
                  </option>
                  <option value="scheduled" data-ui={'Scheduled'}>
                    {t('Scheduled')}
                  </option>
                  <option value="published" data-ui={'Published'}>
                    {t('Published')}
                  </option>
                </select>
              </div>
            }
          />
        </section>
        {visibleMode === 'split' && (
          <EditorDivider
            panes={panes}
            controls={`${id}-source ${id}-preview`}
            value={sourceShare}
            onChange={setSourceShare}
            onDragging={setResizing}
          />
        )}
        <section className={`preview-pane preview-${device}`} id={`${id}-preview`}>
          <div className="preview-toolbar">
            <span>
              <span className="preview-dot" />
              <UiText message={'Live preview'} />
              {previewBusy && <Icon name="LoaderCircle" size={12} className="spin" />}
            </span>
            <div className="toolbar-group">
              <FollowEditor controller={previewController} />
              <button
                aria-label={t('Desktop preview')}
                aria-pressed={device === 'desktop'}
                className={`icon-button ${device === 'desktop' ? 'selected' : ''}`}
                onClick={() => setDevice('desktop')}
                data-ui-attrs={'{"aria-label":"Desktop preview"}'}
              >
                <Icon name="Monitor" size={15} />
              </button>
              <button
                aria-label={t('Mobile preview')}
                aria-pressed={device === 'mobile'}
                className={`icon-button ${device === 'mobile' ? 'selected' : ''}`}
                onClick={() => setDevice('mobile')}
                data-ui-attrs={'{"aria-label":"Mobile preview"}'}
              >
                <Icon name="Smartphone" size={15} />
              </button>
              {preview && (
                <a
                  href={preview}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-button"
                  aria-label={t('Open preview in a new tab')}
                  data-ui-attrs={'{"aria-label":"Open preview in a new tab"}'}
                >
                  <Icon name="ExternalLink" size={14} />
                </a>
              )}
            </div>
          </div>
          <PreviewError controller={previewController} />
          <div className="preview-frame-wrap">
            <LivePreview
              controller={previewController}
              title={t('Live article preview')}
              identity={entry.id}
            />
          </div>
          <div className="preview-route">
            <Icon name="LinkIcon" size={11} />
            {routeFor({ ...entry, slug: metadata.slug }, collections)}
            <span data-ui={'Same renderer as your site'}>{t('Same renderer as your site')}</span>
          </div>
        </section>
      </div>
      <EntrySettings
        id={`${id}-settings`}
        active={!history && mode === 'settings'}
        entry={entry}
        metadata={metadata}
        site={site}
        onChange={updateMeta}
        onReturn={returnToEditor}
        onTrash={() => {
          setConfirmTrash(true);
        }}
        error={error}
        dirty={dirty}
        onSave={flush}
      />
      {composer && <Composer onInsert={insert} onClose={() => setComposer(false)} />}{' '}
      <div className="editor-history-workspace" id={`${id}-history`} hidden={!history}>
        <RevisionHistory
          active={history}
          entry={{ ...entry, ...metadata, body, revision: revision.current }}
          onClose={() => {
            setHistory(false);
            requestAnimationFrame(() => viewRef.current?.requestMeasure());
          }}
          onRestored={(saved) => {
            const next = metadataOf(saved);
            revision.current = saved.revision;
            baseline.current = JSON.stringify({ metadata: next, body: saved.body });
            latest.current = { metadata: next, body: saved.body };
            setMetadata(next);
            setBody(saved.body);
            setConflict(false);
            blocked.current = false;
            onSavedRef.current(saved);
            onStatus('All changes saved');
          }}
        />
      </div>
      {media && (
        <MediaPicker
          onSelect={(url) => insert(`\n\n![Describe this image](${url})\n\n`)}
          onClose={() => setMedia(false)}
        />
      )}{' '}
      {conversion && (
        <ConversionDialog
          entries={[conversion]}
          collections={collections}
          onClose={() => setConversion(null)}
          onConverted={async (entries) => {
            const converted = entries[0],
              next = { metadata: metadataOf(converted), body: converted.body };
            revision.current = converted.revision;
            baseline.current = JSON.stringify(next);
            latest.current = next;
            setMetadata(next.metadata);
            setBody(next.body);
            onSavedRef.current(converted);
            setConversion(null);
            await onConverted?.(converted);
          }}
        />
      )}
      {confirmDuplicate && (
        <Modal
          title={t('Duplicate as a draft?')}
          dismissible={!duplicating}
          onClose={() => setConfirmDuplicate(false)}
          footer={
            <>
              <Button
                data-modal-focus
                disabled={duplicating}
                onClick={() => setConfirmDuplicate(false)}
              >
                <UiText message={'Cancel'} />
              </Button>
              <Button
                variant="primary"
                icon={duplicating ? 'LoaderCircle' : 'Copy'}
                disabled={duplicating}
                onClick={() => {
                  void duplicateEntry();
                }}
              >
                {duplicating ? t('Creating draft…') : t('Duplicate draft')}
              </Button>
            </>
          }
        >
          <p className="modal-intro">
            <UiText message={'Create a draft copy of “'} />
            {metadata.title}
            <UiText message={'” and open it in the editor.'} />
          </p>
          <ErrorBox error={duplicateError} />
        </Modal>
      )}
      {confirmTrash && (
        <Modal
          title={t('Move this entry to Trash?')}
          onClose={() => setConfirmTrash(false)}
          footer={
            <>
              <Button onClick={() => setConfirmTrash(false)}>
                <UiText message={'Keep writing'} />
              </Button>
              <Button
                variant="danger"
                icon="Trash2"
                onClick={async () => {
                  try {
                    await flush();
                    await onTrash({ ...entry, revision: revision.current });
                  } catch (e) {
                    setError((e as Error).message);
                    setConfirmTrash(false);
                  }
                }}
              >
                <UiText message={'Move to Trash'} />
              </Button>
            </>
          }
        >
          <p className="modal-intro">
            “{metadata.title}
            <UiText
              message={
                '” will be removed from the next build. Its Markdown file can be restored from Trash.'
              }
            />
          </p>
        </Modal>
      )}
    </div>
  );
}
