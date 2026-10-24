import { expect, it } from 'vitest';
import { PagesConnection } from '../src/cloud/pages.js';

it('calls the Pages API with the global fetch receiver required by Workers', async () => {
  let called = 0;
  const request: typeof fetch = async function (this: unknown, input, init) {
    expect(this).toBe(globalThis);
    const outgoing = new Request(input, init);
    expect(outgoing.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/' +
        'a'.repeat(32) +
        '/pages/projects?per_page=10&page=1',
    );
    expect(outgoing.headers.get('Authorization')).toBe('Bearer fixture-pages-token');
    expect(outgoing.redirect).toBe('manual');
    called++;
    return Response.json({ success: true, result: [{ name: 'checked-project' }] });
  };
  expect(await new PagesConnection('a'.repeat(32), 'fixture-pages-token', request).list()).toEqual([
    { name: 'checked-project' },
  ]);
  expect(called).toBe(1);
});

it('lists every project in small pages without returning unrelated project settings', async () => {
  const pages: number[] = [];
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input));
    expect(url.searchParams.get('per_page')).toBe('10');
    const page = Number(url.searchParams.get('page'));
    pages.push(page);
    return Response.json({
      success: true,
      result: Array.from({ length: page === 1 ? 10 : 1 }, (_, index) => ({
        name: 'project-' + ((page - 1) * 10 + index),
        env_vars: { secret: 'private-settings-canary' },
      })),
    });
  };
  const projects = await new PagesConnection('a'.repeat(32), 'fixture-pages-token', request).list();
  expect(projects).toHaveLength(11);
  expect(projects.at(-1)).toEqual({ name: 'project-10' });
  expect(pages).toEqual([1, 2]);
  expect(JSON.stringify(projects)).not.toContain('private-settings-canary');
});

it.each([400, 403, 429])(
  'classifies HTTP %s without exposing Cloudflare error bodies',
  async (status) => {
    const request: typeof fetch = async () =>
      Response.json(
        {
          success: false,
          errors: [
            {
              code: 6003,
              message: 'private-token-canary',
              error_chain: [{ code: 6111, message: 'private-account-canary' }],
            },
          ],
        },
        { status },
      );
    const error = await new PagesConnection('a'.repeat(32), 'fixture-pages-token', request)
      .list()
      .catch((error) => error);
    expect(error.message).toContain('[Cloudflare code 6003, 6111]');
    expect(error.message).not.toMatch(/private-token-canary|private-account-canary/);
    expect(error.status).toBe(status);
    if (status === 400) {
      expect(error.message).toContain('token alone');
      expect(error.message).not.toContain('Check Pages Edit');
    }
    if (status === 403) expect(error.message).toContain('Check Pages Edit');
    if (status === 429) expect(error.message).toContain('rate limiting');
  },
);

it('does not forward Pages credentials to an upstream redirect or disclose its error body', async () => {
  let calls = 0;
  const request: typeof fetch = async function (this: unknown, _input, init) {
    expect(this).toBe(globalThis);
    expect(init?.redirect).toBe('manual');
    calls++;
    return new Response('private-upstream-canary', {
      status: 302,
      headers: { Location: 'https://unrelated.fixture.test/login' },
    });
  };
  const result = new PagesConnection('a'.repeat(32), 'fixture-pages-token', request).list();
  await expect(result).rejects.toThrow('Cloudflare Pages GET failed (302)');
  await expect(result).rejects.not.toThrow('private-upstream-canary');
  expect(calls).toBe(1);
});
