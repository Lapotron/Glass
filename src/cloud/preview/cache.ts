export const countWork = () => {};
export const mapConcurrent = <T, R>(
  values: T[],
  _limit: number,
  work: (value: T, index: number) => Promise<R>,
) => Promise.all(values.map(work));
export class RenderCache<T> {
  disk = { prune: async () => {} };
  async sync() {}
  get(_key: string, work: () => Promise<T>) {
    return work();
  }
}
