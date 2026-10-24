import { describe, expect, it } from 'vitest';
import type { Job } from '../src/shared/contracts.js';
import { buildProgress, elapsedTime } from '../src/console/build-progress.js';

const job = (value: Partial<Job> = {}): Job => ({
  id: 'progress-test',
  action: 'publish',
  state: 'building',
  logs: [],
  startedAt: '2026-10-19T00:00:00Z',
  ...value,
});
describe('truthful build and publication progress', () => {
  it('distinguishes hosted pipeline waiting from a local Pages preflight', () => {
    const queued = job({
      state: 'queued',
      target: { canonicalUrl: 'https://example.test', project: 'glass-blog', branch: 'main' },
    });
    expect(buildProgress(queued, true)).toMatchObject({
      label: 'Waiting for Studio pipeline',
      detail:
        'The captured notebook is waiting for its assigned Cloudflare build. No Pages upload has started.',
      done: undefined,
    });
    expect(buildProgress(queued).label).toBe('Checking Pages project');
    expect(buildProgress({ ...queued, state: 'uploading' }, true).label).toBe(
      'Publishing to Pages',
    );
  });
  it('keeps phases without measured totals indeterminate and shows the configured delivery path', () => {
    for (const state of [
      'queued',
      'building',
      'validating',
      'uploading',
      'verifying-deployment',
    ] as const) {
      const info = buildProgress(job({ state, mediaDelivery: 'r2' }));
      expect(info.done).toBeUndefined();
      expect(info.active).toBe(true);
      expect(info.steps.map((step) => step.key)).toEqual(['build', 'media', 'upload', 'verify']);
    }
    expect(buildProgress(job({ mediaDelivery: 'pages' })).steps.map((step) => step.key)).toEqual([
      'build',
      'upload',
      'verify',
    ]);
    const build = buildProgress(job({ action: 'build', state: 'validating' }));
    expect(build.steps.map((step) => step.key)).toEqual(['build', 'validate']);
    expect(build.steps[build.index].key).toBe('validate');
  });
  it('measures media checks separately from verification and bounds received counts', () => {
    const value = job({
      state: 'syncing-media',
      mediaProgress: { done: 5, total: 8, uploaded: 2, bytes: 1024 },
    });
    expect(buildProgress(value)).toMatchObject({
      done: 5,
      total: 8,
      detail: '5 of 8 images checked',
    });
    expect(
      buildProgress({
        ...value,
        state: 'verifying-media',
        mediaProgress: { ...value.mediaProgress!, done: 0 },
      }),
    ).toMatchObject({ done: 0, detail: '0 of 8 images verified' });
    expect(
      buildProgress({ ...value, mediaProgress: { ...value.mediaProgress!, done: 20 } }).done,
    ).toBe(8);
    expect(
      buildProgress({ ...value, mediaProgress: { ...value.mediaProgress!, done: -1 } }).done,
    ).toBe(0);
    expect(
      buildProgress({ ...value, mediaProgress: { done: 0, total: 0, uploaded: 0, bytes: 0 } }).done,
    ).toBeUndefined();
  });
  it('names the Pages preflight before any build or media work', () => {
    expect(buildProgress(job({ state: 'queued' }))).toMatchObject({
      label: 'Checking Pages project',
      active: true,
    });
    expect(buildProgress(job({ state: 'failed', failedAt: 'queued' }))).toMatchObject({
      label: 'Stopped · Checking Pages project',
      index: 0,
      active: false,
      done: undefined,
    });
    expect(buildProgress(job({ state: 'queued', action: 'build' })).label).toBe(
      'Preparing your build',
    );
  });
  it('retains the stopped phase and measured count without turning a failed upload into completion', () => {
    const value = job({
      state: 'failed',
      failedAt: 'verifying-media',
      mediaDelivery: 'r2',
      mediaProgress: { done: 3, total: 8, uploaded: 8, bytes: 4096 },
    });
    const info = buildProgress(value);
    expect(info).toMatchObject({
      active: false,
      succeeded: false,
      failed: true,
      done: 3,
      total: 8,
      label: 'Stopped · Verifying CDN images',
    });
    expect(info.steps[info.index].key).toBe('media');
    const uncertain = buildProgress(
      job({
        state: 'failed',
        failedAt: 'verifying-deployment',
        deployment: {
          url: 'https://test.pages.dev',
          project: 'test',
          buildId: 'test',
          completedAt: '',
        },
      }),
    );
    expect(uncertain.done).toBeUndefined();
    expect(uncertain.steps[uncertain.index].key).toBe('verify');
    expect(uncertain.detail).toContain('Review the deployment before retrying');
  });
  it('supports older job journals and completes every stage only after success', () => {
    const legacy = buildProgress(
      job({ state: 'failed', mediaProgress: { done: 2, total: 8, uploaded: 8, bytes: 1024 } }),
    );
    expect(legacy.steps[legacy.index].key).toBe('media');
    for (const action of ['build', 'publish'] as const) {
      const info = buildProgress(job({ action, state: 'succeeded' }));
      expect(info).toMatchObject({ active: false, done: 1, total: 1, succeeded: true });
      expect(info.index).toBe(info.steps.length);
    }
  });
  it('formats elapsed time without negative, invalid or ambiguous minute values', () => {
    const start = '2026-10-19T00:00:00Z',
      time = Date.parse(start);
    expect(elapsedTime(start, time - 1000)).toBe('0s');
    expect(elapsedTime(start, time + 59999)).toBe('59s');
    expect(elapsedTime(start, time + 63000)).toBe('1m 03s');
    expect(elapsedTime(start, time + 3720000)).toBe('1h 2m');
    expect(elapsedTime('invalid', time)).toBe('0s');
  });
});
