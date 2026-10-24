/** One outstanding task per worker; cancel terminates work rather than merely hiding its result. */
type RequestData<T> = T extends { id: number } ? Omit<T, 'id'> : never;
export class ToolWorker<Request extends { id: number }, Result> {
  private worker?: Worker;
  private sequence = 0;
  private pending?: {
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    id: number;
  };
  constructor(private create: () => Worker) {}
  run(
    request: RequestData<Request>,
    timeout = 5000,
    transfer: Transferable[] = [],
  ): Promise<Result> {
    this.cancel();
    const id = ++this.sequence;
    const worker = (this.worker ||= this.create());
    return new Promise((resolve, reject) => {
      this.pending = {
        reject,
        id,
        timer: setTimeout(
          () => this.cancel('The operation took too long. Reduce the input and retry.'),
          timeout,
        ),
      };
      worker.onmessage = (event: MessageEvent<{ id: number; result?: Result; error?: string }>) => {
        if (event.data?.id !== this.pending?.id) return;
        clearTimeout(this.pending.timer);
        this.pending = undefined;
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result!);
      };
      worker.onerror = () => this.cancel('The tool could not load. Reload this page and retry.');
      worker.postMessage({ ...request, id }, transfer);
    });
  }
  cancel(message = 'Operation cancelled.') {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(new Error(message));
    this.pending = undefined;
    this.worker?.terminate();
    this.worker = undefined;
  }
  destroy() {
    this.cancel();
    this.worker?.terminate();
    this.worker = undefined;
  }
}
