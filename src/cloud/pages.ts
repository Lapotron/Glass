import { CloudError } from './types.js';
export class PagesConnection {
  constructor(
    readonly account: string,
    readonly token: string,
    readonly request: typeof fetch = fetch,
  ) {
    if (!/^[a-f0-9]{32}$/i.test(account) || !token)
      throw new CloudError('Save a Cloudflare account and API token first.');
  }
  async call(
    path: string,
    method = 'GET',
    body?: unknown,
    allowMissing = false,
    pagination = false,
  ): Promise<any> {
    const response = await this.request.call(
      globalThis,
      'https://api.cloudflare.com/client/v4/accounts/' + this.account + '/pages/' + path,
      {
        method,
        headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      },
    );
    const parsed = await response.json().catch(() => null);
    const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    if (allowMissing && response.status === 404) return null;
    if (!response.ok || !data.success) {
      const codes: number[] = [];
      const collect = (errors: unknown, depth = 0) => {
        if (!Array.isArray(errors) || depth > 2) return;
        for (const error of errors.slice(0, 3)) {
          if (!error || typeof error !== 'object') continue;
          if (Number.isSafeInteger(error.code) && error.code >= 1000) codes.push(error.code);
          collect(error.error_chain, depth + 1);
        }
      };
      collect(data.errors);
      const denied = response.status === 401 || response.status === 403;
      const hint = denied
        ? 'Check Pages Edit and the selected account. A saved Studio token overrides the deployment default.'
        : response.status === 400
          ? 'Cloudflare rejected the request. Check the account ID and paste the API token alone, without Bearer, quotes or a Global API key.'
          : response.status === 429
            ? 'Cloudflare is rate limiting requests. Wait before retrying.'
            : response.status >= 300 && response.status < 400
              ? 'Cloudflare returned a redirect. Credentials were not forwarded.'
              : 'Cloudflare Pages is unavailable or returned an invalid response. Retry after checking its service status.';
      throw new CloudError(
        'Cloudflare Pages ' +
          method +
          ' failed (' +
          response.status +
          ')' +
          (codes.length
            ? ' [Cloudflare code ' + [...new Set(codes)].slice(0, 3).join(', ') + ']'
            : '') +
          '. ' +
          hint +
          ' No build was queued.',
        denied ? 403 : response.status === 400 ? 400 : response.status === 429 ? 429 : 502,
      );
    }
    return pagination ? { result: data.result, info: data.result_info } : data.result;
  }
  name(value: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,57}$/.test(value))
      throw new CloudError('Choose a valid Pages project name.');
    return value;
  }
  async list() {
    const projects: { name: string }[] = [];
    for (let page = 1; page <= 20; page++) {
      const { result, info } = await this.call(
        'projects?per_page=10&page=' + page,
        'GET',
        undefined,
        false,
        true,
      );
      if (
        !Array.isArray(result) ||
        result.some(
          (project) => !project || typeof project.name !== 'string' || !project.name.trim(),
        )
      )
        throw new CloudError(
          'Cloudflare returned an invalid Pages project list. No build was queued.',
          502,
        );
      projects.push(...result.map((project) => ({ name: project.name })));
      if (
        result.length < 10 ||
        (Number.isSafeInteger(info?.total_pages) &&
          info.total_pages > 0 &&
          info.total_pages <= page)
      )
        return projects;
    }
    throw new CloudError(
      'The Pages project list exceeds the safe connection-check limit. Use a direct project lookup. No build was queued.',
      400,
    );
  }
  get(name: string) {
    return this.call('projects/' + this.name(name), 'GET', undefined, true);
  }
  async create(name: string, branch = 'main') {
    const existing = await this.get(name);
    if (existing) return { created: false, project: existing };
    return {
      created: true,
      project: await this.call('projects', 'POST', {
        name: this.name(name),
        production_branch: branch,
      }),
    };
  }
  domains(name: string) {
    return this.call('projects/' + this.name(name) + '/domains');
  }
}
