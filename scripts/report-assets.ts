import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inspectReaderAssets } from '../src/engine/asset-report.js';
const report = await inspectReaderAssets(path.join(process.cwd(), 'dist'));
await fs.mkdir('.studio/reports', { recursive: true });
await fs.writeFile('.studio/reports/assets.json', JSON.stringify(report, null, 2));
for (const budget of report.budgets)
  console.log(
    `${budget.passed ? '✓' : '✗'} ${budget.name}: ${(budget.actual / 1024).toFixed(1)} / ${(budget.limit / 1024).toFixed(0)} KiB gzip`,
  );
console.log(
  `Intent-activated charts, all families including showcase: ${(report.chartInteractionGzip / 1024).toFixed(1)} KiB gzip`,
);
console.log(`Reader Settings on visit: ${(report.settingsGzip / 1024).toFixed(1)} KiB gzip`);
if (report.budgets.some((budget) => !budget.passed))
  throw new Error(
    'The production reader asset budget was exceeded. See .studio/reports/assets.json.',
  );
console.log('Asset graph and deferred sizes: .studio/reports/assets.json');
