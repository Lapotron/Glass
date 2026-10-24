import { useEffect, useState } from 'react';
import { t, uiDate, uiNumber } from '../shared/i18n.js';
import { Button, Icon } from '../shared/ui.js';
import { api, type Bootstrap } from './api.js';
import { ErrorBox } from './components.js';
import type { HealthReport } from '../shared/health.js';
import './guided-setup.css';
export function GuidedSetup({
  data,
  navigate,
}: {
  data: Bootstrap;
  navigate: (
    view: 'writing' | 'settings' | 'media' | 'builds' | 'backups' | 'analytics' | 'hosting',
    tab?: string,
  ) => void;
}) {
  const [tab, setTab] = useState('setup'),
    [health, setHealth] = useState<HealthReport>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [config, setConfig] = useState(''),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => {
      if (document.hidden) return;
      setBusy(true);
      void api<HealthReport>('health')
        .then((value) => {
          if (active) {
            setHealth(value);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    };
    load();
    const timer = setInterval(load, 60000);
    document.addEventListener('visibilitychange', load);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);
  const steps = [
    {
      label: t('Create and preview an entry'),
      done: !!data.entries.length,
      run: () => navigate('writing'),
      description: t('Canonical Markdown stays in your notebook.'),
    },
    {
      label: t(data.runtime ? 'Configure Workers Builds' : 'Configure Pages publication'),
      done: data.runtime
        ? !!data.runtime.buildsConfigured
        : !!data.site.cloudflare.projectName && !!data.site.cloudflare.accountId,
      run: () =>
        navigate(data.runtime ? 'hosting' : 'settings', data.runtime ? undefined : 'cloudflare'),
      description: t(
        data.runtime
          ? 'Review the connected repository and approved release workflow in Hosting.'
          : 'Choose the account, project and public URL.',
      ),
    },
    {
      label: t('Build and publish'),
      done: data.jobs.some((j) => j.action === 'publish' && j.state === 'succeeded'),
      run: () => navigate('builds'),
      description: t('Validate an exact artifact before upload.'),
    },
    {
      label: t('Review notebook backups'),
      done: false,
      run: () => navigate('backups'),
      description: t('Keep an export before maintenance or recovery.'),
    },
    {
      label: t('Optional R2 delivery'),
      done: data.site.mediaDelivery.mode === 'r2',
      run: () => navigate('settings', 'media-delivery'),
      description: t(
        data.runtime
          ? 'Serve media through your CDN; generated reader assets remain separate.'
          : 'Serve media through your CDN; Pages remains available.',
      ),
    },
    {
      label: t('Optional audience analytics'),
      done: data.site.integrations.aca.enabled,
      run: () => navigate('settings', 'aca'),
      description: t('Set up the independent ACA service before enabling readers.'),
    },
  ];
  const issues = health?.issues.filter((i) => !i.resolvedAt) || [];
  return (
    <section className="setup-center glass-panel" aria-label={t('Studio guide')}>
      <div className="aca-section-head">
        <div>
          <span className="eyebrow">{t('Make yourself at home')}</span>
          <h2>{t('Studio guide')}</h2>
        </div>
        <nav className="segmented" aria-label={t('Studio guide sections')}>
          {[
            ['setup', t('Get started')],
            ['services', t('Service health')],
            ['ai', t('AI authoring')],
          ].map(([id, label]) => (
            <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
              {t(label)}
              {id === 'services' && issues.length > 0 && (
                <span className="setup-issue-count">{issues.length}</span>
              )}
            </button>
          ))}
        </nav>
      </div>
      <ErrorBox error={error} />
      {tab === 'setup' && (
        <ol className="setup-steps">
          {steps.map((step, index) => (
            <li key={index}>
              <span className={'setup-step-mark' + (step.done ? ' complete' : '')}>
                <Icon name={step.done ? 'Check' : 'ArrowRight'} size={16} />
              </span>
              <div>
                <strong>{step.label}</strong>
                <p className="help">{step.description}</p>
              </div>
              <Button className="small" onClick={step.run}>
                {t(step.done ? 'Review' : 'Open')}
              </Button>
            </li>
          ))}
        </ol>
      )}
      {tab === 'services' && (
        <>
          <p className="help">
            {t(
              'Checks refresh while Studio is open. Optional services do not block writing or ordinary Pages publication.',
            )}
          </p>
          <div className="setup-service-grid">
            {health?.checks.map((check) => (
              <article key={check.id}>
                <strong>
                  {check.id === 'aca'
                    ? 'ACA'
                    : check.id === 'r2'
                      ? 'R2'
                      : check.id === 'pages'
                        ? 'Pages'
                        : t(
                            check.id === 'builds'
                              ? 'Workers Builds'
                              : check.id === 'access'
                                ? 'Owner access'
                                : check.id === 'cloud-storage'
                                  ? 'Private storage'
                                  : check.id,
                          )}
                </strong>
                <span className={'status-pill ' + (check.state === 'attention' ? 'warning' : '')}>
                  {t(check.state)}
                </span>
                <p>{t(check.detail)}</p>
              </article>
            ))}
          </div>
          {health?.worker && (
            <p className="setup-worker-stats">
              {t('Last 24 hours')} · {uiNumber(health.worker.requests)} {t('Worker requests')} ·{' '}
              {uiNumber(health.worker.errors)} {t('Errors')} · CPU p50{' '}
              {uiNumber(health.worker.cpuP50Ms, { maximumFractionDigits: 2 })} ms · p95{' '}
              {uiNumber(health.worker.cpuP95Ms, { maximumFractionDigits: 2 })} ms · p99{' '}
              {uiNumber(health.worker.cpuP99Ms, { maximumFractionDigits: 2 })} ms
            </p>
          )}
          {health?.metricsUnavailable && <p className="help">{t(health.metricsUnavailable)}</p>}
          {issues.map((issue) => (
            <div className="setup-issue" key={issue.id}>
              <Icon name="AlertCircle" size={17} />
              <div>
                <strong>{t(issue.message)}</strong>
                <span className="help">
                  {t('First observed')} ·{' '}
                  {uiDate(issue.firstSeen, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>
              <Button
                className="small"
                onClick={() =>
                  navigate(
                    issue.action === 'analytics'
                      ? 'analytics'
                      : issue.action === 'media'
                        ? 'media'
                        : 'settings',
                    issue.action === 'settings' ? 'aca' : undefined,
                  )
                }
              >
                {t('Review')}
              </Button>
            </div>
          ))}
          {!!health?.issues.some((i) => i.resolvedAt) && (
            <details>
              <summary>{t('Resolved issues')}</summary>
              {health.issues
                .filter((i) => i.resolvedAt)
                .map((i) => (
                  <p className="help" key={i.id}>
                    {t(i.message)} · {t('Resolved')}{' '}
                    {uiDate(i.resolvedAt!, { dateStyle: 'medium' })}
                  </p>
                ))}
            </details>
          )}
          <div className="page-actions">
            <span className="help">
              {busy
                ? t('Checking services…')
                : health
                  ? t('Last checked') + ' ' + uiDate(health.checkedAt, { timeStyle: 'short' })
                  : t('Service status unavailable')}
            </span>
            <Button
              className="small"
              icon="Download"
              disabled={!health}
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(health, null, 2)], { type: 'application/json' }),
                );
                const a = document.createElement('a');
                a.href = url;
                a.download = 'glass-health.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              {t('Export diagnostics')}
            </Button>
          </div>
        </>
      )}
      {tab === 'ai' && (
        <>
          <p>
            {t(
              'Connect a local MCP client to templates, validation, previews and conflict-safe drafts. Studio must be running for this notebook. Published entries remain read-only through MCP.',
            )}
          </p>
          <p className="help">
            {t(
              'The connection contains local paths and a port, never credentials. Review the permissions in your MCP client.',
            )}
          </p>
          <Button
            className="small"
            icon="Copy"
            onClick={async () => {
              try {
                const value = JSON.stringify(await api('authoring/connection'), null, 2);
                setConfig(value);
                await navigator.clipboard.writeText(value);
                setCopied(true);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {t(copied ? 'Configuration copied' : 'Copy MCP configuration')}
          </Button>
          {config && (
            <pre className="setup-config">
              <code>{config}</code>
            </pre>
          )}
          <p className="help">
            {t(
              'Use npm run doctor for a read-only setup check. Use the command palette to find entries and routine operations.',
            )}
          </p>
        </>
      )}
    </section>
  );
}
