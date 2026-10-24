import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Store, atomicWrite } from '../src/engine/store.js';
import {
  ConnectionSettings,
  resolveLaunchOptions,
  applicationRoot,
} from '../src/server/configuration.js';
import { serviceReadiness } from '../src/server/service-readiness.js';
import { redactSecrets } from '../src/server/configuration.js';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { AcaDeploymentService } from '../src/server/aca-deployment.js';
const launch = await resolveLaunchOptions(process.argv.slice(2));
const store = new Store(launch.notebookRoot),
  connections = new ConnectionSettings(store.root);
const [action = 'check'] = launch.args;
try {
  if (action === 'aca') {
    const service = new AcaDeploymentService(store, connections);
    const started = await service.start('deploy', (await service.summary()).revision);
    const completed = await service.waitFor(started.id);
    for (const line of completed.logs) console.log(line);
    if (completed.state !== 'succeeded')
      throw new Error(completed.error || 'ACA deployment failed.');
    process.exitCode = 0;
  } else {
    const readiness = await serviceReadiness(store, connections);
    await fs.mkdir(path.join(store.root, '.studio/reports'), { recursive: true });
    await atomicWrite(
      path.join(store.root, '.studio/reports/services.json'),
      JSON.stringify(readiness, null, 2),
    );
    for (const check of readiness.checks)
      console.log(
        check.id +
          ': ' +
          check.status +
          (check.codes.length ? ' (Cloudflare ' + check.codes.join(', ') + ')' : ''),
      );
    if (!readiness.ready)
      throw new Error(
        'Service preflight is incomplete. Update Studio Connections: D1, Workers Scripts, Access organization/apps and the site zone/DNS/Workers Routes permissions. No cloud resources were changed.',
      );
    if (action === 'check')
      console.log(
        'Read access verified. Deployment still validates bindings, secrets, write permissions and runtime limits.',
      );
    else if (action === 'dynamic') {
      const schema = z.object({
        accessTeam: z.string().regex(/^[a-z0-9-]+$/i),
        accessAudience: z.string().min(10).max(500),
        adminEmails: z.array(z.string().email()).min(1).max(10),
      });
      const configPath = path.join(store.root, '.studio/services/staging.json');
      let settings: z.infer<typeof schema>;
      try {
        settings = schema.parse(JSON.parse(await fs.readFile(configPath, 'utf8')));
      } catch {
        throw new Error(
          'Save the Access team, audience and adminEmails in private .studio/services/staging.json. See docs/dynamic-prototype.md. No deployment was started.',
        );
      }
      const credentials = await connections.values();
      const response = await fetch(
        'https://api.cloudflare.com/client/v4/accounts/' + readiness.accountId + '/access/apps',
        {
          headers: { Authorization: 'Bearer ' + credentials.CLOUDFLARE_API_TOKEN },
          signal: AbortSignal.timeout(15000),
        },
      );
      const apps = (await response.json()) as {
        success: boolean;
        result?: { domain?: string; aud?: string }[];
      };
      if (
        !response.ok ||
        !apps.success ||
        !apps.result?.some(
          (app) => app.domain === 'staging.example.com' && app.aud === settings.accessAudience,
        )
      )
        throw new Error(
          'Create and verify the staging.example.com Access application before deploying the private Worker.',
        );
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        CLOUDFLARE_API_TOKEN: credentials.CLOUDFLARE_API_TOKEN,
        CLOUDFLARE_ACCOUNT_ID: readiness.accountId,
        GLASS_ACCESS_TEAM: settings.accessTeam,
        GLASS_ACCESS_AUD: settings.accessAudience,
        GLASS_ACCESS_ADMINS: settings.adminEmails.join(','),
        GLASS_STAGING_ACCESS_VERIFIED: 'true',
        CI: 'true',
        WRANGLER_SEND_METRICS: 'false',
      };
      for (const key of [
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'ACA_REPORT_TOKEN',
        'CLOUDFLARE_API_KEY',
        'CF_API_TOKEN',
        'CF_API_KEY',
        'CLOUDFLARE_EMAIL',
        'CF_EMAIL',
      ])
        delete environment[key];
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          'npm',
          ['--prefix', path.join(applicationRoot, 'apps/dynamic'), 'run', 'deploy'],
          {
            shell: false,
            cwd: applicationRoot,
            env: environment,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let output = '';
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('Staging deployment timed out. Check Cloudflare before retrying.'));
        }, 180000);
        const capture = (chunk: Buffer) => {
          output += chunk.toString();
          if (output.length > 2 * 1024 * 1024) {
            child.kill('SIGTERM');
            reject(
              new Error(
                'Staging output exceeded its safe limit. Check deployment status before retrying.',
              ),
            );
          }
        };
        child.stdout.on('data', capture);
        child.stderr.on('data', capture);
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          console.log(redactSecrets(output, credentials));
          if (code)
            reject(
              new Error('Private staging deployment failed; the Pages workflow was not invoked.'),
            );
          else resolve();
        });
      });
      console.log(
        'Staging upload completed. Verify its custom domain, actual Access login and free-tier CPU before marking the service operational.',
      );
    } else throw new Error('Use services:check, aca:deploy or dynamic:deploy.');
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
