export const countWork = () => {};
export const mapConcurrent = <T, R>(
  values: T[],
  limit: number,
  work: (value: T, index: number) => Promise<R>,
) => {
  let index = 0;
  const output = new Array<R>(values.length);
  return Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
      for (;;) {
        const current = index++;
        if (current >= values.length) return;
        output[current] = await work(values[current], current);
      }
    }),
  ).then(() => output);
};
const cache = new Map<string, { text: string; bytes: number }>();
let usedBytes = 0,
  ownerId = 0;
export class RenderCache<T> {
  private owner = String(++ownerId) + ':';
  private pending = new Map<string, Promise<T>>();
  disk = {
    prune: async () => {
      for (const [key, value] of cache)
        if (key.startsWith(this.owner)) {
          usedBytes -= value.bytes;
          cache.delete(key);
        }
    },
  };
  async sync() {}
  constructor(..._args: unknown[]) {}
  async get(key: string, work: () => Promise<T>): Promise<T> {
    key = this.owner + key;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return JSON.parse(cached.text);
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = work()
      .then((value) => {
        const text = JSON.stringify(value),
          bytes = Math.max(new TextEncoder().encode(text).length, text.length * 2);
        if (bytes <= 32 * 1024 ** 2) {
          cache.set(key, { text, bytes });
          usedBytes += bytes;
          while (usedBytes > 32 * 1024 ** 2) {
            const first = cache.entries().next().value!;
            cache.delete(first[0]);
            usedBytes -= first[1].bytes;
          }
        }
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}
