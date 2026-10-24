import type { Bootstrap } from './api.js';
let frame: HTMLIFrameElement | undefined, ready: Promise<void> | undefined;
let model: Bootstrap | undefined;
let assets: unknown;
let counter = 0;
const pending = new Map<
  number,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export function setCloudPreviewModel(value: Bootstrap) {
  model = value;
}
async function prepare() {
  if (!ready) {
    ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(new Error('The private preview compiler did not start. Reload Studio to retry.')),
        60000,
      );
      window.addEventListener('message', (event) => {
        if (event.source !== frame?.contentWindow || event.origin !== location.origin) return;
        if (event.data?.type === 'glass-cloud-render-ready') {
          clearTimeout(timeout);
          resolve();
        }
        if (event.data?.type === 'glass-cloud-rendered') {
          const task = pending.get(event.data.id);
          if (!task) return;
          clearTimeout(task.timer);
          pending.delete(event.data.id);
          if (event.data.error) task.reject(new Error(event.data.error));
          else task.resolve(event.data.result);
        }
      });
      frame = document.createElement('iframe');
      frame.title = 'Private preview compiler';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText =
        'position:fixed;left:-10000px;top:0;width:1280px;height:900px;visibility:hidden;pointer-events:none';
      frame.sandbox.add('allow-scripts', 'allow-same-origin');
      frame.src = '/cloud-compiler/index.html';
      document.body.append(frame);
    });
  }
  await ready;
  assets ||= await (await fetch('/cloud-reader-assets.json')).json();
}
const previews = new Map<string, number>();
let previewBytes = 0;
function releasePreview(url: string) {
  const bytes = previews.get(url);
  if (bytes === undefined) return;
  previewBytes -= bytes;
  previews.delete(url);
  URL.revokeObjectURL(url);
}
export async function cloudPreview(route: string, input: unknown, signal?: AbortSignal) {
  await prepare();
  signal?.throwIfAborted();
  const id = ++counter;
  let abort = () => {};
  const result: any = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      frame!.contentWindow!.postMessage({ type: 'glass-cloud-cancel', id }, location.origin);
      reject(new Error('Preview timed out. Source remains unchanged.'));
    }, 30000);
    abort = () => {
      clearTimeout(timer);
      pending.delete(id);
      frame!.contentWindow!.postMessage({ type: 'glass-cloud-cancel', id }, location.origin);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    pending.set(id, { resolve, reject, timer });
    frame!.contentWindow!.postMessage(
      {
        type: 'glass-cloud-render',
        id,
        route,
        input,
        model:
          route === 'preview'
            ? structuredClone(model)
            : route === 'authoring/component-preview'
              ? { site: { theme: model?.site.theme } }
              : undefined,
        assets,
      },
      location.origin,
    );
  }).finally(() => signal?.removeEventListener('abort', abort));
  if (route === 'preview') {
    const html = result.html.replace('<head>', '<head><base href="' + location.origin + '/">');
    const blob = new Blob([html], { type: 'text/html' });
    if (blob.size > 16 * 1024 ** 2)
      throw new Error(
        'This preview exceeds the 16 MiB preview limit. Source remains saved; split the preview into smaller sections.',
      );
    const url = URL.createObjectURL(blob);
    previews.set(url, blob.size);
    previewBytes += blob.size;
    while (previews.size > 4 || previewBytes > 16 * 1024 ** 2)
      releasePreview(previews.keys().next().value!);
    return { url };
  }
  return result;
}
