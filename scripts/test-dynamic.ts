import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
const root = path.resolve('apps/dynamic/.cloudflare/output/v0/workers/default'),
  config = JSON.parse(await fs.readFile(path.join(root, 'worker.config.json'), 'utf8'));
const { privateKey, publicKey } = await generateKeyPair('RS256'),
  jwk = await exportJWK(publicKey);
jwk.kid = 'fixture';
const token = await new SignJWT({ email: 'admin@example.com' })
  .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
  .setIssuer('https://fixture-team.cloudflareaccess.com')
  .setAudience('prototype-test')
  .setSubject('admin')
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(privateKey);
const moduleFiles = async (folder: string): Promise<string[]> =>
  (
    await Promise.all(
      (await fs.readdir(folder, { withFileTypes: true })).map(async (entry) =>
        entry.isDirectory()
          ? moduleFiles(path.join(folder, entry.name))
          : [path.join(folder, entry.name)],
      ),
    )
  ).flat();
const codeFiles = (await moduleFiles(path.join(root, 'bundle')))
  .filter((file) => file.endsWith('.js'))
  .sort(
    (a, b) =>
      Number(b === path.join(root, 'bundle/index.js')) -
      Number(a === path.join(root, 'bundle/index.js')),
  );
const modules = await Promise.all(
  codeFiles.map(async (file) => ({
    type: 'ESModule' as const,
    path: file,
    contents: await fs.readFile(file, 'utf8'),
  })),
);
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: 'prototype',
    modules,
    modulesRoot: path.join(root, 'bundle'),
    compatibilityDate: '2026-10-12',
    compatibilityFlags: ['nodejs_compat'],
    cf: false,
    d1Databases: { DB: 'prototype-test' },
    bindings: {
      ACCESS_TEAM: 'fixture-team',
      ACCESS_AUD: 'prototype-test',
      ACCESS_ADMINS: 'admin@example.com',
    },
    outboundService: async (request) =>
      request.url === 'https://fixture-team.cloudflareaccess.com/cdn-cgi/access/certs'
        ? Response.json({ keys: [jwk] })
        : new Response('Network disabled in prototype tests', { status: 503 }),
  }),
);
try {
  const db = await mf.getD1Database('DB');
  await db.exec(
    (await fs.readFile('apps/dynamic/migrations/0001_notes.sql', 'utf8')).replace(/\n/g, ' '),
  );
  const request = (route: string, method = 'GET', body?: unknown, authorized = true) =>
    mf.dispatchFetch('https://prototype.example' + route, {
      method,
      headers: {
        ...(authorized ? { 'Cf-Access-Jwt-Assertion': token } : {}),
        ...(body
          ? { 'Content-Type': 'application/json', Origin: 'https://prototype.example' }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const timings: number[] = [];
  let start = performance.now();
  const first = await request('/');
  const cold = performance.now() - start;
  assert.equal(first.status, 200, await first.clone().text());
  assert.match(await first.text(), /Room for what comes next/);
  assert.equal(first.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await request('/admin/', 'GET', undefined, false)).status, 401);
  const denied = await request('/admin/', 'GET', undefined, false);
  assert.equal(denied.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(denied.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(denied.headers.get('Referrer-Policy'), 'same-origin');
  assert.equal((await request('/api/notes/', 'GET', undefined, false)).status, 401);
  assert.equal((await request('/_next/static/unknown.js', 'GET', undefined, false)).status, 401);
  const created = await request('/api/notes/', 'POST', { text: 'A real D1 prototype note' });
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = (await created.json()) as { id: string };
  const listed = (await (await request('/api/notes/')).json()) as {
    notes: { id: string; text: string; version: number }[];
  };
  assert.equal(listed.notes[0].text, 'A real D1 prototype note');
  assert.equal(
    (await request('/api/notes/', 'PATCH', { id, text: 'Updated', version: 1 })).status,
    200,
  );
  assert.equal(
    (await request('/api/notes/', 'PATCH', { id, text: 'Stale', version: 1 })).status,
    409,
  );
  assert.equal((await request('/api/notes/', 'DELETE', { id, version: 2 })).status, 200);
  const csrf = await mf.dispatchFetch('https://prototype.example/api/notes/', {
    method: 'POST',
    headers: {
      'Cf-Access-Jwt-Assertion': token,
      Origin: 'https://untrusted.example',
      'Content-Type': 'application/json',
    },
    body: '{"text":"bad"}',
  });
  assert.equal(csrf.status, 403);
  assert.equal(csrf.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const snapshot = await request('/published/');
  assert.equal(snapshot.status, 200);
  assert.match(await snapshot.text(), /Published-only snapshot/);
  for (let i = 0; i < 20; i++) {
    start = performance.now();
    const response = await request('/api/notes/');
    await response.text();
    timings.push(performance.now() - start);
  }
  const walk = async (folder: string): Promise<string[]> =>
    (
      await Promise.all(
        (await fs.readdir(folder, { withFileTypes: true })).map(async (entry) =>
          entry.isDirectory()
            ? walk(path.join(folder, entry.name))
            : [path.join(folder, entry.name)],
        ),
      )
    ).flat();
  const js = (await walk(path.join(root, 'bundle'))).filter((file) => file.endsWith('.js'));
  let bytes = 0,
    gzip = 0;
  for (const file of js) {
    const data = await fs.readFile(file);
    bytes += data.length;
    gzip += gzipSync(data).length;
  }
  timings.sort((a, b) => a - b);
  const result = {
    verifiedAt: new Date().toISOString(),
    runtime: 'local workerd emulator; not a Cloudflare deployment',
    workerBytes: bytes,
    workerGzipBytes: gzip,
    coldHtmlMs: Math.round(cold),
    warmApiP50Ms: Math.round(timings[10]),
    warmApiP95Ms: Math.round(timings[19]),
    checks: [
      'Access signature and allowlist',
      'direct-worker denial',
      'private no-store',
      'D1 create/read/update/delete',
      'stale revision rejection',
      'CSRF origin gate',
      'published-only snapshot',
    ],
    assetsRunWorkerFirst: config.assets.runWorkerFirst,
  };
  await fs.mkdir('.studio/reports', { recursive: true });
  await fs.writeFile('.studio/reports/dynamic.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await mf.dispose();
}
