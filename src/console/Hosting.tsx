import { useCallback, useEffect, useRef, useState } from 'react';
import { api, send } from './api.js';
import { Button, Icon } from '../shared/ui.js';
import { PageHeading, ErrorBox } from './components.js';
import { CloudOperations } from './CloudOperations.js';
import { NotebookMigration } from './NotebookMigration.js';
import { CloudStorage } from './CloudStorage.js';
import { PagesSetup } from './PagesSetup.js';
import type { CloudStatus } from '../shared/cloud-builds.js';
import { t } from '../shared/i18n.js';
import { formatBytes } from '../shared/media-details.js';
import './hosting.css';
type Key = { id: string; created: string; scopes: string; revoked: number };
export function Hosting() {
  const [status, setStatus] = useState<CloudStatus>(),
    [keys, setKeys] = useState<Key[]>([]),
    [authoringKey, setAuthoringKey] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const loading = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    loading.current = true;
    try {
      const [value, tokens] = await Promise.all([
        api<CloudStatus>('cloud/status'),
        api<Key[]>('cloud/mcp-keys'),
      ]);
      if (request !== sequence.current) return;
      setStatus(value);
      setKeys(tokens);
      setError('');
    } catch (e) {
      if (request === sequence.current) setError((e as Error).message);
    } finally {
      if (request === sequence.current) loading.current = false;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const changed = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('studio-filesystem', changed);
    return () => {
      sequence.current++;
      window.removeEventListener('studio-filesystem', changed);
    };
  }, [refresh]);
  const active = status?.jobs.some((job) => job.state === 'queued' || job.state === 'running');
  useEffect(() => {
    if (!active) return;
    const visible = () => {
      if (document.visibilityState === 'visible' && !loading.current) void refresh();
    };
    const timer = window.setInterval(visible, 5000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active, refresh]);
  async function createKey() {
    setBusy(true);
    setError('');
    try {
      const value = await send('cloud/mcp-keys', 'POST', {});
      setAuthoringKey(value.token);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const facts = status
    ? [
        [t('Studio'), status.studioOrigin],
        [t('Public site'), status.siteOrigin],
        [t('Workspace'), status.workspaceId],
        [t('Stored files'), String(status.files)],
        [
          t('Private storage reserved'),
          formatBytes(status.physicalStorage?.bytes || status.bytes) +
            ' / ' +
            formatBytes(status.budgetBytes),
        ],
        [t('Workers Builds'), status.buildsConfigured ? t('Trigger configured') : t('Needs setup')],
      ]
    : [];
  return (
    <div className="studio-page hosting-page">
      <PageHeading
        eyebrow={t('Cloud workspace')}
        title={t('Hosting')}
        description={t('Your private Studio, content storage and Git-connected deployments.')}
      >
        <a
          className="button secondary small"
          href="https://dash.cloudflare.com/"
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="ExternalLink" size={15} />
          {t('Open Cloudflare')}
        </a>
      </PageHeading>
      <ErrorBox error={error} />
      {status?.deferredBuild && (
        <p className="operation-message" role="status">
          {t('Deferred approved release')} · {new Date(status.deferredBuild.after).toLocaleString()}{' '}
          ·{' '}
          {t(
            status.deferredBuild.state === 'waiting'
              ? 'Waiting for quota reset'
              : 'Check Cloudflare build status',
          )}
        </p>
      )}
      {message && (
        <p className="help" role="status">
          {message}
        </p>
      )}
      <div className="hosting-layout">
        <section className="glass-panel hosting-section">
          <h2>
            <Icon name="Cloud" size={19} />
            {t('Cloud connection')}
          </h2>
          <dl className="hosting-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="help">
            {t(
              'Hostnames and bindings are deployment settings. Update them in Cloudflare and verify the matching Access policy before switching domains.',
            )}
          </p>
          <p className="help">
            {t(
              'Reserved storage includes retained artifacts and staged uploads. Removing a notebook record does not immediately erase immutable cloud objects.',
            )}
          </p>
          <Button
            className="small"
            variant="ghost"
            icon="RotateCcw"
            onClick={() => void refresh()}
            disabled={busy}
          >
            {t('Refresh')}
          </Button>
        </section>
        <section className="glass-panel hosting-section">
          <h2>
            <Icon name="GitBranch" size={19} />
            {t('Publishing workflow')}
          </h2>
          <ol className="hosting-workflow">
            <li>{t('Autosave changes only the private cloud notebook.')}</li>
            <li>{t('Publish captures an immutable release and starts Workers Builds.')}</li>
            <li>{t('Git code pushes update Studio; they do not publish the public site.')}</li>
            <li>{t('Branch previews use isolated synthetic notebooks and separate storage.')}</li>
          </ol>
          <p className="help">
            {t(
              'Uploads, backups, restoration and ordinary saves run directly. Only Publish starts the SSG pipeline; Pages serves the generated release.',
            )}
          </p>
          <a
            className="text-link"
            href="/authoring/hosted-studio.md"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="BookOpen" size={15} />
            {t('Hosting guide')}
          </a>
        </section>
        <PagesSetup />
        <CloudStorage />
        <NotebookMigration status={status} onImported={refresh} />
        <section className="glass-panel hosting-section">
          <h2>
            <Icon name="KeyRound" size={19} />
            {t('Remote AI authoring')}
          </h2>
          <p>
            {t(
              'Authoring keys can prepare private drafts and cannot publish. Protected machine clients also need their Cloudflare Access service credentials.',
            )}
          </p>
          <div className="hosting-actions">
            <Button className="small" onClick={() => void createKey()} disabled={busy} icon="Plus">
              {t('Create authoring key')}
            </Button>
            <Button
              className="small"
              variant="ghost"
              icon="Copy"
              onClick={() =>
                void api('authoring/connection')
                  .then((value) => navigator.clipboard.writeText(JSON.stringify(value, null, 2)))
                  .then(() =>
                    setMessage(
                      t(
                        'MCP configuration copied. Replace its credential placeholders in your private client settings.',
                      ),
                    ),
                  )
                  .catch((e) => setError(e.message))
              }
            >
              {t('Copy MCP configuration')}
            </Button>
          </div>
          {authoringKey && (
            <div className="hosting-key">
              <label htmlFor="hosting-new-key">
                {t('Copy this key now; it is shown only once.')}
              </label>
              <div className="input-with-button">
                <input
                  id="hosting-new-key"
                  readOnly
                  type="password"
                  autoComplete="off"
                  value={authoringKey}
                />
                <Button
                  className="small"
                  icon="Copy"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(authoringKey)
                      .then(() => setMessage(t('Authoring key copied.')))
                  }
                >
                  {t('Copy key')}
                </Button>
              </div>
            </div>
          )}
          <ul className="hosting-keys">
            {keys
              .filter((key) => !key.revoked)
              .map((key) => (
                <li key={key.id}>
                  <span>
                    <strong>{t('Draft authoring')}</strong>
                    <small>{new Date(key.created).toLocaleString()}</small>
                  </span>
                  <Button
                    className="small"
                    variant="ghost"
                    icon="X"
                    disabled={busy}
                    onClick={() =>
                      void api('cloud/mcp-keys/' + key.id, { method: 'DELETE' })
                        .then(() => {
                          setAuthoringKey('');
                          return refresh();
                        })
                        .catch((e) => setError(e.message))
                    }
                  >
                    {t('Revoke')}
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      </div>
      <CloudOperations status={status} refresh={refresh} onError={setError} />
      <div className="hosting-signout">
        <Icon name="ShieldCheck" size={16} />
        <span>{t('Owner access is verified by Cloudflare Access.')}</span>
        <a className="text-link" href="/cdn-cgi/access/logout">
          {t('Sign out')}
        </a>
      </div>
    </div>
  );
}
