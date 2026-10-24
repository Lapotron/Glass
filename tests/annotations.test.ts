import { describe, expect, it } from 'vitest';
import {
  annotationLink,
  annotationReader,
  annotationsFromAtom,
} from '../src/shared/annotations.js';
import worker from '../src/edge/annotations.js';
const key = 'a'.repeat(20) + '-1';
const item = (title: string, url = 'https://github.com/example/notebook/discussions/42') =>
  `<entry><title>${title}</title><link rel="alternate" href="${url}"/><updated>2026-10-19T00:00:00Z</updated><content type="html">&lt;blockquote&gt;&lt;p&gt;A precise &amp;amp; public quote.&lt;/p&gt;&lt;/blockquote&gt;</content></entry>`;
const feed = (...entries: string[]) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.join('')}</feed>`;
const config = { repo: 'example/notebook', category: 'General', entries: ['post-1'] };
describe('public annotation discovery', () => {
  it('accepts only this article’s validated line terms and repository links, without rendering feed HTML', () => {
    const valid = `entry/post-1/line/${key}/0-25`;
    const parsed = annotationsFromAtom(
      feed(
        item(valid),
        item(valid),
        item(`entry/private/line/${key}/0-25`),
        item(`entry/post-1/line/${key}/0-2500`),
        item(`entry/post-1/line/${key}/30-50`, 'https://github.com/other/repo/discussions/42'),
      ),
      config.repo,
      'post-1',
    );
    expect(parsed.total).toBe(5);
    expect(parsed.items).toEqual([
      {
        fragment: `line-${key}-0-25`,
        quote: 'A precise & public quote.',
        url: 'https://github.com/example/notebook/discussions/42',
        updatedAt: '2026-10-19T00:00:00.000Z',
      },
    ]);
    expect(
      annotationLink('https://github.com/example/noteXbook/discussions/1', 'example/note.book'),
    ).toBe('');
    expect(annotationLink('https://github.com/orgs/example/discussions/8', config.repo)).toContain(
      '/orgs/example/',
    );
    expect(() =>
      annotationsFromAtom('<html>Provider error</html>', config.repo, 'post-1'),
    ).toThrow();
  });
  it('bounds and caches a fixed read-only feed, paginates, and refuses unpublished or malformed requests', async () => {
    let calls = 0,
      countCalls = 0;
    const read = annotationReader(async (input, init) => {
      const url = new URL(String(input));
      if (url.origin === 'https://giscus.app') {
        countCalls++;
        expect(url.pathname).toBe('/api/discussions');
        expect(url.searchParams.get('repo')).toBe(config.repo);
        expect(url.searchParams.get('number')).toBe('42');
        expect(url.searchParams.get('first')).toBe('100');
        expect(init?.method).toBe('GET');
        expect(init?.redirect).toBe('manual');
        expect(init?.credentials).toBe('omit');
        expect(init?.headers).toEqual({ Accept: 'application/json' });
        return Response.json({
          viewer: { login: 'private-viewer-canary' },
          discussion: {
            url: 'https://github.com/example/notebook/discussions/42',
            repository: { nameWithOwner: config.repo },
            totalCommentCount: 4,
            totalReplyCount: 2,
            pageInfo: { hasNextPage: false },
            comments: [{ bodyHTML: 'private-body-canary' }],
          },
        });
      }
      calls++;
      expect(url.origin + url.pathname).toBe(
        'https://github.com/example/notebook/discussions.atom',
      );
      expect(url.searchParams.get('discussions_q')).toContain('"entry/post-1/line/"');
      expect(init?.redirect).toBe('manual');
      expect(init?.credentials).toBe('omit');
      expect(init?.headers).toEqual({ Accept: 'application/atom+xml' });
      return new Response(
        feed(
          ...Array.from({ length: 25 }, (_, index) =>
            item(`entry/post-1/line/${key}/${index}-${index + 1}`),
          ),
        ),
        { headers: { 'Content-Type': 'application/atom+xml' } },
      );
    });
    const request = (suffix: string) => new Request(`https://blog.test/api/annotations/${suffix}`);
    const first = await read(request('post-1'), config);
    const result = await first.json();
    expect(result.nextPage).toBe(2);
    expect(result.items[0]).toMatchObject({ comments: 4, replies: 2 });
    expect(JSON.stringify(result)).not.toMatch(
      /private-viewer-canary|private-body-canary|bodyHTML|login/,
    );
    expect(first.headers.get('cache-control')).toContain('s-maxage=60');
    await read(request('post-1'), config);
    expect(calls).toBe(1);
    await read(request('post-1?page=2'), config);
    expect(calls).toBe(2);
    expect(countCalls).toBe(1);
    expect((await read(request('private'), config)).status).toBe(404);
    expect((await read(request('post-1?page=101'), config)).status).toBe(400);
    expect(
      (
        await read(
          new Request('https://blog.test/api/annotations/post-1', { method: 'POST' }),
          config,
        )
      ).status,
    ).toBe(405);
    expect(calls).toBe(2);
  });
  it('keeps discovered notes when count metadata is blocked, malformed, oversized or from another thread', async () => {
    for (const response of [
      () => new Response(null, { status: 302, headers: { Location: 'https://other.test' } }),
      () =>
        Response.json({
          discussion: {
            url: 'https://github.com/other/repo/discussions/42',
            repository: { nameWithOwner: 'other/repo' },
            totalCommentCount: 9,
          },
        }),
      () =>
        Response.json({
          discussion: {
            url: 'https://github.com/example/notebook/discussions/42',
            repository: { nameWithOwner: config.repo },
            totalCommentCount: -1,
          },
        }),
      () =>
        new Response('x'.repeat(512 * 1024 + 1), {
          headers: { 'Content-Type': 'application/json' },
        }),
    ]) {
      const read = annotationReader(async (input) =>
        new URL(String(input)).origin === 'https://github.com'
          ? new Response(feed(item(`entry/post-1/line/${key}/0-25`)), {
              headers: { 'Content-Type': 'application/atom+xml' },
            })
          : response(),
      );
      const result = await read(new Request('https://blog.test/api/annotations/post-1'), config);
      expect(result.status).toBe(200);
      const { items } = await result.json();
      expect(items).toHaveLength(1);
      expect(items[0].comments).toBeUndefined();
      expect(items[0].replies).toBeUndefined();
    }
  });
  it('does not present a paginated reply subtotal as the whole discussion count', async () => {
    const read = annotationReader(async (input) =>
      new URL(String(input)).origin === 'https://github.com'
        ? new Response(feed(item(`entry/post-1/line/${key}/0-25`)), {
            headers: { 'Content-Type': 'application/atom+xml' },
          })
        : Response.json({
            discussion: {
              url: 'https://github.com/example/notebook/discussions/42',
              repository: { nameWithOwner: config.repo },
              totalCommentCount: 120,
              totalReplyCount: 15,
              pageInfo: { hasNextPage: true },
            },
          }),
    );
    const { items } = await (
      await read(new Request('https://blog.test/api/annotations/post-1'), config)
    ).json();
    expect(items[0].comments).toBe(120);
    expect(items[0].replies).toBeUndefined();
  });
  it('fails visibly and permits a later retry after invalid or blocked provider responses', async () => {
    let valid = false;
    const read = annotationReader(
      async () =>
        new Response(valid ? feed() : 'Not a feed', {
          headers: { 'Content-Type': 'application/atom+xml' },
        }),
    );
    const request = new Request('https://blog.test/api/annotations/post-1');
    expect((await read(request, config)).status).toBe(503);
    valid = true;
    expect((await read(request, config)).status).toBe(200);
  });
  it('rejects provider redirects without following another page', async () => {
    let calls = 0;
    const read = annotationReader(async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://other.test/private' },
      });
    });
    expect(
      (await read(new Request('https://blog.test/api/annotations/post-1'), config)).status,
    ).toBe(503);
    expect(calls).toBe(1);
  });
  it('the Pages worker delegates static routes to ASSETS and denies private article discovery', async () => {
    const assets: string[] = [];
    const env = {
      ASSETS: {
        async fetch(request: Request) {
          assets.push(new URL(request.url).pathname);
          return request.url.endsWith('annotation-config.json')
            ? Response.json(config)
            : new Response('Static page');
        },
      },
    };
    expect(await (await worker.fetch(new Request('https://blog.test/about/'), env)).text()).toBe(
      'Static page',
    );
    expect(
      (await worker.fetch(new Request('https://blog.test/api/annotations/private'), env)).status,
    ).toBe(404);
    expect(assets).toEqual(['/about/', '/assets/annotation-config.json']);
  });
});
