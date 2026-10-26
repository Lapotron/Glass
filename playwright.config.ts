import { defineConfig, devices } from '@playwright/test';
process.env.NO_PROXY = `${process.env.NO_PROXY || ''},127.0.0.1,localhost`;
process.env.no_proxy = process.env.NO_PROXY;
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  testIgnore: ['**/cloud-studio.e2e.ts', '**/github-pages.e2e.ts'],
  outputDir: './test-results/local',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4387',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
        launchOptions: { args: ['--no-proxy-server'] },
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: [
    {
      command: 'npm run build:console && npx tsx scripts/test-server.ts',
      url: 'http://127.0.0.1:4387/api/bootstrap',
      timeout: 120000,
      reuseExistingServer: false,
      env: { NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
    },
    {
      command: 'npx tsx scripts/test-pages.ts',
      url: 'http://127.0.0.1:4174/',
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        WRANGLER_SEND_METRICS: 'false',
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
      },
    },
  ],
});
