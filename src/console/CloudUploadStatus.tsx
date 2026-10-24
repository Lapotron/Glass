import { t } from '../shared/i18n.js';
import { Icon } from '../shared/ui.js';
import { isCloudStudio, type CloudJobProgress } from './api.js';

export function CloudUploadStatus({
  progress,
  pending = false,
}: {
  progress?: CloudJobProgress;
  pending?: boolean;
}) {
  if (!isCloudStudio() || (!pending && !progress)) return null;
  if (progress && !['queued', 'running'].includes(progress.state)) return null;
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
