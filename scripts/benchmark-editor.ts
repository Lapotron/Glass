/** Isolated browser typing benchmark; no author content or credentials enter a fixture. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { Store } from '../src/engine/store.js';
import { quicksortSource } from '../src/shared/pseudocode-authoring.js';

const exec = promisify(execFile),
  project = process.cwd(),
  args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1] || fallback;
};
const runs = Math.max(1, Math.min(5, Number(option('--runs', '3'))));
const baseline = option('--baseline', '');
const scenario = option('--scenario', 'mixed');
if (!['mixed', 'pseudocode'].includes(scenario)) throw new Error('Scenario must be mixed or pseudocode.');
const baseFiles = [
  'SourceEditor.tsx',
  'LivePreview.tsx',
  'source-analysis.ts',
  'source-analysis.worker.ts',
  'source-worker.ts',
  'source-components.ts',
  'source-components.css',
  'source-math.ts',
  'source-images.ts',
  'source-theme.ts',
  'source-workspace.css',
  'markdown-assistance.ts',
  'SourceMinimap.tsx',
];
const quantile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ||
  0;
function workload(count: number) {
  const rows = ['# Editor workload', '', 'An isolated source-editing workload.', ''];
  while (rows.length < count) {
    const index = rows.length;
    if (index % 120 < 5)
      rows.push('| Item | Value |', '| --- | ---: |', `| Row ${index} | ${index} |`, '');
    else if (index % 80 < 4)
      rows.push(
        '```typescript title="example.ts"',
        `const example${index}: number = ${index};`,
        '```',
        '',
      );
    else if (index % 24 < 4) rows.push('$$', `y_{${index}} = \\frac{x^2}{2} + ${index}`, '$$', '');
    else
      rows.push(
        `Source line ${index}: explain a useful idea with clear and carefully chosen words.`,
      );
  }
  return rows.join('\n') + (scenario === 'pseudocode' ? '\n\n```pseudo\n' + quicksortSource + '\nRET' : '\n');
}
async function variant(label: string, revision?: string) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-editor-benchmark-'));
  const application = path.join(temporary, 'application'),
    notebook = path.join(temporary, 'notebook');
  let server: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let serverLog = '';
  try {
    await fs.mkdir(application, { recursive: true });
    for (const name of ['src', 'scripts', 'docs'])
      await fs.cp(path.join(project, name), path.join(application, name), { recursive: true });
    for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts'])
      await fs.copyFile(path.join(project, name), path.join(application, name));
    await fs.symlink(
      path.join(project, 'node_modules'),
      path.join(application, 'node_modules'),
      'dir',
    );
    if (revision)
      for (const file of baseFiles) {
        const relative = 'src/console/' + file;
        const result = await exec('git', ['show', revision + ':' + relative], {
          cwd: project,
          maxBuffer: 4 * 1024 * 1024,
        });
        await fs.writeFile(path.join(application, relative), result.stdout);
      }
    await fs.cp(path.join(project, 'tests/fixtures/notebook'), path.join(notebook, 'content'), {
      recursive: true,
    });
    const store = new Store(notebook),
      model = await store.read();
    await store.saveJson(
      'site',
      {
        ...model.site,
        mediaDelivery: { ...model.site.mediaDelivery, mode: 'pages' },
        integrations: {
          ...model.site.integrations,
          comments: { ...model.site.integrations.comments, enabled: false },
          analytics: { ...model.site.integrations.analytics, enabled: false },
        },
      },
      model.siteRevision,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/(?:CLOUDFLARE|R2_|ACA_REPORT_TOKEN|GOOGLE_ANALYTICS)/.test(name),
      ),
    ) as Record<string, string>;
    env.NO_PROXY = '127.0.0.1,localhost';
    env.no_proxy = env.NO_PROXY;
    env.WRANGLER_SEND_METRICS = 'false';
    await exec(
      path.join(project, 'node_modules/.bin/vite'),
      ['build', '--config', path.join(application, 'vite.config.ts')],
      { cwd: application, env, maxBuffer: 4 * 1024 * 1024 },
    );
    const port = label === 'baseline' ? 4393 : 4394;
    server = spawn(
      path.join(project, 'node_modules/.bin/tsx'),
      ['src/server/index.ts', '--production', '--root', notebook, '--port', String(port)],
      { cwd: application, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    server.stdout?.on('data', (chunk) => {
      serverLog = (serverLog + String(chunk)).slice(-6000);
    });
    server.stderr?.on('data', (chunk) => {
      serverLog = (serverLog + String(chunk)).slice(-6000);
    });
    const origin = `http://127.0.0.1:${port}`;
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null) throw new Error(serverLog);
      if (
        await fetch(origin + '/api/bootstrap')
          .then((response) => response.ok)
          .catch(() => false)
      )
        break;
      if (attempt > 240) throw new Error('Benchmark server timed out. ' + serverLog);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    browser = await chromium.launch({ args: ['--no-proxy-server'] });
    const reports = [];
    for (const count of [5000, 20000]) {
      const entry = await store.create('posts', `Benchmark ${count}`, `benchmark-${count}`);
      const body = workload(count);
      await store.saveEntry(entry.id, {
        metadata: entry,
        body,
        revision: entry.revision,
      });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.goto(origin + '/studio/#writing');
      await page.locator('.managed-entry-open').filter({ hasText: entry.title }).click();
      await page.getByRole('button', { name: 'Write', exact: true }).click();
      const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
      await editor.waitFor();
      await page.locator('.source-position').click();
      const go = page.getByRole('textbox', { name: 'Go to line:', exact: true });
      await go.fill(String(scenario === 'pseudocode' ? body.split('\n').length : count));
      await go.press('Enter');
      await page.waitForFunction(() =>
        document.querySelector('.source-position')?.textContent?.includes('Ln '),
      );
      await page.waitForTimeout(1500);
      const series = [];
      for (let run = 0; run < runs; run++) {
        await page.evaluate(`(() => {
          const state={samples:[],longTasks:0,observer:null,listener:null};
          state.listener=()=>{const start=performance.now();requestAnimationFrame(()=>state.samples.push(performance.now()-start));};
          document.addEventListener('beforeinput',state.listener,true);
          try{state.observer=new PerformanceObserver(list=>state.longTasks+=list.getEntries().length);state.observer.observe({entryTypes:['longtask']});}catch{}
          window.__glassEditorBenchmark=state;
        })()`);
        await editor.focus();
        await page.keyboard.type(' benchmark typing with responsive authoring tools '.repeat(2), {
          delay: 12,
        });
        await page.waitForTimeout(100);
        const result = await page.evaluate<{
          samples: number[];
          longTasks: number;
          visibleSvg: number;
        }>(`(() => {
          const state=window.__glassEditorBenchmark;document.removeEventListener('beforeinput',state.listener,true);state.observer?.disconnect();
          return {samples:state.samples,longTasks:state.longTasks,visibleSvg:document.querySelectorAll('.source-math-widget svg').length};
        })()`);
        series.push({
          p50: quantile(result.samples, 0.5),
          p95: quantile(result.samples, 0.95),
          samples: result.samples.length,
          longTasks: result.longTasks,
          visibleMathDrawings: result.visibleSvg,
        });
      }
      reports.push({
        lines: count,
        documentLines: body.split('\n').length,
        series,
        p95Median: quantile(
          series.map((run) => run.p95),
          0.5,
        ),
      });
      await page.close();
    }
    return {
      label,
      scenario,
      revision: revision || 'working-tree',
      viewport: '1440x1000',
      cpu: 'native desktop, no artificial throttling',
      cpuModel: os.cpus()[0]?.model || 'unavailable',
      browser: browser.version(),
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      runs,
      reports,
    };
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
    if (server && server.exitCode === null)
      await new Promise<void>((resolve) => {
        server!.once('exit', () => resolve());
        setTimeout(resolve, 2000).unref();
      });
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
const results = [];
if (baseline) results.push(await variant('baseline', baseline));
results.push(await variant('current'));
const report = {
  createdAt: new Date().toISOString(),
  method:
    `beforeinput to next animation frame; isolated notebooks; 1500 ms viewport settling then ${runs} repeated typing runs; same current server/compiler and outer Studio; baseline editor source files overlaid only when a revision is supplied; ${scenario === 'pseudocode' ? 'typing in an active Quicksort fence appended to the mixed corpus' : 'mixed rich-content corpus'}`,
  results,
};
await fs.mkdir('.studio/reports', { recursive: true });
const filename = `.studio/reports/${scenario === 'pseudocode' ? 'pseudocode-ide' : 'markdown-ide'}-benchmark.json`;
await fs.writeFile(filename, JSON.stringify(report, null, 2) + '\n');
for (const result of results)
  for (const sample of result.reports)
    console.log(
      `${result.label} ${sample.lines} lines: median p95 ${sample.p95Median.toFixed(1)} ms`,
    );
console.log('Report: ' + filename);
