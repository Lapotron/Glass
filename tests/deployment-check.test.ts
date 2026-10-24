import { expect, it } from 'vitest';
import { verifyPublishedDeployment } from '../src/server/deployment-check.js';
import type { BuildResult, PublishResult } from '../src/shared/contracts.js';

const build: BuildResult = {
  id: 'current-build',
  outputDir: '/unused',
  pages: 3,
  manifest: ['index.html', 'assets/deployment.json', '_worker.js'],
  entryRoutes: ['/post/example/'],
  diagnostics: [],
  sourceRevision: 'private-source-revision',
  completedAt: '',
};
const deployment: PublishResult = {
  url: 'https://current.example.pages.dev',
  project: 'example',
  buildId: build.id,
  completedAt: '',
};
const canonicalUrl = 'https://journal.example';
const login =
  'https://example.cloudflareaccess.com/cdn-cgi/access/login/current.example.pages.dev?meta=private-login-query';
function publicResponse(url: URL, marker: unknown = { version: 1, id: build.id }) {
  if (url.pathname === '/assets/deployment.json') return Response.json(marker);
  if (url.pathname.startsWith('/api/annotations/'))
    return Response.json({ error: 'Unknown entry' }, { status: 404 });
  return new Response('<header class="site-header"></header>', {
    status: ['/', '/post/example/'].includes(url.pathname) ? 200 : 404,
    headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'" },
  });
}

it('verifies the exact public artifact and all route boundaries without following redirects', async () => {
  const visited: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(new URL(deployment.url).origin);
    expect(init).toMatchObject({ redirect: 'manual', credentials: 'omit', cache: 'no-store' });
    visited.push(url.pathname);
    if (url.pathname === '/assets/deployment.json')
      expect(url.searchParams.get('build')).toBe(build.id);
    return publicResponse(url);
  };
  await verifyPublishedDeployment(deployment, build, request, { canonicalUrl });
  expect(visited).toEqual([
    '/',
    '/assets/deployment.json',
    '/post/example/',
    '/__fieldnotes_missing_page__/',
    '/api/bootstrap',
    '/api/annotations/__deployment_probe__',
  ]);
});

it('verifies the captured canonical domain when Access protects the preview, without requesting the login', async () => {
  const visited: string[] = [],
    logs: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    visited.push(url.origin + url.pathname);
    expect(init?.redirect).toBe('manual');
    if (url.origin === new URL(deployment.url).origin)
      return new Response(null, { status: 302, headers: { Location: login } });
    expect(url.origin).toBe(canonicalUrl);
    return publicResponse(url);
  };
  await verifyPublishedDeployment(deployment, build, request, {
    canonicalUrl,
    onLog: (message) => logs.push(message),
  });
  expect(visited).toHaveLength(7);
  expect(visited[1]).toBe(canonicalUrl + '/assets/deployment.json');
  expect(visited.some((url) => url.includes('cloudflareaccess.com'))).toBe(false);
  expect(logs.join(' ')).toContain(canonicalUrl);
  expect(logs.join(' ')).not.toContain('private-login-query');
});

it.each([{ version: 1, id: 'previous-build' }, { version: 2, id: build.id }, { version: 1 }, null])(
  'rejects a stale or invalid canonical artifact marker: %j',
  async (marker) => {
    const canonicalPaths: string[] = [];
    const request: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.origin !== canonicalUrl)
        return new Response(null, { status: 302, headers: { Location: login } });
      canonicalPaths.push(url.pathname);
      return publicResponse(url, marker);
    };
    await expect(
      verifyPublishedDeployment(deployment, build, request, { canonicalUrl }),
    ).rejects.toThrow(/Uploaded to .*exact build.*before retrying/);
    expect(canonicalPaths).toEqual(['/assets/deployment.json']);
  },
);

it.each([
  'https://unrelated.example/login',
  'https://example.cloudflareaccess.com.attacker.example/cdn-cgi/access/login/current.example.pages.dev',
  'https://example.cloudflareaccess.com/cdn-cgi/access/login/other.pages.dev',
  'http://example.cloudflareaccess.com/cdn-cgi/access/login/current.example.pages.dev',
])('does not bypass an unexpected preview redirect: %s', async (location) => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: location } });
  };
  await expect(
    verifyPublishedDeployment(deployment, build, request, { canonicalUrl }),
  ).rejects.toThrow('Unexpected response at /');
  expect(calls).toBe(1);
});

it('keeps an Access-protected legacy or unconfigured upload unverified', async () => {
  const request: typeof fetch = async () =>
    new Response(null, { status: 302, headers: { Location: login } });
  await expect(verifyPublishedDeployment(deployment, build, request)).rejects.toThrow(
    'preview requires Cloudflare Access',
  );
  await expect(
    verifyPublishedDeployment(deployment, { ...build, manifest: ['index.html'] }, request, {
      canonicalUrl,
    }),
  ).rejects.toThrow('preview requires Cloudflare Access');
});

it('still rejects exposed Studio APIs on an identity-matched canonical domain', async () => {
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.origin !== canonicalUrl)
      return new Response(null, { status: 302, headers: { Location: login } });
    if (url.pathname === '/api/bootstrap') return Response.json({ token: 'must-not-be-public' });
    return publicResponse(url);
  };
  await expect(
    verifyPublishedDeployment(deployment, build, request, { canonicalUrl }),
  ).rejects.toThrow('Unexpected response at /api/bootstrap');
});
