import type { D1Database, D1Statement } from './db.js';
type Meta = { rows_read?: number; rows_written?: number };
export function meterDatabase(database: D1Database) {
  let reads = 0,
    writes = 0,
    statements = 0;
  const record = (result: unknown) => {
    const meta = (result as { meta?: Meta } | null)?.meta;
    reads += meta?.rows_read || 0;
    writes += meta?.rows_written || 0;
  };
  const originals = new WeakMap<D1Statement, D1Statement>();
  const wrap = (statement: D1Statement): D1Statement => {
    const wrapped: D1Statement = {
      bind: (...values) => wrap(statement.bind(...values)),
      async all<T>() {
        statements++;
        const result = await statement.all<T>();
        record(result);
        return result;
      },
      async first<T>(column?: string) {
        const result = await wrapped.all<Record<string, unknown>>();
        const row = result.results[0];
        return (row ? (column ? row[column] : row) : null) as T | null;
      },
      async run() {
        statements++;
        const result = await statement.run();
        record(result);
        return result;
      },
    };
    originals.set(wrapped, statement);
    return wrapped;
  };
  const db: D1Database = {
    prepare: (sql) => wrap(database.prepare(sql)),
    async batch<T>(items: D1Statement[]) {
      statements += items.length;
      const results = await database.batch<T>(items.map((item) => originals.get(item) || item));
      results.forEach(record);
      return results;
    },
    exec: (sql) => database.exec(sql),
  };
  return {
    db,
    counts: () => ({ reads, writes, statements }),
    async flush(site: string, now = Date.now()) {
      await database
        .prepare(
          'INSERT INTO database_usage(site,day,rows_read,rows_written,last_at) VALUES(?,?,?,?,?) ON CONFLICT(site,day) DO UPDATE SET rows_read=rows_read+excluded.rows_read,rows_written=rows_written+excluded.rows_written,last_at=excluded.last_at',
        )
        .bind(site, new Date(now).toISOString().slice(0, 10), reads + 1, writes + 2, now)
        .run();
    },
  };
}
