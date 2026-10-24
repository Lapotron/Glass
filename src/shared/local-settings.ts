export const connectionFields = [
  'cloudflareApiToken',
  'cloudflareBuildsApiToken',
  'workersBuildsDeployHook',
  'acaReportToken',
  'r2AccessKeyId',
  'r2SecretAccessKey',
] as const;
export type ConnectionField = (typeof connectionFields)[number];
export type ConnectionSummary = {
  revision: string;
  fields: Record<
    ConnectionField,
    { configured: boolean; source: 'studio' | 'environment' | 'none' }
  >;
};
export type ServiceReadiness = {
  checkedAt: string;
  accountId: string;
  checks: {
    id: 'workers' | 'd1' | 'access' | 'zone';
    status: 'ready' | 'denied' | 'missing' | 'unavailable';
    codes: number[];
  }[];
  ready: boolean;
};
export type ConnectionUpdate = {
  revision: string;
  set?: Partial<Record<ConnectionField, string>>;
  remove?: ConnectionField[];
};
export type CloudflareProject = { name: string };
export type CloudflareConnection = {
  authenticated: boolean;
  accounts: { id: string; name: string }[];
  accountId: string;
  pagesAccess: 'unchecked' | 'verified' | 'denied' | 'unavailable';
  projects: CloudflareProject[];
  error?: string;
  proxyDetected?: boolean;
};
export type RuntimeValues = { port: number; notebookRoot: string };
export type RuntimeSummary = {
  revision: string;
  saved: RuntimeValues;
  active: RuntimeValues;
  restartRequired: boolean;
};
