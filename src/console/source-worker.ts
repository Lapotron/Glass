import type { InspectionContext } from './source-inspection.js';
import { analyzeSource, type SourceAnalysis } from './source-analysis.js';

/** One active job and one replaceable successor, including the main-thread fallback. */
export function sourceAnalyzer() {
  type Task = {
    id: number;
    source: string;
    context?: InspectionContext;
    key: string;
    resolve: (value: SourceAnalysis) => void;
    reject: (error: Error) => void;
  };
  let worker: Worker | undefined,
    sequence = 0,
    disposed = false;
  let active: Task | undefined, queued: Task | undefined;
  let sentContext: string | undefined,
    contextRevision = 0;
  let cached: { source: string; key: string; promise: Promise<SourceAnalysis> } | undefined;
  const superseded = (): SourceAnalysis => ({
    headings: [],
    diagnostics: [],
    words: 0,
    characters: 0,
    lines: 1,
    superseded: true,
  });
  const finish = (task: Task, result?: SourceAnalysis, error?: Error) => {
    if (active !== task) return;
    active = undefined;
    if (disposed || queued) task.resolve(superseded());
    else if (error) task.reject(error);
    else task.resolve(result!);
    if (queued && !disposed) {
      const next = queued;
      queued = undefined;
      run(next);
    }
  };
  const run = (task: Task) => {
    active = task;
    if (worker) {
      try {
        if (sentContext !== task.key) {
          worker.postMessage({
            type: 'context',
            revision: ++contextRevision,
            context: task.context,
          });
          sentContext = task.key;
        }
        worker.postMessage({ type: 'analyze', id: task.id, source: task.source, contextRevision });
        return;
      } catch {
        fallback();
        return;
      }
    }
    void Promise.resolve().then(() => {
      if (disposed || active !== task) return;
      if (queued) {
        finish(task, superseded());
        return;
      }
      try {
        finish(task, analyzeSource(task.source, task.context));
      } catch (error) {
        finish(task, undefined, error as Error);
      }
    });
  };
  const fallback = () => {
    worker?.terminate();
    worker = undefined;
    sentContext = undefined;
    const latest = queued || active;
    if (queued && active) active.resolve(superseded());
    active = undefined;
    queued = undefined;
    if (latest && !disposed) run(latest);
  };
  try {
    worker = new Worker(new URL('./source-analysis.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({ data }) => {
      if (!active || data.id !== active.id) return;
      finish(active, data.result, data.error ? new Error(data.error) : undefined);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fallback();
    };
    worker.onmessageerror = fallback;
  } catch {
    worker = undefined;
  }
  return {
    analyze(source: string, context?: InspectionContext): Promise<SourceAnalysis> {
      if (disposed) return Promise.resolve(superseded());
      const key = JSON.stringify(context) || '';
      if (cached?.source === source && cached.key === key) return cached.promise;
      const promise = new Promise<SourceAnalysis>((resolve, reject) => {
        const task = { id: ++sequence, source, context, key, resolve, reject };
        if (active) {
          queued?.resolve(superseded());
          queued = task;
        } else run(task);
      });
      cached = { source, key, promise };
      void promise.catch(() => {
        if (cached?.promise === promise) cached = undefined;
      });
      return promise;
    },
    dispose() {
      disposed = true;
      cached = undefined;
      worker?.terminate();
      active?.resolve(superseded());
      queued?.resolve(superseded());
      active = undefined;
      queued = undefined;
    },
  };
}
