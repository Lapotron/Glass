import { beforeEach, afterEach, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Store } from '../src/engine/store.js';
import { buildSite } from '../src/engine/build.js';
import { BackupService } from '../src/engine/backup.js';
import { createApp } from '../src/server/app.js';
import {
  ConnectionSettings,
  LauncherSettings,
  resolveLaunchOptions,
  redactSecrets,
} from '../src/server/configuration.js';
import { createRunner, JobService } from '../src/server/publishing.js';
import {
  contrastRatio,
  contrastAgainstBounds,
  contrastPreset,
  mergeContrast,
  resolveContrast,
  textRoles,
} from '../src/shared/contrast.js';
import { parseReaderPreferences } from '../src/shared/reader-preferences.js';
import { themeVariables } from '../src/shared/theme.js';
import { themeSchema } from '../src/shared/contracts.js';
let root: string, install: string, store: Store, assets: string;
const secrets = {
  cloudflareApiToken: 'cloudflare-canary-private-12345',
  r2AccessKeyId: 'r2-access-canary-12345',
  r2SecretAccessKey: 'r2-secret-canary-private-12345',
};
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-contrast-'));
  install = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-install-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
  assets = path.join(root, 'assets-fixture');
  await fs.mkdir(assets);
  for (const file of ['site.js', 'site.css', 'appearance.js', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, file), '/* fixture */');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(install, { recursive: true, force: true });
});
it('calculates contrast without overlooking matching intermediate image colors', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBe(21);
  expect(contrastAgainstBounds('#777777', ['#000000', '#ffffff'])).toBe(1);
  expect(contrastAgainstBounds('#ffffff', ['#111111', '#444444'])).toBeCloseTo(
    contrastRatio('#ffffff', '#444444'),
  );
});
it('defaults legacy site washes to Automatic and retains fixed washes through site saves', async () => {
  const original = await store.read();
  expect(original.site.theme.wallpaperWash).toBe('auto');
  for (const wallpaperWash of ['light', 'dark', 'auto'] as const) {
    const current = await store.read();
    await store.saveJson(
      'site',
      { ...current.site, theme: { ...current.site.theme, wallpaperWash } },
      current.siteRevision,
    );
    expect((await store.read()).site.theme.wallpaperWash).toBe(wallpaperWash);
  }
  expect(themeSchema.safeParse({ wallpaperWash: 'arbitrary CSS' }).success).toBe(false);
});
it('keeps fixed wallpaper washes independent of theme while protecting the themed surfaces', async () => {
  const { site } = await store.read();
  for (const background of ['sky', 'sand', 'mist'] as const)
    for (const mode of ['light', 'dark'] as const)
      for (const wallpaperWash of ['auto', 'light', 'dark'] as const)
        for (const wallpaperDim of [0, 0.35, 0.8]) {
          const theme = {
            ...site.theme,
            background,
            backgroundImage: '/media/coast-dusk.svg',
            wallpaperWash,
            wallpaperDim,
            glassOpacity: 1,
            readingOpacity: 1,
          };
          const result = resolveContrast(theme, mode);
          const washMode = wallpaperWash === 'auto' ? mode : wallpaperWash;
          expect(result.washTint === '16 20 30').toBe(washMode === 'dark');
          expect(result.wash).toBe(wallpaperDim);
          expect(result.glassOpacity).toBeGreaterThanOrEqual(theme.contrast.glassFloor);
          expect(result.readingOpacity).toBe(1);
          for (const role of textRoles)
            expect(
              result.ratios[role],
              `${mode}/${wallpaperWash}/${background}/${wallpaperDim}/${role}`,
            ).toBeGreaterThanOrEqual(role === 'body' || role === 'heading' ? 7 : 4.5);
          expect(themeVariables(theme)[`--wallpaper-wash-tint-${mode}`]).toBe(result.washTint);
          expect(themeVariables(theme)[`--wallpaper-dim`]).toBe(wallpaperDim);
          expect(
            Object.keys(themeVariables(theme)).some((key) => key.startsWith('--protected-wash')),
          ).toBe(false);
        }
});
it('protects all text roles across both appearances, atmospheres, image extremes and presets', async () => {
  const { site } = await store.read();
  for (const mode of ['light', 'dark'] as const)
    for (const background of ['sky', 'sand', 'mist'] as const)
      for (const preset of ['balanced', 'high'] as const)
        for (const image of ['', '/media/coast-dusk.svg']) {
          const result = resolveContrast(
            {
              ...site.theme,
              contrast: contrastPreset(preset),
              background,
              backgroundImage: image,
              wallpaperDim: 0,
              glassOpacity: 1,
              readingOpacity: 1,
            },
            mode,
          );
          for (const role of textRoles)
            expect(
              result.ratios[role],
              `${mode}/${background}/${preset}/${role}`,
            ).toBeGreaterThanOrEqual(
              role === 'body' || role === 'heading' ? 7 : preset === 'high' ? 7 : 4.5,
            );
          if (image) {
            expect(result.wash).toBe(0);
            expect(result.glassOpacity).toBeGreaterThan(0);
            expect(result.readingOpacity).toBeGreaterThan(0);
          }
        }
});
it('keeps article tint independent of automatic and legacy reading floors', async () => {
  const { site } = await store.read();
  for (const mode of ['light', 'dark'] as const)
    for (const readingOpacity of [0, 0.2, 0.6, 1]) {
      const theme = {
        ...site.theme,
        backgroundImage: '/media/coast-dusk.svg',
        glassOpacity: 0.3,
        readingOpacity,
        wallpaperDim: 0,
        contrast: { ...site.theme.contrast, glassFloor: 1, readingFloor: 1 },
      };
      const result = resolveContrast(theme, mode);
      expect(result.readingOpacity).toBeCloseTo((mode === 'dark' ? 0.5 : 0.3) * readingOpacity);
      expect(result.glassOpacity).toBe(1);
      expect(themeVariables(theme)['--reading-opacity']).toBe(readingOpacity);
      expect(
        Object.keys(themeVariables(theme)).some((key) => key.startsWith('--protected-reading')),
      ).toBe(false);
      if (readingOpacity === 0)
        expect(result.ratios.body).toBeLessThan(theme.contrast.readingTarget);
    }
});
it('keeps exact manual colors and deep-merges only validated reader overrides', async () => {
  const { site } = await store.read();
  const prefs = parseReaderPreferences({
    version: 1,
    theme: {
      contrast: {
        automatic: false,
        readingFloor: 4,
        colors: {
          light: { body: '#778899', link: 'url(javascript:bad)' },
          dark: { body: '#aabbcc' },
        },
      },
    },
  });
  const base = mergeContrast(site.theme.contrast, { colors: { light: { heading: '#123456' } } });
  const merged = mergeContrast(base, prefs.theme.contrast);
  expect(merged.colors.light).toEqual({ heading: '#123456', body: '#778899' });
  expect(merged.readingFloor).toBe(0.68);
  expect(
    mergeContrast(base, { colors: { light: { heading: null } } }).colors.light.heading,
  ).toBeUndefined();
  expect(resolveContrast({ ...site.theme, contrast: merged }, 'light').colors.body).toBe('#778899');
  expect(themeVariables({ ...site.theme, contrast: merged })['--foreground-body-light']).toBe(
    '#778899',
  );
});
it('saves credentials privately with revision checks, explicit removal and environment fallback', async () => {
  const connections = new ConnectionSettings(root, {
    CLOUDFLARE_API_TOKEN: 'environment-token-12345',
  });
  const initial = await connections.summary();
  expect(initial.fields.cloudflareApiToken.source).toBe('environment');
  const saved = await connections.update({ revision: initial.revision, set: secrets });
  expect(JSON.stringify(saved)).not.toContain(secrets.cloudflareApiToken);
  expect(saved.fields.r2AccessKeyId.source).toBe('studio');
  expect((await connections.values()).CLOUDFLARE_API_TOKEN).toBe(secrets.cloudflareApiToken);
  expect((await fs.stat(path.join(root, '.studio/connections.json'))).mode & 0o777).toBe(0o600);
  await expect(
    connections.update({
      revision: initial.revision,
      set: { cloudflareApiToken: 'replacement-12345' },
    }),
  ).rejects.toThrow(/changed/);
  await expect(
    connections.update({ revision: saved.revision, remove: ['r2AccessKeyId'] }),
  ).rejects.toThrow(/both R2/);
  const removed = await connections.update({
    revision: saved.revision,
    remove: ['cloudflareApiToken', 'r2AccessKeyId', 'r2SecretAccessKey'],
  });
  expect(removed.fields.cloudflareApiToken.source).toBe('environment');
  expect(removed.fields.r2AccessKeyId.configured).toBe(false);
  await connections.importEnvironment(removed.revision);
  expect((await connections.summary()).fields.cloudflareApiToken.source).toBe('studio');
});
it('requires Studio tokens and returns credential status without echoing secrets', async () => {
  const app = await createApp(root, { watchFiles: false, connectionTest: async () => {} });
  try {
    const state = await (await app.app.request('http://127.0.0.1/api/connections')).json();
    const body = JSON.stringify({ revision: state.revision, set: secrets });
    expect(
      (
        await app.app.request('http://127.0.0.1/api/connections', {
          method: 'PUT',
          body,
          headers: { 'Content-Type': 'application/json' },
        })
      ).status,
    ).toBe(403);
    const response = await app.app.request('http://127.0.0.1/api/connections', {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'application/json', 'X-Studio-Token': app.token },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const exposed =
      (await response.text()) +
      (await (await app.app.request('http://127.0.0.1/api/bootstrap')).text());
    for (const value of Object.values(secrets)) expect(exposed).not.toContain(value);
    const denied = await app.app.request('http://127.0.0.1/api/connections', {
      method: 'PUT',
      body,
      headers: {
        'Content-Type': 'application/json',
        'X-Studio-Token': app.token,
        Origin: 'https://elsewhere.example',
      },
    });
    expect(denied.status).toBe(403);
  } finally {
    app.close();
  }
});
it('keeps credentials outside source snapshots, Pages artifacts and portable backups', async () => {
  const connections = new ConnectionSettings(root, {});
  await connections.update({ revision: (await connections.summary()).revision, set: secrets });
  const result = await buildSite(store, { assets });
  const backups = new BackupService(store),
    record = await backups.create();
  const archive = gunzipSync(await backups.download(record.id)).toString();
  const decodedBackup = (JSON.parse(archive).files as { data: string }[])
    .map((file) => Buffer.from(file.data, 'base64').toString())
    .join('\n');
  const snapshot = await fs.readFile(
    path.join(root, '.studio/builds', result.id, 'source.json'),
    'utf8',
  );
  const publicFiles = (
    await Promise.all(result.manifest.map((file) => fs.readFile(path.join(result.outputDir, file))))
  ).join('\n');
  for (const value of Object.values(secrets)) {
    expect(archive + decodedBackup + snapshot + publicFiles).not.toContain(value);
  }
  expect(archive).not.toContain('connections.json');
});
it('preserves a credential snapshot through rotation and redacts failed publishing logs', async () => {
  const model = await store.read();
  await store.saveJson(
    'site',
    {
      ...model.site,
      url: 'https://journal.example.net',
      cloudflare: { ...model.site.cloudflare, accountId: 'a'.repeat(32), projectName: 'journal' },
      mediaDelivery: { ...model.site.mediaDelivery, mode: 'pages' },
    },
    model.siteRevision,
  );
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((resolve) => (entered = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve));
  const jobs = new JobService(
    store,
    async (args, _account, onLog, credentials) => {
      expect(credentials?.CLOUDFLARE_API_TOKEN).toBe(secrets.cloudflareApiToken);
      if (args.includes('list')) return { code: 0, stdout: '[{"name":"journal"}]', stderr: '' };
      onLog?.(secrets.r2SecretAccessKey);
      return { code: 1, stdout: '', stderr: secrets.cloudflareApiToken };
    },
    async (s, options) => {
      entered();
      await gate;
      return buildSite(s, { ...options, assets });
    },
  );
  await jobs.initialize();
  await jobs.connections.update({
    revision: (await jobs.connections.summary()).revision,
    set: secrets,
  });
  const job = jobs.start('publish');
  await ready;
  await jobs.connections.update({
    revision: (await jobs.connections.summary()).revision,
    set: { cloudflareApiToken: 'rotated-cloudflare-12345' },
  });
  release();
  const result = await jobs.waitFor(job.id);
  expect(result.state).toBe('failed');
  expect(result.error).toContain('[redacted]');
  const journal = await fs.readFile(path.join(root, '.studio/jobs', job.id + '.json'), 'utf8');
  for (const value of Object.values(secrets)) expect(journal).not.toContain(value);
});
it('redacts command output split across chunks and limits credentials passed to Wrangler', async () => {
  const bin = path.join(install, 'node_modules/wrangler/bin');
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(
    path.join(bin, 'wrangler.js'),
    `const token=process.env.CLOUDFLARE_API_TOKEN;process.stdout.write(token.slice(0,9));setTimeout(()=>{process.stdout.write(token.slice(9)+'\\n');process.stderr.write('Bearer '+token+'\\n');process.stdout.write(String(process.env.R2_SECRET_ACCESS_KEY));},5);`,
  );
  const runner = createRunner(install, async () => ({
    CLOUDFLARE_API_TOKEN: secrets.cloudflareApiToken,
    R2_SECRET_ACCESS_KEY: secrets.r2SecretAccessKey,
  }));
  const logs: string[] = [];
  const result = await runner([], undefined, (line) => logs.push(line));
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('[redacted]');
  expect(result.stdout).toContain('undefined');
  expect(JSON.stringify(result) + logs.join('')).not.toContain(secrets.cloudflareApiToken);
  expect(
    redactSecrets(secrets.r2SecretAccessKey, { R2_SECRET_ACCESS_KEY: secrets.r2SecretAccessKey }),
  ).toBe('[redacted]');
});
it('applies validated startup choices only on the next launch and supports explicit overrides', async () => {
  const active = { port: 4310, notebookRoot: root },
    launcher = new LauncherSettings(install, active);
  const first = await launcher.summary();
  await launcher.update({ port: 4409, notebookRoot: root }, first.revision);
  const pending = await launcher.summary();
  expect(pending.active).toEqual(active);
  expect(pending.restartRequired).toBe(true);
  expect((await resolveLaunchOptions([], { PORT: '4450', BLOG_ROOT: install }, install)).port).toBe(
    4409,
  );
  const explicit = await resolveLaunchOptions(
    ['--port', '4460', 'build', '--root', root],
    {},
    install,
  );
  expect(explicit.port).toBe(4460);
  expect(explicit.args).toEqual(['build']);
  await expect(
    launcher.update({ port: 22, notebookRoot: root }, pending.revision),
  ).rejects.toThrow();
  await expect(
    launcher.update({ port: 4409, notebookRoot: install }, pending.revision),
  ).rejects.toThrow(/notebook folder/);
  await expect(launcher.update(active, first.revision)).rejects.toThrow(/changed/);
});
it('serves installed Studio assets when the notebook lives in another folder', async () => {
  await fs.mkdir(path.join(install, '.studio/console'), { recursive: true });
  await fs.writeFile(path.join(install, '.studio/console/index.html'), '<h1>Installed Studio</h1>');
  const app = await createApp(root, {
    watchFiles: false,
    applicationRoot: install,
    activePort: 4455,
  });
  try {
    expect(await (await app.app.request('http://127.0.0.1/studio/')).text()).toContain(
      'Installed Studio',
    );
    const runtime = await (await app.app.request('http://127.0.0.1/api/runtime-settings')).json();
    expect(runtime.active).toEqual({ notebookRoot: root, port: 4455 });
  } finally {
    app.close();
  }
});
