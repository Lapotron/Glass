import { CloudError } from './types.js';
/** Keep JSON-bound SQL below D1's per-value ceiling, without a query for every file. */
export function* jsonChunks(values: unknown[], limit = 1024 ** 2) {
  let chunk: unknown[] = [],
    bytes = 2;
  for (const value of values) {
    const size = new TextEncoder().encode(JSON.stringify(value)).length + 1;
    if (size > limit)
      throw new CloudError('A metadata record exceeds the safe D1 request size.', 413);
    if (bytes + size > limit && chunk.length) {
      yield JSON.stringify(chunk);
      chunk = [];
      bytes = 2;
    }
    chunk.push(value);
    bytes += size;
  }
  if (chunk.length) yield JSON.stringify(chunk);
}
