import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type StudioBuildInfo = {
  version: string;
  commit: string | null;
  builtAt: string;
  development: boolean;
  modified: boolean;
};

/** Capture the interface being compiled, independently of the author's notebook or reader release. */
export function studioBuildInfo(
  root: string,
  development: boolean,
  environment: { WORKERS_CI_COMMIT_SHA?: string } = process.env,
): StudioBuildInfo {
  const git = (args: string[]) => {
    try {
      return execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      }).trim();
    } catch {
      return '';
    }
  };
  const validCommit = (value: string) => /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(value);
  const ciCommit = environment.WORKERS_CI_COMMIT_SHA || '';
  const commit = validCommit(ciCommit) ? ciCommit : git(['rev-parse', 'HEAD']);
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return {
    version,
    commit: validCommit(commit) ? commit.toLowerCase() : null,
    builtAt: new Date().toISOString(),
    development,
    modified: !!git([
      'status',
      '--porcelain',
      '--untracked-files=normal',
      '--',
      'src',
      'scripts',
      'infrastructure',
      'package.json',
      'package-lock.json',
      'vite*.ts',
    ]),
  };
}
