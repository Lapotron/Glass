import { z } from 'zod';
import { PrivateSettings } from '../server/configuration.js';
import {
  defaultAcaDeployment,
  acaDeploymentSchema,
  type AcaDeploymentSummary,
} from '../shared/aca-deployment.js';
import { digest, type Store } from '../engine/store.js';
import type { CloudEnv } from './types.js';
import { CloudError } from './types.js';

export const acaSettings = () =>
  new PrivateSettings(
    '/workspace/.studio/services/aca.json',
    z.object({ options: acaDeploymentSchema.optional() }).strict(),
  );
export async function acaSummary(env: CloudEnv, store: Store): Promise<AcaDeploymentSummary> {
  const saved = await acaSettings().read(),
    { site } = await store.snapshot(),
    options = saved.value.options || defaultAcaDeployment(site);
  const key = digest(
    JSON.stringify([
      site.cloudflare.accountId,
      options.workerName,
      options.databaseName,
      options.siteId,
    ]),
  );
  const target = await new PrivateSettings(
    '/workspace/.studio/services/aca-targets/' + key + '.json',
    z
      .object({
        databaseId: z.string().optional(),
        secrets: z.record(z.string(), z.string()).optional(),
        namespace: z.string().optional(),
      })
      .strict(),
  ).read();
  const journal = await new PrivateSettings(
    '/workspace/.studio/services/aca-job.json',
    z.object({ job: z.any().optional() }).strict(),
  ).read();
  const active = await env.DB.prepare(
    "SELECT id,request,state FROM cloud_jobs WHERE state IN ('queued','running') AND kind='api' AND request LIKE '%/aca/%' LIMIT 1",
  ).first<{ id: string; request: string; state: string }>();
  return {
    revision: saved.revision,
    options,
    accountId: site.cloudflare.accountId,
    siteOrigin: new URL(site.url).origin,
    databaseId: target.value.databaseId,
    secretsReady: !!target.value.secrets,
    busy: !!active,
    job: journal.value.job || null,
  };
}
export async function saveAca(env: CloudEnv, store: Store, input: unknown) {
  const data = z.object({ value: acaDeploymentSchema, revision: z.string() }).strict().parse(input);
  const current = await acaSummary(env, store);
  if (current.busy)
    throw new CloudError('Wait for ACA setup or deployment before changing its settings.', 409);
  await acaSettings().save({ options: data.value }, data.revision);
  return acaSummary(env, store);
}
