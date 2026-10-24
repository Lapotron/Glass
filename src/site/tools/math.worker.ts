import type { MathRequest } from './math-runtime.js';
export type { MathRequest, MathResult } from './math-runtime.js';
// Keep the compiler in an ordinary dependency chunk. Safari can evaluate a module
// worker's entry twice when a lazy font chunk imports the entry back (WebKit 324459).
let handle: ((request: MathRequest) => void) | undefined;
const pending: MathRequest[] = [];
self.addEventListener('message', (event: MessageEvent<MathRequest>) => {
  if (!event.data || !Number.isSafeInteger(event.data.id)) return;
  if (handle) handle(event.data);
  else if (pending.length < 32) pending.push(event.data);
});
void import('./math-runtime.js')
  .then((runtime) => {
    handle = runtime.handleMathRequest;
    pending.splice(0).forEach(handle);
  })
  .catch(() => {
    handle = (request) =>
      self.postMessage({
        id: request.id,
        error: 'The tool could not load. Reload this page and retry.',
      });
    pending.splice(0).forEach(handle);
  });
