import { bindings, defineConfig, defineWorker } from 'cf/config';
export default defineConfig({
  ...(process.env.CLOUDFLARE_ACCOUNT_ID ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
  worker: defineWorker({
    name: 'glass-dynamic-prototype',
    entrypoint: './worker/index.ts',
    compatibilityDate: '2026-10-12',
    compatibilityFlags: ['nodejs_compat'],
    assets: { notFoundHandling: 'none', runWorkerFirst: true },
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({ name: 'glass-dynamic-prototype' }),
      ACCESS_TEAM: bindings.text(process.env.GLASS_ACCESS_TEAM || ''),
      ACCESS_AUD: bindings.text(process.env.GLASS_ACCESS_AUD || ''),
      ACCESS_ADMINS: bindings.text(process.env.GLASS_ACCESS_ADMINS || 'me@example.com'),
    },
  }),
});
