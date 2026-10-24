/** Minimal D1 binding contract, also implemented by the local Workers emulator. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run(): Promise<{
    meta: { changes?: number; rows_read?: number; rows_written?: number };
    success: boolean;
  }>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<T[]>;
  exec(sql: string): Promise<unknown>;
}
