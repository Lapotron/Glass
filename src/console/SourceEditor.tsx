import { useUiLocale } from './LanguageControl.js';
import { currentUiCatalog } from '../shared/i18n.js';
import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { createSourceComponentPreviews, type ComponentAction } from './source-components.js';
import { SourceComponentTools, fencedValue, replaceFence } from './SourceComponentTools.js';
import type { SourceComponent } from '../shared/source-components.js';
import {
  parseSourceTable,
  changeSourceTable,
  writeSourceTable,
  tableDelimited,
} from '../shared/source-table.js';
import { tableActions } from '../shared/source-table.js';
import {
  useEffect,
  useRef,
  useState,
  useId,
  useMemo,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  highlightWhitespace,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view';
import { EditorState, Compartment, Prec, Transaction } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, isolateHistory } from '@codemirror/commands';
import { sourceLanguage, fenceAt } from './source-language.js';
import {
  foldGutter,
  indentOnInput,
  bracketMatching,
  foldKeymap,
  indentUnit,
} from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { lintKeymap, forceLinting } from '@codemirror/lint';
import {
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
  gotoLine,
} from '@codemirror/search';
import { sourceHighlighting } from './source-theme.js';
import {
  pseudocodeCompletion,
  pseudocodeStructure,
  jumpPseudocodeBlock,
  beautifyPseudocodeOperators,
} from './pseudocode-intelligence.js';
import type { ViewUpdate } from '@codemirror/view';
import { Button, Icon } from '../shared/ui.js';
import { Modal } from './components.js';
import {
  authoringExtensions,
  completionTargets,
  startCompletion,
  completionStatus,
  blogCompletions,
  tableCommand,
  type CompletionTargets,
} from './markdown-assistance.js';
import {
  readSourcePreferences,
  sourceDefaults,
  type SourceAnalysis,
  type SourcePreferences,
} from './source-analysis.js';
import { sourceAnalyzer } from './source-worker.js';
import { sourceSearch, sourceMatches } from './source-search.js';
import { editingCommands } from './source-commands.js';
import { SourceMinimap } from './SourceMinimap.js';
import { sourceFormatter } from './source-formatter.js';
import { MarkdownDiff } from './MarkdownDiff.js';
import { LinkComposer } from './LinkComposer.js';
import { SourceImageTools } from './SourceImageTools.js';
import { imagePreviewUpdate, sourceImageExtensions } from './source-images.js';
import { localLinkTargets } from './source-links.js';
import type { SourceImage } from './source-inspection.js';
import { markdownMeaning, type FormatResult, type SourceEdit } from './source-format.js';
import { EditorPreferences, type EditorAction } from './EditorPreferences.js';
import { instantiateSnippet } from '../shared/markdown-snippets.js';
import { completionShortcutLabel } from './source-shortcuts.js';
import { sourceMathPreviews } from './source-math.js';
import { createSourceMathController } from './source-math-controller.js';
import {
  mathCompletion,
  mathHover,
  mathParameterHints,
  goToMathDefinition,
  type MathCompletionContext,
} from './math-completion.js';
import type { MathSettings } from '../shared/math-authoring.js';
import { createCodeIntelligence, type CodeDialog } from './code-intelligence.js';
import { CodeIntelligenceDialog } from './CodeIntelligenceDialog.js';
import { sourceStructure, matchingMathEnvironment } from './source-structure.js';
import type { MarkdownDiagnostic } from '../shared/markdown-analysis.js';
import { fenceOption } from '../shared/code-projects.js';
import './source-workspace.css';

