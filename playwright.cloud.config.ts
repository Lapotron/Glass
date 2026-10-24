import { defineConfig } from '@playwright/test';
import original from './playwright.config.js';
export default defineConfig({
  ...original,
  testMatch: 'cloud-studio.e2e.ts',
  testIgnore: [],
  outputDir: './test-results/cloud',
  timeout: 120000,
  use: { ...original.use, baseURL: 'http://127.0.0.1:4398' },
  webServer: {
    command:
      'npm run cloud:build:studio > .studio/cloud-browser-build.log 2>&1 && npx tsx scripts/test-cloud-server.ts',
    url: 'http://127.0.0.1:4398/api/bootstrap',
    timeout: 120000,
    reuseExistingServer: false,
  },
});
