import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';
const args = process.argv.slice(2);
const option = (key: string, fallback: string) =>
  args.includes(key) ? args[args.indexOf(key) + 1] || fallback : fallback;
const base = new URL(option('--url', 'http://127.0.0.1:4173'));
if (!['127.0.0.1', 'localhost'].includes(base.hostname))
  throw new Error('Reader benchmarks use a local production preview.');
const label = option('--label', 'optimized');
if (!/^[a-z-]+$/.test(label)) throw new Error('Invalid report label.');
const requestedRuns = Number(option('--runs', '3'));
if (!Number.isInteger(requestedRuns) || requestedRuns < 1 || requestedRuns > 5)
  throw new Error('Choose between one and five benchmark runs.');
const runs = requestedRuns;
const profile = option('--profile', 'desktop');
if (!['desktop', 'mobile'].includes(profile)) throw new Error('Choose desktop or mobile.');
const mobile = profile === 'mobile';
const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
const searchResponse = await fetch(new URL('/search.json', base));
if (!searchResponse.ok) throw new Error('Build the site before benchmarking its article routes.');
const search = (await searchResponse.json()) as { url: string }[];
const showcase = search.find((entry) => entry.url.endsWith('/component-showcase/'));
const article = search.find((entry) => entry !== showcase);
const routes = ['/', ...[article, showcase].flatMap((entry) => (entry ? [entry.url] : []))];
const browser = await chromium.launch({ headless: true });
const records: object[] = [];
try {
  for (const route of routes) {
    for (let run = 1; run <= runs; run++) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        isMobile: mobile,
        hasTouch: mobile,
        serviceWorkers: 'block',
      });
      await context.route('**/*', (request) =>
        new URL(request.request().url()).origin === base.origin
          ? request.continue()
          : request.abort(),
      );
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      await session.send('Emulation.setCPUThrottlingRate', { rate: mobile ? 4 : 1 });
      await session.send('Network.enable');
      await session.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: mobile ? 150 : 40,
        downloadThroughput: mobile ? 200000 : 1250000,
        uploadThroughput: mobile ? 93750 : 625000,
      });
      await page.addInitScript(() => {
        const metrics = ((window as any).__readerMetrics = {
          lcp: 0,
          cls: 0,
          longTasks: [] as number[],
        });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) metrics.lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as any[])
            if (!entry.hadRecentInput) metrics.cls += entry.value;
        }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) metrics.longTasks.push(entry.duration);
        }).observe({ type: 'longtask', buffered: true });
      });
      const resources: Promise<{ file: string; bytes: number; gzip: number }>[] = [];
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if (response.ok() && /\.(?:js|css)(?:\?|$)/.test(response.url()))
          resources.push(
            response.body().then((body) => ({
              file: new URL(response.url()).pathname,
              bytes: body.length,
              gzip: gzipSync(body).length,
            })),
          );
      });
      await page.goto(new URL(route, base).href, { waitUntil: 'networkidle', timeout: 60000 });
      const initial = resources.length;
      const initialMetrics = await page.evaluate(() => (window as any).__readerMetrics);
      for (const node of await page.locator('[data-interactive],.diagram,.md-tabs').all()) {
        if (await node.isVisible()) {
          await node.scrollIntoViewIfNeeded();
          await page.waitForTimeout(150);
        }
      }
      if (await page.locator('[data-interactive]').count())
        await page.waitForFunction(() =>
          [...document.querySelectorAll<HTMLElement>('[data-interactive]')].every(
            (node) => node.dataset.enhanced === 'true',
          ),
        );
      if (await page.locator('[data-mermaid]').count())
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll('[data-mermaid]')].every((node) =>
              node.querySelector('svg'),
            ),
          { timeout: 30000 },
        );
      await page.waitForLoadState('networkidle');
      const files = await Promise.all(resources);
      const metrics = await page.evaluate(() => (window as any).__readerMetrics);
      let chartFirstInteractionMs: number | undefined, chartAdditionalGzip: number | undefined;
      if (args.includes('--charts') && (await page.locator('[data-interactive="chart"]').count())) {
        const chart = page.locator('[data-interactive="chart"]').first();
        const started = Date.now();
        await chart.locator('.chart-viewport').focus();
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLElement>('[data-interactive="chart"]')?.dataset
              .chartReady === 'true',
        );
        await chart.locator('.chart-viewport').press('Home');
        chartFirstInteractionMs = Date.now() - started;
        await page.waitForLoadState('networkidle');
        const withCharts = await Promise.all(resources);
        chartAdditionalGzip = withCharts
          .slice(files.length)
          .reduce((sum, file) => sum + file.gzip, 0);
      }
      const record = {
        route,
        run,
        initialFiles: initial,
        totalFiles: files.length,
        initialGzip: files.slice(0, initial).reduce((n, file) => n + file.gzip, 0),
        totalGzip: files.reduce((n, file) => n + file.gzip, 0),
        initialLcpMs: initialMetrics.lcp,
        initialCls: initialMetrics.cls,
        cls: metrics.cls,
        longTaskCount: metrics.longTasks.length,
        longTaskMs: metrics.longTasks.reduce((a: number, b: number) => a + b, 0),
        chartFirstInteractionMs,
        chartAdditionalGzip,
        errors,
        files,
      };
      records.push(record);
      console.log(JSON.stringify({ ...record, files: undefined }));
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await fs.mkdir('.studio/reports', { recursive: true });
await fs.writeFile(
  `.studio/reports/reader-${label}.json`,
  JSON.stringify(
    {
      label,
      createdAt: new Date().toISOString(),
      profile,
      viewport: `${viewport.width}x${viewport.height}`,
      cpuSlowdown: mobile ? 4 : 1,
      network: mobile ? '1.6 Mbps / 150 ms' : '10 Mbps / 40 ms',
      runs,
      records,
    },
    null,
    2,
  ),
);
