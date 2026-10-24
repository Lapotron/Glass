import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { siteSchema } from '../src/shared/contracts.js';
const flag = (name: string) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const root = await fs.realpath(path.resolve(flag('root') || process.cwd()));
const port = Number(flag('port') || 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Use a valid local Studio port.');
const report: Record<string, unknown> = {
  node: process.versions.node,
  notebookValid: false,
  studioRunning: false,
};
try {
  const site = siteSchema.parse(
    JSON.parse(await fs.readFile(path.join(root, 'content/site.json'), 'utf8')),
  );
  Object.assign(report, {
    notebookValid: true,
    pagesConfigured: Boolean(site.cloudflare.accountId && site.cloudflare.projectName),
    r2Enabled: site.mediaDelivery.mode === 'r2',
    acaConfigured: Boolean(site.integrations.aca.endpoint && site.integrations.aca.siteId),
  });
} catch {
  report.guidance = 'Check content/site.json against the maintained site schema.';
}
try {
  const origin = 'http://127.0.0.1:' + port;
  const response = await fetch(origin + '/api/bootstrap', {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json();
  if (data.workspaceId !== createHash('sha256').update(root).digest('hex')) throw new Error();
  report.studioRunning = true;
  const health = await fetch(origin + '/api/health', {
    redirect: 'error',
    signal: AbortSignal.timeout(25000),
  });
  if (health.ok) report.health = await health.json();
} catch {
  report.studioGuidance =
    'Start Studio for this notebook with npm run dev, then retry doctor with its --port.';
}
console.log(JSON.stringify(report, null, 2));
if (!report.notebookValid) process.exitCode = 1;
