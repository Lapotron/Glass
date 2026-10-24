import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState } from 'react';
import {
  connectionFields,
  type ConnectionField,
  type ConnectionSummary,
  type RuntimeSummary,
  type ServiceReadiness,
} from '../shared/local-settings.js';
import { Button, Icon } from '../shared/ui.js';
import { api, send, isCloudStudio } from './api.js';
import { ErrorBox, Field } from './components.js';
import type { FlushRef } from './Editor.js';

const emptyCredentials = () => ({
  cloudflareApiToken: '',
  cloudflareBuildsApiToken: '',
  workersBuildsDeployHook: '',
  acaReportToken: '',
  r2AccessKeyId: '',
  r2SecretAccessKey: '',
});
const labels: Record<ConnectionField, string> = {
  cloudflareApiToken: 'Cloudflare API token',
  cloudflareBuildsApiToken: 'Workers Builds API token',
  workersBuildsDeployHook: 'Workers Builds Deploy Hook',
  acaReportToken: 'ACA private report token',
  r2AccessKeyId: 'R2 access key ID',
  r2SecretAccessKey: 'R2 secret access key',
};
export function usePrivateFlush(
  flushRef: FlushRef,
  save: () => Promise<void>,
  dirty: boolean,
  onDirty: (dirty: boolean) => void,
) {
  const latest = useRef({ save, dirty });
  latest.current = { save, dirty };
  useEffect(() => onDirty(dirty), [dirty]);
  useEffect(() => {
    flushRef.current = () => latest.current.save();
    const handler = (event: BeforeUnloadEvent) => {
      if (latest.current.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      flushRef.current = null;
      window.removeEventListener('beforeunload', handler);
    };
  }, []);
}
export function ConnectionControls({
  flushRef,
  onDirty,
  onSaved,
  saveSite,
}: {
  flushRef: FlushRef;
  onDirty: (dirty: boolean) => void;
  onSaved: () => void;
  saveSite: () => Promise<void>;
}) {
  const [summary, setSummary] = useState<ConnectionSummary | null>(null),
    [draft, setDraft] = useState(emptyCredentials),
    [remove, setRemove] = useState<ConnectionField[]>([]),
    [shown, setShown] = useState<Partial<Record<ConnectionField, boolean>>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const latest = useRef({ draft, remove });
  const [services, setServices] = useState<ServiceReadiness | null>(null);
  const serviceLabels = {
    workers: t('Workers read access'),
    d1: t('D1 read access'),
    access: t('Access organization'),
    zone: t('Site zone access'),
  };
  latest.current = { draft, remove };
  const state = useRef(summary);
  state.current = summary;
  const pending = useRef<Promise<void> | null>(null);
  const dirty = remove.length > 0 || Object.values(draft).some(Boolean);
  async function load() {
    try {
      const value = await api<ConnectionSummary>('connections');
      state.current = value;
      setSummary(value);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    if (pending.current) await pending.current;
    const snapshot = latest.current;
    if (!snapshot.remove.length && !Object.values(snapshot.draft).some(Boolean)) return;
    if (!state.current) throw new Error('Wait for credential status to load.');
    setBusy(true);
    setError('');
    const operation = (async () => {
      try {
        const set = Object.fromEntries(
          Object.entries(snapshot.draft)
            .filter(
              ([key, value]) =>
                Boolean(value.trim()) && !snapshot.remove.includes(key as ConnectionField),
            )
            .map(([key, value]) => [key, value.trim()]),
        );
        const result = await send<ConnectionSummary>('connections', 'PUT', {
          revision: state.current!.revision,
          set,
          remove: snapshot.remove,
        });
        state.current = result;
        setSummary(result);
        setServices(null);
        latest.current = { draft: emptyCredentials(), remove: [] };
        setDraft(emptyCredentials());
        setRemove([]);
        setMessage('Credentials saved privately on this computer.');
        onSaved();
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setBusy(false);
      }
    })();
    pending.current = operation;
    try {
      await operation;
    } finally {
      pending.current = null;
    }
  }
  usePrivateFlush(flushRef, save, dirty, onDirty);
  const removing = (fields: ConnectionField[]) => {
    setRemove((current) =>
      fields.every((key) => current.includes(key))
        ? current.filter((key) => !fields.includes(key))
        : [...new Set([...current, ...fields])],
    );
    setMessage('');
  };
  return (
    <div className="local-connections">
      <div className="settings-card-heading">
        <Icon name="LockKeyhole" />
        <h2 data-ui={'Private connection credentials'}>{t('Private connection credentials')}</h2>
      </div>
      <section className="service-readiness">
        <h3>{t('Independent services')}</h3>
        <p className="help">
          {t(
            'Check account access for ACA and private staging. This read-only check does not create resources or prove deployment write permissions.',
          )}
        </p>
        <Button
          className="small"
          icon="CloudUpload"
          disabled={busy}
          onClick={async () => {
            try {
              await saveSite();
              await save();
              setBusy(true);
              setError('');
              setServices(null);
              setServices(await api<ServiceReadiness>('services/readiness'));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('Check service readiness')}
        </Button>
        {services && (
          <>
            <p className="help">
              {t('Checked account')}: <code>{services.accountId}</code>
            </p>
            <dl>
              {services.checks.map((check) => (
                <div key={check.id}>
                  <dt>{serviceLabels[check.id]}</dt>
                  <dd>
                    <Icon
                      name={check.status === 'ready' ? 'CheckCircle2' : 'AlertCircle'}
                      size={14}
                    />
                    {t(
                      check.status === 'ready'
                        ? 'Read access verified'
                        : check.status === 'denied'
                          ? 'Permission required'
                          : check.status === 'missing'
                            ? 'Setup required'
                            : 'Check unavailable',
                    )}
                    {check.codes.length > 0 && <small> · {check.codes.join(', ')}</small>}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>
      <p className="help">
        {isCloudStudio()
          ? t(
              'Cloudflare deployments supply encrypted connection defaults automatically. Enter a value here only to override that default. Credentials stay private and are excluded from portable backups.',
            )
          : t(
              'Saved on this computer, separately from your notebook and portable backups. Leave a field empty to keep its saved value.',
            )}
      </p>
      <p className="help">
        {isCloudStudio()
          ? t(
              'Automatic setup reuses credentials supplied to the Studio build; it cannot grant extra API permissions. Access service credentials remain in Builds. R2 S3 credentials are optional separate defaults.',
            )
          : t(
              'Pages needs an API token with Account → Cloudflare Pages → Edit scoped to your selected account. Enter R2 S3 credentials in their separate fields below.',
            )}
      </p>
      <fieldset className="private-fields" disabled={busy || !summary}>
        {connectionFields.map((key) => (
          <Field
            key={key}
            label={labels[key]}
            help={
              remove.includes(key)
                ? t('Removal pending.')
                : summary?.fields[key].source === 'studio'
                  ? isCloudStudio()
                    ? t('Saved privately in Cloudflare.')
                    : t('Saved locally.')
                  : summary?.fields[key].source === 'environment'
                    ? isCloudStudio()
                      ? t('Provided by the Cloudflare deployment.')
                      : t('Available from the server environment.')
                    : t('No credential saved.')
            }
          >
            <div className="input-with-button">
              <input
                type={shown[key] ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                aria-label={labels[key]}
                value={draft[key]}
                placeholder={
                  summary?.fields[key].configured
                    ? t('Enter a replacement to change it')
                    : t('Paste credential')
                }
                onChange={(event) => {
                  setDraft((current) => ({ ...current, [key]: event.target.value }));
                  setMessage('');
                }}
              />
              <Button
                className="small"
                icon={shown[key] ? 'EyeOff' : 'Eye'}
                disabled={!draft[key]}
                onClick={() => setShown((current) => ({ ...current, [key]: !current[key] }))}
              >
                {shown[key] ? t('Hide') : t('Show')}
              </Button>
            </div>
          </Field>
        ))}
        <div className="private-settings-actions">
          <Button
            className="small"
            icon="Trash2"
            disabled={
              summary?.fields.acaReportToken.source !== 'studio' &&
              !remove.includes('acaReportToken')
            }
            onClick={() => removing(['acaReportToken'])}
          >
            {remove.includes('acaReportToken') ? t('Keep ACA token') : t('Remove ACA token')}
          </Button>
          <Button
            className="small"
            icon="Check"
            disabled={!dirty}
            onClick={() => {
              void save().catch(() => undefined);
            }}
          >
            <UiText message={'Save credentials'} />
          </Button>
          <Button
            className="small"
            icon="Trash2"
            disabled={
              summary?.fields.cloudflareApiToken.source !== 'studio' &&
              !remove.includes('cloudflareApiToken')
            }
            onClick={() => removing(['cloudflareApiToken'])}
          >
            {remove.includes('cloudflareApiToken')
              ? t('Undo token removal')
              : t('Remove saved token')}
          </Button>
          <Button
            className="small"
            icon="Trash2"
            disabled={
              summary?.fields.r2AccessKeyId.source !== 'studio' && !remove.includes('r2AccessKeyId')
            }
            onClick={() => removing(['r2AccessKeyId', 'r2SecretAccessKey'])}
          >
            {remove.includes('r2AccessKeyId') ? t('Undo R2 removal') : t('Remove R2 credentials')}
          </Button>
        </div>
      </fieldset>
      <div className="private-settings-actions">
        <Button
          className="small"
          disabled={busy || !summary}
          icon="Download"
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              if (dirty) throw new Error('Save or clear your credential draft before importing.');
              const result = await send<ConnectionSummary>(
                'connections/import-environment',
                'POST',
                { revision: summary!.revision },
              );
              state.current = result;
              setSummary(result);
              setMessage('Available environment credentials imported privately.');
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <UiText message={'Import from environment'} />
        </Button>
        <Button
          className="small"
          icon="RotateCcw"
          disabled={busy}
          onClick={() => {
            void load();
          }}
        >
          <UiText message={'Reload credential status'} />
        </Button>
        <Button
          className="small"
          icon="CheckCircle2"
          disabled={busy}
          onClick={async () => {
            try {
              await saveSite();
              await save();
              setBusy(true);
              setError('');
              const result = await send<{ message: string }>('connections/test', 'POST', {
                provider: 'r2',
              });
              setMessage(result.message);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <UiText message={'Test saved R2 connection'} />
        </Button>
      </div>
      {message && (
        <p className="help" role="status">
          {message}
        </p>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
export function RuntimeControls({
  flushRef,
  onDirty,
}: {
  flushRef: FlushRef;
  onDirty: (dirty: boolean) => void;
}) {
  const [summary, setSummary] = useState<RuntimeSummary | null>(null),
    [draft, setDraft] = useState({ port: 4310, notebookRoot: '' }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const baseline = useRef(''),
    latest = useRef(draft),
    state = useRef(summary),
    pending = useRef<Promise<void> | null>(null);
  latest.current = draft;
  state.current = summary;
  const dirty = Boolean(summary) && JSON.stringify(draft) !== baseline.current;
  async function load(keepDraft = false) {
    try {
      if (isCloudStudio()) return;
      const value = await api<RuntimeSummary>('runtime-settings');
      state.current = value;
      setSummary(value);
      if (!keepDraft) {
        baseline.current = JSON.stringify(value.saved);
        latest.current = value.saved;
        setDraft(value.saved);
      }
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    if (pending.current) await pending.current;
    const value = latest.current;
    if (!state.current || JSON.stringify(value) === baseline.current) return;
    setBusy(true);
    setError('');
    const operation = (async () => {
      try {
        const result = await send<RuntimeSummary>('runtime-settings', 'PUT', {
          value,
          revision: state.current!.revision,
        });
        baseline.current = JSON.stringify(result.saved);
        latest.current = result.saved;
        state.current = result;
        setDraft(result.saved);
        setSummary(result);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setBusy(false);
      }
    })();
    pending.current = operation;
    try {
      await operation;
    } finally {
      pending.current = null;
    }
  }
  usePrivateFlush(flushRef, save, dirty, onDirty);
  if (isCloudStudio())
    return (
      <p className="help">
        <UiText message="This Studio runs on Cloudflare. Manage its hostname and deployment in Hosting." />
      </p>
    );
  return (
    <div className="local-runtime">
      <div className="settings-card-heading">
        <Icon name="Settings2" />
        <h2 data-ui={'Local Studio'}>{t('Local Studio')}</h2>
      </div>
      <p
        className="help"
        data-ui={
          'Choose the port and an existing notebook folder for the next launch. The current notebook stays open until you restart Studio.'
        }
      >
        {t(
          'Choose the port and an existing notebook folder for the next launch. The current notebook stays open until you restart Studio.',
        )}
      </p>
      <fieldset className="private-fields" disabled={busy || !summary}>
        <Field
          label={t('Studio port')}
          help={t('A port from 1024 to 65535. The local address always uses this computer.')}
        >
          <input
            type="number"
            min="1024"
            max="65535"
            aria-label={t('Studio port')}
            value={draft.port}
            onChange={(event) =>
              setDraft((current) => ({ ...current, port: Number(event.target.value) }))
            }
            data-ui-attrs={'{"aria-label":"Studio port"}'}
          />
        </Field>
        <Field
          label={t('Notebook folder')}
          help={t('An absolute path containing content/site.json and content/library.json.')}
        >
          <input
            value={draft.notebookRoot}
            aria-label={t('Notebook folder')}
            spellCheck={false}
            onChange={(event) =>
              setDraft((current) => ({ ...current, notebookRoot: event.target.value }))
            }
            data-ui-attrs={'{"aria-label":"Notebook folder"}'}
          />
        </Field>
        <Button
          className="small"
          icon="Check"
          disabled={!dirty}
          onClick={() => {
            void save().catch(() => undefined);
          }}
        >
          <UiText message={'Save startup settings'} />
        </Button>
      </fieldset>
      {summary && (
        <div className="settings-note">
          <Icon name="Info" size={18} />
          <div>
            <p>
              <UiText message={'Active: http://127.0.0.1:'} />
              {summary.active.port}
            </p>
            <p className="mono">{summary.active.notebookRoot}</p>
            <p role="status">
              {summary.restartRequired
                ? t('Saved startup changes take effect on the next launch.')
                : t('Saved settings match this Studio session.')}
            </p>
          </div>
        </div>
      )}
      <Button
        className="small"
        icon="RotateCcw"
        onClick={() => {
          void load(true);
        }}
      >
        <UiText message={'Reload startup status'} />
      </Button>
      <ErrorBox error={error} />
    </div>
  );
}
