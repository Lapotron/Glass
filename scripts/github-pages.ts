import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Store } from '../src/engine/store.js';
import { buildSite } from '../src/engine/build.js';
import { publicDeployment } from '../src/engine/deployment.js';

export async function buildGithubPages(args = process.argv.slice(2), environment = process.env) {
  const { values } = parseArgs({
    args,
    options: {
      root: { type: 'string' },
      'base-url': { type: 'string' },
    },
  });
  const baseUrl = values['base-url'] || environment.GLASS_PAGES_BASE_URL;
  if (!baseUrl)
    throw new Error(
      'Pass --base-url https://OWNER.github.io/REPOSITORY/ (or your configured custom domain). GitHub Actions supplies this from configure-pages.',
    );
  const deployment = publicDeployment('https://example.com', { target: 'github-pages', baseUrl });
  // CI never inherits another notebook from a saved Studio launcher preference.
  const root = await fs.realpath(path.resolve(values.root || process.cwd()));
  const result = await buildSite(new Store(root), {
    deployment: { target: 'github-pages', baseUrl },
    onLog: console.log,
  });
  console.log(
    `GitHub Pages artifact: ${path.join(root, 'dist')}\nDeployment URL: ${deployment.baseUrl}/`,
  );
  for (const diagnostic of result.diagnostics) console.log(diagnostic);
  if (environment.GITHUB_STEP_SUMMARY) {
    const table = `## Glass build\n\n- Commit: \`${/^[a-f0-9]{40,64}$/i.test(environment.GITHUB_SHA || '') ? environment.GITHUB_SHA : 'local'}\`\n- Destination: ${deployment.baseUrl}/\n- Pages: ${result.pages}\n- Files: ${result.manifest.length}\n- Bytes: ${result.totalBytes}\n\nBuild complete. Publication is reported separately by the deployment job.\n`;
    await fs.appendFile(environment.GITHUB_STEP_SUMMARY, table);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  buildGithubPages().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
