import type { D1Database, D1Statement } from './db.js';

/** Canonical network addresses are used only transiently, never returned or logged. */
export function normalizeNetworkAddress(input: string): string | undefined {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(input)) {
    const parts = input.split('.').map(Number);
    return parts.every((part) => part <= 255) ? parts.join('.') : undefined;
  }
  if (!input.includes(':') || /[\s%[\]/?#@]/.test(input)) return;
  try {
    const canonical = new URL('http://[' + input + ']/').hostname.slice(1, -1);
    if (canonical === '2a06:98c0:3600::103') return; // Cross-zone Worker placeholder.
    const mapped = canonical.match(/^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/);
    if (mapped) {
      const a = parseInt(mapped[1], 16),
        b = parseInt(mapped[2], 16);
      return [a >> 8, a & 255, b >> 8, b & 255].join('.');
    }
    return canonical;
  } catch {
    return;
  }
}
export async function dailyNetworkHash(
  address: string,
  site: string,
  day: string,
  secret: string,
  scope = '',
) {
  const normalized = normalizeNetworkAddress(address);
  if (!normalized || secret.length < 32) return;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(JSON.stringify([site, day, scope, normalized])),
  );
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** Each insert and its changes()-guarded count run together in the ingestion transaction. */
export function networkStatements(
  db: D1Database,
  site: string,
  day: string,
  content: string,
  hashes: readonly [string, string, string],
  now: number,
  revision = '',
): D1Statement[] {
  const scopes = [['', ''], [content, ''], ...(revision ? [[content, revision]] : [])];
  return scopes
    .filter(
      (value, i) =>
        scopes.findIndex((scope) => scope[0] === value[0] && scope[1] === value[1]) === i,
    )
    .flatMap(([target, version]) => [
      db
        .prepare(
          'INSERT OR IGNORE INTO daily_network_keys(site,day,content,revision,hash,expires) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          site,
          day,
          target,
          version,
          hashes[version ? 2 : target ? 1 : 0],
          Math.min(now + 48 * 3600000, Date.parse(day) + 36 * 3600000),
        ),
      db
        .prepare(
          'INSERT INTO daily_network_totals(site,day,content,revision,networks) SELECT ?,?,?,?,1 WHERE changes()=1 ON CONFLICT(site,day,content,revision) DO UPDATE SET networks=networks+1',
        )
        .bind(site, day, target, version),
    ]);
}
