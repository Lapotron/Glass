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
  async call(path: string, method = 'GET', body?: unknown, allowMissing = false): Promise<any> {
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
    const data = await response.json().catch(() => ({}));
    if (allowMissing && response.status === 404) return null;
    if (!response.ok || !data.success)
      throw new CloudError(
        'Cloudflare Pages ' +
          method +
          ' failed (' +
          response.status +
          '). Check Pages Edit and the selected account. No build was queued.',
        response.status === 401 || response.status === 403 ? 403 : 502,
      );
    return data.result;
  }
  name(value: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,57}$/.test(value))
      throw new CloudError('Choose a valid Pages project name.');
    return value;
  }
  list() {
    return this.call('projects?per_page=100');
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
