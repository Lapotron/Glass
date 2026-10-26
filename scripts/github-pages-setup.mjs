import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Read-only opt-in: never enable Pages or change a domain on the owner's behalf. */
export async function githubPagesSetup(repository, token, request = fetch) {
  if (!/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository || '') || !token)
    throw new Error(
      'GitHub Pages setup needs the workflow repository and its provided GITHUB_TOKEN.',
    );
  let response;
  try {
    response = await request(`https://api.github.com/repos/${repository}/pages`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    throw new Error(
      'Could not reach GitHub Pages setup. Retry after connectivity is restored; no deployment was attempted.',
    );
  }
  if (response.status === 404) {
    await response.body?.cancel();
    return {
      enabled: false,
      message:
        'Pages is not configured. Open Settings → Pages → Build and deployment → Source → GitHub Actions, then run this workflow again.',
    };
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `GitHub Pages setup check failed (HTTP ${response.status}). Check repository Pages availability and the workflow pages: read permission. No deployment was attempted.`,
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('GitHub returned unreadable Pages metadata. No deployment was attempted.');
  }
  if (result.build_type === 'legacy')
    return {
      enabled: false,
      message:
        'Pages uses branch publishing. Change Settings → Pages → Source to GitHub Actions, then run this workflow again.',
    };
  if (result.build_type !== 'workflow')
    throw new Error(
      'GitHub returned an unknown Pages publishing mode. Check Settings → Pages. No deployment was attempted.',
    );
  return { enabled: true, message: 'GitHub Actions publishing is configured.' };
}

async function main() {
  const result = await githubPagesSetup(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN);
  console.log(result.message);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `enabled=${result.enabled}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Pages setup\n\n${result.message}\n\n${result.enabled ? 'Build and deployment follow in separate steps.' : 'Deployment was skipped. The public website was not changed.'}\n`,
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
