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
        '/pages/projects?per_page=100',
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
