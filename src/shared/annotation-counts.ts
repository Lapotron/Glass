import type { Annotation } from './annotations.js';

type Counts = Pick<Annotation, 'comments' | 'replies'>;
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

/** Public, read-only metadata; never return provider identities or comment bodies. */
export function annotationCounts(providerFetch: typeof fetch) {
  const cache = new Map<string, { until: number; result: Promise<Counts> }>();
  return async (items: Annotation[], repo: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let next = 0;
    const enriched = [...items];
    const read = async (item: Annotation): Promise<Counts> => {
      const number = new URL(item.url).pathname.match(/\/(\d+)$/)?.[1];
      if (!number) return {};
      const key = `${repo}/${number}`;
      let saved = cache.get(key);
      if (!saved || saved.until < Date.now()) {
        if (cache.size >= 256) cache.delete(cache.keys().next().value!);
        const result = (async (): Promise<Counts> => {
          const url = new URL('https://giscus.app/api/discussions');
          url.searchParams.set('repo', repo);
          url.searchParams.set('number', number);
          url.searchParams.set('first', '100');
          const response = await providerFetch(url, {
            method: 'GET',
            credentials: 'omit',
            redirect: 'manual',
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          });
          if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json'))
            throw new Error('Annotation counts unavailable.');
          const reader = response.body?.getReader();
          if (!reader) throw new Error('Annotation counts unavailable.');
          const decoder = new TextDecoder();
          let body = '',
            bytes = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 512 * 1024) throw new Error('Annotation metadata too large.');
              body += decoder.decode(value, { stream: true });
            }
            body += decoder.decode();
          } finally {
            await reader.cancel().catch(() => {});
          }
          const discussion = JSON.parse(body)?.discussion;
          const link = new URL(discussion?.url);
          if (
            discussion?.repository?.nameWithOwner?.toLowerCase() !== repo.toLowerCase() ||
            link.origin !== 'https://github.com' ||
            link.pathname.toLowerCase() !== `/${repo.toLowerCase()}/discussions/${number}` ||
            link.username ||
            link.password ||
            !count(discussion.totalCommentCount)
          )
            throw new Error('Invalid annotation metadata.');
          return {
            comments: discussion.totalCommentCount,
            // Giscus's reply count covers the returned comment page, not hidden pages.
            replies:
              discussion.pageInfo?.hasNextPage === false && count(discussion.totalReplyCount)
                ? discussion.totalReplyCount
                : undefined,
          };
        })();
        saved = { until: Date.now() + 60000, result };
        cache.set(key, saved);
        void result.catch(() => {
          if (cache.get(key)?.result === result) cache.delete(key);
        });
      }
      return saved.result;
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(4, items.length) }, async () => {
          while (next < items.length && !controller.signal.aborted) {
            const index = next++;
            try {
              enriched[index] = { ...items[index], ...(await read(items[index])) };
            } catch {
              /* Preserve the note and an unknown count when the provider is unavailable. */
            }
          }
        }),
      );
      return enriched;
    } finally {
      clearTimeout(timer);
    }
  };
}
