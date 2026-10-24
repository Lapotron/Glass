import { promises as fs } from 'node:fs';
import type { Runner } from '../../src/server/publishing.js';

/** Explicit synthetic provider; never forwards a request to Cloudflare. */
export class AcaCloudflareFixture {
  requests: { url: string; method: string; token: string | null }[] = [];
  commands: string[][] = [];
  databaseId: string | undefined;
  databaseName = '';
  workerExists = false;
  deniedD1 = false;
  failMigration = false;
  failUpload = false;
  failVerification = false;
  staleDeployment = false;
  migrationHook?: () => Promise<void>;
  config: Record<string, unknown> = {};
  remoteSecrets: Record<string, string> = {};
  privateFiles: string[] = [];
  versionId = 'e743c461-a3ba-4449-a820-ab78c562ef22';
  savedVersion: Record<string, string> | undefined;
  rollbackUploads = 0;
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      headers = new Headers(init?.headers);
    this.requests.push({
      url: url.origin + url.pathname,
      method: init?.method || 'GET',
      token: headers.get('Authorization'),
    });
    if (url.hostname === 'api.cloudflare.com') {
      if (url.pathname.includes('/access/')) throw new Error('ACA must not call Access APIs');
      if (url.pathname.endsWith('/versions'))
        return Response.json({
          success: true,
          result: {
            items: [{ id: this.versionId, metadata: { created_on: new Date().toISOString() } }],
          },
        });
      if (url.pathname.endsWith('/versions/' + this.versionId))
        return Response.json({
          success: true,
          result: {
            resources: {
              bindings: [
                ...Object.entries(this.savedVersion || this.config.vars || {}).map(
                  ([name, text]) => ({ name, text, type: 'plain_text' }),
                ),
                { name: 'DB', type: 'd1', id: this.databaseId },
              ],
            },
          },
        });
      if (url.pathname.endsWith('/deployments') && init?.method === 'POST') {
        const deployment = JSON.parse(String(init.body));
        if (deployment.versions?.[0]?.version_id !== this.versionId)
          throw new Error('Unexpected recovery version');
        this.rollbackUploads++;
        if (this.savedVersion) this.config.vars = { ...this.savedVersion };
        return Response.json({ success: true, result: { id: 'test-recovery' } });
      }
      if (url.pathname.endsWith('/d1/database')) {
        if (this.deniedD1)
          return Response.json(
            { success: false, errors: [{ code: 10000, message: 'Upstream private details' }] },
            { status: 401 },
          );
        if (init?.method === 'POST') {
          this.databaseName = JSON.parse(String(init.body)).name;
          this.databaseId = '12345678-1234-4234-8234-123456789abc';
          return Response.json({
            success: true,
            result: { uuid: this.databaseId, name: this.databaseName },
          });
        }
        return Response.json({
          success: true,
          result: this.databaseId ? [{ uuid: this.databaseId, name: this.databaseName }] : [],
        });
      }
      if (url.pathname.endsWith('/workers/scripts'))
        return Response.json({
          success: true,
          result: this.workerExists ? [{ id: this.config.name }] : [],
        });
      if (url.pathname.endsWith('/settings'))
        return Response.json({
          success: true,
          result: {
            bindings: Object.entries(this.config.vars || {}).map(([name, text]) => ({
              name,
              text,
            })),
          },
        });
      if (url.pathname.endsWith('/secrets'))
        return Response.json({
          success: true,
          result: Object.keys(this.remoteSecrets).map((name) => ({ name, type: 'secret_text' })),
        });
      if (url.pathname.endsWith('/workers/subdomain'))
        return Response.json({ success: true, result: { subdomain: 'fixture' } });
      if (url.pathname.endsWith('/zones'))
        return Response.json({ success: true, result: [{ id: 'b'.repeat(32) }] });
      throw new Error('Unexpected Cloudflare route: ' + url.pathname);
    }
    const vars = this.config.vars as Record<string, string>;
    if (url.pathname === '/v1/status') {
      if (headers.get('Authorization') !== 'Bearer ' + this.remoteSecrets.REPORT_TOKEN)
        return Response.json({ error: 'Unauthorized.' }, { status: 401 });
      if (this.failVerification) return Response.json({ error: 'Unavailable' }, { status: 502 });
      return Response.json({
        protocol: 3,
        capabilities: ['audience-v2'],
        historyMode:
          this.config.vars &&
          (this.config.vars as Record<string, string>).IDENTITY_MODE === 'optional-consent'
            ? 'optional-consent'
            : 'anonymous',
        siteId: vars.SITE_ID,
        siteOrigin: vars.SITE_ORIGIN,
        deploymentId: this.staleDeployment ? 'previous-deployment' : vars.DEPLOYMENT_ID,
        enabled: vars.ENABLED === 'true',
        paused: false,
        networkMode: 'daily',
        pendingDays: 0,
      });
    }
    if (
      url.pathname.startsWith('/v1/reports/') &&
      headers.get('Authorization') !== 'Bearer ' + this.remoteSecrets.REPORT_TOKEN
    )
      return Response.json({ error: 'Unauthorized.' }, { status: 401 });
    if (url.pathname.startsWith('/v1/reports/'))
      return Response.json({ name: 'overview', metrics: [], series: [], rows: [] });
    if (
      url.pathname === '/v1/events' &&
      init?.method === 'OPTIONS' &&
      headers.get('Origin') !== vars.SITE_ORIGIN
    )
      return new Response(null, { status: 403 });
    if (url.pathname === '/v1/events' && init?.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': vars.SITE_ORIGIN },
      });
    throw new Error('Unexpected synthetic ACA URL');
  };
  runner: Runner = async (args, _account, onLog) => {
    this.commands.push(args);
    if (args.some((arg) => arg === 'pages')) throw new Error('ACA must never invoke Pages');
    const configFile = args[args.indexOf('--config') + 1];
    this.privateFiles.push(configFile);
    this.config = JSON.parse(await fs.readFile(configFile, 'utf8'));
    if (args[0] === 'd1') {
      await this.migrationHook?.();
      onLog?.('Applied ordered migrations.');
      return { code: this.failMigration ? 1 : 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'deploy') {
      const keyFile = args[args.indexOf('--secrets-file') + 1];
      this.privateFiles.push(keyFile);
      const secrets = JSON.parse(await fs.readFile(keyFile, 'utf8'));
      onLog?.('Fixture canary secret ' + secrets.REPORT_TOKEN);
      if (!this.failUpload) {
        this.remoteSecrets = { ...this.remoteSecrets, ...secrets };
        this.workerExists = true;
      }
      return { code: this.failUpload ? 1 : 0, stdout: 'Synthetic ACA deployment.', stderr: '' };
    }
    throw new Error('Unexpected ACA command');
  };
}
