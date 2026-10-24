import { t } from '../shared/i18n.js';
import { Icon } from '../shared/ui.js';
import { isCloudStudio, type CloudJobProgress } from './api.js';
import { formatBytes } from '../shared/media-details.js';

export function CloudUploadStatus({
  progress,
  pending = false,
}: {
  progress?: CloudJobProgress;
  pending?: boolean;
}) {
  if (!isCloudStudio() || (!pending && !progress)) return null;
  if (
    progress &&
    !['queued', 'running', 'preparing', 'checking', 'uploading', 'verifying'].includes(
      progress.state,
    )
  )
    return null;
  if (progress && ['preparing', 'checking', 'uploading', 'verifying'].includes(progress.state))
    return (
      <div className="help hosting-progress" role="status" aria-label={t('Cloud operation')}>
        <span>
          <Icon
            name={
              progress.state === 'preparing' || progress.state === 'checking'
                ? 'Image'
                : 'CloudUpload'
            }
            size={14}
          />{' '}
          {progress.state === 'preparing'
            ? t('Preparing on your device…')
            : progress.state === 'checking'
              ? t('Checking file checksum…')
              : progress.state === 'verifying'
                ? t('Verifying and saving to private storage…')
                : t('Uploading directly to private storage…')}
        </span>
        {!!progress.totalBytes && (
          <>
            <progress
              aria-label={t('Media transfer progress')}
              value={progress.bytes || 0}
              max={progress.totalBytes}
            />
            <span>
              {formatBytes(progress.bytes || 0)} / {formatBytes(progress.totalBytes)}
            </span>
          </>
        )}
      </div>
    );
  return (
    <p className="help" role="status" aria-label={t('Cloud operation')}>
      <Icon name={progress?.state === 'queued' ? 'Clock3' : 'CloudUpload'} size={14} />{' '}
      {!progress
        ? t('Sending upload to your cloud Studio.')
        : progress.state === 'queued'
          ? t('Waiting for Cloudflare to start this upload.')
          : t('Cloudflare is processing this upload.')}{' '}
      <a className="text-link" href="#hosting" target="_blank" rel="noreferrer">
        {t('Cloud operations')} <Icon name="ExternalLink" size={13} />
      </a>
    </p>
  );
}
