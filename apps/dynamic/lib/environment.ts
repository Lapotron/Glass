import { env } from 'cloudflare:workers';
import type { AccessConfig } from './access';
export type Database = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta: { changes?: number } }>;
    };
  };
};
export const environment = () => env as unknown as AccessConfig & { DB: Database };
