import { t } from '../shared/i18n.js';
import type { FormatResult } from './source-format.js';
export function sourceFormatter() {
  let worker: Worker | undefined,
    id = 0;
  const pending = new Map<
    number,
    {
      resolve: (r: FormatResult) => void;
      reject: (e: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const dispose = (message = 'Formatting was cancelled.') => {
    worker?.terminate();
    worker = undefined;
    for (const p of pending.values()) {
      clearTimeout(p.timeout);
      p.reject(new Error(message));
    }
    pending.clear();
  };
  return {
    format(source: string, selection?: { from: number; to: number }): Promise<FormatResult> {
      if (!worker) {
        try {
          worker = new Worker(new URL('./source-format.worker.ts', import.meta.url), {
            type: 'module',
          });
          worker.onmessage = ({ data }) => {
            const p = pending.get(data.id);
            if (!p || data.version !== 1) return;
            clearTimeout(p.timeout);
            pending.delete(data.id);
            if (data.error) p.reject(new Error(data.error));
            else p.resolve(data.result);
          };
          worker.onerror = (e) => {
            e.preventDefault();
            dispose('The formatter worker could not load. Your Markdown is unchanged.');
          };
          worker.onmessageerror = () => dispose('The formatter response could not be read.');
        } catch {
          return Promise.reject(
            new Error(t("The formatter worker is unavailable. Your Markdown is unchanged.")),
          );
        }
      }
      return new Promise((resolve, reject) => {
        const request = ++id;
        pending.set(request, {
          resolve,
          reject,
          timeout: setTimeout(
            () => dispose('Formatting timed out. Your Markdown is unchanged.'),
            10000,
          ),
        });
        worker!.postMessage({ version: 1, id: request, source, selection });
      });
    },
    dispose,
  };
}
