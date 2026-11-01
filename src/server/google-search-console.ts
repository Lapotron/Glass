import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { PrivateSettings } from './configuration.js';
import { SearchConsoleService } from './search-console.js';
import { digest } from '../engine/store.js';

const scope = 'https://www.googleapis.com/auth/webmasters.readonly';
const secret = z.string().min(8).max(4096).regex(/^\S+$/);
const schema = z
  .object({
    clientId: z.string().max(500).optional(),
    clientSecret: secret.optional(),
    refreshToken: secret.optional(),
    property: z.string().max(500).optional(),
    autoSync: z.boolean().optional(),
    lastSync: z.string().optional(),
    pending: z
      .object({
        state: z.string(),
        verifier: z.string(),
        cookieHash: z.string(),
        actor: z.string(),
        origin: z.string(),
        expires: z.number(),
      })
      .optional(),
  })
  .strict();
const random = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
async function providerJson(response: Response, max = 1024 * 1024) {
  if (!response.ok || Number(response.headers.get('Content-Length') || 0) > max || !response.body)
    throw new Error('Google Search Console request failed. Check authorization and retry.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let size = 0,
    text = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) throw new Error('Google Search Console response exceeded its limit.');
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as Record<string, unknown>;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
function matchingProperty(property: string, siteOrigin: string) {
  const site = new URL(siteOrigin);
  if (property.startsWith('sc-domain:')) {
    const domain = property.slice('sc-domain:'.length).toLowerCase();
    return !!domain && (site.hostname === domain || site.hostname.endsWith('.' + domain));
  }
  try {
    const url = new URL(property);
    return url.origin === site.origin && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}
function laDay(now: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Optional, read-only OAuth integration. Provider tokens never appear in API responses. */
export class GoogleSearchConsole {
  private readonly settings: PrivateSettings<z.infer<typeof schema>>;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private root: string,
    private fetcher: typeof fetch = fetch,
  ) {
    this.settings = new PrivateSettings(
      path.join(root, '.studio/services/search-console-oauth.json'),
      schema,
    );
  }
  async status() {
    const { value, revision } = await this.settings.read();
    return {
      revision,
      configured: !!(value.clientId && value.clientSecret),
      connected: !!value.refreshToken,
      property: value.property || '',
      autoSync: !!value.autoSync,
      lastSync: value.lastSync || null,
    };
  }
  async configure(input: unknown, siteOrigin: string) {
    return this.exclusive(() => this.configureLocked(input, siteOrigin));
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.then(work);
    this.pending = next.catch(() => {});
    return next;
  }
  private async configureLocked(input: unknown, siteOrigin: string) {
    const data = z
      .object({
        revision: z.string(),
        clientId: z.string().max(500).optional(),
        clientSecret: secret.optional(),
        property: z.string().max(500).optional(),
        autoSync: z.boolean().optional(),
        disconnect: z.boolean().optional(),
        clearClient: z.boolean().optional(),
      })
      .strict()
      .parse(input);
    const previous = await this.settings.read(),
      value = { ...previous.value };
    if (data.clientId || data.clientSecret) {
      if (
        !data.clientId ||
        !/^[\w-]+\.apps\.googleusercontent\.com$/.test(data.clientId) ||
        !data.clientSecret
      )
        throw new Error('Enter a Google OAuth client ID and secret together.');
      value.clientId = data.clientId;
      value.clientSecret = data.clientSecret;
      delete value.refreshToken;
      delete value.property;
      delete value.pending;
      delete value.lastSync;
      value.autoSync = false;
    }
    if (data.disconnect) {
      delete value.refreshToken;
      delete value.property;
      delete value.pending;
      value.autoSync = false;
    }
    if (data.clearClient) {
      for (const key of [
        'clientId',
        'clientSecret',
        'refreshToken',
        'property',
        'pending',
        'lastSync',
      ] as const)
        delete value[key];
      value.autoSync = false;
    }
    if (data.property !== undefined) {
      if (
        !data.property ||
        !matchingProperty(data.property, siteOrigin) ||
        !(await this.properties(siteOrigin)).includes(data.property)
      )
        throw new Error('Choose a verified Search Console property for this site.');
      value.property = data.property;
    }
    if (data.autoSync !== undefined) {
      if (data.autoSync && (!value.refreshToken || !value.property))
        throw new Error('Connect Google and choose a property before automatic sync.');
      value.autoSync = data.autoSync;
    }
    await this.settings.save(value, data.revision);
    return this.status();
  }
  async start(origin: string, actor: string) {
    return this.exclusive(() => this.startLocked(origin, actor));
  }
  private async startLocked(origin: string, actor: string) {
    const previous = await this.settings.read();
    if (!previous.value.clientId || !previous.value.clientSecret)
      throw new Error('Save the Google OAuth client first.');
    const state = random(),
      verifier = random(),
      cookie = random();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    await this.settings.save(
      {
        ...previous.value,
        pending: {
          state,
          verifier,
          cookieHash: digest(cookie),
          actor,
          origin,
          expires: Date.now() + 600000,
        },
      },
      previous.revision,
    );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [key, value] of Object.entries({
      client_id: previous.value.clientId,
      redirect_uri: origin + '/api/search-console/oauth/callback',
      response_type: 'code',
      scope,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    }))
      url.searchParams.set(key, value);
    return { url: url.href, cookie };
  }
  async finish(origin: string, actor: string, state: string, cookie: string, code: string) {
    return this.exclusive(() => this.finishLocked(origin, actor, state, cookie, code));
  }
  private async finishLocked(
    origin: string,
    actor: string,
    state: string,
    cookie: string,
    code: string,
  ) {
    const previous = await this.settings.read(),
      pending = previous.value.pending;
    if (
      !pending ||
      pending.expires < Date.now() ||
      pending.origin !== origin ||
      pending.actor !== actor ||
      !equal(state, pending.state) ||
      !equal(digest(cookie), pending.cookieHash) ||
      !code ||
      code.length > 4096
    )
      throw new Error(
        'Google authorization expired or did not match this Studio session. Start again.',
      );
    const token = await providerJson(
      await this.fetcher('https://oauth2.googleapis.com/token', {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: previous.value.clientId!,
          client_secret: previous.value.clientSecret!,
          redirect_uri: origin + '/api/search-console/oauth/callback',
          code_verifier: pending.verifier,
          grant_type: 'authorization_code',
        }),
      }),
      65536,
    );
    if (
      typeof token.refresh_token !== 'string' ||
      !secret.safeParse(token.refresh_token).success ||
      typeof token.scope !== 'string' ||
      !token.scope.split(' ').includes(scope)
    )
      throw new Error(
        'Google did not grant offline read-only access. Reconnect and approve the requested permission.',
      );
    const value = { ...previous.value, refreshToken: token.refresh_token };
    delete value.pending;
    delete value.property;
    value.autoSync = false;
    await this.settings.save(value, previous.revision);
  }
  private async accessToken() {
    const { value } = await this.settings.read();
    if (!value.clientId || !value.clientSecret || !value.refreshToken)
      throw new Error('Connect Google Search Console first.');
    const result = await providerJson(
      await this.fetcher('https://oauth2.googleapis.com/token', {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: value.clientId,
          client_secret: value.clientSecret,
          refresh_token: value.refreshToken,
          grant_type: 'refresh_token',
        }),
      }),
      65536,
    );
    if (typeof result.access_token !== 'string' || !secret.safeParse(result.access_token).success)
      throw new Error('Google authorization could not be refreshed. Reconnect Google.');
    return result.access_token;
  }
  async properties(siteOrigin: string) {
    const token = await this.accessToken();
    const data = await providerJson(
      await this.fetcher('https://www.googleapis.com/webmasters/v3/sites', {
        headers: { Authorization: 'Bearer ' + token },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      }),
    );
    const entries = data.siteEntry ?? [];
    if (!Array.isArray(entries) || entries.length > 10000)
      throw new Error('Google returned an invalid property list.');
    return entries
      .flatMap((entry: any) =>
        typeof entry?.siteUrl === 'string' &&
        entry.permissionLevel !== 'siteUnverifiedUser' &&
        matchingProperty(entry.siteUrl, siteOrigin)
          ? [entry.siteUrl]
          : [],
      )
      .slice(0, 100);
  }
  async sync(siteOrigin: string, now = Date.now()) {
    return this.exclusive(() => this.syncLocked(siteOrigin, now));
  }
  private async syncLocked(siteOrigin: string, now: number) {
    const previous = await this.settings.read(),
      property = previous.value.property;
    if (!property || !matchingProperty(property, siteOrigin))
      throw new Error('Choose a verified Search Console property for this site.');
    const token = await this.accessToken();
    const today = laDay(now),
      to = new Date(Date.parse(today) - 3 * 86400000).toISOString().slice(0, 10),
      from = new Date(Date.parse(to) - 27 * 86400000).toISOString().slice(0, 10);
    const escaped = siteOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const body = {
      startDate: from,
      endDate: to,
      dimensions: ['date'],
      type: 'web',
      dataState: 'final',
      rowLimit: 1000,
      dimensionFilterGroups: [
        {
          filters: [
            { dimension: 'page', operator: 'includingRegex', expression: '^' + escaped + '/' },
          ],
        },
      ],
    };
    const result = await providerJson(
      await this.fetcher(
        'https://www.googleapis.com/webmasters/v3/sites/' +
          encodeURIComponent(property) +
          '/searchAnalytics/query',
        {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(20000),
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      ),
    );
    const rows =
      result.rows === undefined
        ? []
        : z
            .array(
              z
                .object({
                  keys: z.tuple([z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
                  clicks: z.number().int().nonnegative(),
                  impressions: z.number().int().nonnegative(),
                  position: z.number().nonnegative().optional(),
                })
                .passthrough(),
            )
            .max(1000)
            .parse(result.rows);
    if (rows.length) {
      const csv = [
        'Date,Clicks,Impressions,Position',
        ...rows.map((row) =>
          [row.keys[0], row.clicks, row.impressions, row.position ?? ''].join(','),
        ),
      ].join('\n');
      const service = new SearchConsoleService(this.root),
        review = await service.prepare(
          { source: csv, name: 'Google Search Console · finalized data', property, from, to },
          'google-api',
        );
      await service.commit(review.id);
    }
    await this.settings.save(
      { ...previous.value, lastSync: new Date(now).toISOString() },
      previous.revision,
    );
    return { from, to, rows: rows.length, noData: !rows.length, timezone: 'America/Los_Angeles' };
  }
}
