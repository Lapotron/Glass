import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { siteSchema } from '../src/shared/contracts.js';
import { Store } from '../src/engine/store.js';
import { createRenderer } from '../src/site/pages.js';
import { contentSecurityPolicy } from '../src/shared/security.js';

it('supports Cloudflare-managed installation without requiring a manual token or changing legacy defaults', async () => {
  const site = JSON.parse(await fs.readFile('tests/fixtures/notebook/site.json', 'utf8'));
  const legacy = siteSchema.parse(site);
  expect(legacy.integrations.analytics.mode).toBe('manual');
  expect(legacy.integrations.analytics.enabled).toBe(false);
  const configured = (analytics: unknown) => ({
    ...legacy,
    integrations: { ...legacy.integrations, analytics },
  });
  expect(siteSchema.safeParse(configured({ enabled: true })).success).toBe(false);
  expect(siteSchema.safeParse(configured({ enabled: true, mode: 'managed' })).success).toBe(true);
  expect(siteSchema.safeParse(configured({ enabled: true, mode: 'unknown' })).success).toBe(false);
  expect(
    siteSchema.parse(configured({ enabled: true, token: 'a'.repeat(32) })).integrations.analytics
      .mode,
  ).toBe('manual');
});

it('permits the managed beacon in CSP without emitting a second loader or changing ACA', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-cloudflare-managed-'));
  try {
    await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
    const model = await new Store(root).snapshot();
    const aca = model.site.integrations.aca;
    model.entries = model.entries.map((entry) => ({ ...entry, body: 'A useful paragraph.' }));
    model.site = siteSchema.parse({
      ...model.site,
      integrations: { ...model.site.integrations, analytics: { enabled: true, mode: 'managed' } },
    });
    const policy = contentSecurityPolicy(model.site);
    expect(policy).toContain('https://static.cloudflareinsights.com');
    expect(policy).toContain('https://cloudflareinsights.com');
    expect(policy.match(/script-src [^;]+/)?.[0]).not.toContain("'unsafe-inline'");
    expect(model.site.integrations.aca).toEqual(aca);
    const renderer = await createRenderer(model);
    for (const route of ['/', '/archive/', '/settings/']) {
      const html = renderer.render(route);
      expect(html).not.toContain('data-analytics=');
      expect(html).not.toContain('beacon.min.js');
    }
    model.site.integrations.analytics.enabled = false;
    expect(contentSecurityPolicy(model.site)).not.toContain('cloudflareinsights.com');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
