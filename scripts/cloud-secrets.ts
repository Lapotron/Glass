import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Copy only runtime connection defaults. Access client secrets stay build-only. */
export function hostedConnectionSecrets(environment: NodeJS.ProcessEnv) {
  if (
    environment.PREVIEW === 'true' ||
    (environment.WORKERS_CI_BRANCH &&
      environment.WORKERS_CI_BRANCH !== (environment.GLASS_PRODUCTION_BRANCH || 'main'))
  )
    throw new Error('Production connection credentials cannot be deployed to branch previews.');
  const secrets: Record<string, string> = {};
  for (const name of [
    'CLOUDFLARE_API_TOKEN',
    'BUILDS_API_TOKEN',
    'BUILDS_DEPLOY_HOOK',
    'ACA_REPORT_TOKEN',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
  ])
    if (environment[name]) secrets[name] = environment[name]!;
  if (Boolean(secrets.R2_ACCESS_KEY_ID) !== Boolean(secrets.R2_SECRET_ACCESS_KEY))
    throw new Error('Supply both R2 build credentials together.');
  if (environment.GLASS_CI_TOKEN) {
    if (environment.GLASS_CI_TOKEN.length < 32)
      throw new Error('GLASS_CI_TOKEN must contain at least 32 characters.');
    secrets.CI_TOKEN = environment.GLASS_CI_TOKEN;
  }
  return secrets;
}

export async function withHostedSecrets<T>(
  environment: NodeJS.ProcessEnv,
  action: (file: string | undefined) => Promise<T>,
) {
  const secrets = hostedConnectionSecrets(environment);
  if (!Object.keys(secrets).length) return action(undefined);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-runtime-secrets-'));
  const file = path.join(directory, 'secrets.json');
  try {
    await fs.chmod(directory, 0o700);
    await fs.writeFile(file, JSON.stringify(secrets), { flag: 'wx', mode: 0o600 });
    return await action(file);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
