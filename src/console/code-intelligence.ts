import { snippet, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { linter, forceLinting, type Diagnostic } from '@codemirror/lint';
import { EditorView, hoverTooltip, ViewPlugin, showTooltip } from '@codemirror/view';
import { StateEffect, StateField, Transaction, type Text } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import {
  virtualCodeFiles,
  type SourceCodeBlock,
  type VirtualCodeFile,
} from '../shared/code-projects.js';
import type { MarkdownDiagnostic } from '../shared/markdown-analysis.js';

type Span = { start: number; length: number };
type Location = { file: string; span: Span; name?: string; library?: boolean };
export type CodeDialog = {
  title: string;
  message?: string;
  locations?: { label: string; detail: string; go: () => void }[];
  rename?: (name: string) => void;
  name?: string;
  fixes?: { label: string; apply: () => void }[];
};
type Hint = { pos: number; signature: string; documentation?: string; argument?: number };
const hintEffect = StateEffect.define<Hint | null>();
const codeRefresh = StateEffect.define<number>();
function hintDOM(info: { signature: string; documentation?: string; argument?: number }) {
  const dom = document.createElement('div');
  dom.className = 'code-intelligence-info';
  const code = document.createElement('code');
  code.textContent = info.signature;
  dom.append(code);
  if (info.argument !== undefined) {
    const position = document.createElement('small');
    position.textContent = `Parameter ${info.argument + 1}`;
    dom.append(position);
  }
  if (info.documentation) {
    const doc = document.createElement('p');
    doc.textContent = info.documentation;
    dom.append(doc);
  }
  return { dom };
}
const hints = StateField.define<Hint | null>({
  create: () => null,
  update(value, transaction) {
    if (transaction.docChanged || transaction.selection) value = null;
    for (const effect of transaction.effects) if (effect.is(hintEffect)) value = effect.value;
    return value;
  },
  provide: (field) =>
    showTooltip.from(field, (value) =>
      value ? { pos: value.pos, above: true, create: () => hintDOM(value) } : null,
    ),
});
export function createCodeIntelligence(
  open: (value: CodeDialog) => void,
  onDiagnostics: (value: MarkdownDiagnostic[]) => void = () => {},
) {
  let worker: Worker | undefined,
    failed = false,
    disposed = false,
    revision = 0,
    sequence = 0;
  let blocks: SourceCodeBlock[] = [],
    files: VirtualCodeFile[] = [],
    key = '',
    document: Text | undefined;
  const pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let diagnostics: { from: number; to: number; code: number }[] = [];
  type CodeIssue = {
    from: number;
    to: number;
    message: string;
    severity: 'warning' | 'error';
    code: number;
  };
  const checked = new Map<string, CodeIssue[]>();
  let checkAll = false;
  const settleError = (message: string) => {
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(new Error(message));
    }
    pending.clear();
  };
  function ensure() {
    if (failed || disposed)
      throw new Error('Language intelligence is unavailable. Syntax highlighting remains active.');
    if (worker) return worker;
    worker = new Worker(new URL('./code-intelligence.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task) return;
      clearTimeout(task.timer);
      pending.delete(data.id);
      if (data.revision !== revision)
        task.reject(new Error('The source changed. Run the command again.'));
      else if (data.error) task.reject(new Error(data.error));
      else task.resolve(data.result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker?.terminate();
      worker = undefined;
      failed = true;
      settleError('The language worker stopped. Use Retry language intelligence to reconnect.');
    };
    worker.postMessage({ type: 'sync', files, revision });
    return worker;
  }
  function request(action: string, file: string, pos: number, args?: unknown): Promise<any> {
    try {
      const runtime = ensure(),
        id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Language analysis timed out. Retry the command.'));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        runtime.postMessage({ id, revision, action, file, pos, args });
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  const locate = (view: EditorView, pos = view.state.selection.main.head) => {
    if (view.state.doc !== document) return undefined;
    const index = blocks.findIndex((block) => pos >= block.bodyFrom && pos <= block.bodyTo);
    if (
      index >= 0 &&
      files.some((file, other) => other !== index && file.name === files[index].name)
    )
      return undefined;
    return index < 0
      ? undefined
      : { block: blocks[index], file: files[index].name, pos: pos - blocks[index].bodyFrom };
  };
  const mapped = (location: Location) => {
    const index = files.findIndex((file) => file.name === location.file);
    if (index < 0) return null;
    const block = blocks[index],
      from = block.bodyFrom + location.span.start,
      to = block.bodyFrom + location.span.start + location.span.length;
    return from >= block.bodyFrom && to <= block.bodyTo ? { from, to, block } : null;
  };
  const apply = (
    view: EditorView,
    captured: Text,
    changes: { from: number; to: number; insert: string }[],
  ) => {
    if (view.state.doc !== captured)
      throw new Error('New edits arrived. Run the command again; your source was kept.');
    const sorted = changes.sort((a, b) => a.from - b.from);
    if (sorted.some((edit, index) => index > 0 && edit.from < sorted[index - 1].to))
      throw new Error('These source edits overlap.');
    view.dispatch({
      changes: sorted,
      effects: view.scrollSnapshot(),
      annotations: [Transaction.userEvent.of('input.code-action'), isolateHistory.of('full')],
    });
    view.focus();
  };
  function retry(view: EditorView) {
    worker?.terminate();
    worker = undefined;
    failed = false;
    settleError('Language assistance is restarting.');
    checked.clear();
    onDiagnostics([]);
    view.dispatch({ effects: codeRefresh.of(revision) });
    forceLinting(view);
  }
  async function command(
    action: 'definitions' | 'references' | 'rename' | 'fixes',
    view: EditorView,
  ) {
    const current = locate(view);
    if (!current) return false;
    const captured = view.state.doc;
    try {
      if (action === 'fixes') {
        const issues = diagnostics.filter(
          (d) => d.from <= view.state.selection.main.head && d.to >= view.state.selection.main.head,
        );
        if (!issues.length) {
          open({
            title: 'Code actions',
            message: 'Place the cursor on a code diagnostic to see available fixes.',
          });
          return true;
        }
        const fixes = await request('fixes', current.file, current.pos, {
          from: Math.min(...issues.map((i) => i.from)) - current.block.bodyFrom,
          to: Math.max(...issues.map((i) => i.to)) - current.block.bodyFrom,
          codes: issues.map((i) => i.code),
        });
        if (view.state.doc !== captured) return true;
        open({
          title: 'Code actions',
          message: fixes.length ? undefined : 'No automatic fix is available for this diagnostic.',
          fixes: fixes.map((fix: any) => ({
            label: fix.description,
            apply: () =>
              apply(
                view,
                captured,
                fix.changes.flatMap((change: any) =>
                  change.edits.map((edit: any) => {
                    const range = mapped({ file: change.file, span: edit.span });
                    if (!range) throw new Error('This fix edits a file outside the article.');
                    return { from: range.from, to: range.to, insert: edit.newText };
                  }),
                ),
              ),
          })),
        });
        return true;
      }
      const result: Location[] = await request(action, current.file, current.pos);
      if (view.state.doc !== captured) return true;
      const locations = result
        .map((location) => ({ location, range: mapped(location) }))
        .filter(
          (item): item is { location: Location; range: NonNullable<ReturnType<typeof mapped>> } =>
            !!item.range,
        );
      if (action === 'rename') {
        const word = view.state.wordAt(view.state.selection.main.head);
        open({
          title: 'Rename symbol',
          name: word ? view.state.sliceDoc(word.from, word.to) : '',
          rename: (name) => {
            if (!/^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u.test(name))
              throw new Error('Enter a valid JavaScript identifier.');
            apply(
              view,
              captured,
              locations.map(({ location, range }) => ({
                ...range,
                insert: ((location as any).prefix || '') + name + ((location as any).suffix || ''),
              })),
            );
          },
        });
        return true;
      }
      const go = (range: { from: number; to: number }) => {
        if (view.state.doc !== captured) throw new Error('The source changed. Search again.');
        view.dispatch({
          selection: { anchor: range.from, head: range.to },
          effects: EditorView.scrollIntoView(range.from, { y: 'center' }),
        });
        view.focus();
      };
      if (action === 'definitions' && locations.length === 1) {
        go(locations[0].range);
        return true;
      }
      open({
        title: action === 'definitions' ? 'Definitions' : 'References',
        message: locations.length
          ? undefined
          : result.some((location) => location.library)
            ? 'This symbol is defined in the browser or standard TypeScript library. Hover it to read its signature.'
            : 'No matching locations in this article.',
        locations: locations.map(({ range }) => ({
          label: `${range.block.filename}:${view.state.doc.lineAt(range.from).number}`,
          detail: view.state.doc.lineAt(range.from).text.trim(),
          go: () => go(range),
        })),
      });
    } catch (error) {
      open({ title: 'Language intelligence', message: (error as Error).message });
    }
    return true;
  }
  return {
    update(view: EditorView, next: SourceCodeBlock[]) {
      blocks = next;
      document = view.state.doc;
      const nextFiles = virtualCodeFiles(blocks),
        nextKey = JSON.stringify(nextFiles);
      if (nextKey === key) {
        if (blocks.length) view.dispatch({ effects: codeRefresh.of(revision) });
        return;
      }
      key = nextKey;
      files = nextFiles;
      revision++;
      diagnostics = [];
      checked.clear();
      onDiagnostics([]);
      settleError('The code changed. Retry the command.');
      worker?.postMessage({ type: 'sync', revision, files });
      if (blocks.length) view.dispatch({ effects: codeRefresh.of(revision) });
    },
    completion: async (context: CompletionContext): Promise<CompletionResult | null> => {
      if (context.state.doc !== document) return null;
      const index = blocks.findIndex(
        (block) => context.pos >= block.bodyFrom && context.pos <= block.bodyTo,
      );
      if (
        index < 0 ||
        files.some((file, other) => other !== index && file.name === files[index].name)
      )
        return null;
      const word = context.matchBefore(/[\w$]*$/);
      if (
        !word ||
        (!word.text &&
          !context.explicit &&
          context.state.doc.sliceString(context.pos - 1, context.pos) !== '.')
      )
        return null;
      const file = files[index].name,
        pos = context.pos - blocks[index].bodyFrom,
        captured = revision;
      try {
        const entries = await request('complete', file, pos);
        if (context.aborted || revision !== captured) return null;
        return {
          from: word.from,
          options: entries.map((entry: any) => ({
            label: entry.label,
            apply: entry.insert?.includes('${')
              ? snippet(entry.insert)
              : entry.insert || entry.label,
            type:
              entry.kind === 'method' || entry.kind === 'function'
                ? 'function'
                : entry.kind === 'class' || entry.kind === 'interface'
                  ? 'class'
                  : entry.kind === 'keyword'
                    ? 'keyword'
                    : 'variable',
            info: async () => {
              const info = await request('details', file, pos, { name: entry.label });
              return info ? hintDOM(info).dom : '';
            },
          })),
          validFor: /^[\w$]*$/,
        };
      } catch {
        return null;
      }
    },
    extension: [
      hints,
      hoverTooltip(
        async (view, pos) => {
          const current = locate(view, pos);
          if (!current) return null;
          const captured = view.state.doc;
          try {
            const info = await request('hover', current.file, current.pos);
            if (!info || view.state.doc !== captured) return null;
            return {
              pos: current.block.bodyFrom + info.span.start,
              end: current.block.bodyFrom + info.span.start + info.span.length,
              above: true,
              create: () => hintDOM(info),
            };
          } catch {
            return null;
          }
        },
        { hoverTime: 350 },
      ),
      ViewPlugin.define((view) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let lintTimer: ReturnType<typeof setTimeout> | undefined;
        const update = () => {
          clearTimeout(timer);
          const current = locate(view);
          if (!current) return;
          const before = view.state.doc.sliceString(
            Math.max(current.block.bodyFrom, view.state.selection.main.head - 300),
            view.state.selection.main.head,
          );
          if (!/[,(][^;{}]*$/.test(before)) return;
          timer = setTimeout(() => {
            const captured = view.state.doc,
              pos = view.state.selection.main.head;
            void request('signature', current.file, current.pos)
              .then((info) => {
                if (info && view.state.doc === captured && view.state.selection.main.head === pos)
                  view.dispatch({ effects: hintEffect.of({ pos, ...info }) });
              })
              .catch(() => {});
          }, 180);
        };
        return {
          update(change) {
            if (change.docChanged || change.selectionSet) update();
            if (change.viewportChanged) {
              clearTimeout(lintTimer);
              lintTimer = setTimeout(() => forceLinting(view), 200);
            }
          },
          destroy() {
            clearTimeout(timer);
            clearTimeout(lintTimer);
          },
        };
      }),
      linter(
        async (view) => {
          if (view.state.doc !== document) return [];
          const captured = document;
          const output: Diagnostic[] = [];
          diagnostics = [];
          const entire = checkAll;
          checkAll = false;
          const names = new Set<string>();
          for (let index = 0; index < blocks.length; index++) {
            const block = blocks[index],
              file = files[index];
            if (names.has(file.name)) {
              output.push({
                from: block.from,
                to: block.bodyFrom,
                severity: 'error',
                message: 'Duplicate filename in this code project. Choose a unique title.',
                source: 'TypeScript',
              });
              continue;
            }
            names.add(file.name);
            if (!block.check) continue;
            if (
              entire ||
              (block.bodyTo >= view.viewport.from - 2500 &&
                block.bodyFrom <= view.viewport.to + 2500)
            ) {
              try {
                const result = await request('diagnostics', file.name, 0);
                if (view.state.doc !== captured) return [];
                checked.set(file.name, result.slice(0, 100));
              } catch (error) {
                if (failed)
                  output.push({
                    from: block.from,
                    to: block.bodyFrom,
                    severity: 'warning',
                    message: (error as Error).message,
                    source: 'Language service',
                    actions: [{ name: 'Retry language intelligence', apply: () => retry(view) }],
                  });
                break;
              }
            }
            for (const issue of checked.get(file.name) || []) {
              const from = Math.min(block.bodyTo, block.bodyFrom + issue.from),
                to = Math.min(block.bodyTo, block.bodyFrom + issue.to);
              diagnostics.push({ from, to, code: issue.code });
              output.push({
                from,
                to,
                severity: issue.severity,
                message: issue.message,
                source: `TS${issue.code}`,
                actions: [
                  {
                    name: 'Code actions',
                    apply: () => {
                      view.dispatch({ selection: { anchor: from } });
                      void command('fixes', view);
                    },
                  },
                ],
              });
            }
          }
          onDiagnostics(
            output.map((issue) => ({
              from: issue.from,
              to: issue.to,
              message: issue.message,
              severity: issue.severity === 'warning' ? 'warning' : 'error',
              code: issue.source || 'typescript',
              line: view.state.doc.lineAt(issue.from).number,
              column: issue.from - view.state.doc.lineAt(issue.from).from + 1,
              category: 'syntax',
            })),
          );
          return output;
        },
        {
          delay: 600,
          needsRefresh: (update) =>
            update.transactions.some((transaction) =>
              transaction.effects.some((effect) => effect.is(codeRefresh)),
            ),
        },
      ),
    ],
    command,
    retry,
    checkAll(view: EditorView) {
      checkAll = true;
      forceLinting(view);
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      settleError('Editor closed.');
      projectsCleanup();
    },
  };
  function projectsCleanup() {
    blocks = [];
    files = [];
    document = undefined;
  }
}
