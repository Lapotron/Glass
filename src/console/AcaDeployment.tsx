import { useEffect, useRef, useState } from 'react';
import { t } from '../shared/i18n.js';
import { Button, Icon } from '../shared/ui.js';
import {
  acaDeploymentStages,
  type AcaDeploymentOptions,
  type AcaDeploymentSummary,
  type AcaDeploymentCheck,
  type AcaDeploymentJob,
} from '../shared/aca-deployment.js';
import { api, send } from './api.js';
import { ErrorBox, Field, ToggleField } from './components.js';
import { usePrivateFlush } from './LocalSettings.js';
import type { FlushRef } from './Editor.js';
import './aca-deployment.css';
import { AcaRecovery } from './AcaRecovery.js';

function mergeJob(current: AcaDeploymentJob | null, incoming: AcaDeploymentJob | null) {
  if (!current || !incoming || incoming.startedAt > current.startedAt) return incoming || current;
  if (incoming.id !== current.id) return current;
  if (
    ['succeeded', 'failed'].includes(current.state) &&
    !['succeeded', 'failed'].includes(incoming.state)
  )
    return current;
  return incoming;
}
export function AcaDeploymentControls({
  flushRef,
  saveSite,
  onDirty,
  onConnected,
  contextKey,
}: {
  flushRef: FlushRef;
  saveSite: () => Promise<void>;
  onDirty: (value: boolean) => void;
  onConnected: (job: AcaDeploymentJob) => boolean;
  contextKey: string;
}) {
  const [summary, setSummary] = useState<AcaDeploymentSummary | null>(null),
    [draft, setDraft] = useState<AcaDeploymentOptions | null>(null),
    [baseline, setBaseline] = useState(''),
    [error, setError] = useState(''),
    [working, setWorking] = useState(false),
    [check, setCheck] = useState<AcaDeploymentCheck | null>(null),
    [conflict, setConflict] = useState(false),
    [connected, setConnected] = useState('');
  const state = useRef(summary),
    context = useRef(contextKey),
    current = useRef(draft),
    reference = useRef(baseline);
  state.current = summary;
  context.current = contextKey;
  current.current = draft;
  reference.current = baseline;
  const pending = useRef<Promise<void> | null>(null),
    started = useRef(''),
    mounted = useRef(true);
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const job = summary?.job || null;
  const active = !!summary?.busy || (!!job && !['succeeded', 'failed'].includes(job.state));
  const busy = working || active;
  useEffect(() => setCheck(null), [contextKey]);
  async function refresh(reset = false) {
    const value = await api<AcaDeploymentSummary>('aca/deployment');
    if (!mounted.current) return value;
    if (reset || !current.current || JSON.stringify(current.current) === reference.current) {
      current.current = value.options;
      reference.current = JSON.stringify(value.options);
      setDraft(value.options);
      setBaseline(reference.current);
      setConflict(false);
    } else if (state.current && value.revision !== state.current.revision) setConflict(true);
    const next = { ...value, job: mergeJob(state.current?.job || null, value.job) };
    state.current = next;
    setSummary(next);
    return next;
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((error) => setError((error as Error).message));
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
      } catch (error) {
        if (!stopped) setError((error as Error).message);
      }
      if (!stopped) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 400);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);
  useEffect(() => {
    if (
      !job?.verified ||
      job.state !== 'succeeded' ||
      started.current !== job.id ||
      connected === job.id
    )
      return;
    connectService(job);
  }, [job?.id, job?.state, job?.verified]);
  function connectService(value: AcaDeploymentJob) {
    if (onConnected(value)) setConnected(value.id);
    else
      setError(
        t(
          'The site or Cloudflare account changed. Review the captured ACA target before using its connection.',
        ),
      );
  }
  async function save() {
    if (pending.current) await pending.current;
    const value = current.current;
    if (!value || JSON.stringify(value) === reference.current) return;
    if (conflict) throw new Error(t('Reload ACA settings before saving; your draft is preserved.'));
    const operation = (async () => {
      const result = await send<AcaDeploymentSummary>('aca/deployment', 'PUT', {
        value,
        revision: state.current?.revision,
      });
      const text = JSON.stringify(value);
      reference.current = JSON.stringify(result.options);
      setBaseline(reference.current);
      if (JSON.stringify(current.current) === text) {
        current.current = result.options;
        setDraft(result.options);
      }
      state.current = result;
      setSummary(result);
    })();
    pending.current = operation;
    try {
      await operation;
    } catch (error) {
      setError((error as Error).message);
      throw error;
    } finally {
      pending.current = null;
    }
  }
  usePrivateFlush(flushRef, save, dirty, onDirty);
  function update(patch: Partial<AcaDeploymentOptions>) {
    setDraft((value) => value && { ...value, ...patch });
    setCheck(null);
    setError('');
  }
  async function run(action: 'check' | 'setup' | 'deploy') {
    if (busy) return;
    setWorking(true);
    setError('');
    setCheck(null);
    try {
      await saveSite();
      await refresh();
      if (action === 'check') {
        const captured = context.current;
        const checked = await send<AcaDeploymentCheck>('aca/deployment/check', 'POST', {
          revision: state.current?.revision,
        });
        if (context.current === captured) setCheck(checked);
      } else {
        const value = await send<AcaDeploymentJob>('aca/deployment/' + action, 'POST', {
          revision: state.current?.revision,
        });
        started.current = value.id;
        setSummary(
          (previous) => previous && { ...previous, busy: true, job: mergeJob(previous.job, value) },
        );
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setWorking(false);
    }
  }
  const labels = {
    checking: t('Connection'),
    database: t('Database'),
    migrating: t('Migrations'),
    secrets: t('Private keys'),
    uploading: t('Deploy'),
    verifying: t('Verify'),
  };
  const serviceLabels = {
    workers: t('Workers read access'),
    d1: t('D1 read access'),
    access: t('Access organization'),
    zone: t('Site zone access'),
  };
  const permissionLabels = {
    ready: t('Read access verified'),
    denied: t('Permission required'),
    missing: t('Setup required'),
    unavailable: t('Check unavailable'),
  };
  const step =
    job &&
    acaDeploymentStages.indexOf(
      (job.failedAt || job.state) as (typeof acaDeploymentStages)[number],
    );
  return (
    <section className="aca-setup" aria-label={t('ACA service deployment')}>
      <div className="aca-setup-heading">
        <Icon name="CloudUpload" size={18} />
        <div>
          <h4>{t('Set up ACA on Cloudflare')}</h4>
          <p className="help">
            {t(
              'Create or reuse the database, apply migrations, manage private keys and deploy the independent analytics Worker. Pages stays on its existing workflow.',
            )}
          </p>
        </div>
      </div>
      <ErrorBox error={error} />
      {!draft ? (
        <Button
          icon="RotateCcw"
          onClick={() => void refresh().catch((error) => setError((error as Error).message))}
        >
          {t('Reload ACA settings')}
        </Button>
      ) : (
        <>
          <fieldset disabled={busy} className="aca-setup-fields">
            <legend className="sr-only">{t('ACA deployment settings')}</legend>
            <div className="field-row">
              <Field label={t('Worker name')}>
                <input
                  value={draft.workerName}
                  onChange={(e) => update({ workerName: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('D1 database name')}>
                <input
                  value={draft.databaseName}
                  onChange={(e) => update({ databaseName: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="field-row">
              <Field
                label={t('Analytics custom domain')}
                help={t(
                  'Leave empty to use workers.dev. A custom domain must be under your saved site hostname.',
                )}
              >
                <input
                  value={draft.domain}
                  onChange={(e) => update({ domain: e.target.value })}
                  placeholder="analytics.example.com"
                  autoComplete="off"
                />
              </Field>
              <Field label={t('Service site ID')}>
                <input
                  value={draft.siteId}
                  onChange={(e) => update({ siteId: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            </div>
            <details className="aca-setup-advanced">
              <summary>{t('Service controls')}</summary>
              <ToggleField
                label={t('Accept reader events')}
                help={t(
                  'Website collection also requires Enable ACA and a fresh Pages publication. Turning this off pauses the service while preserving reports.',
                )}
                checked={draft.collectionEnabled}
                onChange={(collectionEnabled) => update({ collectionEnabled })}
              />
              <ToggleField
                label={t('Allow daily network estimates')}
                checked={draft.dailyNetworks}
                onChange={(dailyNetworks) => update({ dailyNetworks })}
              />
              <ToggleField label={t('Detailed audience reports')} checked={draft.audienceDetails} onChange={(audienceDetails)=>update({audienceDetails})} help={t('Approximate geography and normalized devices; no raw IPs or GPS.')} />
              <ToggleField label={t('Optional cross-day history')} checked={draft.optionalHistory} onChange={(optionalHistory)=>update({optionalHistory})} help={t('Only readers who explicitly opt in receive a persistent browser identifier.')} />
              <Field
                label={t('Daily accepted batch limit')}
                help={t(
                  'Starts at 1,000 batches per UTC day. Free-tier budgets remain enforced; account usage is shared.',
                )}
              >
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={draft.dailyBatches}
                  onChange={(e) => update({ dailyBatches: Number(e.target.value) })}
                />
              </Field>
            </details>
          </fieldset>
          <dl className="aca-setup-facts">
            <div>
              <dt>{t('Cloudflare account')}</dt>
              <dd>{summary?.accountId || t('Not configured')}</dd>
            </div>
            <div>
              <dt>{t('Allowed website')}</dt>
              <dd>{summary?.siteOrigin}</dd>
            </div>
            <div>
              <dt>{t('Database')}</dt>
              <dd>{summary?.databaseId || t('Created during setup')}</dd>
            </div>
            <div>
              <dt>{t('Private keys')}</dt>
              <dd>{summary?.secretsReady ? t('Saved privately') : t('Generated automatically')}</dd>
            </div>
          </dl>
          <p className="help">
            {t(
              'Uses the Cloudflare token saved in Connections. ACA needs D1 and Workers access; Access permissions are not required. Custom domains also need zone, DNS and Workers Routes access.',
            )}
          </p>
          <div className="aca-setup-actions">
            <Button
              icon={working ? 'LoaderCircle' : 'CheckCircle2'}
              disabled={busy || conflict}
              onClick={() => void run('check')}
            >
              {t('Check ACA connection')}
            </Button>
            <Button icon="Layers" disabled={busy || conflict} onClick={() => void run('setup')}>
              {t('Set up ACA')}
            </Button>
            <Button
              icon="CloudUpload"
              disabled={busy || conflict}
              variant="primary"
              onClick={() => void run('deploy')}
            >
              {t('Deploy ACA')}
            </Button>
          </div>
          {conflict && (
            <p className="error-message">
              {t('ACA settings changed outside this view. Reload to review the saved version.')}
            </p>
          )}
          {conflict && (
            <Button
              onClick={() =>
                void refresh(true).catch((error) => setError((error as Error).message))
              }
            >
              {t('Reload ACA settings')}
            </Button>
          )}
          {check && (
            <div className="aca-setup-check" role="status">
              <strong>
                {check.readiness.ready
                  ? t('ACA read access verified')
                  : t('ACA connection needs attention')}
              </strong>
              <ul>
                {check.readiness.checks.map((item) => (
                  <li key={item.id}>
                    <span>{serviceLabels[item.id]}</span>
                    <span>
                      {permissionLabels[item.status]}
                      {item.codes.length ? ' · ' + item.codes.join(', ') : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="help">
                {t(
                  'Read access does not prove deployment permissions. Setup and deployment validate each write.',
                )}
              </p>
            </div>
          )}
          {job && (
            <div className="aca-setup-job" aria-label={t('ACA deployment progress')}>
              <div className="aca-setup-job-heading">
                <strong>{job.action === 'setup' ? t('ACA setup') : t('ACA deployment')}</strong>
                <span className="badge">
                  {job.state === 'queued'
                    ? t('Queued')
                    : job.state === 'succeeded'
                      ? t('Succeeded')
                      : job.state === 'failed'
                        ? t('Failed')
                        : labels[job.state]}
                </span>
              </div>
              <p className="help">
                {job.options.workerName} · {job.siteOrigin} ·{' '}
                <time dateTime={job.completedAt || job.startedAt}>
                  {new Date(job.completedAt || job.startedAt).toLocaleString()}
                </time>
              </p>
              <ol className="aca-setup-stages">
                {acaDeploymentStages
                  .filter(
                    (stage) =>
                      job.action === 'deploy' || !['uploading', 'verifying'].includes(stage),
                  )
                  .map((stage, index) => (
                    <li
                      key={stage}
                      data-complete={job.state === 'succeeded' || index < (step ?? -1)}
                      aria-current={job.state === stage ? 'step' : undefined}
                    >
                      <span aria-hidden="true">{index + 1}</span>
                      {labels[stage]}
                    </li>
                  ))}
              </ol>
              {active && <progress aria-label={t('ACA deployment in progress')} />}
              <p role="status" className="help">
                {job.error || job.logs.at(-1)}
              </p>
              {job.databaseId && <p className="help">D1 · {job.databaseId}</p>}
              {job.deploymentUrl && (
                <a className="text-link" href={job.deploymentUrl} target="_blank" rel="noreferrer">
                  <Icon name="ExternalLink" size={14} />
                  {job.deploymentUrl}
                  {!job.verified && ' · ' + t('Unverified upload')}
                </a>
              )}
              {job.verified && (
                <div className="aca-setup-connected">
                  <p className="help">
                    {t(
                      'Service verified. Use its connection, enable ACA below, then save and Build & Publish the website to begin collection.',
                    )}
                  </p>
                  <Button
                    icon="LinkIcon"
                    onClick={() => {
                      connectService(job);
                    }}
                  >
                    {connected === job.id ? t('Connection filled in') : t('Use this ACA service')}
                  </Button>
                </div>
              )}
              <details>
                <summary>{t('Deployment log')}</summary>
                <pre className="aca-setup-log" tabIndex={0}>
                  {job.logs.join('\n')}
                </pre>
              </details>
            </div>
          )}
        </>
      )}
    <AcaRecovery/>
</section>
  );
}
