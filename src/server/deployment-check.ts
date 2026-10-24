import type { BuildResult, PublishResult } from '../shared/contracts.js';
export async function verifyPublishedDeployment(
  deployment: PublishResult,
  build: BuildResult,
  request: typeof fetch = fetch,
  options: {
    canonicalUrl?: string;
    onLog?: (message: string) => void;
    workerOrigins?: string[];
  } = {},
) {
  let origin = new URL(deployment.url).origin;
  if (
    new URL(origin).protocol !== 'https:' ||
    !(new URL(origin).hostname.endsWith('.pages.dev') || options.workerOrigins?.includes(origin))
  )
    throw new Error('Cloudflare returned an unexpected deployment address.');
  const stamped = build.manifest.includes('assets/deployment.json');
  const send = (pathname: string) =>
    request(new URL(pathname, origin), {
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
  const checked = async (response: Response, pathname: string, status: number, type: string) => {
    if (response.status !== status || !response.headers.get('content-type')?.includes(type)) {
      await response.body?.cancel();
      throw new Error('Unexpected response at ' + pathname);
    }
    return response;
  };
  const read = async (pathname: string, status: number, type: string) =>
    checked(await send(pathname), pathname, status, type);
  const identity = async () => {
    if (!stamped) return;
    const marker = await read(
      '/assets/deployment.json?build=' + encodeURIComponent(build.id),
      200,
      'application/json',
    );
    const text = await marker.text();
    let value: unknown;
    try {
      if (text.length <= 4096) value = JSON.parse(text);
    } catch {
      // Invalid or stale metadata must never verify a different deployment.
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('id' in value) ||
      value.id !== build.id
    )
      throw new Error('The live domain is not serving this exact build yet.');
  };
  try {
    let home = await send('/');
    if (accessProtected(home, origin)) {
      await home.body?.cancel();
      if (!options.canonicalUrl || !stamped)
        throw new Error(
          'The Pages preview requires Cloudflare Access. Verify the captured public domain with a fresh build.',
        );
      const canonical = new URL(options.canonicalUrl);
      if (canonical.protocol !== 'https:' || canonical.username || canonical.password)
        throw new Error('The captured public domain must use HTTPS without credentials.');
      origin = canonical.origin;
      options.onLog?.('Pages preview requires Access; checking the exact build at ' + origin + '.');
      await identity();
      home = await read('/', 200, 'text/html');
    } else {
      home = await checked(home, '/', 200, 'text/html');
      await identity();
    }
    if (
      !(await home.text()).includes('site-header') ||
      !home.headers.get('content-security-policy')?.includes("default-src 'self'")
    )
      throw new Error('The deployment is missing its expected security headers.');
    const article =
      build.entryRoutes?.[0] ||
      build.manifest
        .find((file) => /^(blog|lab)\/.+\/index\.html$/.test(file))
        ?.replace(/index\.html$/, '')
        .replace(/^/, '/');
    if (article) await (await read(article, 200, 'text/html')).body?.cancel();
    await (await read('/__fieldnotes_missing_page__/', 404, 'text/html')).body?.cancel();
    await (await read('/api/bootstrap', 404, 'text/html')).body?.cancel();
    if (build.manifest.includes('_worker.js'))
      await (
        await read('/api/annotations/__deployment_probe__', 404, 'application/json')
      ).body?.cancel();
  } catch (error) {
    throw new Error(
      'Uploaded to ' +
        deployment.url +
        ', but verification failed: ' +
        (error as Error).message +
        ' Check this deployment before retrying publication.',
      { cause: error },
    );
  }
}

function accessProtected(response: Response, origin: string) {
  if (![301, 302, 303, 307, 308].includes(response.status)) return false;
  try {
    const login = new URL(response.headers.get('location') || '', origin);
    return (
      login.protocol === 'https:' &&
      !login.username &&
      !login.password &&
      login.hostname.endsWith('.cloudflareaccess.com') &&
      login.pathname === '/cdn-cgi/access/login/' + new URL(origin).hostname
    );
  } catch {
    return false;
  }
}
