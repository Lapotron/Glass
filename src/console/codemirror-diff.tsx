import { t } from '../shared/i18n.js';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorState, Compartment } from '@codemirror/state';
import { currentUiCatalog, subscribeUiLocale } from '../shared/i18n.js';
import {
  EditorView,
  lineNumbers,
  keymap,
  highlightWhitespace,
  drawSelection,
} from '@codemirror/view';
import { sourceLanguage } from './source-language.js';
import { MergeView, unifiedMergeView, Change } from '@codemirror/merge';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { defaultKeymap } from '@codemirror/commands';
import { SourceMinimap } from './SourceMinimap.js';
import { sourceHighlighting } from './source-theme.js';
import { diffDefaults, summarizeDiff, type DiffOptions, type DiffSummary } from './diff-model.js';
import { diffLimit, type ComputedDiff } from './diff-compute.js';

/** Private, read-only views. No merge controls or editing commands are installed. */
export function createMarkdownDiff(
  host: HTMLElement,
  earlier: string,
  current: string,
  report: (summary: DiffSummary) => void,
) {
  if ([earlier, current].some((s) => new TextEncoder().encode(s).length > diffLimit))
    throw new Error(
      'Visual comparison is limited to 8 MiB per source. Use the complete sources or patch below.',
    );
  let options = { ...diffDefaults },
    result: ComputedDiff | undefined,
    active = 0,
    disposed = false;
  let worker: Worker | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    sequence = 0;
  let merge: MergeView | undefined,
    views: EditorView[] = [],
    roots: Root[] = [],
    layout = '';
  const language = new Compartment();
  const unsubscribe = subscribeUiLocale(() => {
    if (layout === 'accessible') {
      const focused = host.contains(document.activeElement);
      build();
      if (focused) reveal(active);
    } else
      views.forEach((view, index) =>
        view.dispatch({
          effects: language.reconfigure([
            EditorState.phrases.of(currentUiCatalog()),
            EditorView.contentAttributes.of({
              'aria-label': t(
                views.length === 2 && index === 0
                  ? 'Earlier Markdown comparison'
                  : 'Current Markdown comparison',
              ),
            }),
          ]),
        }),
      );
  });
  const publish = () => {
    if (!result || disposed) return;
    const messages = [
      !result.precise
        ? 'Approximate comparison: the detailed diff reached its computation limit.'
        : '',
      result.whitespaceOnly
        ? 'Edge whitespace changes are hidden. The complete sources and patch retain them.'
        : '',
      result.lineEndings
        ? 'Only line endings differ (CRLF/CR/LF). CodeMirror normalizes display; the complete sources and patch retain the original bytes.'
        : '',
    ];
    report({
      ...summarizeDiff(result.regions, active),
      message: messages.filter(Boolean).join(' ') || undefined,
    });
  };
  const destroyViews = () => {
    roots.forEach((r) => r.unmount());
    roots = [];
    if (merge) merge.destroy();
    else views.forEach((v) => v.destroy());
    merge = undefined;
    views = [];

    host.replaceChildren();
  };
  const reveal = (index: number, focus = true) => {
    if (!result?.regions.length) return;
    active = (index + result.regions.length) % result.regions.length;
    const region = result.regions[active];
    if (options.mode === 'accessible') {
      const block = host.querySelector<HTMLElement>(`[data-change="${active}"]`);
      block?.scrollIntoView({ block: 'nearest' });
      if (focus) block?.focus();
    } else
      views.forEach((view, i) => {
        const line =
          views.length === 2 && i === 0
            ? region.originalStartLineNumber
            : region.modifiedStartLineNumber;
        const at = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines))).from;
        view.dispatch({
          selection: { anchor: at },
          effects: EditorView.scrollIntoView(at, { y: 'center' }),
        });
        if (focus && i === views.length - 1) view.focus();
      });
    publish();
  };
  const build = () => {
    if (!result || disposed) return;
    const positions = views.map((v) => ({
      scroll: v.scrollDOM.scrollTop,
      selection: v.state.selection.main.head,
    }));
    destroyViews();
    layout = options.mode === 'auto' ? (host.clientWidth < 680 ? 'inline' : 'split') : options.mode;
    host.dataset.layout = layout;
    host.dataset.ready = 'true';
    if (layout === 'accessible') {
      host.tabIndex = 0;
      const container = document.createElement('div');
      container.className = 'diff-accessible-blocks';
      container.setAttribute('role', 'list');
      container.setAttribute('aria-label', t('Markdown change blocks'));
      const a = earlier.split(/\r\n?|\n/),
        b = current.split(/\r\n?|\n/);
      result.regions.forEach((r, index) => {
        const block = document.createElement('section');
        block.dataset.change = String(index);
        block.tabIndex = 0;
        block.setAttribute('role', 'listitem');
        block.setAttribute('aria-label', t('Change {count}', { count: index + 1 }));
        const title = document.createElement('h3');
        title.textContent = t('Change {count} · earlier line {earlier} → current line {current}', {
          count: index + 1,
          earlier: r.originalStartLineNumber,
          current: r.modifiedStartLineNumber,
        });
        block.append(title);
        for (const [label, lines, start, end] of [
          ['Earlier', a, r.originalStartLineNumber, r.originalEndLineNumber],
          ['Current', b, r.modifiedStartLineNumber, r.modifiedEndLineNumber],
        ] as const) {
          const heading = document.createElement('h4');
          heading.textContent = t(label);
          const pre = document.createElement('pre');
          pre.textContent = end ? lines.slice(start - 1, end).join('\n') : t('(No lines)');
          pre.className = label === 'Earlier' ? 'diff-removed' : 'diff-added';
          block.append(heading, pre);
        }
        block.onfocus = () => {
          active = index;
          publish();
        };
        block.onkeydown = (event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            reveal(
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? result!.regions.length - 1
                  : index + (event.key === 'ArrowDown' ? 1 : -1),
            );
          }
        };
        container.append(block);
      });
      if (!result.regions.length)
        container.textContent = result.lineEndings
          ? t('Only line endings differ. Use the complete Markdown sources below.')
          : t('No visible Markdown changes.');
      host.append(container);
      publish();
      return;
    }
    host.removeAttribute('tabindex');
    const base = (label: string) => [
      language.of([
        EditorState.phrases.of(currentUiCatalog()),
        EditorView.contentAttributes.of({ 'aria-label': t(label) }),
      ]),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      sourceLanguage(),
      sourceHighlighting,
      lineNumbers(),
      drawSelection(),
      search({ top: true }),
      keymap.of([...searchKeymap, ...defaultKeymap]),
      EditorView.contentAttributes.of({ tabindex: '0' }),
      options.wrap ? EditorView.lineWrapping : [],
      options.showWhitespace ? highlightWhitespace() : [],
      EditorView.theme({
        '&': {
          height: '100%',
          background: 'transparent',
          color: 'var(--text)',
          fontSize: 'calc(12px * var(--font-scale))',
        },
        '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.8', overflow: 'auto' },
        '.cm-content': { padding: '12px 0 40px' },
        '.cm-gutters': { background: 'transparent', color: 'var(--faint)', border: 'none' },
        '&.cm-focused': { outline: 'none' },
      }),
    ];
    const diffConfig = {
      override: () => result!.changes.map((c) => new Change(c.fromA, c.toA, c.fromB, c.toB)),
    };
    const collapseUnchanged = options.collapse ? { margin: 3, minSize: 8 } : undefined;
    const stage = document.createElement('div');
    stage.className = 'diff-cm-stage';
    host.append(stage);
    if (layout === 'split') {
      merge = new MergeView({
        parent: stage,
        a: { doc: earlier, extensions: base('Earlier Markdown comparison') },
        b: { doc: current, extensions: base('Current Markdown comparison') },
        diffConfig,
        collapseUnchanged,
        highlightChanges: true,
        gutter: true,
      });
      views = [merge.a, merge.b];
    } else {
      views = [
        new EditorView({
          parent: stage,
          doc: current,
          extensions: [
            ...base('Current Markdown comparison'),
            unifiedMergeView({
              original: earlier,
              mergeControls: false,
              allowInlineDiffs: true,
              diffConfig,
              collapseUnchanged,
            }),
          ],
        }),
      ];
    }
    views.forEach((view, i) => {
      const previous = positions[Math.min(i, positions.length - 1)];
      if (previous) {
        view.dispatch({
          selection: { anchor: Math.min(previous.selection, view.state.doc.length) },
        });
        view.scrollDOM.scrollTop = previous.scroll;
      }
    });
    if (options.minimap) {
      const maps = document.createElement('div');
      maps.className = 'diff-minimaps';
      host.append(maps);
      views.forEach((view, i) => {
        const left = layout === 'split' && i === 0,
          label = left ? 'Earlier diff minimap' : 'Current diff minimap';
        const el = document.createElement('div');
        el.className = 'diff-minimap';
        maps.append(el);
        const id = `comparison-${++sequence}`;
        view.contentDOM.id = id;
        const root = createRoot(el);
        roots.push(root);
        root.render(
          createElement(SourceMinimap, {
            viewRef: { current: view },
            source: view.state.doc.toString(),
            analysis: {
              headings: [],
              diagnostics: [],
              words: 0,
              characters: 0,
              lines: view.state.doc.lines,
            },
            tick: sequence,
            controls: id,
            label,
            markers: result!.regions.map((r) => ({
              line: left ? r.originalStartLineNumber : r.modifiedStartLineNumber,
              end: left ? r.originalEndLineNumber : r.modifiedEndLineNumber,
              color: left ? '--danger' : '--success',
            })),
          }),
        );
      });
    }
    publish();
  };
  const fail = (message: string) => {
    worker?.terminate();
    worker = undefined;
    clearTimeout(timer);
    if (!disposed)
      report({ state: 'unavailable', regions: [], active: 0, added: 0, removed: 0, message });
  };
  const compute = () => {
    worker?.terminate();
    clearTimeout(timer);
    result = undefined;
    destroyViews();
    report({ state: 'loading', regions: [], active: 0, added: 0, removed: 0 });
    try {
      worker = new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        clearTimeout(timer);
        worker?.terminate();
        worker = undefined;
        if (disposed) return;
        if (data.error) fail(data.error);
        else {
          result = data.result;
          active = 0;
          try {
            build();
          } catch {
            fail('The comparison view could not initialize. Use the complete sources or retry.');
          }
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fail('The comparison worker could not load. Retry or read the complete sources.');
      };
      timer = setTimeout(
        () =>
          fail(
            'Comparison stopped after two seconds. The complete sources and exact patch are available below.',
          ),
        2000,
      );
      worker.postMessage({ earlier, current, ignoreWhitespace: options.ignoreWhitespace });
    } catch {
      fail(
        'This browser cannot start the comparison worker. Read the complete sources or download the exact patch.',
      );
    }
  };
  const resize = new ResizeObserver(() => {
    if (
      options.mode === 'auto' &&
      host.clientWidth > 0 &&
      layout &&
      layout !== (host.clientWidth < 680 ? 'inline' : 'split')
    )
      build();
  });
  resize.observe(host);
  compute();
  return {
    setOptions(next: DiffOptions) {
      const previous = options;
      options = { ...next };
      if (previous.ignoreWhitespace !== options.ignoreWhitespace) compute();
      else if (JSON.stringify(previous) !== JSON.stringify(options)) build();
    },
    goToChange(direction: 'next' | 'previous') {
      reveal(active + (direction === 'next' ? 1 : -1));
    },
    revealChange: reveal,
    find() {
      const view = views.at(-1);
      if (view) {
        openSearchPanel(view);
        view.dom.querySelector<HTMLInputElement>('.cm-search input')?.focus();
      }
    },
    dispose() {
      disposed = true;
      unsubscribe();
      worker?.terminate();
      clearTimeout(timer);
      resize.disconnect();
      destroyViews();
    },
  };
}
