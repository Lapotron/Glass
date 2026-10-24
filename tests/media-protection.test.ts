import { beforeEach, afterEach, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/engine/store.js';
import { ConnectionSettings } from '../src/server/configuration.js';
import {
  MediaProtectionService,
  mediaProtectionExpressions,
} from '../src/server/media-protection.js';
let root: string, store: Store, connections: ConnectionSettings, service: MediaProtectionService;
let calls: { method: string; url: string; body: any }[],
  rules: Record<string, { id: string; version: string; rules: any[] }>;
let deny = false,
  verify = true,
  loseReply = false;
const token = 'private-protection-canary-123456789',
  zone = 'a'.repeat(32);
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input)),
    method = init?.method || 'GET',
    body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ method, url: url.pathname, body });
  if (url.hostname !== 'api.cloudflare.com')
    return new Response(null, {
      status: 404,
      headers: verify ? { 'X-Robots-Tag': 'noindex' } : {},
    });
  if (deny)
    return Response.json(
      { success: false, errors: [{ code: 10000, message: token }] },
      { status: 403 },
    );
  const ok = (result: unknown) => Response.json({ success: true, result });
  if (url.pathname === '/client/v4/zones') return ok([{ id: zone, name: 'example.org' }]);
  const entry = url.pathname.match(/\/phases\/([^/]+)\/entrypoint$/);
  if (entry)
    return rules[entry[1]]
      ? ok(structuredClone(rules[entry[1]]))
      : new Response(null, { status: 404 });
  if (url.pathname.endsWith('/rulesets') && method === 'POST') {
    const value = {
      id: 'new-' + body.phase,
      version: '1',
      rules: body.rules.map((rule: any) => ({ ...rule, id: crypto.randomUUID() })),
    };
    rules[body.phase] = value;
    if (loseReply) throw new Error(token);
    return ok(value);
  }
  const found = Object.values(rules).find((value) =>
    url.pathname.includes('/rulesets/' + value.id + '/rules'),
  );
  if (found) {
    if (method === 'POST') found.rules.push({ ...body, id: crypto.randomUUID() });
    else {
      const id = url.pathname.split('/').at(-1);
      found.rules = found.rules.map((rule) => (rule.id === id ? { ...body, id } : rule));
    }
    found.version = String(Number(found.version) + 1);
    if (loseReply) throw new Error(token);
    return ok(found);
  }
  throw new Error('Unexpected fixture request ' + url.pathname);
};
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-media-protection-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  const model = await store.snapshot();
  await store.saveJson(
    'site',
    {
      ...model.site,
      url: 'https://reader.example.org',
      cloudflare: { ...model.site.cloudflare, accountId: zone },
      mediaDelivery: {
        mode: 'r2',
        bucket: 'media',
        publicOrigin: 'https://assets.example.org',
        prefix: 'media',
      },
    },
    model.siteRevision,
  );
  connections = new ConnectionSettings(root, {});
  await connections.update({
    revision: (await connections.summary()).revision,
    set: { cloudflareApiToken: token },
  });
  calls = [];
  rules = {
    http_response_headers_transform: {
      id: 'header-set',
      version: '1',
      rules: [
        {
          id: 'manual',
          ref: 'unrelated',
          action: 'rewrite',
          expression: 'true',
          enabled: true,
          action_parameters: { headers: { 'x-owner': { operation: 'set', value: 'manual' } } },
        },
      ],
    },
  };
  deny = false;
  verify = true;
  loseReply = false;
  service = new MediaProtectionService(store, connections, fetcher);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('checks without mutations, appends only a scoped rule, verifies delivery and keeps tokens private', async () => {
  const before = structuredClone(rules.http_response_headers_transform.rules[0]),
    review = await service.check();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
  expect(review.changes).toHaveLength(1);
  const status = await service.apply(review.id, review.revision);
  expect(status.current).toBe(true);
  expect(rules.http_response_headers_transform.rules[0]).toEqual(before);
  const rule = rules.http_response_headers_transform.rules[1];
  expect(rule.expression).toContain('http.host eq "assets.example.org"');
  expect(rule.expression).toContain('"/media/"');
  expect(rule.action_parameters.headers['x-robots-tag'].value).toBe('noindex');
  expect(JSON.stringify({ review, status })).not.toContain(token);
  expect((await fs.stat(path.join(root, '.studio/cloud-media/protection.json'))).mode & 0o777).toBe(
    0o600,
  );
  const again = await service.check();
  expect(again.changes).toHaveLength(0);
  const writes = calls.filter((call) => !['GET', 'HEAD'].includes(call.method)).length;
  await service.apply(again.id, again.revision);
  expect(calls.filter((call) => !['GET', 'HEAD'].includes(call.method))).toHaveLength(writes);
  expect(rules.http_response_headers_transform.rules).toHaveLength(2);
});
it('expires checks when settings, credentials or remote rules change without overwriting other rules', async () => {
  const review = await service.check();
  rules.http_response_headers_transform.version = '2';
  await expect(service.apply(review.id, review.revision)).rejects.toThrow('rules changed');
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
  const second = await service.check();
  const model = await store.snapshot();
  await store.saveJson('site', { ...model.site, name: 'A changed title' }, model.siteRevision);
  await expect(service.apply(second.id, second.revision)).rejects.toThrow(
    'Site or credentials changed',
  );
});
it('does not retry uncertain writes or call failed delivery verified', async () => {
  const review = await service.check();
  loseReply = true;
  await expect(service.apply(review.id, review.revision)).rejects.toThrow(
    'Check its current state',
  );
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  expect((await service.status()).current).toBe(false);
  await expect(service.apply(review.id, review.revision)).rejects.toThrow('expired');
  loseReply = false;
  verify = false;
  const next = await service.check();
  await expect(service.apply(next.id, next.revision)).rejects.toThrow('not verified yet');
  expect((await service.status()).current).toBe(false);
  verify = true;
  const verified = await service.check();
  expect(verified.changes).toHaveLength(0);
  expect((await service.apply(verified.id, verified.revision)).current).toBe(true);
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
});
it('reports permission failures without leaking upstream details', async () => {
  deny = true;
  await expect(service.check()).rejects.toThrow('permissions');
  try {
    await service.check();
  } catch (e) {
    expect((e as Error).message).not.toContain(token);
  }
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});
it('scopes embed protection to media and exact trusted origins while retaining direct navigation', async () => {
  const model = await store.snapshot();
  model.site.mediaProtection = {
    discourageIndexing: true,
    blockForeignEmbeds: true,
    allowedHosts: ['reader.partner.org'],
  };
  const expression = mediaProtectionExpressions(model.site).embed;
  expect(expression).toContain('"https://reader.example.org/"');
  expect(expression).toContain('"https://reader.partner.org/"');
  expect(expression).toContain('sec-fetch-dest');
  expect(expression).toContain('document');
  expect(expression).not.toContain('/assets/');
  expect(expression).not.toContain('matches ');
});
