import { afterEach, beforeEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/engine/store.js';
import { googleAnalyticsSchema, siteSchema } from '../src/shared/contracts.js';
import { contentSecurityPolicy } from '../src/shared/security.js';
import { createRenderer } from '../src/site/pages.js';
import { buildSite } from '../src/engine/build.js';

let root: string, store: Store, assets: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-google-analytics-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  assets = path.join(root, 'asset-fixture');
  await fs.mkdir(assets);
  for (const file of ['site.js', 'site.css', 'appearance.js', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, file), '/* fixture */');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('defaults GA4 off without rewriting source and accepts only a public measurement ID', async () => {
  const before = await fs.readFile(path.join(store.content, 'site.json'), 'utf8');
  const model = await store.snapshot();
  expect(model.site.integrations.googleAnalytics).toEqual({
    enabled: false,
    measurementId: '',
    respectPrivacy: true,
    debugMode: false,
  });
  expect(await fs.readFile(path.join(store.content, 'site.json'), 'utf8')).toBe(before);
  expect(
    googleAnalyticsSchema.parse({ enabled: true, measurementId: ' g-abc1234567 ' }).measurementId,
  ).toBe('G-ABC1234567');
  for (const measurementId of [
    '',
    'UA-1234567',
    'GTM-123456',
    'GT-1234567',
    'G-<script>',
    'https://bad.test',
    'G-ABC?x=1',
  ])
    expect(
      googleAnalyticsSchema.safeParse({ enabled: true, measurementId }).success,
      measurementId,
    ).toBe(false);
  const configured = siteSchema.parse({
    ...model.site,
    integrations: {
      ...model.site.integrations,
      googleAnalytics: { enabled: true, measurementId: 'g-test123456', debugMode: true },
    },
  });
  await store.saveJson('site', configured, model.siteRevision);
  const saved = await store.snapshot();
  expect(saved.site.integrations.googleAnalytics).toEqual({
    enabled: true,
    measurementId: 'G-TEST123456',
    debugMode: true,
    respectPrivacy: true,
  });
  expect(saved.site.integrations.analytics).toEqual(model.site.integrations.analytics);
  expect(saved.entries).toEqual(model.entries);
});

it('keeps provider permissions conditional and omits tracking from preview and utility documents', async () => {
  const model = await store.snapshot();
  model.entries = model.entries.map((entry) => ({ ...entry, body: 'A useful paragraph.' }));
  expect(contentSecurityPolicy(model.site)).not.toContain('googletagmanager');
  model.site.integrations.googleAnalytics = googleAnalyticsSchema.parse({
    enabled: true,
    measurementId: 'G-TEST123456',
    debugMode: true,
  });
  const policy = contentSecurityPolicy(model.site);
  expect(policy).toContain('https://www.googletagmanager.com');
  expect(policy).toContain('https://*.google-analytics.com');
  expect(policy).toContain('https://*.google.com');
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy.match(/script-src [^;]+/)?.[0]).not.toContain("'unsafe-inline'");
  expect(policy).not.toContain('doubleclick');
  expect(policy).not.toContain('cloudflareinsights');
  const renderer = await createRenderer(model);
  expect(renderer.render('/')).toContain('data-google-analytics=');
  expect(renderer.render('/archive/')).toContain('G-TEST123456');
  expect(renderer.render('/settings/')).not.toContain('data-google-analytics');
  expect(renderer.render('/404.html')).not.toContain('G-TEST123456');
  const preview = await createRenderer(model, { preview: true });
  expect(preview.render('/')).not.toContain('data-google-analytics');
  expect(preview.render('/')).not.toContain('G-TEST123456');
});

it('builds GA4 output and removes the configuration and permissions after disabling it', async () => {
  const model = await store.snapshot();
  model.entries = model.entries.map((entry) => ({ ...entry, body: 'A useful paragraph.' }));
  model.site.integrations.googleAnalytics = googleAnalyticsSchema.parse({
    enabled: true,
    measurementId: 'G-TEST123456',
  });
  await buildSite(store, { model, assets });
  expect(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8')).toContain(
    'data-google-analytics=',
  );
  expect(await fs.readFile(path.join(root, 'dist/_headers'), 'utf8')).toContain(
    'www.googletagmanager.com',
  );
  model.site.integrations.googleAnalytics.enabled = false;
  await buildSite(store, { model, assets });
  expect(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8')).not.toContain(
    'G-TEST123456',
  );
  expect(await fs.readFile(path.join(root, 'dist/_headers'), 'utf8')).not.toContain(
    'googletagmanager',
  );
});
