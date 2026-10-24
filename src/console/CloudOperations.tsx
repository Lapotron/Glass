import { useState } from 'react';
import { Button, Icon } from '../shared/ui.js';
import { t } from '../shared/i18n.js';
import { readerBuild, type CloudStatus, type CloudOperation } from '../shared/cloud-builds.js';
import type { JobState } from '../shared/contracts.js';
import { JobStatus } from './components.js';
import { send } from './api.js';

function operationName(job: CloudOperation) {
  if (job.kind !== 'api')
    return job.kind === 'publish' ? t('Build & publish') : t('Static site build');
  try {
    return JSON.parse(job.request).path || t('Cloud operation');
  } catch {
    return t('Cloud operation');
  }
}

export function CloudOperations({
  status,
  refresh,
  onError,
}: {
  status?: CloudStatus;
  refresh: () => Promise<void>;
  onError: (error: string) => void;
}) {
  const [cancelling, setCancelling] = useState(''),
    [copied, setCopied] = useState('');
  const active = status?.jobs.some((job) => job.state === 'queued' || job.state === 'running');
  const waiting = status?.jobs.some(
    (job) => job.state === 'queued' && Date.now() - Date.parse(job.created) > 5 * 60_000,
  );
  const claimed = status?.jobs.some((job) => !!job.commit_sha);
  const pipelineWorker = status?.studioWorker || status?.siteWorker;
  const dashboard =
    status?.accountId &&
    /^[a-f\d]{32}$/i.test(status.accountId) &&
    pipelineWorker &&
    /^[\w-]+$/.test(pipelineWorker)
      ? `https://dash.cloudflare.com/${status.accountId}/workers/services/view/${pipelineWorker}/production`
      : '';
  return (
    <section className="glass-panel hosting-section hosting-jobs">
      <div className="hosting-section-heading">
        <h2>
          <Icon name="Activity" size={19} />
          {t('Cloud operations')}
        </h2>
        <span className="help">
          {active
            ? t('Updates automatically while this page is visible.')
            : t('No active cloud operations.')}
        </span>
      </div>
      {waiting && (
        <div className="hosting-queue-notice" role="status">
          <Icon name="Clock3" size={17} />
          <div>
            <strong>{t('The Studio pipeline has not claimed this request yet.')}</strong>
            <p className="help">
              {t(
                'Open its build log. Check the Studio pipeline commands, GLASS_CI_SECRETS and Access Service Auth policy. After fixing setup, cancel the unclaimed request and start the intended operation again in Studio.',
              )}
            </p>
          </div>
        </div>
      )}
      <details className="hosting-build-help" open={waiting || !status?.buildsConfigured}>
        <summary>
          {t('Studio pipeline setup')} ·{' '}
          {claimed
            ? t('Runner has connected')
            : status?.buildsConfigured
              ? t('Trigger configured; runner not verified')
              : t('Needs setup')}
        </summary>
        <p className="help">
          {t(
            'Studio deployments synchronize build-supplied connection defaults as encrypted runtime secrets. Access service credentials still belong in GLASS_CI_SECRETS and need a Service Auth policy. Explicit Studio credentials override the deployment defaults. Never paste secrets into a support message.',
          )}
        </p>
        <dl className="hosting-build-fields">
          {Object.entries(readerBuild).map(([key, value]) => (
            <div key={key}>
              <dt>
                {key === 'root'
                  ? t('Root directory')
                  : key === 'build'
                    ? t('Build command')
                    : t('Deploy command')}
              </dt>
              <dd>
                <code>{value}</code>
                <Button
                  className="small"
                  variant="ghost"
                  icon={copied === key ? 'Check' : 'Copy'}
                  aria-label={t('Copy {value0}', {
                    value0:
                      key === 'root'
                        ? t('Root directory')
                        : key === 'build'
                          ? t('Build command')
                          : t('Deploy command'),
                  })}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(value)
                      .then(() => setCopied(key))
                      .catch((error) => onError(error.message))
                  }
                />
              </dd>
            </div>
          ))}
        </dl>
        <div className="hosting-actions">
          {dashboard && (
            <a
              className="text-link"
              href={dashboard + '/deployments'}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="ExternalLink" size={14} />
              {t('Reader deployments')}
            </a>
          )}
          <a
            className="text-link"
            href="/authoring/hosted-studio.md#cloud-operations-stay-queued"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="BookOpen" size={14} />
            {t('Queue troubleshooting')}
          </a>
        </div>
      </details>
      <ul>
        {status?.jobs.slice(0, 12).map((job) => (
          <li key={job.id}>
            <div className="hosting-job-description">
              <strong>{operationName(job)}</strong>
              <small>
                {new Date(job.created).toLocaleString()}
                {job.commit_sha ? ' · ' + job.commit_sha.slice(0, 8) : ''}
              </small>
              {job.error && <p className="help">{job.error}</p>}
            </div>
            <div className="hosting-job-actions">
              <JobStatus state={(job.state === 'running' ? 'building' : job.state) as JobState} />
              {dashboard && job.build_uuid && /^[\w-]+$/.test(job.build_uuid) && (
                <a
                  className="text-link"
                  href={dashboard + '/builds/' + job.build_uuid}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="ExternalLink" size={14} />
                  {t('Build log')}
                </a>
              )}
              {job.state === 'queued' && (
                <Button
                  className="small"
                  variant="ghost"
                  icon="X"
                  disabled={!!cancelling}
                  onClick={async () => {
                    setCancelling(job.id);
                    try {
                      await send('cloud-jobs/' + job.id + '/cancel', 'POST', {});
                      await refresh();
                    } catch (error) {
                      onError((error as Error).message);
                    } finally {
                      setCancelling('');
                    }
                  }}
                >
                  {t('Cancel queued request')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!status?.jobs.length && <p className="help">{t('No cloud operations yet.')}</p>}
    </section>
  );
}
