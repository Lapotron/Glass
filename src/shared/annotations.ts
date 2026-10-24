import { lineFragment, parseLineFragment } from './line-references.js';
import { annotationCounts } from './annotation-counts.js';

export type Annotation = {
  fragment: string;
  quote: string;
  url: string;
  updatedAt: string;
  comments?: number;
  replies?: number;
};
export type AnnotationPage = { items: Annotation[]; nextPage: number | null; checkedAt: string };
export type AnnotationConfig = { repo: string; category: string; entries: string[] };
const decode = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity: string) => {
    const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    if (entity[0] !== '#') return entities[entity.toLowerCase()] || '';
    const n =
      entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�';
  });
const plain = (html: string) =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
export function annotationLink(value: string, repo: string) {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase(),
      owner = repo.split('/')[0].toLowerCase();
    const bases = [`/${repo.toLowerCase()}/discussions/`, `/orgs/${owner}/discussions/`];
    if (
      url.origin === 'https://github.com' &&
      !url.username &&
      !url.password &&
      bases.some((base) => path.startsWith(base) && /^\d+$/.test(path.slice(base.length)))
    )
      return url.origin + url.pathname;
  } catch {}
  return '';
}
export function annotationsFromAtom(
  xml: string,
  repo: string,
  entryId: string,
): { items: Annotation[]; total: number } {
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<feed\b/.test(xml)) throw new Error('Invalid discussion feed.');
  const entries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)];
  const items: Annotation[] = [],
    seen = new Set<string>();
  for (const [, item] of entries) {
    const title = decode(item.match(/<title\b[^>]*>([\s\S]*?)<\/title>/)?.[1] || '').trim();
    const prefix = `entry/${entryId}/line/`;
    if (!title.startsWith(prefix)) continue;
    const parts = title.slice(prefix.length).split('/');
    const reference = parts.length === 2 && parseLineFragment(`line-${parts[0]}-${parts[1]}`);
    if (!reference) continue;
    const fragment = lineFragment(reference);
    if (seen.has(fragment)) continue;
    const hrefs = [...item.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*\/?\s*>/g)];
    const url = hrefs.map((match) => annotationLink(decode(match[1]), repo)).find(Boolean);
    if (!url) continue;
    const content = decode(item.match(/<content\b[^>]*>([\s\S]*?)<\/content>/)?.[1] || '');
    const quote = plain(
      content.match(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/)?.[1] || '',
    ).slice(0, 2000);
    const date = item.match(/<updated>([^<]+)<\/updated>/)?.[1] || '';
    items.push({
      fragment,
      quote,
      url,
      updatedAt: Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : '',
    });
    seen.add(fragment);
  }
  return { items, total: entries.length };
}

/** Same implementation in local Studio and the credential-free Pages read endpoint. */
export function annotationReader(providerFetch: typeof fetch = fetch) {
  const cache = new Map<string, { until: number; result: Promise<AnnotationPage> }>();
  const withCounts = annotationCounts(providerFetch);
  return async (request: Request, config: AnnotationConfig): Promise<Response> => {
    const json = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: {
          'Cache-Control':
            status === 200
              ? 'public, max-age=30, s-maxage=60, stale-while-revalidate=120'
              : 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        },
      });
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
    const url = new URL(request.url),
      match = /^\/api\/annotations\/([^/]+)\/?$/.exec(url.pathname);
    const entryId = match?.[1] || '',
      rawPage = url.searchParams.get('page') || '1',
      page = Number(rawPage);
    if (!/^[\w-]{1,128}$/.test(entryId) || !config.entries.includes(entryId))
      return json({ error: 'Article not found.' }, 404);
    if (!/^\d{1,3}$/.test(rawPage) || page < 1 || page > 100)
      return json({ error: 'Invalid page.' }, 400);
    if (!/^[\w-]+\/[\w.-]+$/.test(config.repo))
      return json({ error: 'Annotations are not configured.' }, 503);
    const key = `${config.repo}/${config.category}/${entryId}/${page}`;
    let cached = cache.get(key);
    if (!cached || cached.until < Date.now()) {
      if (cache.size >= 64) cache.delete(cache.keys().next().value!);
      const result = (async () => {
        const source = new URL(`https://github.com/${config.repo}/discussions.atom`);
        source.searchParams.set('discussions_q', `in:title "entry/${entryId}/line/"`);
        source.searchParams.set('page', String(page));
        const init: RequestInit = {
          // Workerd supports follow/manual only. A non-OK response below rejects redirects.
          redirect: 'manual',
          credentials: 'omit',
          signal: AbortSignal.timeout(10000),
          headers: { Accept: 'application/atom+xml' },
        };
        const response = await providerFetch(source, init);
        if (!response.ok || !response.headers.get('content-type')?.includes('xml'))
          throw new Error('Discussion feed unavailable.');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Discussion feed unavailable.');
        const decoder = new TextDecoder();
        let xml = '',
          bytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 2 * 1024 * 1024) throw new Error('Discussion feed too large.');
            xml += decoder.decode(value, { stream: true });
          }
          xml += decoder.decode();
        } finally {
          await reader.cancel().catch(() => {});
        }
        const parsed = annotationsFromAtom(xml, config.repo, entryId);
        return {
          items: await withCounts(parsed.items, config.repo),
          nextPage: parsed.total >= 25 && page < 100 ? page + 1 : null,
          checkedAt: new Date().toISOString(),
        };
      })();
      cached = { until: Date.now() + 60000, result };
      cache.set(key, cached);
    }
    try {
      return json(await cached.result);
    } catch {
      cache.delete(key);
      return json({ error: 'Annotations could not load. Try again or browse on GitHub.' }, 503);
    }
  };
}
