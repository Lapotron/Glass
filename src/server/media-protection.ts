import { z } from 'zod';
import path from 'node:path';
import { Store, ConflictError, digest } from '../engine/store.js';
import { PrivateSettings, type ConnectionSettings } from './configuration.js';
import type { SiteConfig } from '../shared/contracts.js';
import type { MediaProtectionReview, MediaProtectionStatus } from '../shared/media-protection.js';
type Rule = {
  id?: string;
  ref: string;
  action: string;
  expression: string;
  enabled: boolean;
  description: string;
  action_parameters?: { headers: Record<string, { operation: string; value: string }> };
};
type Ruleset = { id: string; version?: string; rules: Rule[] };
const phases = {
  index: 'http_response_headers_transform',
  embed: 'http_request_firewall_custom',
} as const;
const receiptSchema = z.object({
  appliedAt: z.string().default(''),
  target: z.string().default(''),
  rules: z
    .array(z.object({ zone: z.string(), phase: z.string(), id: z.string(), enabled: z.boolean() }))
    .default([]),
  state: z.enum(['idle', 'applying', 'verified', 'uncertain']).default('idle'),
});
type Capture = {
  site: SiteConfig;
  siteRevision: string;
  token: string;
  credential: string;
  target: string;
};
type Work = {
  zone: string;
  phase: string;
  rule: Rule;
  ruleset: Ruleset | null;
  fingerprint: string;
};
function sameRule(left: Rule | undefined, right: Rule) {
  const fields = (rule: Rule) => [
    rule.ref,
    rule.action,
    rule.expression,
    rule.enabled !== false,
    rule.description,
    Object.entries(rule.action_parameters?.headers || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, header]) => [name, header.operation, header.value]),
  ];
  return !!left && JSON.stringify(fields(left)) === JSON.stringify(fields(right));
}
const quote = (value: string) => JSON.stringify(value);
function targetKey(site: SiteConfig) {
  return digest(
    JSON.stringify({
      account: site.cloudflare.accountId,
      url: site.url,
      media: site.mediaDelivery,
      protection: site.mediaProtection,
    }),
  );
}
export function mediaProtectionExpressions(site: SiteConfig) {
  const host = new URL(site.url).hostname,
    cdn = site.mediaDelivery.mode === 'r2' ? new URL(site.mediaDelivery.publicOrigin).hostname : '';
  const siteMedia = `(http.host eq ${quote(host)} and (starts_with(http.request.uri.path,"/media/") or starts_with(http.request.uri.path,"/m/")))`;
  const cdnMedia = cdn
    ? `(http.host eq ${quote(cdn)} and starts_with(http.request.uri.path,${quote('/' + site.mediaDelivery.prefix + '/')}))`
    : '';
  const media = [siteMedia, cdnMedia].filter(Boolean).join(' or ');
  const assets = `(http.host eq ${quote(host)} and starts_with(http.request.uri.path,"/assets/"))`;
  const allowed = [...new Set([host, cdn, ...site.mediaProtection.allowedHosts].filter(Boolean))];
  const trusted = allowed.flatMap((host) =>
    ['https://', 'http://'].map(
      (protocol) => `starts_with(http.referer,${quote(protocol + host + '/')})`,
    ),
  );
  return {
    host,
    cdn,
    index: `(${assets} or ${media})`,
    embed: `(${media}) and http.request.method in {"GET" "HEAD"} and http.referer ne "" and not (${trusted.join(' or ')}) and not any(http.request.headers["sec-fetch-dest"][*] eq "document")`,
  };
}
/** Manage two narrowly scoped rules. Never replace a ruleset or retry a mutation. */
export class MediaProtectionService {
  private busy = false;
  private reviews = new Map<
    string,
    { public: MediaProtectionReview; capture: Capture; work: Work[]; expires: number }
  >();
  private receipt: PrivateSettings<z.infer<typeof receiptSchema>>;
  constructor(
    private store: Store,
    private connections: ConnectionSettings,
    private fetcher: typeof fetch = fetch,
  ) {
    this.receipt = new PrivateSettings(
      path.join(store.root, '.studio/cloud-media/protection.json'),
      receiptSchema,
    );
  }
  private async capture(): Promise<Capture> {
    const model = await this.store.snapshot(),
      token = (await this.connections.values()).CLOUDFLARE_API_TOKEN;
    if (!token || !model.site.cloudflare.accountId)
      throw new Error(
        'Save the Cloudflare account and API token before checking media protection.',
      );
    if (model.site.mediaDelivery.mode === 'r2' && !model.site.mediaDelivery.publicOrigin)
      throw new Error('Save the public media origin first.');
    return {
      site: model.site,
      siteRevision: model.siteRevision,
      token,
      credential: digest(token),
      target: targetKey(model.site),
    };
  }
  private async request<T>(
    capture: Capture,
    route: string,
    method = 'GET',
    body?: unknown,
    optional = false,
  ): Promise<T | null> {
    let response: Response;
    try {
      response = await this.fetcher('https://api.cloudflare.com/client/v4' + route, {
        method,
        headers: { Authorization: 'Bearer ' + capture.token, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(
        'Cloudflare media protection could not be reached. Check its current state before retrying.',
      );
    }
    if (optional && response.status === 404) return null;
    const data = (await response.json().catch(() => ({ success: false }))) as {
      success?: boolean;
      result: T;
      errors?: { code?: number }[];
    };
    if (!response.ok || !data.success) {
      const codes = (data.errors || [])
        .map((e) => e.code)
        .filter(Number.isSafeInteger)
        .join(', ');
      throw new Error(
        'Cloudflare media protection failed' +
          (codes ? ' (' + codes + ')' : '') +
          '. Check Zone Read and Transform Rules permissions; foreign-embed blocking also needs custom WAF rule permissions.',
      );
    }
    return data.result;
  }
  private async zone(capture: Capture, hostname: string) {
    const labels = hostname.split('.');
    while (labels.length >= 2) {
      const result = await this.request<{ id: string; name: string }[]>(
        capture,
        '/zones?name=' +
          encodeURIComponent(labels.join('.')) +
          '&account.id=' +
          encodeURIComponent(capture.site.cloudflare.accountId),
      );
      if (result?.length === 1 && /^[a-f0-9]{32}$/.test(result[0].id)) return result[0].id;
      labels.shift();
    }
    throw new Error(
      'No accessible Cloudflare zone for ' +
        hostname +
        '. Check the selected account and Zone Read permission.',
    );
  }
  async status(): Promise<MediaProtectionStatus> {
    const saved = await this.receipt.read(),
      site = (await this.store.snapshot()).site;
    return {
      appliedAt: saved.value.appliedAt,
      current: saved.value.state === 'verified' && saved.value.target === targetKey(site),
      rules: saved.value.rules,
    };
  }
  async check(): Promise<MediaProtectionReview> {
    if (this.busy) throw new ConflictError('Wait for media protection to finish applying.');
    const capture = await this.capture(),
      expressions = mediaProtectionExpressions(capture.site),
      ledger = await this.receipt.read();
    const zoneByHost = new Map<string, string>();
    for (const host of [...new Set([expressions.host, expressions.cdn].filter(Boolean))])
      zoneByHost.set(host, await this.zone(capture, host));
    const zones = [...new Set(zoneByHost.values())],
      work: Work[] = [];
    const owner = digest(new URL(capture.site.url).origin).slice(0, 12);
    for (const zone of zones)
      for (const kind of ['index', 'embed'] as const) {
        const enabled =
          kind === 'index'
            ? capture.site.mediaProtection.discourageIndexing
            : capture.site.mediaProtection.blockForeignEmbeds;
        const phase = phases[kind];
        if (!enabled && !ledger.value.rules.some((r) => r.zone === zone && r.phase === phase))
          continue;
        const ruleset = await this.request<Ruleset>(
          capture,
          `/zones/${zone}/rulesets/phases/${phase}/entrypoint`,
          'GET',
          undefined,
          true,
        );
        const ref = 'glass_' + owner + '_' + kind,
          existing = ruleset?.rules.find((rule) => rule.ref === ref);
        if (enabled) {
          let count = ruleset?.rules.filter((rule) => rule.enabled !== false).length || 0;
          if (kind === 'index')
            for (const extra of ['http_request_transform', 'http_request_late_transform']) {
              const set = await this.request<Ruleset>(
                capture,
                `/zones/${zone}/rulesets/phases/${extra}/entrypoint`,
                'GET',
                undefined,
                true,
              );
              count += set?.rules.filter((rule) => rule.enabled !== false).length || 0;
            }
          const limit = kind === 'index' ? 10 : 5;
          if (count - Number(existing?.enabled !== false && !!existing) + 1 > limit)
            throw new Error(
              'No free-tier ' +
                (kind === 'index' ? 'Transform' : 'WAF') +
                ' rule slot is available. Review existing rules; Glass will not upgrade the plan.',
            );
        }
        const hosts = [...zoneByHost]
          .filter(([, id]) => id === zone)
          .map(([host]) => `http.host eq ${quote(host)}`)
          .join(' or ');
        const rule: Rule = {
          ref,
          action: kind === 'index' ? 'rewrite' : 'block',
          expression: `(${hosts}) and (${expressions[kind]})`,
          enabled,
          description: 'Glass media ' + (kind === 'index' ? 'indexing' : 'foreign embeds'),
          ...(kind === 'index'
            ? {
                action_parameters: {
                  headers: { 'x-robots-tag': { operation: 'set', value: 'noindex' } },
                },
              }
            : {}),
        };
        work.push({
          zone,
          phase,
          rule: { ...rule, ...(existing?.id ? { id: existing.id } : {}) },
          ruleset,
          fingerprint: digest(JSON.stringify(ruleset)),
        });
      }
    const id = crypto.randomUUID(),
      revision = digest(
        JSON.stringify({ target: capture.target, credential: capture.credential, work }),
      );
    const result = {
      id,
      revision,
      checkedAt: new Date().toISOString(),
      changes: work
        .filter(
          (w) =>
            !sameRule(
              w.ruleset?.rules.find((r) => r.ref === w.rule.ref),
              w.rule,
            ),
        )
        .map((w) => ({
          zone: w.zone,
          phase: w.phase,
          enabled: w.rule.enabled,
          existing: !!w.rule.id,
        })),
    };
    if (this.reviews.size >= 5) this.reviews.clear();
    this.reviews.set(id, { public: result, capture, work, expires: Date.now() + 10 * 60000 });
    return result;
  }
  async apply(id: string, revision: string) {
    if (this.busy) throw new ConflictError('Wait for media protection to finish applying.');
    const review = this.reviews.get(id);
    if (!review || review.public.revision !== revision || review.expires < Date.now())
      throw new ConflictError('Media protection check expired. Check again before applying.');
    this.busy = true;
    try {
      const fresh = await this.capture();
      if (
        fresh.siteRevision !== review.capture.siteRevision ||
        fresh.credential !== review.capture.credential
      )
        throw new ConflictError('Site or credentials changed. Check media protection again.');
      for (const step of review.work) {
        const current = await this.request<Ruleset>(
          fresh,
          `/zones/${step.zone}/rulesets/phases/${step.phase}/entrypoint`,
          'GET',
          undefined,
          true,
        );
        if (digest(JSON.stringify(current)) !== step.fingerprint)
          throw new ConflictError(
            'Cloudflare rules changed. Check again to preserve those changes.',
          );
      }
      // Every attempt needs a fresh read-only review, including uncertain responses.
      this.reviews.delete(id);
      let ledger = await this.receipt.read();
      ledger = await this.receipt.save(
        { ...ledger.value, state: 'applying', target: fresh.target },
        ledger.revision,
      );
      for (const step of review.work) {
        const { id: ruleId, ...rule } = step.rule;
        let applied: Rule | null;
        const existing = step.ruleset?.rules.find((r) => r.ref === rule.ref);
        if (sameRule(existing, rule)) applied = existing!;
        else if (!step.ruleset) {
          if (!rule.enabled) continue;
          const result = await this.request<Ruleset>(
            fresh,
            `/zones/${step.zone}/rulesets`,
            'POST',
            { name: 'Glass media protection', kind: 'zone', phase: step.phase, rules: [rule] },
          );
          applied = result?.rules.find((r) => r.ref === rule.ref) || null;
        } else {
          const result = await this.request<Ruleset>(
            fresh,
            `/zones/${step.zone}/rulesets/${step.ruleset.id}/rules` + (ruleId ? '/' + ruleId : ''),
            ruleId ? 'PATCH' : 'POST',
            rule,
          );
          applied = result?.rules?.find((r) => r.ref === rule.ref) || null;
        }
        if (!applied?.id)
          throw new Error(
            'Cloudflare did not confirm the protection rule. Check again before retrying.',
          );
        const saved = { zone: step.zone, phase: step.phase, id: applied.id, enabled: rule.enabled };
        ledger = await this.receipt.save(
          {
            ...ledger.value,
            rules: [
              ...ledger.value.rules.filter(
                (r) => !(r.zone === step.zone && r.phase === step.phase),
              ),
              saved,
            ],
          },
          ledger.revision,
        );
      }
      if (fresh.site.mediaProtection.discourageIndexing) {
        const probes = [
          new URL('/assets/reader-assets.json', fresh.site.url).href,
          ...(fresh.site.mediaDelivery.mode === 'r2'
            ? [
                new URL(
                  '/' + fresh.site.mediaDelivery.prefix + '/.glass-protection-check',
                  fresh.site.mediaDelivery.publicOrigin,
                ).href,
              ]
            : []),
        ];
        for (const url of probes) {
          const response = await this.fetcher(url, {
            method: 'HEAD',
            redirect: 'manual',
            signal: AbortSignal.timeout(15000),
          });
          if (
            !response.headers
              .get('x-robots-tag')
              ?.split(/\s*,\s*/)
              .includes('noindex')
          )
            throw new Error(
              'Cloudflare saved the rules, but public indexing headers are not verified yet. Check again before retrying.',
            );
        }
      }
      if (fresh.site.mediaProtection.blockForeignEmbeds) {
        const url = new URL('/media/.glass-protection-check', fresh.site.url).href;
        const blocked = await this.fetcher(url, {
          method: 'HEAD',
          headers: { Referer: 'https://foreign-embed.invalid/', 'Sec-Fetch-Dest': 'image' },
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        });
        const allowed = await this.fetcher(url, {
          method: 'HEAD',
          headers: { Referer: fresh.site.url.replace(/\/$/, '') + '/', 'Sec-Fetch-Dest': 'image' },
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        });
        if (blocked.status !== 403 || allowed.status === 403)
          throw new Error(
            'Cloudflare saved the rules, but foreign-embed behavior has not been verified. Check again before retrying.',
          );
      }
      await this.receipt.save(
        { ...ledger.value, state: 'verified', appliedAt: new Date().toISOString() },
        ledger.revision,
      );
      this.reviews.delete(id);
      return this.status();
    } catch (error) {
      const ledger = await this.receipt.read();
      if (ledger.value.state === 'applying')
        await this.receipt.save({ ...ledger.value, state: 'uncertain' }, ledger.revision);
      throw error;
    } finally {
      this.busy = false;
    }
  }
}
