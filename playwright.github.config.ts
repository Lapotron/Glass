import { defineConfig } from '@playwright/test';
import original from './playwright.config.js';
export default defineConfig({
  ...original,
  testMatch: 'github-pages.e2e.ts',
  testIgnore: [],
  outputDir: './test-results/github-pages',
  use: { ...original.use, baseURL: 'http://127.0.0.1:4396/Glass/' },
  webServer: {
    command: 'npx tsx scripts/test-github-pages.ts',
    url: 'http://127.0.0.1:4396/Glass/',
    timeout: 180000,
    reuseExistingServer: false,
  },
});
