import { z } from 'zod';
import type { ServiceReadiness } from './local-settings.js';
import type { SiteConfig } from './contracts.js';

export const acaDeploymentSchema = z
  .object({
    workerName: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{2,62}$/, 'Use 3–63 lowercase letters, numbers or hyphens.'),
    databaseName: z
      .string()
      .trim()
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,62}$/,
        'Use 3–63 letters, numbers, hyphens or underscores.',
      ),
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .refine(
        (value) => !value || /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(value),
        'Enter a hostname without https:// or a path.',
      ),
    siteId: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/),
    collectionEnabled: z.boolean().default(true),
    dailyNetworks: z.boolean().default(true),
    audienceDetails: z.boolean().default(true),
    optionalHistory: z.boolean().default(false),
    dailyBatches: z.number().int().min(1).max(100000).default(1000),
  })
  .strict();
export type AcaDeploymentOptions = z.infer<typeof acaDeploymentSchema>;
export function defaultAcaDeployment(site:SiteConfig){
 const siteId=site.integrations.aca.siteId||new URL(site.url).hostname.replace(/^www\./,'').split('.')[0].replace(/[^a-zA-Z0-9_-]/g,'').slice(0,48)||'glass';
 const name=(siteId.toLowerCase().replace(/_/g,'-').replace(/^[^a-z]+/,'')||'glass').slice(0,55)+'-aca',host=new URL(site.url).hostname;
 return acaDeploymentSchema.parse({workerName:name,databaseName:name,domain:host.includes('.')&&!host.includes('example.')?'analytics.'+host:'',siteId});
}
export const acaDeploymentStages = [
  'checking',
  'database',
  'migrating',
  'secrets',
  'uploading',
  'verifying',
] as const;
export type AcaDeploymentJob = {
  id: string;
  action: 'setup' | 'deploy';
  state: 'queued' | (typeof acaDeploymentStages)[number] | 'succeeded' | 'failed';
  failedAt?: string;
  startedAt: string;
  completedAt?: string;
  accountId: string;
  options: AcaDeploymentOptions;
  siteOrigin: string;
  logs: string[];
  databaseId?: string;
  deploymentUrl?: string;
  verified?: boolean;
  error?: string;
};
export type AcaDeploymentCheck = {
  readiness: ServiceReadiness;
  databaseId?: string;
  workerExists?: boolean;
};
export type AcaDeploymentSummary = {
  busy: boolean;
  revision: string;
  options: AcaDeploymentOptions;
  accountId: string;
  siteOrigin: string;
  databaseId?: string;
  secretsReady: boolean;
  job: AcaDeploymentJob | null;
};
