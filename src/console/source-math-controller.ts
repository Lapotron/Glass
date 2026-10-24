import { ViewPlugin, type EditorView } from '@codemirror/view';
import type { SourceMath } from './source-analysis.js';
import { mathPreviewUpdate } from './source-math.js';
import type { MathSettings } from '../shared/math-authoring.js';
import type { MathPreviewResult } from '../shared/math-preview.js';
import { api } from './api.js';
import { mathAt } from './source-language.js';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

type Equation = SourceMath & { identity: number };
/** A view-owned, visible-first queue. Prose edits do not invalidate unchanged TeX. */
export function createSourceMathController(initialSettings?: MathSettings) {
  let view: EditorView | undefined,
    source = '',
    equations: Equation[] = [],
    sequence = 0,
    disposed = false;
  let display = true,
    inline = true,
    math: MathSettings | undefined = initialSettings,
    settingsKey = JSON.stringify(initialSettings || {});
  let active: AbortController | undefined,
    pending = false;
  let activeTargets = new Set<number>();
  let visiblePending = false;
  const cache = new Map<number, MathPreviewResult>();
  let cacheBytes = 0;
  const setResult = (id: number, result: MathPreviewResult) => {
    cacheBytes -= (cache.get(id)?.html?.length || 0) * 2;
    cache.delete(id);
    cache.set(id, result);
    cacheBytes += (result.html?.length || 0) * 2;
    while (cache.size > 512 || cacheBytes > 8 * 1024 * 1024) {
      const first = cache.keys().next().value!;
      cacheBytes -= (cache.get(first)?.html?.length || 0) * 2;
      cache.delete(first);
    }
  };
  const apply = () => {
    if (!view || disposed) return;
    view.dispatch({
      effects: mathPreviewUpdate.of(
        equations.map((eq) => ({
          ...eq,
          result: cache.get(eq.identity),
          visible: eq.display ? display : inline,
        })),
      ),
    });
  };
  const schedule = () => {
    if (pending || disposed) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      void run();
    });
  };
  async function run() {
    if (active || !view || disposed) return;
    const from = Math.max(0, view.viewport.from - 2500),
      to = Math.min(view.state.doc.length, view.viewport.to + 2500);
    const targets = equations
      .filter(
        (eq) =>
          (eq.display ? display : inline) &&
          eq.to >= from &&
          eq.from <= to &&
          !cache.has(eq.identity),
      )
      .slice(0, 16);
    if (!targets.length) return;
    const controller = new AbortController();
    active = controller;
    activeTargets = new Set(targets.map((eq) => eq.identity));
    try {
      const { results } = await api<{ results: MathPreviewResult[] }>('authoring/math-preview', {
        method: 'POST',
        body: JSON.stringify({
          source,
          ranges: targets.map(({ from, to }) => ({ from, to })),
          math,
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (!Array.isArray(results) || results.length !== targets.length)
        throw new Error('Incomplete math preview response.');
      if (!disposed) {
        results.forEach((result, index) => {
          if (typeof result?.html !== 'string' && typeof result?.error !== 'string')
            throw new Error('Invalid math preview response.');
          setResult(targets[index].identity, result);
        });
        apply();
      }
    } catch (error) {
      if (!disposed && !controller.signal.aborted) {
        targets.forEach((eq) =>
          setResult(eq.identity, {
            error: `Math preview unavailable. ${(error as Error).message}`,
          }),
        );
        apply();
      }
    } finally {
      if (active === controller) {
        active = undefined;
        activeTargets.clear();
      }
      schedule();
    }
  }
  function install(
    nextView: EditorView,
    nextSource: string,
    maths: SourceMath[],
    preferences: { mathPreviews: boolean; inlineMathPreviews: boolean },
    settings?: MathSettings,
  ) {
    if (disposed) return;
    const nextKey = JSON.stringify(settings || {});
    let samePrefix = nextKey === settingsKey;
    if (!samePrefix) active?.abort();
    equations = maths.map((item, index) => {
      const old = equations[index];
      samePrefix = !!(
        samePrefix &&
        old &&
        old.source === item.source &&
        old.display === item.display
      );
      return { ...item, identity: samePrefix ? old.identity : ++sequence };
    });
    const current = new Set(equations.map((eq) => eq.identity));
    if ([...activeTargets].some((identity) => !current.has(identity))) active?.abort();
    view = nextView;
    source = nextSource;
    math = settings;
    settingsKey = nextKey;
    display = preferences.mathPreviews;
    inline = preferences.inlineMathPreviews;
    apply();
    schedule();
  }
  function equationAt(
    state: EditorState,
    region: { from: number; to: number; display: boolean },
  ): SourceMath | undefined {
    const raw = state.doc.sliceString(region.from, region.to);
    const complete = region.display
      ? /^\$\$\s*\n[\s\S]*\n\s*\$\$$/.test(raw)
      : /^\$(?!\$)[\s\S]+\$$/.test(raw);
    if (!complete) return undefined;
    return {
      ...region,
      source: region.display
        ? raw
            .slice(2, -2)
            .replace(/^\r?\n/, '')
            .replace(/\r?\n\s*$/, '')
        : raw.slice(1, -1),
    };
  }
  function discoverVisible() {
    if (visiblePending || disposed) return;
    visiblePending = true;
    queueMicrotask(() => {
      visiblePending = false;
      if (!view || disposed) return;
      const tree = syntaxTree(view.state),
        found = new Map<number, SourceMath>();
      tree.iterate({
        from: Math.max(0, view.viewport.from - 2500),
        to: view.viewport.to + 2500,
        enter(node) {
          if (node.name === 'InlineMath' || node.name === 'DisplayMath') {
            const item = equationAt(view!.state, {
              from: node.from,
              to: node.to,
              display: node.name === 'DisplayMath',
            });
            if (item) found.set(item.from, item);
            return false;
          }
        },
      });
      let changed = false;
      // Remark also recognizes math nested in directives which Lezer treats as prose.
      // Only source transactions or authoritative analysis may remove those ranges.
      const merged: SourceMath[] = [...equations];
      for (const item of found.values()) {
        const index = merged.findIndex((eq) => eq.from === item.from);
        if (index < 0) {
          merged.push(item);
          changed = true;
        } else if (merged[index].to !== item.to || merged[index].source !== item.source) {
          merged[index] = item;
          changed = true;
        }
      }
      if (changed)
        install(
          view,
          view.state.doc.toString(),
          merged.sort((a, b) => a.from - b.from),
          { mathPreviews: display, inlineMathPreviews: inline },
          math,
        );
      else schedule();
    });
  }
  return {
    extension: ViewPlugin.define((v) => {
      view = v;
      const retry = () => {
        for (const [key, result] of cache) if (result.error) cache.delete(key);
        apply();
        schedule();
      };
      v.dom.addEventListener('studio-retry-math', retry);
      discoverVisible();
      return {
        update(update) {
          if (update.docChanged) {
            let contextChanged = false;
            update.changes.iterChangedRanges((from, to, fromNew, toNew) => {
              if (
                mathAt(update.startState, from) ||
                /[`~$\\]/.test(
                  update.startState.doc.sliceString(from, to) +
                    update.state.doc.sliceString(fromNew, toNew),
                )
              )
                contextChanged = true;
            });
            if (contextChanged) settingsKey = 'changed-context';
            const current = mathAt(update.state, update.state.selection.main.head);
            if (equations.length || current) {
              const mapped: SourceMath[] = equations
                .filter((eq) => !update.changes.touchesRange(eq.from, eq.to))
                .map((eq) => ({
                  ...eq,
                  from: update.changes.mapPos(eq.from),
                  to: update.changes.mapPos(eq.to),
                }));
              if (current) {
                const fresh = equationAt(update.state, current);
                if (fresh) mapped.push(fresh);
              }
              mapped.sort((a, b) => a.from - b.from);
              const unique = mapped.filter(
                (eq, index) => !index || eq.from !== mapped[index - 1].from,
              );
              const captured = update.state.doc;
              queueMicrotask(() => {
                if (!disposed && v.state.doc === captured)
                  install(
                    v,
                    captured.toString(),
                    unique,
                    { mathPreviews: display, inlineMathPreviews: inline },
                    math,
                  );
              });
            }
          }
          if (
            update.viewportChanged ||
            update.docChanged ||
            syntaxTree(update.state) !== syntaxTree(update.startState)
          )
            discoverVisible();
        },
        destroy() {
          v.dom.removeEventListener('studio-retry-math', retry);
        },
      };
    }),
    update: install,
    dispose() {
      disposed = true;
      active?.abort();
      cache.clear();
      view = undefined;
    },
  };
}
