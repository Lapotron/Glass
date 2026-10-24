import { useEffect, useState } from 'react';
import { api, send } from './api.js';
import { Button, Icon } from '../shared/ui.js';
import { t } from '../shared/i18n.js';
import { Field, ErrorBox } from './components.js';
import { readerBuild } from '../shared/cloud-builds.js';
export function PagesSetup() {
  const [value, setValue] = useState<any>(),
    [project, setProject] = useState(''),
    [hook, setHook] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [projects, setProjects] = useState<{ name: string }[]>([]);
  async function load() {
    const next = await api('cloud/pages');
    setValue(next);
    setProject(next.project || '');
  }
  useEffect(() => {
    void load().catch((error) => setError(error.message));
  }, []);
  async function act(task: () => Promise<any>) {
    setBusy(true);
    setError('');
    try {
      await task();
      await load();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="glass-panel hosting-section">
      <h2>
        <Icon name="Workflow" size={19} />
        {t('Pages publishing setup')}
      </h2>
      <ol className="hosting-workflow">
        <li>
          {t(
            'Private Studio uses its existing D1 database and R2 binding. No S3 keys are needed for private storage.',
          )}
        </li>
        <li>
          {t('Connect the Studio Git pipeline once. Use its private Deploy Hook for Publish.')}
        </li>
        <li>
          {t(
            'Choose a Direct Upload Pages project. Publish builds the captured notebook; Git updates deploy Studio only.',
          )}
        </li>
      </ol>
      <dl className="hosting-facts">
        <div>
          <dt>{t('Root directory')}</dt>
          <dd>
            <code>{readerBuild.root}</code>
          </dd>
        </div>
        <div>
          <dt>{t('Build command')}</dt>
          <dd>
            <code>{readerBuild.build}</code>
          </dd>
        </div>
        <div>
          <dt>{t('Deploy command')}</dt>
          <dd>
            <code>{readerBuild.deploy}</code>
          </dd>
        </div>
      </dl>
      <Field
        label={t('Studio pipeline Deploy Hook')}
        help={t(
          'Create a private Deploy Hook on the Studio Worker’s Git build. This replaces the old reader Worker hook; its value is encrypted and never displayed again.',
        )}
      >
        <input
          type="password"
          autoComplete="off"
          value={hook}
          onChange={(event) => setHook(event.target.value)}
          placeholder="https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/…"
        />
      </Field>
      <Button
        className="small"
        disabled={busy || !hook}
        onClick={() =>
          void act(async () => {
            if (
              !/^https:\/\/api\.cloudflare\.com\/client\/v4\/workers\/builds\/deploy_hooks\/[\w-]+$/.test(
                hook,
              )
            )
              throw new Error(t('Use the Studio Worker’s private Deploy Hook URL.'));
            const connection = await api('connections');
            await send('connections', 'PUT', {
              revision: connection.revision,
              set: { workersBuildsDeployHook: hook },
            });
            setHook('');
            setMessage(t('Studio Publish hook saved.'));
          })
        }
      >
        {t('Save private hook')}
      </Button>
      <Field
        label={t('Pages project name')}
        help={t(
          'Use a separate Pages project while the old reader Worker remains available for rollback.',
        )}
      >
        <input
          value={project}
          maxLength={58}
          onChange={(event) => setProject(event.target.value)}
          list="hosting-pages-projects"
          placeholder="glass-blog"
        />
        <datalist id="hosting-pages-projects">
          {projects.map((item) => (
            <option key={item.name} value={item.name} />
          ))}
        </datalist>
      </Field>
      <p className="help">
        {t('Cloudflare account')}: {value?.account || t('Not configured')} ·{' '}
        {value?.credential
          ? t('Saved or deployed token available')
          : t('Save a Cloudflare API token in Credentials.')}
      </p>
      <ErrorBox error={error} />
      {message && (
        <p className="help" role="status">
          {message}
        </p>
      )}
      <div className="heading-actions">
        <Button
          icon="Save"
          disabled={busy || !project}
          onClick={() =>
            void act(async () => {
              await send('cloud/pages/target', 'PUT', { project });
              setMessage(t('Pages target saved. No build was started.'));
            })
          }
        >
          {t('Save target')}
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const result = await send('cloud/pages/check', 'POST', {});
              setProjects(result.projects);
              setMessage(
                t('Pages access verified. Select an existing Direct Upload project or create one.'),
              );
            })
          }
        >
          {t('Check connection')}
        </Button>
        <Button
          disabled={busy || !project}
          onClick={() =>
            void act(async () => {
              await send('cloud/pages/project', 'POST', { project });
              setMessage(
                t(
                  'Direct Upload Pages project ready. Save the target, then Publish to verify staging.',
                ),
              );
            })
          }
        >
          {t('Create project')}
        </Button>
      </div>
      {value?.staged && (
        <div className="operation-message">
          <strong>{t('Verified staging release')}</strong>
          <p>
            <a href={value.staged.deployment_url} target="_blank" rel="noreferrer">
              {value.staged.deployment_url}
              <Icon name="ExternalLink" size={13} />
            </a>
          </p>
          <p className="help">
            {t(
              'Review this release before attaching the public domain in Pages → Custom domains. Keep the old reader Worker until the canonical deployment marker is verified. Nothing here removes the existing public route.',
            )}
          </p>
        </div>
      )}
      <p className="help">
        <a className="text-link" href="#settings/connections">
          {t('Open connection credentials')}
        </a>{' '}
        ·{' '}
        <a
          className="text-link"
          href="/authoring/hosted-studio.md"
          target="_blank"
          rel="noreferrer"
        >
          {t('Deployment and migration guide')}
        </a>
      </p>
    </section>
  );
}
