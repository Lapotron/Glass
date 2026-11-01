import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GoogleSearchConsole } from '../src/server/google-search-console.js';
import { SearchConsoleService } from '../src/server/search-console.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
it('uses read-only PKCE, verifies the owner session, keeps tokens private and imports finalized Google dates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-search-oauth-'));
  roots.push(root);
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init?.body));
      return Response.json(
        form.get('grant_type') === 'authorization_code'
          ? {
              refresh_token: 'private-refresh-token',
              scope: 'https://www.googleapis.com/auth/webmasters.readonly',
            }
          : { access_token: 'private-access-token' },
      );
    }
    if (url.endsWith('/webmasters/v3/sites'))
      return Response.json({
        siteEntry: [
          { siteUrl: 'https://site.example/', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://other.example/', permissionLevel: 'siteOwner' },
        ],
      });
    if (url.includes('/searchAnalytics/query'))
      return Response.json({
        rows: [{ keys: ['2026-10-28'], clicks: 3, impressions: 12, position: 2.4 }],
      });
    throw new Error('Unexpected provider request');
  }) as typeof fetch;
  const service = new GoogleSearchConsole(root, fetcher),
    origin = 'https://studio.example';
  let status = await service.status();
  await service.configure(
    {
      revision: status.revision,
      clientId: 'abc.apps.googleusercontent.com',
      clientSecret: 'private-client-secret',
    },
    'https://site.example',
  );
  const started = await service.start(origin, 'owner');
  const authorization = new URL(started.url);
  expect(authorization.searchParams.get('scope')).toBe(
    'https://www.googleapis.com/auth/webmasters.readonly',
  );
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  const state = authorization.searchParams.get('state')!;
  await expect(service.finish(origin, 'other', state, started.cookie, 'code')).rejects.toThrow(
    'session',
  );
  await expect(service.finish(origin, 'owner', state, 'wrong-cookie', 'code')).rejects.toThrow(
    'session',
  );
  expect(calls).toHaveLength(0);
  await service.finish(origin, 'owner', state, started.cookie, 'code');
  await expect(service.finish(origin, 'owner', state, started.cookie, 'code')).rejects.toThrow(
    'session',
  );
  expect(await service.properties('https://site.example')).toEqual(['https://site.example/']);
  status = await service.status();
  expect(JSON.stringify(status)).not.toContain('private-');
  await service.configure(
    { revision: status.revision, property: 'https://site.example/', autoSync: true },
    'https://site.example',
  );
  const manual = new SearchConsoleService(root);
  const reviewed = await manual.prepare({
    source: 'Date,Clicks,Impressions\n2026-10-28,9,99',
    name: 'manual.csv',
    property: 'https://site.example/',
    from: '2026-10-02',
    to: '2026-10-29',
  });
  await manual.commit(reviewed.id);
  const result = await service.sync('https://site.example', Date.parse('2026-11-01T18:00:00Z'));
  expect(result).toMatchObject({ rows: 1, noData: false, timezone: 'America/Los_Angeles' });
  const query = calls.find((item) => item.url.includes('/searchAnalytics/query'))!;
  expect(JSON.parse(String(query.init?.body))).toMatchObject({
    dataState: 'final',
    dimensions: ['date'],
    type: 'web',
  });
  expect(JSON.parse(String(query.init?.body)).dimensionFilterGroups[0].filters[0].expression).toBe(
    '^https://site\\.example/',
  );
  const datasets = await new SearchConsoleService(root).list();
  expect(datasets).toHaveLength(2);
  expect(datasets.find((item) => item.source === 'google-api')).toMatchObject({
    dimension: 'date',
    rowCount: 1,
    timezone: 'America/Los_Angeles',
  });
  expect((await manual.read(reviewed.dataset.id)).name).toBe('manual.csv');
  await service.sync('https://site.example', Date.parse('2026-11-02T18:00:00Z'));
  const refreshed = await new SearchConsoleService(root).list();
  expect(refreshed).toHaveLength(2);
  expect(refreshed.find((item) => item.source === 'google-api')?.id).toBe(
    datasets.find((item) => item.source === 'google-api')?.id,
  );
  expect((await manual.read(reviewed.dataset.id)).name).toBe('manual.csv');
  expect(JSON.stringify(datasets)).not.toContain('private-');
  status = await service.status();
  await service.configure({ revision: status.revision, disconnect: true }, 'https://site.example');
  expect((await service.status()).connected).toBe(false);
});
