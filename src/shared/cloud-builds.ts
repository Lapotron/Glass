/** Public pipeline settings; credentials never belong in this metadata. */
export const readerBuild = {
  root: 'infrastructure/cloud/site',
  build: 'npm --prefix ../../.. ci && npm --prefix ../../.. run cloud:build:site',
  deploy: 'npm --prefix ../../.. run cloud:deploy:site',
} as const;
export type CloudOperation = {
  id: string;
  kind: 'api' | 'publish' | 'build';
  state: string;
  request: string;
  created: string;
  updated: string;
  commit_sha?: string | null;
  build_uuid?: string | null;
  error?: string | null;
};
export type CloudStatus = {
  version: number;
  workspaceId: string;
  studioOrigin: string;
  siteOrigin: string;
  preview: boolean;
  buildsConfigured: boolean;
  accountId?: string;
  siteWorker?: string;
  files: number;
  bytes: number;
  budgetBytes: number;
  physicalStorage?: { bytes: number; budget: number };
  jobs: CloudOperation[];
  deferredBuild?: { after: string; state: string };
};
