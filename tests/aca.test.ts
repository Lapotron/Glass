import { beforeAll, afterAll, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acaBatchSchema, type AcaBatch } from '../src/shared/aca.js';
import { maintainAnalytics, summarizeDay } from '../src/aca/aggregate.js';
import { analyticsReport } from '../src/aca/reports.js';
import type { D1Database } from '../src/aca/db.js';
import { addCardinality, mergeCardinality, cardinalitySize } from '../src/aca/cardinality.js';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { verifyAdmin } from '../apps/dynamic/lib/access.js';
import { advanceMaintenance, advanceSummary } from '../src/aca/bounded-summary.js';
import { dailyNetworkHash, normalizeNetworkAddress } from '../src/aca/networks.js';
import { meterDatabase } from '../src/aca/usage.js';
import { handleAnalytics } from '../src/aca/worker.js';
import { parseSegment, segmentSql } from '../src/shared/aca-segments.js';
import { segmentOptions } from '../src/aca/segment-reports.js';
let root: string, mf: Miniflare, db: D1Database;
const token = 'a-private-report-token-32-characters-long';

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-aca-test-'));
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir: root,
      target: 'es2022',
      minify: false,
      lib: { entry: path.resolve('src/aca/worker.ts'), formats: ['es'], fileName: () => 'aca.js' },
    },
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      script: await fs.readFile(path.join(root, 'aca.js'), 'utf8'),
      modules: true,
      compatibilityDate: '2026-10-12',
      cf: false,
      d1Databases: { DB: 'aca' },
      bindings: {
        ENABLED: 'true',
        SITE_ID: 'test',
        SITE_ORIGIN: 'https://reader.example',
        REPORT_TOKEN: token,
        IDENTITY_SECRET: 'a-private-identity-secret-32-characters',
        MAX_DAILY_BATCHES: '1000',
        DAILY_NETWORKS: 'true',
        IDENTITY_MODE: 'legacy-opt-in',
        NETWORK_SECRET: 'test-network-secret-at-least-32-characters',
      },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const name of (await fs.readdir('infrastructure/aca/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = (await fs.readFile('infrastructure/aca/migrations/' + name, 'utf8')).replace(
      /--[^\n]*/g,
      '',
    );
    for (const statement of sql.split(';').filter((part) => part.trim()))
      await db.prepare(statement).run();
  }
}, 60000);
afterAll(async () => {
  await mf?.dispose();
  await fs.rm(root, { recursive: true, force: true });
});
it('allows anonymous JSON preflights only from the site origin without accepting browser credentials', async () => {
  const options = (origin: string) =>
    mf.dispatchFetch('https://metrics.example/v1/events', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
  const allowed = await options('https://reader.example');
  expect(allowed.status).toBe(204);
  expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://reader.example');
  expect(allowed.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  expect(allowed.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  expect(allowed.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  expect(allowed.headers.get('Vary')).toBe('Origin');
  const rejected = await options('https://other.example');
  expect(rejected.status).toBe(403);
  expect(rejected.headers.get('Access-Control-Allow-Origin')).toBeNull();
});
const send = (
  batch: unknown,
  origin = 'https://reader.example',
  headers: Record<string, string> = {},
) =>
  mf.dispatchFetch('https://aca.test/v1/events', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(batch),
  });
const batch = (patch: Partial<AcaBatch> = {}): AcaBatch => ({
  version: 1,
  site: 'test',
  view: crypto.randomUUID(),
  content: 'article-test',
  revision: 'a'.repeat(64),
  route: '/post/test/',
  sequence: 0,
  active: 0,
  depth: 0,
  buckets: Array(20).fill(0),
  sections: {},
  end: false,
  ended: false,
  consent: 'anonymous',
  source: 'direct',
  campaign: '',
  device: 'desktop',
  language: 'en',
  events: [],
  ...patch,
});
it('validates bounded allowlisted segment values and binds values instead of interpolating SQL', () => {
  expect(parseSegment('{"country":["US","US","FR"],"device":["desktop"]}')).toEqual({
    country: ['FR', 'US'],
    device: ['desktop'],
  });
  expect(() => parseSegment('{"sql":"DROP TABLE views"}')).toThrow('valid audience');
  expect(() => parseSegment(JSON.stringify({ country: Array(11).fill('US') }))).toThrow();
  const result = segmentSql({ source: ["source' OR 1=1 --"] });
  expect(result.clause).not.toContain('OR 1=1');
  expect(result.params).toEqual(["source' OR 1=1 --"]);
});
it('uses committed joint segments for intersections, event attribution, geography, vitals and durable history', async () => {
  const site = 'segment-check',
    date = new Date().toISOString().slice(0, 10),
    content = 'segment-article';
  const env = {
    DB: db,
    ENABLED: 'true',
    SITE_ID: site,
    SITE_ORIGIN: 'https://reader.example',
    REPORT_TOKEN: token,
    IDENTITY_SECRET: 'a-private-identity-secret-32-characters',
    IDENTITY_MODE: 'optional-consent',
    AUDIENCE_DETAILS: 'true',
  };
  const post = async (
    country: string,
    device: 'phone' | 'desktop',
    source: string,
    language: string,
  ) => {
    const body = batch({
      site,
      content,
      version: 2,
      device,
      source,
      language,
      active: 20000,
      buckets: [20000, ...Array(19).fill(0)],
      sections: { intro: 20000 },
      events: [
        {
          id: crypto.randomUUID(),
          action: 'impression',
          target: 'destination',
          surface: 'home',
          rank: 1,
          value: 0,
        },
        {
          id: crypto.randomUUID(),
          action: 'click',
          target: 'destination',
          surface: 'home',
          rank: 1,
          value: 0,
        },
        {
          id: crypto.randomUUID(),
          action: 'vital',
          target: 'LCP',
          surface: '',
          rank: 0,
          value: 1600,
        },
      ],
    });
    const request = new Request('https://aca.test/v1/events', {
      method: 'POST',
      headers: {
        Origin: env.SITE_ORIGIN,
        'Content-Type': 'application/json',
        'User-Agent':
          device === 'phone'
            ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1'
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(body),
    });
    Object.defineProperty(request, 'cf', {
      value: {
        country,
        continent: country === 'US' ? 'NA' : 'EU',
        city: country === 'US' ? 'Seattle' : 'Paris',
        region: 'Example',
        latitude: 47,
        longitude: -122,
        timezone: 'UTC',
      },
    });
    const response = await handleAnalytics(request, env);
    expect(response.status, await response.clone().text()).toBe(200);
  };
  await post('US', 'desktop', 'google', 'en');
  await post('US', 'phone', 'google', 'zh');
  await post('FR', 'desktop', 'direct', 'fr');
  const run = async (database = db) => {
    for (let i = 0; i < 200; i++) if (await advanceSummary(database, site, date)) return;
    throw new Error('Segment work did not complete');
  };
  await run();
  const url = (segment: unknown, selected = content) =>
    new URL(
      'https://aca.test/?' +
        new URLSearchParams({
          from: date,
          to: date,
          content: selected,
          segment: JSON.stringify(segment),
        }),
    );
  const report = await analyticsReport(
    db,
    site,
    'overview',
    url({ country: ['US'], device: ['desktop'] }),
  );
  expect(report.metrics.find((m) => m.label === 'Page views')?.value).toBe(1);
  expect(report.coverage).toMatchObject({ days: 1, coveredDays: 1, missingDays: [] });
  const union = await analyticsReport(
    db,
    site,
    'overview',
    url({ country: ['US', 'FR'], device: ['desktop'] }),
  );
  expect(union.metrics.find((m) => m.label === 'Page views')?.value).toBe(2);
  const reach = await analyticsReport(
    db,
    site,
    'reach',
    url({ country: ['US'], device: ['desktop'] }, 'destination'),
  );
  expect(reach.metrics.find((m) => m.label === 'Impressions')?.value).toBe(1);
  expect(reach.metrics.find((m) => m.label === 'On-site CTR')?.value).toBe(100);
  const geography = await analyticsReport(db, site, 'geography', url({ device: ['phone'] }));
  expect(geography.rows).toHaveLength(1);
  expect(geography.rows[0]).toMatchObject({ country: 'US', views: 1 });
  const quality = await analyticsReport(db, site, 'quality', url({ country: ['FR'] }));
  expect(quality.rows.find((r) => r.metric === 'LCP')).toMatchObject({
    observations: 1,
    average: 1600,
    percentileSamples: 1,
  });
  const visits = await analyticsReport(db, site, 'visits', url({ language: ['zh'] }));
  expect(visits.rows).toHaveLength(1);
  const options = await segmentOptions(db, site, { from: date, to: date, content, revision: '' });
  expect(options.options.country).toEqual(['FR', 'US']);
  const history = await analyticsReport(db, site, 'audience', url({ country: ['US'] }));
  expect(history.cohorts).toEqual([]);
  expect(history.notes.some((n) => n.includes('unavailable with segment'))).toBe(true);
  // New records cannot leak through a failed summary generation.
  await post('US', 'desktop', 'google', 'en');
  const failing: D1Database = {
    prepare(sql) {
      if (sql.startsWith('INSERT INTO summaries')) throw new Error('Segment commit stopped');
      return db.prepare(sql);
    },
    batch: (items) => db.batch(items),
    exec: (sql) => db.exec(sql),
  };
  await expect(run(failing)).rejects.toThrow('Segment commit stopped');
  expect(
    (await analyticsReport(db, site, 'overview', url({ country: ['US'], device: ['desktop'] })))
      .metrics[0].value,
  ).toBe(1);
  await run();
  expect(
    (await analyticsReport(db, site, 'overview', url({ country: ['US'], device: ['desktop'] })))
      .metrics[0].value,
  ).toBe(2);
  await db.prepare('DELETE FROM events WHERE site=?').bind(site).run();
  await db.prepare('DELETE FROM views WHERE site=?').bind(site).run();
  expect(
    (await analyticsReport(db, site, 'overview', url({ country: ['FR'] }))).metrics[0].value,
  ).toBe(1);
});
it('marks older independent summaries unavailable for combined segment filters', async () => {
  const site = 'segment-legacy',
    date = '2026-08-01';
  await db
    .prepare('INSERT INTO summaries(site,day,refreshed_at) VALUES(?,?,?)')
    .bind(site, date, Date.now())
    .run();
  const report = await analyticsReport(
    db,
    site,
    'overview',
    new URL(
      'https://aca.test/?' +
        new URLSearchParams({ from: date, to: date, segment: JSON.stringify({ country: ['US'] }) }),
    ),
  );
  expect(report.coverage).toMatchObject({ days: 1, coveredDays: 0, missingDays: [date] });
  expect(report.series).toEqual([]);
});
it('collects cumulative active time once, deduplicates events, gates reports, and forgets opt-in raw state', async () => {
  const visitor = crypto.randomUUID(),
    view = crypto.randomUUID(),
    event = {
      id: crypto.randomUUID(),
      action: 'impression' as const,
      target: 'article-target',
      surface: 'home',
      rank: 1,
      value: 0,
    };
  const original = batch({
    view,
    visitor,
    consent: 'opt-in',
    active: 10000,
    buckets: [10000, ...Array(19).fill(0)],
    events: [event, { ...event, id: crypto.randomUUID(), action: 'click' }],
  });
  expect((await send(original)).status).toBe(200);
  expect((await send(original)).status).toBe(200);
  const update = {
    ...original,
    sequence: 1,
    active: 12000,
    buckets: [12000, ...Array(19).fill(0)],
    events: [...original.events, { ...event, id: crypto.randomUUID(), action: 'copy' as const }],
  };
  expect((await send(update)).status).toBe(200);
  expect((await send(batch())).status).toBe(200);
  expect((await db.prepare('SELECT COUNT(*) AS n FROM views').first<{ n: number }>())?.n).toBe(2);
  expect((await db.prepare('SELECT COUNT(*) AS n FROM events').first<{ n: number }>())?.n).toBe(3);
  expect((await mf.dispatchFetch('https://aca.test/v1/reports/overview')).status).toBe(401);
  // Reports never initiate an expensive rebuild. Explicit bounded maintenance publishes it.
  for (let i = 0; i < 30; i++) {
    const status = await mf.dispatchFetch('https://aca.test/v1/maintenance', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    });
    expect(status.status, await status.clone().text()).toBe(200);
    if (!((await status.json()) as { pendingDays: number }).pendingDays) break;
  }
  const report = (await (
    await mf.dispatchFetch('https://aca.test/v1/reports/overview', {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { metrics: { label: string; value: number }[] };
  const metric = (label: string) => report.metrics.find((m) => m.label === label)?.value;
  expect(metric('Page views')).toBe(2);
  expect(metric('Qualified reads')).toBe(1);
  const legacy = await analyticsReport(db, 'test', 'overview', new URL('https://aca.test/'));
  expect(legacy.metrics.find((m) => m.label === 'Opt-in unique browsers')?.value).toBe(1);
  expect(metric('Average daily networks')).toBeNull();
  expect(metric('On-site CTR')).toBe(100);
  expect((await send(original, 'https://untrusted.example')).status).toBe(403);
  const forgotten = await mf.dispatchFetch('https://aca.test/v1/forget', {
    method: 'POST',
    headers: { Origin: 'https://reader.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ site: 'test', visitor }),
  });
  expect(forgotten.status).toBe(200);
  expect((await db.prepare('SELECT COUNT(*) AS n FROM visitors').first<{ n: number }>())?.n).toBe(
    0,
  );
  expect((await db.prepare('SELECT COUNT(*) AS n FROM views').first<{ n: number }>())?.n).toBe(1);
  expect((await send({ ...update, sequence: 2 })).status).toBe(403);
});
it('rejects private fields, inconsistent consent and impossible cumulative dwell', () => {
  expect(acaBatchSchema.safeParse({ ...batch(), ip: '127.0.0.1' }).success).toBe(false);
  expect(acaBatchSchema.safeParse(batch({ visitor: crypto.randomUUID() })).success).toBe(false);
  expect(
    acaBatchSchema.safeParse(batch({ active: 10, buckets: Array(20).fill(1000) })).success,
  ).toBe(false);
});
it('summarizes expiring raw data before retention removes it', async () => {
  const old = batch({
    content: 'old-article',
    active: 2000,
    buckets: [2000, ...Array(19).fill(0)],
  });
  expect((await send(old)).status).toBe(200);
  const date = new Date(Date.now() - 91 * 86400000).toISOString().slice(0, 10);
  await db.prepare('UPDATE views SET day=? WHERE id=?').bind(date, old.view).run();
  await maintainAnalytics(db, 'test');
  expect(await db.prepare('SELECT id FROM views WHERE id=?').bind(old.view).first()).toBeNull();
  expect(
    (
      await db
        .prepare('SELECT views FROM daily WHERE content=?')
        .bind('old-article')
        .first<{ views: number }>()
    )?.views,
  ).toBe(1);
});
it('keeps the last complete report when a summary fails before its commit watermark', async () => {
  const original = batch({
    content: 'atomic-summary',
    active: 2000,
    buckets: [2000, ...Array(19).fill(0)],
  });
  expect((await send(original)).status).toBe(200);
  const now = Date.now(),
    date = new Date(now).toISOString().slice(0, 10);
  await summarizeDay(db, 'test', date, now);
  expect(
    (
      await send({
        ...original,
        sequence: 1,
        active: 12000,
        buckets: [12000, ...Array(19).fill(0)],
      })
    ).status,
  ).toBe(200);
  const failing: D1Database = {
    prepare(sql) {
      if (sql.startsWith('INSERT INTO summaries')) throw new Error('Simulated commit failure');
      return db.prepare(sql);
    },
    batch: (statements) => db.batch(statements),
    exec: (sql) => db.exec(sql),
  };
  await expect(summarizeDay(failing, 'test', date, now + 1000)).rejects.toThrow(
    'Simulated commit failure',
  );
  const report = await analyticsReport(
    db,
    'test',
    'overview',
    new URL(`https://aca.test/v1/reports/overview?from=${date}&to=${date}&content=atomic-summary`),
  );
  expect(report.series[0].active).toBe(2);
  expect(
    (
      await db
        .prepare('SELECT active FROM views WHERE id=?')
        .bind(original.view)
        .first<{ active: number }>()
    )?.active,
  ).toBe(12000);
});
it('retains an expired day with a stale watermark when maintenance has a backlog', async () => {
  const now = Date.now();
  for (let index = 0; index < 6; index++) {
    const original = batch({ content: 'pending-retention' });
    expect((await send(original)).status).toBe(200);
    const date = new Date(now - (101 - index) * 86400000).toISOString().slice(0, 10);
    await db
      .prepare('UPDATE views SET day=?,updated_at=? WHERE id=?')
      .bind(date, now - 1000, original.view)
      .run();
    await summarizeDay(db, 'test', date, now - 2000);
  }
  await maintainAnalytics(db, 'test', now);
  expect(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM views WHERE content=?')
        .bind('pending-retention')
        .first<{ n: number }>()
    )?.n,
  ).toBe(1);
  await maintainAnalytics(db, 'test', now + 1000);
  expect(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM views WHERE content=?')
        .bind('pending-retention')
        .first<{ n: number }>()
    )?.n,
  ).toBe(0);
});
it('merges cardinality summaries without summing daily unique counts', () => {
  const a = Array(cardinalitySize).fill(0),
    b = Array(cardinalitySize).fill(0);
  for (let i = 0; i < 10000; i++) {
    const hash = createHash('sha256').update(String(i)).digest('hex');
    if (i < 8000) addCardinality(a, hash);
    if (i >= 2000) addCardinality(b, hash);
  }
  expect(mergeCardinality([a, b])).toBeGreaterThan(9300);
  expect(mergeCardinality([a, b])).toBeLessThan(10700);
  expect(mergeCardinality([a, a])).toBe(mergeCardinality([a]));
});
it('normalizes network addresses, rotates keyed hashes by site/day and excludes untrusted placeholders', async () => {
  expect(normalizeNetworkAddress('2001:0db8:0:0:0:0:0:1')).toBe('2001:db8::1');
  expect(normalizeNetworkAddress('::ffff:192.0.2.1')).toBe('192.0.2.1');
  for (const value of [
    '999.1.2.3',
    '127.0.0.1, 10.0.0.1',
    'fe80::1%eth0',
    '2a06:98c0:3600::103',
    'not-an-address',
  ])
    expect(normalizeNetworkAddress(value)).toBeUndefined();
  const secret = 'a-long-network-secret-for-hashing-32-characters';
  const a = await dailyNetworkHash('192.0.2.1', 'a', '2026-10-23', secret);
  expect(a).toMatch(/^[a-f0-9]{64}$/);
  expect(a).not.toBe(await dailyNetworkHash('192.0.2.1', 'a', '2026-10-24', secret));
  expect(a).not.toBe(await dailyNetworkHash('192.0.2.1', 'b', '2026-10-23', secret));
  expect(await dailyNetworkHash('invalid', 'a', '2026-10-23', secret)).toBeUndefined();
});
it('production anonymous mode discards identities sent by stale clients', async () => {
  const visitor = crypto.randomUUID(),
    payload = batch({ content: 'stale-identity', consent: 'opt-in', visitor });
  const response = await handleAnalytics(
    new Request('https://aca.test/v1/events', {
      method: 'POST',
      headers: { Origin: 'https://reader.example', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    {
      DB: db,
      ENABLED: 'true',
      SITE_ID: 'test',
      SITE_ORIGIN: 'https://reader.example',
      REPORT_TOKEN: token,
      IDENTITY_SECRET: 'a-private-identity-secret-32-characters',
      IDENTITY_MODE: 'anonymous',
    },
  );
  expect(response.status).toBe(200);
  const stored = await db
    .prepare('SELECT visitor,consent FROM views WHERE id=?')
    .bind(payload.view)
    .first<{ visitor: string | null; consent: string }>();
  expect(stored).toEqual({ visitor: null, consent: 'anonymous' });
});
it('deduplicates daily networks transactionally, preserves counts after expiry, and respects privacy headers', async () => {
  const content = 'network-article',
    now = Date.now(),
    day = new Date(now).toISOString().slice(0, 10);
  for (const address of ['192.0.2.1', '192.0.2.1', '2001:db8::1', '2001:0db8::1']) {
    const payload = batch({ content, networkEstimate: true });
    expect((await send(payload, undefined, { 'CF-Connecting-IP': address })).status).toBe(200);
    expect((await send(payload, undefined, { 'CF-Connecting-IP': address })).status).toBe(200);
  }
  const keys = await db
    .prepare('SELECT * FROM daily_network_keys WHERE content=?')
    .bind(content)
    .all();
  expect(keys.results).toHaveLength(4); // Article and revision scopes, two networks each.
  expect(new Set(keys.results.map((row) => (row as { hash: string }).hash)).size).toBe(4);
  expect(JSON.stringify(keys)).not.toContain('192.0.2.1');
  const response = await send(
    batch({ content: 'privacy-signal', networkEstimate: true }),
    undefined,
    { 'CF-Connecting-IP': '192.0.2.1', 'Sec-GPC': '1' },
  );
  expect(response.status).toBe(204);
  expect(
    await db.prepare('SELECT id FROM views WHERE content=?').bind('privacy-signal').first(),
  ).toBeNull();
  const report = await analyticsReport(
    db,
    'test',
    'audience',
    new URL('https://aca.test/?from=' + day + '&to=' + day + '&content=' + content),
    now,
    true,
  );
  expect(report.series[0].networks).toBe(2);
  expect(report.cohorts).toEqual([]);
  const metered = meterDatabase(db);
  await advanceMaintenance(metered.db, 'test', now + 49 * 3600000);
  expect(metered.counts().statements).toBeLessThan(45);
  expect(
    (await db.prepare('SELECT * FROM daily_network_keys WHERE content=?').bind(content).all())
      .results,
  ).toHaveLength(0);
  expect(
    (
      await db
        .prepare("SELECT networks FROM daily_network_totals WHERE content=? AND revision=''")
        .bind(content)
        .first<{ networks: number }>()
    )?.networks,
  ).toBe(2);
});
it('exposes private readiness and pauses ingestion before the configured free-tier budget', async () => {
  expect((await mf.dispatchFetch('https://aca.test/v1/status')).status).toBe(401);
  const day = new Date().toISOString().slice(0, 10);
  await db
    .prepare('UPDATE database_usage SET rows_written=60000 WHERE site=? AND day=?')
    .bind('test', day)
    .run();
  expect((await send(batch())).status).toBe(429);
  const response = await mf.dispatchFetch('https://aca.test/v1/status', {
    headers: { Authorization: 'Bearer ' + token },
  });
  expect(response.status).toBe(200);
  const status = (await response.json()) as { paused: boolean; protocol: number };
  expect(status.paused).toBe(true);
  expect(status.protocol).toBe(3);
  expect(JSON.stringify(status)).not.toContain(token);
  await db
    .prepare('UPDATE database_usage SET rows_written=0 WHERE site=? AND day=?')
    .bind('test', day)
    .run();
  const accepted = await db
    .prepare('SELECT accepted FROM health WHERE site=? AND day=?')
    .bind('test', day)
    .first<{ accepted: number }>();
  await db
    .prepare('UPDATE health SET accepted=1000 WHERE site=? AND day=?')
    .bind('test', day)
    .run();
  expect((await send(batch())).status).toBe(429);
  const capped = await mf.dispatchFetch('https://aca.test/v1/status', {
    headers: { Authorization: 'Bearer ' + token },
  });
  expect(((await capped.json()) as { paused: boolean }).paused).toBe(true);
  await db
    .prepare('UPDATE health SET accepted=? WHERE site=? AND day=?')
    .bind(accepted?.accepted || 0, 'test', day)
    .run();
});
it('resumes multi-page summaries within free-tier query limits and never publishes a failed generation', async () => {
  const day = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 70; i++) {
    expect(
      (
        await send(
          batch({
            content: 'paged-summary',
            active: 10000,
            buckets: [10000, ...Array(19).fill(0)],
            sections: { introduction: 10000 },
            events: [
              {
                id: crypto.randomUUID(),
                action: 'copy',
                target: 'source-' + (i % 17),
                surface: 'code',
                rank: 0,
                value: 0,
              },
            ],
          }),
        )
      ).status,
    ).toBe(200);
  }
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const meter = meterDatabase(db);
    await advanceSummary(meter.db, 'test', day, Date.now());
    expect(meter.counts().statements).toBeLessThan(40);
    const job = await db
      .prepare('SELECT state FROM summary_jobs WHERE site=? AND day=?')
      .bind('test', day)
      .first<{ state: string }>();
    if (job && JSON.parse(job.state).phase === 'commit') {
      ready = true;
      break;
    }
  }
  expect(ready).toBe(true);
  const query = new URL('https://aca.test/?from=' + day + '&to=' + day + '&content=paged-summary');
  const previous = await analyticsReport(db, 'test', 'overview', query);
  expect(previous.series[0].views).toBe(0);
  const failing: D1Database = {
    ...db,
    prepare(sql) {
      if (sql.startsWith('INSERT INTO summaries')) throw new Error('Interrupted before commit');
      return db.prepare(sql);
    },
    batch: (items) => db.batch(items),
    exec: (sql) => db.exec(sql),
  };
  await expect(advanceSummary(failing, 'test', day)).rejects.toThrow('Interrupted before commit');
  expect((await analyticsReport(db, 'test', 'overview', query)).series[0].views).toBe(0);
  expect(await advanceSummary(db, 'test', day)).toBe(true);
  const completed = await analyticsReport(db, 'test', 'overview', query);
  expect(completed.series[0].views).toBe(70);
  expect(completed.series[0].active).toBe(700);
  expect(
    (
      await db
        .prepare(
          'SELECT SUM(count) AS n FROM daily_events WHERE content=? AND refreshed_at=(SELECT refreshed_at FROM summaries WHERE site=? AND day=?)',
        )
        .bind('paged-summary', 'test', day)
        .first<{ n: number }>()
    )?.n,
  ).toBe(70);
});
it('distinguishes a jump to the end, an unobserved body and a completed read in retention summaries', async () => {
  const content = 'retention-cases',
    day = new Date().toISOString().slice(0, 10);
  for (const patch of [
    { active: 10000, buckets: [10000, ...Array(19).fill(0)], end: true },
    { active: 10000, buckets: Array(20).fill(0), end: false },
    { active: 20000, buckets: Array(20).fill(1000), end: true },
  ])
    expect((await send(batch({ content, ...patch }))).status).toBe(200);
  let committed = false;
  for (let i = 0; i < 60; i++)
    if (await advanceSummary(db, 'test', day)) {
      committed = true;
      break;
    }
  expect(committed).toBe(true);
  const row = await db
    .prepare(
      'SELECT completed,qualified,retention FROM daily WHERE site=? AND day=? AND content=? AND refreshed_at=(SELECT refreshed_at FROM summaries WHERE site=? AND day=?)',
    )
    .bind('test', day, content, 'test', day)
    .first<{ completed: number; qualified: number; retention: string }>();
  expect(row?.completed).toBe(1);
  expect(row?.qualified).toBe(3);
  const buckets = JSON.parse(row!.retention) as { dropoffs: number }[];
  expect(buckets.reduce((sum, bucket) => sum + bucket.dropoffs, 0)).toBe(1);
  expect(buckets[0].dropoffs).toBe(1);
});
it('validates Access signature, issuer, audience, expiry and the explicit admin allowlist', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256'),
    jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  const resolver = createLocalJWKSet({ keys: [jwk] });
  const config = {
    ACCESS_TEAM: 'test-team',
    ACCESS_AUD: 'audience',
    ACCESS_ADMINS: 'admin@example.com',
  };
  const jwt = await new SignJWT({ email: 'admin@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://test-team.cloudflareaccess.com')
    .setAudience('audience')
    .setSubject('admin')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
  const request = new Request('https://prototype.example/admin/', {
    headers: { 'Cf-Access-Jwt-Assertion': jwt },
  });
  expect((await verifyAdmin(request, config, resolver)).email).toBe('admin@example.com');
  await expect(
    verifyAdmin(request, { ...config, ACCESS_AUD: 'wrong' }, resolver),
  ).rejects.toThrow();
  await expect(
    verifyAdmin(request, { ...config, ACCESS_ADMINS: 'someone@example.com' }, resolver),
  ).rejects.toThrow();
  await expect(
    verifyAdmin(new Request('https://prototype.example'), config, resolver),
  ).rejects.toThrow();
  await expect(verifyAdmin(request, { ...config, ACCESS_TEAM: '' }, resolver)).rejects.toThrow();
});

it('commits bounded audience and vital summaries, paginates visits and keeps raw addresses out', async () => {
  const content = 'audience-details',
    day = new Date().toISOString().slice(0, 10);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const view = crypto.randomUUID();
    ids.push(view);
    const response = await send(
      batch({
        version: 2,
        view,
        content,
        audience: { viewport: 'small', cores: '5–8' },
        active: 15000,
        events: [
          {
            id: crypto.randomUUID(),
            action: 'vital',
            target: 'LCP',
            surface: '',
            rank: 0,
            value: 1000 + i * 1000,
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    await db
      .prepare('UPDATE views SET audience=? WHERE site=? AND id=?')
      .bind(
        JSON.stringify({
          country: 'JP',
          region: 'Tokyo',
          city: 'Tokyo',
          latitude: 35.68,
          longitude: 139.65,
          browser: 'Safari 18',
          os: 'iOS',
          device: 'phone',
        }),
        'test',
        view,
      )
      .run();
  }
  const url = new URL(`https://aca.test/?from=${day}&to=${day}&content=${content}`);
  expect((await analyticsReport(db, 'test', 'geography', url)).rows).toHaveLength(0);
  let committed = false;
  for (let i = 0; i < 150; i++)
    if (await advanceSummary(db, 'test', day)) {
      committed = true;
      break;
    }
  expect(committed).toBe(true);
  const geo = await analyticsReport(db, 'test', 'geography', url);
  expect(geo.rows).toEqual([
    expect.objectContaining({
      country: 'JP',
      city: 'Tokyo',
      views: 3,
      qualified: 3,
      activeMs: 45000,
    }),
  ]);
  const devices = await analyticsReport(db, 'test', 'technology', url);
  expect(devices.rows).toContainEqual(
    expect.objectContaining({ dimension: 'browser', value: 'Safari 18', views: 3 }),
  );
  const quality = await analyticsReport(db, 'test', 'quality', url);
  expect(quality.rows.find((r) => r.metric === 'LCP')).toMatchObject({
    percentileSamples: 3,
    p75: expect.any(Number),
  });
  const visits = await analyticsReport(db, 'test', 'visits', url);
  expect(visits.rows).toHaveLength(3);
  expect(visits.rows[0]).toMatchObject({ country: 'JP', device: 'phone', history: 'anonymous' });
  expect(JSON.stringify(visits)).not.toContain('CF-Connecting-IP');
  expect(JSON.stringify(visits)).not.toContain(token);
  url.searchParams.set('cursor', 'not-valid-json');
  await expect(analyticsReport(db, 'test', 'visits', url)).rejects.toThrow('cursor');
});

it('keeps consented returning-browser history alongside daily network estimates', async () => {
  const day = new Date().toISOString().slice(0, 10),
    visitor = crypto.randomUUID(),
    view = crypto.randomUUID(),
    content = 'coexisting-history';
  expect(
    (
      await send(
        batch({ view, visitor, consent: 'opt-in', content, active: 12000, networkEstimate: true }),
        undefined,
        {
          'CF-Connecting-IP': '192.0.2.42',
        },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await send(batch({ content, active: 12000, networkEstimate: true }), undefined, {
        'CF-Connecting-IP': '192.0.2.43',
      })
    ).status,
  ).toBe(200);
  const row = await db
    .prepare('SELECT visitor FROM views WHERE id=?')
    .bind(view)
    .first<{ visitor: string }>();
  const previous = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await db
    .prepare('UPDATE visitors SET first_day=?,days=? WHERE site=? AND id=?')
    .bind(previous, JSON.stringify([previous, day]), 'test', row!.visitor)
    .run();
  let committed = false;
  for (let i = 0; i < 200; i++)
    if (await advanceSummary(db, 'test', day)) {
      committed = true;
      break;
    }
  expect(committed).toBe(true);
  const url = new URL(`https://aca.test/?from=${day}&to=${day}&content=${content}`);
  const overview = await analyticsReport(db, 'test', 'overview', url, Date.now(), true, true);
  expect(overview.metrics).toContainEqual(
    expect.objectContaining({ label: 'Opt-in unique browsers', value: 1 }),
  );
  expect(overview.series[0]).toMatchObject({ visitors: 1, networks: expect.any(Number) });
  const audience = await analyticsReport(db, 'test', 'audience', url, Date.now(), true, true);
  expect(audience.historyMode).toBe('optional-consent');
  expect(audience.metrics).toContainEqual(
    expect.objectContaining({ label: 'Returning browsers', value: 1 }),
  );
});
it('paginates raw visit markers without gaps or returning private identifiers', async () => {
  const content = 'paged-visits',
    day = new Date().toISOString().slice(0, 10),
    ids = new Set<string>();
  for (let i = 0; i < 105; i++) {
    const view = crypto.randomUUID();
    ids.add(view);
    expect((await send(batch({ view, content }))).status).toBe(200);
  }
  const url = new URL(`https://aca.test/?from=${day}&to=${day}&content=${content}`);
  const first = await analyticsReport(db, 'test', 'visits', url);
  expect(first.rows).toHaveLength(100);
  expect(first.nextCursor).toBeTruthy();
  url.searchParams.set('cursor', first.nextCursor!);
  const next = await analyticsReport(db, 'test', 'visits', url);
  expect(next.rows).toHaveLength(5);
  expect(next.nextCursor).toBeNull();
  expect(new Set([...first.rows, ...next.rows].map((r) => r.visit))).toEqual(ids);
  expect(Object.keys(first.rows[0])).not.toContain('visitor');
});
