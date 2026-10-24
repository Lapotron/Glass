/** Keep a retained Pages origin available while moving its hostname to the reader Worker. */
export async function prepareSiteRoute(
  worker: string,
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
) {
  const zone = environment.GLASS_SITE_ZONE_ID;
  if (environment.GLASS_ENABLE_SITE_DOMAIN !== 'true' || !zone) return async () => {};
  if (!/^[a-f0-9]{32}$/i.test(zone) || !environment.CLOUDFLARE_API_TOKEN)
    throw new Error('Configure the existing site zone and deployment credential before cutover.');
  const hostname = new URL(environment.GLASS_SITE_ORIGIN!).hostname;
  const pattern = hostname + '/*';
  const base = 'https://api.cloudflare.com/client/v4/zones/' + zone + '/workers/routes';
  const headers = { Authorization: 'Bearer ' + environment.CLOUDFLARE_API_TOKEN };
  async function call(url: string, method = 'GET') {
    const response = await fetcher(url, { method, headers, signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok || !data.success)
      throw new Error(
        'The site route could not be verified (' +
          response.status +
          '). Existing routes were kept.',
      );
    return data.result as { id: string; pattern: string; script?: string }[];
  }
  const routes = await call(base);
  for (const route of routes) {
    const host = route.pattern.replace(/^https?:\/\//, '').split('/')[0];
    const matches = new RegExp(
      '^' + host.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
      'i',
    ).test(hostname);
    if (matches && (route.pattern !== pattern || route.script !== worker))
      throw new Error(
        'An existing route already handles the site hostname. Review it before cutover; no routes were replaced.',
      );
  }
  if (routes.some((route) => route.pattern === pattern && route.script === worker))
    return async () => {};
  // Only undo the exact route this first deployment could have created. Never delete pre-existing routes.
  return async () => {
    const current = await call(base);
    const created = current.find(
      (route) =>
        route.pattern === pattern &&
        route.script === worker &&
        !routes.some((old) => old.id === route.id),
    );
    if (created) await call(base + '/' + created.id, 'DELETE');
  };
}
