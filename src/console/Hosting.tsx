import { useEffect, useState } from 'react';
import { api, send } from './api.js';
import { Button, Icon } from '../shared/ui.js';
import { PageHeading, ErrorBox, Modal, JobStatus } from './components.js';
import { t } from '../shared/i18n.js';
import { formatBytes } from '../shared/media-details.js';
import type { JobState } from '../shared/contracts.js';
import './hosting.css';
type RecordFile = { path: string; sha: string; bytes: number; modified?: string };
type Manifest = {
  format: 'glass-cloud-workspace';
  version: 1;
  files: RecordFile[];
  privateSettings?: boolean;
};
type Review = { files: Map<string, File>; manifest: Manifest; version: number };
type Key = { id: string; created: string; scopes: string; revoked: number };
export function Hosting() {
  const [status, setStatus] = useState<any>(),
    [keys, setKeys] = useState<Key[]>([]),
    [authoringKey, setAuthoringKey] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState({ done: 0, total: 0 }),
    [review, setReview] = useState<Review>();
  const refresh = async () => {
    try {
      const [value, tokens] = await Promise.all([
        api('cloud/status'),
        api<Key[]>('cloud/mcp-keys'),
      ]);
      setStatus(value);
      setKeys(tokens);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  async function choose(list: FileList | null) {
    if (!list?.length || !status) return;
    setError('');
    try {
      const files = [...list],
        manifestFile = files.find((file) => file.name === 'manifest.json');
      if (!manifestFile)
        throw new Error(t('Choose the exported cloud workspace folder, including manifest.json.'));
      const manifest = JSON.parse(await manifestFile.text()) as Manifest;
      if (
        manifest.format !== 'glass-cloud-workspace' ||
        manifest.version !== 1 ||
        !Array.isArray(manifest.files) ||
        manifest.files.length < 2 ||
        manifest.files.length > 30000 ||
        new Set(manifest.files.map((file) => file.path)).size !== manifest.files.length
      )
        throw new Error(t('This folder is not a Glass cloud migration export.'));
      const prefix = manifestFile.webkitRelativePath.slice(0, -manifestFile.name.length) + 'data/';
      const indexed = new Map(
        files
          .filter((file) => file.webkitRelativePath.startsWith(prefix))
          .map((file) => [file.webkitRelativePath.slice(prefix.length), file]),
      );
      for (const record of manifest.files) {
        if (
          !/^(?:content\/|\.studio\/|dist\/)/.test(record.path) ||
          record.path.split('/').some((part) => !part || part === '.' || part === '..') ||
          record.path.includes('\\') ||
          !/^[a-f0-9]{64}$/.test(record.sha) ||
          !Number.isSafeInteger(record.bytes) ||
          record.bytes < 0 ||
          indexed.get(record.path)?.size !== record.bytes
        )
          throw new Error(
            t('An exported file is missing or has changed: {value0}', { value0: record.path }),
          );
      }
      manifest.privateSettings = manifest.files.some(
        (file) =>
          file.path === '.studio/connections.json' || file.path.startsWith('.studio/services/'),
      );
      setReview({ files: indexed, manifest, version: status.version });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function migrate() {
    if (!review) return;
    setBusy(true);
    setError('');
    setMessage('');
    setProgress({ done: 0, total: review.manifest.files.length });
    const controller = new AbortController();
    try {
      const session = await send('cloud/migration', 'POST', { version: review.version }),
        queue = [...review.manifest.files];
      let done = 0;
      const settled = await Promise.allSettled(
        Array.from({ length: Math.min(6, queue.length) }, async () => {
          try {
            for (;;) {
              controller.signal.throwIfAborted();
              const record = queue.shift();
              if (!record) return;
              const result = await api<RecordFile>(
                'cloud/migration/' +
                  session.id +
                  '/file?' +
                  new URLSearchParams({ path: record.path }),
                {
                  method: 'PUT',
                  signal: controller.signal,
                  body: review.files.get(record.path)!,
                  headers: {
                    'Content-Type': 'application/octet-stream',
                    ...(record.modified ? { 'X-File-Modified': record.modified } : {}),
                  },
                },
              );
              if (result.sha !== record.sha)
                throw new Error(
                  t('An exported file failed its checksum: {value0}', { value0: record.path }),
                );
              setProgress({ done: ++done, total: review.manifest.files.length });
            }
          } catch (error) {
            controller.abort();
            throw error;
          }
        }),
      );
      const failed = settled.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      await send('cloud/migration/' + session.id + '/commit', 'POST', {
        files: review.manifest.files.map(({ path, sha, bytes }) => ({ path, sha, bytes })),
      });
      setReview(undefined);
      setMessage(t('Notebook imported. Reload Studio to open the cloud copy.'));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
        [t('Workers Builds'), status.buildsConfigured ? t('Configured') : t('Needs setup')],
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
            <li>{t('Production code pushes rebuild the last approved release.')}</li>
            <li>{t('Branch previews use isolated synthetic notebooks and separate storage.')}</li>
          </ol>
          <p className="help">
            {t(
              'Backups, restoration and media optimization can wait in the build queue. A failed build leaves the last verified public release available.',
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
        <section className="glass-panel hosting-section">
          <h2>
            <Icon name="FolderUp" size={19} />
            {t('Import your notebook')}
          </h2>
          <p>
            {t(
              'Choose a cloud:export folder to review its contents. Files upload privately, pass checksum validation, then replace the notebook together. Keep the original notebook until verification is complete.',
            )}
          </p>
          <label className="button secondary hosting-file" aria-disabled={busy || status?.preview}>
            <Icon name="FolderOpen" size={16} />
            {t('Choose migration folder')}
            <input
              aria-label={t('Choose migration folder')}
              type="file"
              multiple
              {...{ webkitdirectory: '' }}
              disabled={busy || status?.preview || !status}
              onChange={(event) => void choose(event.target.files)}
            />
          </label>
          {progress.total > 0 && (
            <div className="hosting-progress" role="status">
              <progress
                value={progress.done}
                max={progress.total}
                aria-label={t('Notebook migration progress')}
              />
              <span>
                {t('Uploaded {value0} of {value1}', {
                  value0: progress.done,
                  value1: progress.total,
                })}
              </span>
            </div>
          )}
        </section>
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
      <section className="glass-panel hosting-section hosting-jobs">
        <h2>
          <Icon name="Activity" size={19} />
          {t('Cloud operations')}
        </h2>
        <ul>
          {status?.jobs?.slice(0, 12).map((job: any) => (
            <li key={job.id}>
              <div>
                <strong>
                  {job.kind === 'api'
                    ? JSON.parse(job.request).path
                    : job.kind === 'publish'
                      ? t('Build & publish')
                      : t('Static site build')}
                </strong>
                <small>
                  {new Date(job.created).toLocaleString()}
                  {job.commit_sha ? ' · ' + job.commit_sha.slice(0, 8) : ''}
                </small>
                {job.error && <p className="help">{job.error}</p>}
              </div>
              <JobStatus state={(job.state === 'running' ? 'building' : job.state) as JobState} />
              {job.state === 'queued' && (
                <Button
                  className="small"
                  variant="ghost"
                  icon="X"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await send('cloud-jobs/' + job.id + '/cancel', 'POST', {});
                      await refresh();
                    } catch (failure) {
                      setError((failure as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t('Cancel queued request')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!status?.jobs?.length && <p className="help">{t('No cloud operations yet.')}</p>}
      </section>
      <div className="hosting-signout">
        <Icon name="ShieldCheck" size={16} />
        <span>{t('Owner access is verified by Cloudflare Access.')}</span>
        <a className="text-link" href="/cdn-cgi/access/logout">
          {t('Sign out')}
        </a>
      </div>
      {review && (
        <Modal
          title={t('Review notebook import')}
          onClose={() => {
            if (!busy) setReview(undefined);
          }}
          footer={
            <>
              <Button onClick={() => setReview(undefined)} disabled={busy}>
                {t('Cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => void migrate()}
                disabled={busy}
                icon={busy ? 'LoaderCircle' : 'CloudUpload'}
              >
                {busy ? t('Importing…') : t('Import reviewed notebook')}
              </Button>
            </>
          }
        >
          <p>
            {t(
              'This replaces the current cloud notebook with {value0} verified files ({value1}). The live public site and original notebook remain available.',
              {
                value0: review.manifest.files.length,
                value1: formatBytes(
                  review.manifest.files.reduce((sum, file) => sum + file.bytes, 0),
                ),
              },
            )}
          </p>
          {review.manifest.privateSettings && (
            <p className="help">
              {t(
                'This restricted export includes private service settings and credentials. They remain encrypted in private cloud storage.',
              )}
            </p>
          )}
          <p className="help">
            {t('Newer cloud edits stop the import; they are never overwritten silently.')}
          </p>
          <ErrorBox error={error} />
        </Modal>
      )}
    </div>
  );
}
