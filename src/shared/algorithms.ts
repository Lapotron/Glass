/** First index whose value is greater than the target. */
export function upperBound(values: readonly number[], target: number) {
  let low = 0,
    high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Stable bounded heap; compare follows Array.sort's best-first convention. */
export function topK<T>(values: Iterable<T>, count: number, compare: (a: T, b: T) => number): T[] {
  if (count <= 0) return [];
  const heap: { value: T; order: number }[] = [];
  const rank = (a: (typeof heap)[number], b: (typeof heap)[number]) =>
    compare(a.value, b.value) || a.order - b.order;
  let order = 0;
  for (const value of values) {
    const item = { value, order: order++ };
    if (heap.length < count) {
      heap.push(item);
      let at = heap.length - 1;
      while (at > 0) {
        const parent = (at - 1) >>> 1;
        if (rank(heap[parent], heap[at]) >= 0) break;
        [heap[parent], heap[at]] = [heap[at], heap[parent]];
        at = parent;
      }
    } else if (rank(item, heap[0]) < 0) {
      heap[0] = item;
      let at = 0;
      for (;;) {
        const left = at * 2 + 1,
          right = left + 1;
        if (left >= heap.length) break;
        const child = right < heap.length && rank(heap[right], heap[left]) > 0 ? right : left;
        if (rank(heap[at], heap[child]) >= 0) break;
        [heap[at], heap[child]] = [heap[child], heap[at]];
        at = child;
      }
    }
  }
  return heap.sort(rank).map((item) => item.value);
}