export function CodeEditor({
  value,
  onChange,
  viewRef,
  onUpdate,
  header,
  saving,
  math,
}: {
  value: string;
  onChange: (value: string) => void;
  viewRef: MutableRefObject<EditorView | null>;
  onUpdate?: (update: ViewUpdate) => void;
  header?: ReactNode;
  saving?: boolean;
  math?: MathSettings;
}) {
  const host = useRef<HTMLDivElement>(null),
    workspace = useRef<HTMLDivElement>(null),
    id = useId();
  const targets = useRef<CompletionTargets>({ links: [], media: [] }),
    scope = useRef('');
  const config = useRef(new Compartment());
  const locale = useUiLocale();
  const language = useRef(new Compartment());
  const [preferences, setPreferences] = useState<SourcePreferences>({ ...sourceDefaults });
  const [analysis, setAnalysis] = useState<SourceAnalysis>({
    headings: [],
    diagnostics: [],
    words: 0,
    characters: 0,
    lines: 1,
  });
  const formatter = useRef<ReturnType<typeof sourceFormatter> | null>(null),
    analysisSource = useRef('');
  const analyzeNow = useRef<(source: string) => void>(() => {});
  const mathController = useRef<ReturnType<typeof createSourceMathController> | null>(null);
  const mathInfo = useRef<MathCompletionContext>({ math, macros: [] });
  mathInfo.current = { math, macros: analysis.macros || [] };
  const intelligence = useRef<ReturnType<typeof createCodeIntelligence> | null>(null);
  const [languageDialog, setLanguageDialog] = useState<CodeDialog | null>(null);
  const [codeProblems, setCodeProblems] = useState<MarkdownDiagnostic[]>([]);
  const componentSystem = useRef<ReturnType<typeof createSourceComponentPreviews> | null>(null);
  const componentAction = useRef<ComponentAction>(() => {});
  const [componentDialog, setComponentDialog] = useState<{
    block: SourceComponent;
    mode: 'edit' | 'expand';
    cell?: { row: number; column: number };
  } | null>(null);
  const [copyData, setCopyData] = useState<string | null>(null);

  const [formatting, setFormatting] = useState(false),
    [formatPreview, setFormatPreview] = useState<{ original: string; result: FormatResult } | null>(
      null,
    );
  const [linkDialog, setLinkDialog] = useState(false),
    [imageDialog, setImageDialog] = useState<{ image: SourceImage; source: string } | null>(null);
  const [severity, setSeverity] = useState('all'),
    [category, setCategory] = useState('all');
  const formatBusy = useRef(false),
    preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [problemCount, setProblemCount] = useState(0),
    [toolError, setToolError] = useState('');
  const [width, setWidth] = useState(0),
    [drawer, setDrawer] = useState(false),
    [overview, setOverview] = useState(false);
  const [tab, setTab] = useState<'outline' | 'problems' | 'search'>('outline'),
    [filter, setFilter] = useState('');
  const [workspaceTab, setWorkspaceTab] = useState<'source' | 'settings'>('source');
  const [commands, setCommands] = useState(false),
    [commandQuery, setCommandQuery] = useState(''),
    [commandIndex, setCommandIndex] = useState(0);
  const [focusMode, setFocusMode] = useState(false),
    [temporary, setTemporary] = useState(false);
  const [tick, setTick] = useState(0),
    [cursor, setCursor] = useState({ position: 0, line: 1, column: 1, selected: 0 });
  const change = useRef(onChange);
  change.current = onChange;
  const updateRef = useRef(onUpdate);
  updateRef.current = onUpdate;
  const shortcuts = useRef({
    commands: () => {},
    outline: () => {},
    save: () => {},
    format: () => {},
    link: () => {},
  });
  shortcuts.current = {
    save: () => {
      void explicitSave();
    },
    format: () => {
      void formatSource('document');
    },
    link: () => setLinkDialog(true),
    commands: () => {
      setCommands(true);
      setCommandQuery('');
      setCommandIndex(0);
    },
    outline: () => {
      setTab('outline');
      setDrawer(true);
    },
  };
  const preferenceExtensions = (p: SourcePreferences) => [
    p.numbers ? lineNumbers() : [],
    p.activeLine ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
    p.wrap ? EditorView.lineWrapping : [],
    p.whitespace ? highlightWhitespace() : [],
    indentUnit.of(' '.repeat(p.indent)),
    p.closeBrackets ? closeBrackets() : [],
    autocompletion({
      override: [
        pseudocodeCompletion,
        mathCompletion(() => mathInfo.current),
        async (context) => intelligence.current?.completion(context) || null,
        blogCompletions(() => targets.current),
      ],
      activateOnTyping: p.completeOnTyping,
      maxRenderedOptions: 20,
      defaultKeymap: false,
    }),
    p.completionShortcut
      ? Prec.highest(
          keymap.of([{ key: p.completionShortcut, run: startCompletion, preventDefault: true }]),
        )
      : [],
  ];
  const savePreferences = (patch: Partial<SourcePreferences>) =>
    setPreferences((previous) => {
      const next = { ...previous, ...patch, version: 1 as const };
      try {
        if (scope.current)
          localStorage.setItem(`fieldnotes-editor:${scope.current}`, JSON.stringify(next));
        else setTemporary(true);
      } catch {
        setTemporary(true);
      }
      return next;
    });
  useEffect(() => {
    let disposed = false;
    const analyzer = sourceAnalyzer();
    formatter.current = sourceFormatter();
    let contextForTargets: CompletionTargets | undefined;
    let inspectionContext: Parameters<typeof analyzer.analyze>[1];
    const analyze = async (source: string) => {
      const info = targets.current;
      if (contextForTargets !== info) {
        contextForTargets = info;
        inspectionContext = {
          links: info.notebook
            ? [
                ...localLinkTargets(info.notebook).map((t) => ({ url: t.url, status: t.status })),
                ...info.notebook.entries.flatMap((entry) =>
                  (entry.routeAliases || []).map((url) => ({ url, status: entry.status })),
                ),
              ]
            : undefined,
          media: info.mediaAvailable ? info.media.map((m) => m.url) : undefined,
        };
      }
      const result = await analyzer.analyze(source, inspectionContext);
      if (!disposed && !result.superseded && viewRef.current?.state.doc.toString() === source) {
        analysisSource.current = source;
        setAnalysis(result);
      }
      return result;
    };
    analyzeNow.current = (source) => {
      void analyze(source).catch(() => {});
    };
    void completionTargets()
      .then((result) => {
        if (disposed) return;
        targets.current = result;
        if (viewRef.current) forceLinting(viewRef.current);
        if (result.workspaceId) {
          scope.current = result.workspaceId;
          setPreferences(readSourcePreferences(result.workspaceId));
        }
      })
      .catch(() => setTemporary(true));
    const codeIntelligence = createCodeIntelligence(setLanguageDialog, (next) =>
      setCodeProblems((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      ),
    );
    intelligence.current = codeIntelligence;
    const mathPreviews = createSourceMathController(mathInfo.current.math);
    mathController.current = mathPreviews;
    const previews = createSourceComponentPreviews((...args) => componentAction.current(...args));
    componentSystem.current = previews;
    previews.source(value);
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          config.current.of(preferenceExtensions(sourceDefaults)),
          language.current.of(EditorState.phrases.of(currentUiCatalog())),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          sourceLanguage(),
          sourceHighlighting,
          sourceStructure,
          pseudocodeStructure,
          bracketMatching(),
          rectangularSelection(),
          crosshairCursor(),
          highlightSelectionMatches(),
          sourceSearch,
          ...sourceImageExtensions((image) =>
            setImageDialog({ image, source: view.state.doc.toString() }),
          ),
          sourceMathPreviews,
          mathPreviews.extension,
          codeIntelligence.extension,
          mathHover(() => mathInfo.current),
          mathParameterHints(() => mathInfo.current),
          previews.extension,
          ...authoringExtensions(
            () => targets.current,
            (count) => {
              if (!disposed) setProblemCount(count);
            },
            analyze,
          ),
          EditorView.contentAttributes.of({
            tabindex: '0',
            id: `source-${id}`,
            'aria-label': 'Markdown source',
            role: 'textbox',
            'aria-multiline': 'true',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString());
            updateRef.current?.(update);
            if (update.selectionSet || update.docChanged) {
              const selection = update.state.selection.main,
                line = update.state.doc.lineAt(selection.head);
              setCursor({
                position: selection.head,
                line: line.number,
                column: selection.head - line.from + 1,
                selected: update.state.selection.ranges.reduce((sum, r) => sum + r.to - r.from, 0),
              });
            }
            if (
              update.docChanged ||
              update.transactions.some((transaction) => transaction.effects.length)
            )
              setTick((current) => current + 1);
          }),
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-s',
                run: () => {
                  shortcuts.current.save();
                  return true;
                },
              },
              {
                key: 'Mod-Shift-f',
                run: () => {
                  shortcuts.current.format();
                  return true;
                },
              },
              {
                key: 'Mod-k',
                run: () => {
                  shortcuts.current.link();
                  return true;
                },
              },
              {
                key: 'Mod-Shift-p',
                run: () => {
                  shortcuts.current.commands();
                  return true;
                },
              },
              {
                key: 'Mod-Shift-o',
                run: () => {
                  shortcuts.current.outline();
                  return true;
                },
              },
              {
                key: 'F12',
                run: (view) =>
                  goToMathDefinition(view, mathInfo.current.macros) ||
                  languageAction('definitions', view),
              },
              { key: 'Shift-F12', run: (view) => languageAction('references', view) },
              { key: 'F2', run: (view) => languageAction('rename', view) },
              { key: 'Mod-.', run: (view) => languageAction('fixes', view) },
              ...editingCommands
                .filter((command) => command.shortcut === 'Mod B' || command.shortcut === 'Mod I')
                .map((command) => ({
                  key: command.shortcut!.replaceAll(' ', '-'),
                  run: command.run,
                })),
            ]),
          ),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...lintKeymap,
          ]),
          Prec.highest(
            keymap.of(completionKeymap.filter((binding) => binding.run !== startCompletion)),
          ),
          EditorView.theme({
            '&': {
              background: 'transparent',
              fontSize:
                'calc(var(--source-font-size, 13px * var(--font-scale)) * var(--editor-source-scale, 1))',
              height: '100%',
            },
            '.cm-scroller': {
              fontFamily: 'var(--mono)',
              lineHeight: 'var(--source-leading, 1.95)',
              overflow: 'auto',
            },
            '.cm-content': {
              padding: 'var(--source-padding-top, 22px) 0 var(--source-padding-bottom, 100px)',
              caretColor: 'var(--accent)',
            },
            '.cm-line': { padding: '0 24px 0 10px' },
            '.cm-gutters': {
              background: 'transparent',
              color: 'var(--faint)',
              border: 'none',
              fontSize: 'inherit',
              lineHeight: 'inherit',
              padding: '0 4px 0 8px',
            },
            '.cm-activeLineGutter,.cm-activeLine': { background: 'var(--hover)' },
            '&.cm-focused': { outline: 'none' },
            '.cm-selectionBackground,&.cm-focused .cm-selectionBackground': {
              background: 'color-mix(in srgb,var(--accent) 15%,transparent)',
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    const link = () => shortcuts.current.link();
    view.dom.addEventListener('studio-insert-link', link);
    const resize = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    resize.observe(workspace.current!);
    return () => {
      disposed = true;
      analyzeNow.current = () => {};
      resize.disconnect();
      analyzer.dispose();
      formatter.current?.dispose();
      previews.dispose();
      mathPreviews.dispose();
      codeIntelligence.dispose();
      intelligence.current = null;
      mathController.current = null;
      componentSystem.current = null;
      view.dom.removeEventListener('studio-insert-link', link);
      view.destroy();
      viewRef.current = null;
    };
  }, []);
  useEffect(() => {
    const view = viewRef.current;
    if (view && value !== view.state.doc.toString())
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: config.current.reconfigure(preferenceExtensions(preferences)),
    });
    viewRef.current?.requestMeasure();
  }, [preferences]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: language.current.reconfigure(EditorState.phrases.of(currentUiCatalog())),
    });
  }, [locale]);
  useEffect(() => {
    if (focusMode) viewRef.current?.requestMeasure();
  }, [focusMode]);
  useEffect(() => {
    if (viewRef.current && analysisSource.current === value)
      viewRef.current.dispatch({
        effects: imagePreviewUpdate.of({
          images: analysis.images || [],
          mode: preferences.imagePreviews,
        }),
      });
  }, [analysis, preferences.imagePreviews]);
  useEffect(() => {
    componentSystem.current?.source(value, math);
    analyzeNow.current(value);
  }, [value, math]);
  useEffect(() => {
    if (viewRef.current && analysisSource.current === value)
      componentSystem.current?.update(
        viewRef.current,
        analysis.components || [],
        preferences.componentPreviews,
      );
  }, [analysis, preferences.componentPreviews, math]);
  useEffect(() => {
    const view = viewRef.current;
    if (view && analysisSource.current === value)
      mathController.current?.update(view, value, analysis.maths || [], preferences, math);
  }, [analysis, value, preferences.mathPreviews, preferences.inlineMathPreviews, math]);
  useEffect(() => {
    const view = viewRef.current;
    if (view && analysisSource.current === value) {
      intelligence.current?.update(view, analysis.codeBlocks || []);
      if (analysis.codeBlocks?.length) forceLinting(view);
    }
  }, [analysis, value]);
  function languageAction(
    action: 'definitions' | 'references' | 'rename' | 'fixes',
    view: EditorView,
  ) {
    const fence = fenceAt(view.state, view.state.selection.main.head);
    if (!fence || !/^(?:javascript|js|jsx|typescript|ts|tsx)(?:\s|$)/.test(fence.info))
      return false;
    void intelligence.current?.command(action, view);
    return true;
  }
  function applyEdits(original: string, edits: SourceEdit[]) {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() !== original)
      throw new Error('The source changed. Run this action again to keep the latest text.');
    const result = edits.reduceRight(
      (text, edit) => text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
      original,
    );
    if (edits.length && markdownMeaning(original) !== markdownMeaning(result))
      throw new Error(
        'These fixes could change document meaning. Your Markdown was kept for manual review.',
      );
    if (edits.length)
      view.dispatch({
        changes: edits,
        effects: view.scrollSnapshot(),
        annotations: [Transaction.userEvent.of('input.format'), isolateHistory.of('full')],
      });
    view.focus();
  }
  async function formatSource(action: 'document' | 'selection' | 'preview') {
    const view = viewRef.current;
    if (!view || !formatter.current || formatBusy.current) return false;
    const original = view.state.doc.toString(),
      selection = view.state.selection.main;
    formatBusy.current = true;
    setFormatting(true);
    setToolError('');
    try {
      if (action === 'selection' && selection.empty)
        throw new Error('Select complete Markdown blocks before formatting a selection.');
      const result = await formatter.current.format(
        original,
        action === 'selection' ? { from: selection.from, to: selection.to } : undefined,
      );
      if (!viewRef.current || view.state.doc.toString() !== original)
        throw new Error(
          'New edits arrived during formatting. Your latest text was kept. Run formatting again.',
        );
      if (action === 'preview') setFormatPreview({ original, result });
      else applyEdits(original, result.edits);
      return true;
    } catch (e) {
      if (viewRef.current) setToolError((e as Error).message);
      return false;
    } finally {
      formatBusy.current = false;
      if (viewRef.current) setFormatting(false);
    }
  }
  async function explicitSave() {
    if (formatBusy.current) return;
    if (preferencesRef.current.formatOnSave) await formatSource('document');
    // Let the parent's canonical draft snapshot catch up with this transaction.
    requestAnimationFrame(() => {
      if (viewRef.current) document.dispatchEvent(new Event('studio-save'));
    });
  }
  function fixSafe() {
    try {
      applyEdits(
        analysisSource.current,
        analysis.diagnostics.flatMap((d) => d.fix?.changes || []).sort((a, b) => a.from - b.from),
      );
      setToolError('');
    } catch (e) {
      setToolError((e as Error).message);
    }
  }
  const allProblems = [...analysis.diagnostics, ...codeProblems].sort((a, b) => a.from - b.from);
  const issueCount = problemCount + codeProblems.length;
  const minimapAnalysis = useMemo(
    () =>
      codeProblems.length
        ? {
            ...analysis,
            diagnostics: [...analysis.diagnostics, ...codeProblems].sort((a, b) => a.from - b.from),
          }
        : analysis,
    [analysis, codeProblems],
  );
  const problems = allProblems.filter(
    (d) =>
      (severity === 'all' || d.severity === severity) &&
      (category === 'all' || (d.category || 'syntax') === category),
  );
  const assistanceCommands = [
    {
      id: 'retry-code',
      label: 'Retry language intelligence',
      run: () => {
        if (viewRef.current) intelligence.current?.retry(viewRef.current);
        return true;
      },
    },
    {
      id: 'check-all-code',
      label: 'Check all JS/TS code blocks',
      run: () => {
        if (viewRef.current) intelligence.current?.checkAll(viewRef.current);
        return true;
      },
    },
    {
      id: 'matching-environment',
      label: 'Go to matching math environment',
      run: () => (viewRef.current ? matchingMathEnvironment(viewRef.current) : false),
    },
    ...(
      [
        ['definitions', 'Go to definition', 'F12'],
        ['references', 'Find references', 'Shift F12'],
        ['rename', 'Rename symbol', 'F2'],
        ['fixes', 'Code actions', 'Mod .'],
      ] as const
    ).map(([action, label, shortcut]) => ({
      id: 'code-' + action,
      label,
      shortcut,
      run: () => (viewRef.current ? languageAction(action, viewRef.current) : false),
    })),
    {
      id: 'format-document',
      label: 'Format document',
      shortcut: 'Mod Shift F',
      run: () => {
        void formatSource('document');
        return true;
      },
    },
    {
      id: 'format-selection',
      label: 'Format selected complete blocks',
      run: () => {
        void formatSource('selection');
        return true;
      },
    },
    {
      id: 'preview-format',
      label: 'Preview formatting',
      run: () => {
        void formatSource('preview');
        return true;
      },
    },
    {
      id: 'fix-safe',
      label: 'Fix all safe issues',
      run: () => {
        fixSafe();
        return true;
      },
    },
    {
      id: 'link-composer',
      label: 'Insert or edit link / local citation',
      shortcut: 'Mod K',
      run: () => {
        setLinkDialog(true);
        return true;
      },
    },
  ];
  useEffect(() => {
    if (workspaceTab === 'source') requestAnimationFrame(() => viewRef.current?.requestMeasure());
  }, [workspaceTab]);
  function returnToSource() {
    setWorkspaceTab('source');
    requestAnimationFrame(() => {
      viewRef.current?.requestMeasure();
      viewRef.current?.focus();
    });
  }
  function editorAction(action: EditorAction) {
    returnToSource();
    if (action === 'complete')
      requestAnimationFrame(() => {
        const view = viewRef.current;
        if (view && completionStatus(view.state) === null) startCompletion(view);
      });
    else if (action === 'fix') fixSafe();
    else void formatSource(action);
  }
  async function editorTable(action: string) {
    if (!viewRef.current) return;
    try {
      await tableCommand(viewRef.current, action);
      setToolError('');
      returnToSource();
    } catch (e) {
      setToolError((e as Error).message);
    }
  }
  componentAction.current = (block, action, selected) => {
    const view = viewRef.current;
    if (!view) return;
    try {
      if (view.state.doc.sliceString(block.from, block.to) !== block.source)
        throw new Error('This component changed. Retry its tools.');
      let cell = selected;
      if (block.kind === 'table') {
        const table = parseSourceTable(block.source),
          position = view.state.selection.main.head - block.from;
        table.cells.forEach((cells, row) =>
          cells.forEach((range, column) => {
            if (position >= range.from && position <= range.to) cell = { row, column };
          }),
        );
      }
      if (action === 'edit' || action === 'expand') {
        setComponentDialog({ block, mode: action, cell });
        return;
      }
      if (action === 'copy' || action === 'csv' || action === 'tsv') {
        const text =
          action === 'copy'
            ? block.source
            : tableDelimited(parseSourceTable(block.source), action === 'csv' ? ',' : '\t');
        void navigator.clipboard.writeText(text).catch(() => setCopyData(text));
        return;
      }
      let insert = block.source;
      if (block.kind === 'table')
        insert = writeSourceTable(
          changeSourceTable(
            parseSourceTable(block.source),
            action,
            cell?.row || 0,
            cell?.column || 0,
          ),
        );
      else if (action === 'swap' && block.kind === 'image-compare') {
        const config = JSON.parse(fencedValue(block));
        [config.before, config.after] = [config.after, config.before];
        [config.beforeLabel, config.afterLabel] = [config.afterLabel, config.beforeLabel];
        insert = replaceFence(block.source, JSON.stringify(config, null, 2));
      }
      view.dispatch({
        changes: { from: block.from, to: block.to, insert },
        effects: view.scrollSnapshot(),
        annotations: Transaction.userEvent.of('input.component'),
      });
      setToolError('');
    } catch (error) {
      setToolError((error as Error).message);
    }
  };
  const wide = width >= 960,
    mini = workspaceTab === 'source' && width >= 640 && preferences.minimap;
  const showNav = workspaceTab === 'source' && ((wide && preferences.navigator) || drawer);
  const headings = analysis.headings.filter((heading) =>
    heading.text.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  const currentHeading = analysis.headings
    .filter((heading) => heading.from <= cursor.position)
    .at(-1);
  const results = useMemo(
    () => (tab === 'search' && viewRef.current ? sourceMatches(viewRef.current) : []),
    [tick, value, tab],
  );
  const jump = (position: number, end = position) => {
    const view = viewRef.current;
    if (!view) return;
    const target = Math.max(0, Math.min(view.state.doc.length, position));
    view.dispatch({
      selection: { anchor: target, head: Math.min(view.state.doc.length, end) },
      effects: EditorView.scrollIntoView(target, { y: 'center' }),
    });
    view.focus();
    if (!wide) {
      setDrawer(false);
      setOverview(false);
    }
  };
  const nav = (next: typeof tab) => {
    setTab(next);
    if (!wide || !preferences.navigator) setDrawer(true);
  };
  const allCommands = [
    ...assistanceCommands,
    {
      id: 'pseudocode-match',
      label: t('Jump to matching pseudocode block'),
      shortcut: undefined,
      run: jumpPseudocodeBlock,
    },
    {
      id: 'pseudocode-symbols',
      label: t('Beautify pseudocode operators'),
      shortcut: undefined,
      run: beautifyPseudocodeOperators,
    },
    {
      id: 'complete-source',
      label: 'Complete at cursor',
      shortcut: completionShortcutLabel(preferences.completionShortcut),
      run: () => {
        editorAction('complete');
        return true;
      },
    },
    ...Object.entries(tableActions).map(([action, label]) => ({
      id: `table-${action}`,
      label,
      shortcut: undefined,
      run: () => {
        void editorTable(action);
        return true;
      },
    })),
    ...editingCommands.filter((c) => c.id !== 'link'),
  ];
  const commandList = allCommands.filter((command) =>
    command.label.toLowerCase().includes(commandQuery.toLowerCase()),
  );
  const run = (command: (typeof allCommands)[number]) => {
    setCommands(false);
    requestAnimationFrame(() => {
      const view = viewRef.current;
      if (view) {
        view.focus();
        command.run(view);
      }
    });
  };
  return (
    <div
      ref={workspace}
      className={`code-editor-wrap source-workspace ${focusMode ? 'source-focus-mode' : ''}`}
      data-navigator={showNav && wide ? 'docked' : showNav ? 'drawer' : 'closed'}
      data-minimap={mini ? 'docked' : workspaceTab === 'source' && overview ? 'drawer' : 'closed'}
      data-source-tab={workspaceTab}
      style={{ '--editor-source-scale': preferences.scale } as React.CSSProperties}
      onKeyDown={(event) => {
        if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
        if (workspaceTab === 'settings') {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            returnToSource();
          }
          return;
        }
        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void explicitSave();
        } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          if (viewRef.current) openSearchPanel(viewRef.current);
        } else if (event.key === 'Escape' && (drawer || overview || focusMode)) {
          event.preventDefault();
          event.stopPropagation();
          setDrawer(false);
          setOverview(false);
          setFocusMode(false);
          viewRef.current?.focus();
        }
      }}
    >
      {showNav && (
        <aside
          className="source-navigator"
          aria-label={t('Editor navigator')}
          id={`navigator-${id}`}
          data-ui-attrs={'{"aria-label":"Editor navigator"}'}
        >
          <div className="source-navigator-head">
            <div
              className="source-navigator-tabs"
              role="tablist"
              aria-label={t('Editor navigation')}
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  const tabs = ['outline', 'problems', 'search'] as const;
                  const index =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? 2
                        : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
                  setTab(tabs[index]);
                  document.getElementById(`${id}-${tabs[index]}-tab`)?.focus();
                }
              }}
              data-ui-attrs={'{"aria-label":"Editor navigation"}'}
            >
              {(['outline', 'problems', 'search'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  id={`${id}-${item}-tab`}
                  aria-controls={`${id}-navigation-panel`}
                  aria-selected={tab === item}
                  tabIndex={tab === item ? 0 : -1}
                  onClick={() => setTab(item)}
                  title={
                    item === 'problems'
                      ? t('Problems')
                      : item === 'search'
                        ? t('Search results')
                        : t('Document outline')
                  }
                >
                  <Icon
                    name={
                      item === 'outline'
                        ? 'ListTree'
                        : item === 'problems'
                          ? 'AlertCircle'
                          : 'Search'
                    }
                    size={15}
                  />
                  <span>
                    {item === 'problems'
                      ? problemCount + codeProblems.length || t('Problems')
                      : item === 'search'
                        ? t('Find')
                        : t('Outline')}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="icon-button source-navigator-close"
              aria-label={t('Close navigator')}
              onClick={() => {
                setDrawer(false);
                if (wide) savePreferences({ navigator: false });
              }}
              data-ui-attrs={'{"aria-label":"Close navigator"}'}
            >
              <Icon name="X" size={14} />
            </button>
          </div>
          <div
            className="source-navigator-body"
            role="tabpanel"
            id={`${id}-navigation-panel`}
            aria-labelledby={`${id}-${tab}-tab`}
            tabIndex={0}
          >
            {tab === 'outline' && (
              <>
                <input
                  type="search"
                  aria-label={t('Filter document headings')}
                  placeholder={t('Filter headings…')}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  data-ui-attrs={
                    '{"aria-label":"Filter document headings","placeholder":"Filter headings…"}'
                  }
                />
                <nav
                  aria-label={t('Markdown headings')}
                  data-ui-attrs={'{"aria-label":"Markdown headings"}'}
                >
                  {headings.map((heading) => (
                    <button
                      type="button"
                      key={heading.from}
                      className="source-heading"
                      aria-current={currentHeading?.from === heading.from ? 'location' : undefined}
                      style={{ paddingInlineStart: 12 + (heading.level - 1) * 12 }}
                      onClick={() => jump(heading.from)}
                    >
                      <span>{heading.text || t('Untitled heading')}</span>
                      <small>{heading.line}</small>
                    </button>
                  ))}
                </nav>
                {!headings.length && (
                  <p className="help">
                    {filter
                      ? t('No matching headings.')
                      : t('Add Markdown headings to navigate your document.')}
                  </p>
                )}
                <div className="source-outline-actions">
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      viewRef.current &&
                      editingCommands.find((c) => c.id === 'fold-all')!.run(viewRef.current)
                    }
                    data-ui={'Fold all'}
                  >
                    {t('Fold all')}
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      viewRef.current &&
                      editingCommands.find((c) => c.id === 'unfold-all')!.run(viewRef.current)
                    }
                    data-ui={'Expand all'}
                  >
                    {t('Expand all')}
                  </button>
                </div>
              </>
            )}
            {tab === 'problems' && (
              <>
                <div className="source-problem-filters">
                  <select
                    aria-label={t('Problem severity')}
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    data-ui-attrs={'{"aria-label":"Problem severity"}'}
                  >
                    <option value="all" data-ui={'All severities'}>
                      {t('All severities')}
                    </option>
                    <option value="error" data-ui={'Errors'}>
                      {t('Errors')}
                    </option>
                    <option value="warning" data-ui={'Warnings'}>
                      {t('Warnings')}
                    </option>
                  </select>
                  <select
                    aria-label={t('Problem category')}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    data-ui-attrs={'{"aria-label":"Problem category"}'}
                  >
                    <option value="all" data-ui={'All categories'}>
                      {t('All categories')}
                    </option>
                    {['syntax', 'structure', 'accessibility', 'links', 'style'].map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="source-outline-actions">
                  <button
                    type="button"
                    className="text-link"
                    disabled={!problems.length}
                    onClick={() => {
                      const p =
                        [...problems].reverse().find((p) => p.from < cursor.position) ||
                        problems.at(-1);
                      if (p) jump(p.from, p.to);
                    }}
                    data-ui={'Previous issue'}
                  >
                    {t('Previous issue')}
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    disabled={!problems.length}
                    onClick={() => {
                      const p = problems.find((p) => p.from > cursor.position) || problems[0];
                      if (p) jump(p.from, p.to);
                    }}
                    data-ui={'Next issue'}
                  >
                    {t('Next issue')}
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    disabled={!analysis.diagnostics.some((p) => p.fix)}
                    onClick={fixSafe}
                    data-ui={'Fix safe issues'}
                  >
                    {t('Fix safe issues')}
                  </button>
                </div>
                {!problems.length && (
                  <p className="help" data-ui={'No Markdown problems found.'}>
                    {t('No Markdown problems found.')}
                  </p>
                )}
                {problems.map((problem, index) => (
                  <div className="source-problem-row" key={index}>
                    <button
                      type="button"
                      className="source-problem"
                      key={index}
                      onClick={() => jump(problem.from, problem.to)}
                    >
                      <Icon name="AlertCircle" size={14} />
                      <span>
                        <strong>{problem.message}</strong>
                        <small>
                          <UiText message={'Line '} />
                          {problem.line}
                          <UiText message={', column '} />
                          {problem.column} · {problem.severity} · {problem.category || t('syntax')}
                        </small>
                      </span>
                    </button>
                    {problem.fix && (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => {
                          try {
                            applyEdits(analysisSource.current, problem.fix!.changes);
                          } catch (e) {
                            setToolError((e as Error).message);
                          }
                        }}
                      >
                        {problem.fix.label}
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
            {tab === 'search' && (
              <>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => viewRef.current && openSearchPanel(viewRef.current)}
                >
                  <UiText message={'Find and replace '} />
                  <Icon name="Search" size={14} />
                </button>
                <p className="help">
                  {results.length
                    ? t('{value0}{value1} matches', {
                        value0: results.length,
                        value1: results.length === 2000 ? '+' : '',
                      })
                    : t('Use Find to search this document.')}
                </p>
                {results.slice(0, 200).map((match, index) => {
                  const line = viewRef.current!.state.doc.lineAt(match.from);
                  return (
                    <button
                      type="button"
                      className="source-search-result"
                      key={index}
                      onClick={() => jump(match.from, match.to)}
                    >
                      <small>
                        <UiText message={'Line '} />
                        {line.number}
                      </small>
                      <span>
                        {line.text.slice(
                          Math.max(0, match.from - line.from - 24),
                          match.from - line.from + 100,
                        )}
                      </span>
                    </button>
                  );
                })}
                {results.length > 200 && (
                  <p
                    className="help"
                    data-ui={'Showing the first 200 results. Find navigates every match.'}
                  >
                    {t('Showing the first 200 results. Find navigates every match.')}
                  </p>
                )}
              </>
            )}
          </div>
        </aside>
      )}
      <div className="source-main">
        <div
          className="source-view-tabs"
          role="tablist"
          aria-label={t('Source workspace')}
          onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 'source'
                  : event.key === 'End'
                    ? 'settings'
                    : workspaceTab === 'source'
                      ? 'settings'
                      : 'source';
              setWorkspaceTab(next);
              document.getElementById(`${id}-${next}-view-tab`)?.focus();
            }
          }}
          data-ui-attrs={'{"aria-label":"Source workspace"}'}
        >
          {(['source', 'settings'] as const).map((tab) => (
            <button
              type="button"
              role="tab"
              id={`${id}-${tab}-view-tab`}
              aria-controls={`${id}-${tab}-view`}
              aria-selected={workspaceTab === tab}
              tabIndex={workspaceTab === tab ? 0 : -1}
              key={tab}
              onClick={(event) => {
                event.currentTarget.focus();
                setWorkspaceTab(tab);
              }}
            >
              <Icon name={tab === 'source' ? 'Code2' : 'Settings2'} size={14} />
              {tab === 'source' ? t('Source edit') : t('Settings')}
            </button>
          ))}
        </div>
        {toolError && (
          <p className="editor-tool-error" role="status">
            {toolError}
          </p>
        )}
        <div
          className="source-edit-panel"
          id={`${id}-source-view`}
          role="tabpanel"
          aria-labelledby={`${id}-source-view-tab`}
          hidden={workspaceTab !== 'source'}
        >
          <div
            className="editor-assistance"
            aria-label={t('Markdown authoring tools')}
            data-ui-attrs={'{"aria-label":"Markdown authoring tools"}'}
          >
            <div className="editor-assistance-tools">
              <div
                className="source-command-buttons"
                role="group"
                aria-label={t('Editor tools')}
                data-ui-attrs={'{"aria-label":"Editor tools"}'}
              >
                <button
                  type="button"
                  className="icon-button"
                  data-source-nav
                  aria-label={t('Toggle document outline')}
                  aria-controls={`navigator-${id}`}
                  aria-expanded={showNav}
                  title={t('Outline · Ctrl/Cmd Shift O')}
                  onClick={() => {
                    if (wide) savePreferences({ navigator: !preferences.navigator });
                    else {
                      setDrawer(!drawer);
                      setTab('outline');
                    }
                  }}
                  data-ui-attrs={
                    '{"aria-label":"Toggle document outline","title":"Outline · Ctrl/Cmd Shift O"}'
                  }
                >
                  <Icon name="ListTree" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('Find in Markdown')}
                  title={t('Find · Ctrl/Cmd F')}
                  onClick={() => viewRef.current && openSearchPanel(viewRef.current)}
                  data-ui-attrs={'{"aria-label":"Find in Markdown","title":"Find · Ctrl/Cmd F"}'}
                >
                  <Icon name="Search" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('Toggle minimap')}
                  aria-pressed={mini || overview}
                  title={t('Document minimap')}
                  onClick={() =>
                    width >= 640
                      ? savePreferences({ minimap: !preferences.minimap })
                      : setOverview(!overview)
                  }
                  data-ui-attrs={'{"aria-label":"Toggle minimap","title":"Document minimap"}'}
                >
                  <Icon name="MapPin" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('Editor commands')}
                  title={t('Editor commands · Ctrl/Cmd Shift P')}
                  onClick={() => shortcuts.current.commands()}
                  data-ui-attrs={
                    '{"aria-label":"Editor commands","title":"Editor commands · Ctrl/Cmd Shift P"}'
                  }
                >
                  <Icon name="Code2" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={
                    focusMode ? t('Exit writing focus mode') : t('Enter writing focus mode')
                  }
                  aria-pressed={focusMode}
                  title={focusMode ? t('Exit focus · Escape') : t('Focus on writing')}
                  onClick={() => setFocusMode(!focusMode)}
                >
                  <Icon name={focusMode ? 'Columns2' : 'Expand'} size={16} />
                </button>
              </div>
              <button
                type="button"
                className="text-link editor-syntax-status"
                data-state={issueCount ? 'issues' : 'valid'}
                title={t('Show Markdown diagnostics')}
                onClick={() => nav('problems')}
                data-ui-attrs={'{"title":"Show Markdown diagnostics"}'}
              >
                <Icon name={issueCount ? 'AlertCircle' : 'Check'} size={14} />
                {issueCount
                  ? t('{value0} {value1}', {
                      value0: issueCount,
                      value1: issueCount === 1 ? 'issue' : 'issues',
                    })
                  : t('Syntax checked')}
              </button>
            </div>
          </div>
          {header}
          <div
            className="code-editor"
            ref={host}
            aria-label={t('Markdown editor')}
            data-ui-attrs={'{"aria-label":"Markdown editor"}'}
          />
          <div className="editor-foot">
            {saving !== undefined && (
              <span
                className="editor-save-state"
                title={saving ? t('Saving your thoughts…') : t('Saved as Markdown')}
              >
                <span className={`status-dot ${saving ? 'unsaved' : ''}`} />
                <span className="editor-save-label">
                  {saving ? t('Saving your thoughts…') : t('Saved as Markdown')}
                </span>
              </span>
            )}
            <button
              type="button"
              className="text-link source-position"
              title={t('Go to line / column')}
              onClick={() => viewRef.current && gotoLine(viewRef.current)}
              data-ui-attrs={'{"title":"Go to line / column"}'}
            >
              <span>
                <UiText message={'Ln '} />
                {cursor.line}
                <UiText message={', Col '} />
                {cursor.column}
              </span>
              {cursor.selected > 0 && (
                <span className="source-selection">
                  {' '}
                  · {cursor.selected} <UiText message={' selected'} />
                </span>
              )}
            </button>
            <span
              className="source-statistics"
              title={t('{value0} characters · {value1} lines', {
                value0: analysis.characters,
                value1: analysis.lines,
              })}
            >
              {analysis.words.toLocaleString()} <UiText message={' words ·'} />{' '}
              {Math.max(1, Math.ceil(analysis.words / 220))} <UiText message={' min'} />
            </span>
            <span className="source-encoding">
              {(viewRef.current &&
                (() => {
                  const block = fenceAt(viewRef.current!.state, cursor.position);
                  return block
                    ? `${fenceOption(block.info, 'title') || block.info.split(/\s+/)[0]} · `
                    : '';
                })()) ||
                'Markdown · '}
              UTF-8
            </span>
          </div>
        </div>
        <section
          className="source-settings-panel"
          id={`${id}-settings-view`}
          role="tabpanel"
          aria-labelledby={`${id}-settings-view-tab`}
          hidden={workspaceTab !== 'settings'}
        >
          <EditorPreferences
            value={preferences}
            onChange={savePreferences}
            temporary={temporary}
            busy={formatting}
            onAction={editorAction}
            onExample={(example) => {
              const view = viewRef.current;
              if (view) {
                const range = view.state.selection.main;
                view.dispatch({
                  changes: {
                    from: range.from,
                    to: range.to,
                    insert: '\n\n' + instantiateSnippet(example) + '\n\n',
                  },
                  annotations: Transaction.userEvent.of('input.reference'),
                });
                returnToSource();
              }
            }}
          />
        </section>
      </div>
      {workspaceTab === 'source' && (mini || overview) && (
        <div
          className="source-overview"
          aria-label={t('Document overview')}
          data-ui-attrs={'{"aria-label":"Document overview"}'}
        >
          {overview && !mini && (
            <button
              type="button"
              className="text-link"
              onClick={() => setOverview(false)}
              data-ui={'Close overview'}
            >
              {t('Close overview')}
            </button>
          )}
          <SourceMinimap
            source={value}
            viewRef={viewRef}
            analysis={minimapAnalysis}
            tick={tick}
            controls={`source-${id}`}
          />
        </div>
      )}
      {languageDialog && (
        <CodeIntelligenceDialog value={languageDialog} onClose={() => setLanguageDialog(null)} />
      )}
      {linkDialog && viewRef.current && (
        <LinkComposer
          view={viewRef.current}
          targets={targets.current}
          onClose={() => setLinkDialog(false)}
        />
      )}
      {imageDialog && viewRef.current && (
        <SourceImageTools
          view={viewRef.current}
          {...imageDialog}
          onClose={() => setImageDialog(null)}
        />
      )}
      {componentDialog && viewRef.current && (
        <SourceComponentTools
          view={viewRef.current}
          math={math}
          {...componentDialog}
          onClose={() => setComponentDialog(null)}
        />
      )}
      {copyData !== null && (
        <Modal title={t('Copy component data')} onClose={() => setCopyData(null)}>
          <p
            className="help"
            data-ui={'Clipboard access is unavailable. Select and copy this text.'}
          >
            {t('Clipboard access is unavailable. Select and copy this text.')}
          </p>
          <textarea
            data-modal-focus
            readOnly
            rows={10}
            aria-label={t('Component data')}
            value={copyData}
            onFocus={(event) => event.currentTarget.select()}
            data-ui-attrs={'{"aria-label":"Component data"}'}
          />
        </Modal>
      )}
      {formatPreview && (
        <Modal
          title={t('Preview formatting')}
          wide
          onClose={() => setFormatPreview(null)}
          footer={
            <>
              <Button onClick={() => setFormatPreview(null)}>
                <UiText message={'Cancel'} />
              </Button>
              <Button
                variant="primary"
                icon="Check"
                onClick={() => {
                  try {
                    applyEdits(formatPreview.original, formatPreview.result.edits);
                    setFormatPreview(null);
                  } catch (e) {
                    setToolError((e as Error).message);
                    setFormatPreview(null);
                  }
                }}
              >
                <UiText message={'Apply formatting'} />
              </Button>
            </>
          }
        >
          <p
            className="help"
            data-ui={'The Markdown parser confirmed that document meaning is unchanged.'}
          >
            {t('The Markdown parser confirmed that document meaning is unchanged.')}
          </p>
          <MarkdownDiff earlier={formatPreview.original} current={formatPreview.result.source} />
        </Modal>
      )}
      {commands && (
        <Modal title={t('Editor commands')} onClose={() => setCommands(false)}>
          <input
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-label={t('Search editor commands')}
            data-modal-focus
            value={commandQuery}
            onChange={(event) => {
              setCommandQuery(event.target.value);
              setCommandIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setCommandIndex(
                  (index) =>
                    (index + (event.key === 'ArrowDown' ? 1 : commandList.length - 1)) %
                    Math.max(1, commandList.length),
                );
              } else if (event.key === 'Enter' && commandList[commandIndex]) {
                event.preventDefault();
                run(commandList[commandIndex]);
              }
            }}
            aria-controls={`commands-${id}`}
            aria-activedescendant={
              commandList[commandIndex]
                ? `${id}-command-${commandList[commandIndex].id}`
                : undefined
            }
            data-ui-attrs={'{"aria-label":"Search editor commands"}'}
          />
          <div
            className="source-command-list"
            id={`commands-${id}`}
            role="listbox"
            aria-label={t('Editing commands')}
            data-ui-attrs={'{"aria-label":"Editing commands"}'}
          >
            {commandList.map((command, index) => (
              <button
                type="button"
                role="option"
                id={`${id}-command-${command.id}`}
                key={command.id}
                aria-selected={index === commandIndex}
                onClick={() => run(command)}
              >
                <span>{command.label}</span>
                {command.shortcut && (
                  <kbd>
                    {command.shortcut.replace(
                      'Mod',
                      navigator.platform.includes('Mac') ? '⌘' : 'Ctrl',
                    )}
                  </kbd>
                )}
              </button>
            ))}
            {!commandList.length && (
              <p className="help" data-ui={'No matching commands.'}>
                {t('No matching commands.')}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
