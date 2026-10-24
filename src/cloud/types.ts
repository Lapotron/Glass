/** Minimal platform contracts keep cloud code independently testable without ambient Worker globals. */
export interface Statement {
  bind(...values: unknown[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
  exec(sql: string): Promise<unknown>;
}
export interface Bucket {
  get(
    key: string,
    options?: unknown,
  ): Promise<null | {
    body: ReadableStream<Uint8Array>;
    size: number;
    etag?: string;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
  }>;
  put(
    key: string,
    value: string | ArrayBuffer | Uint8Array | ReadableStream,
    options?: unknown,
  ): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
}
export type CloudEnv = {
  DB: Database;
  BUCKET: Bucket;
  ASSETS: { fetch(request: Request): Promise<Response> };
  STUDIO_SECRET: string;
  ACCESS_TEAM: string;
  ACCESS_AUD: string;
  ACCESS_ADMINS: string;
  STUDIO_ORIGIN: string;
  SITE_ORIGIN: string;
  SITE_STAGING_ORIGIN?: string;
  PRODUCTION_BRANCH?: string;
  WORKSPACE_ID: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  BUILDS_TRIGGER_ID: string;
  BUILDS_API_TOKEN: string;
  BUILDS_DEPLOY_HOOK?: string;
  CI_TOKEN: string;
  PREVIEW?: string;
  STORAGE_BUDGET_BYTES?: string;
};
export type Actor = { id: string; email: string };
export type FileRecord = {
  path: string;
  sha: string;
  bytes: number;
  modified: string;
  text: string | null;
  encrypted: number;
};
export type FilePatch = { path: string; value: string | null; base64?: boolean };
export type WorkspaceManifest = { version: number; files: FileRecord[] };
export class CloudError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
export const hash = async (value: string | Uint8Array) =>
  hex(
    await crypto.subtle.digest(
      'SHA-256',
      typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value),
    ),
  );
export const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
