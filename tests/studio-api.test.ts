import { beforeEach, afterEach, expect, it, vi } from 'vitest';
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

it('reports a missing or malformed API response without exposing a JSON parse exception', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response('404 Not Found', { status: 404 }))
      .mockResolvedValueOnce(new Response('<html>outdated server</html>')),
  );
  const { api } = await import('../src/console/api.js');
  await expect(api('authoring/math-preview', { method: 'POST', body: '{}' })).rejects.toMatchObject(
    { name: 'Error', status: 404, message: expect.stringContaining('Restart Studio') },
  );
  await expect(api('bootstrap')).rejects.toMatchObject({
    message: expect.stringContaining('unreadable response'),
  });
});

it('refreshes an expired token once after a same-notebook restart and retries the rejected operation', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ workspaceId: 'same-notebook', token: 'first-session' }))
    .mockResolvedValueOnce(json({ error: 'Your Studio session expired. Reload this page.' }, 403))
    .mockResolvedValueOnce(json({ workspaceId: 'same-notebook', token: 'renewed-session' }))
    .mockResolvedValueOnce(json({ results: [] }));
  vi.stubGlobal('fetch', fetcher);
  const { api } = await import('../src/console/api.js');
  await api('bootstrap');
  await expect(
    api('authoring/math-preview', { method: 'POST', body: '{"expressions":[]}' }),
  ).resolves.toEqual({ results: [] });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls[3][1].headers['X-Studio-Token']).toBe('renewed-session');
  expect(fetcher.mock.calls[3][1].body).toBe('{"expressions":[]}');
});

it('never retries a rejected write against a different notebook', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ workspaceId: 'first-notebook', token: 'first-session' }))
    .mockResolvedValueOnce(json({ error: 'Your Studio session expired. Reload this page.' }, 403))
    .mockResolvedValueOnce(json({ workspaceId: 'other-notebook', token: 'other-session' }));
  vi.stubGlobal('fetch', fetcher);
  const { api } = await import('../src/console/api.js');
  await api('bootstrap');
  await expect(api('content/entry', { method: 'PUT', body: '{}' })).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining('switched notebooks'),
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
