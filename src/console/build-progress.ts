import type { Job, JobState } from '../shared/contracts.js';
import { t } from '../shared/i18n.js';

const labels: Record<JobState, string> = {
  queued: 'Preparing your build',
  building: 'Building static pages',
  validating: 'Checking the generated site',
  'syncing-media': 'Synchronizing images',
  'verifying-media': 'Verifying CDN images',
  uploading: 'Publishing to Pages',
  'verifying-deployment': 'Checking the live deployment',
  succeeded: 'Complete',
  failed: 'Needs attention',
};
export function buildProgress(job: Job, hosted = false) {
  const succeeded = job.state === 'succeeded',
    failed = job.state === 'failed';
  const legacyFailure: JobState = job.deployment
    ? 'verifying-deployment'
    : job.mediaProgress && job.mediaProgress.done < job.mediaProgress.total
      ? 'verifying-media'
      : job.build && job.action === 'publish'
        ? 'uploading'
        : 'building';
  const state = failed ? job.failedAt || legacyFailure : job.state;
  const cloud = job.target?.project === 'Workers';
  const phaseLabel =
    state === 'queued' && hosted
      ? t('Waiting for Studio pipeline')
      : state === 'queued' && cloud
        ? 'Waiting for Workers Builds'
        : state === 'uploading' && cloud
          ? 'Publishing the reader Worker'
          : state === 'queued' && job.action === 'publish'
            ? 'Checking Pages project'
            : labels[state];
  const media =
    job.action === 'publish' &&
    (job.mediaDelivery === 'r2' || Boolean(job.mediaProgress || job.build?.media));
  const steps =
    job.action === 'build'
      ? [
          { key: 'build', label: 'Build', icon: 'Layers' },
          { key: 'validate', label: 'Validate', icon: 'CheckCheck' },
        ]
      : [
          { key: 'build', label: 'Build', icon: 'Layers' },
          ...(media ? [{ key: 'media', label: 'Media', icon: 'Image' }] : []),
          { key: 'upload', label: 'Publish', icon: 'CloudUpload' },
          { key: 'verify', label: 'Verify', icon: 'CheckCheck' },
        ];
  const stepKey =
    job.action === 'build'
      ? state === 'validating'
        ? 'validate'
        : 'build'
      : state === 'syncing-media' || state === 'verifying-media'
        ? 'media'
        : state === 'uploading'
          ? 'upload'
          : state === 'verifying-deployment'
            ? 'verify'
            : 'build';
  const index = succeeded
    ? steps.length
    : Math.max(
        0,
        steps.findIndex((step) => step.key === stepKey),
      );
  const measured =
    (state === 'syncing-media' || state === 'verifying-media') &&
    !succeeded &&
    job.mediaProgress &&
    job.mediaProgress.total > 0;
  const total = measured ? job.mediaProgress!.total : 1;
  const done = succeeded
    ? 1
    : measured
      ? Math.max(0, Math.min(total, job.mediaProgress!.done))
      : undefined;
  const detail = measured
    ? `${done} of ${total} images ${state === 'verifying-media' ? 'verified' : 'checked'}${failed ? ' before the job stopped' : ''}`
    : failed
      ? job.deployment
        ? 'The upload returned a URL. Review the deployment before retrying.'
        : 'Review the error, then start a new job.'
      : succeeded
        ? job.action === 'publish'
          ? 'The site is published and its deployment has been verified.'
          : 'Your static site is built and ready to preview.'
        : state === 'uploading'
          ? cloud
            ? 'Uploading the validated reader Worker and its static assets.'
            : 'Uploading the validated site to Cloudflare Pages.'
          : state === 'verifying-deployment'
            ? 'Confirming that the published site responds correctly.'
            : state === 'queued'
              ? hosted
                ? t(
                    'The captured notebook is waiting for its assigned Cloudflare build. No Pages upload has started.',
                  )
                : cloud
                  ? 'The captured notebook is waiting in the private build queue.'
                  : job.action === 'publish'
                    ? 'Checking the configured Pages target before building or transferring images.'
                    : 'Opening the saved notebook and preparing its files.'
              : 'Rendering pages, preparing assets, and checking the result.';
  return {
    steps,
    index,
    done,
    total,
    state,
    failed,
    succeeded,
    active: !succeeded && !failed,
    label: failed
      ? `Stopped · ${phaseLabel}`
      : succeeded
        ? job.action === 'publish'
          ? 'Published & verified'
          : 'Build complete'
        : phaseLabel,
    detail,
    barLabel:
      state === 'verifying-media'
        ? 'Media verification progress'
        : state === 'syncing-media'
          ? 'Media synchronization progress'
          : job.action === 'publish'
            ? 'Publication progress'
            : 'Build progress',
  };
}
export function elapsedTime(startedAt: string, end: number) {
  const seconds = Math.max(0, Math.floor((end - Date.parse(startedAt)) / 1000)) || 0;
  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
      : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
