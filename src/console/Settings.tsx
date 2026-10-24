import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { SettingsNavigation } from './SettingsNavigation.js';
import { AppearanceSettings } from './AppearanceSettings.js';
import { LanguageSettings } from './LanguageSettings.js';
import { resolveSettingsSection, settingsFieldSection } from './settings-navigation.js';
import { MediaDeliverySettings } from './MediaDeliverySettings.js';
import { MediaProtectionSettings } from './MediaProtectionSettings.js';
import { CollectionSettings } from './CollectionSettings.js';
import { retainCollectionPaths } from '../shared/collections.js';
import { ConnectionControls, RuntimeControls } from './LocalSettings.js';
import { NotebookResetControls } from './NotebookReset.js';
import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '../shared/ui.js';
import { siteSchema, publicNavigationFor, type SiteConfig } from '../shared/contracts.js';
import { api, send, ApiError } from './api.js';
import { Field, PageHeading, MediaPicker, ErrorBox, CopyButton, Modal } from './components.js';
import {
  BrandingSettings,
  MetadataSettings,
  FooterSettings,
  FeedSettings,
  NavigationTools,
  type SiteImageField,
} from './SiteDetails.js';
import type { FlushRef } from './Editor.js';
import { ScheduleSettings } from './ScheduleSettings.js';
import { IntegrationSettings } from './IntegrationSettings.js';
import { AcaDeploymentControls } from './AcaDeployment.js';
import type { CloudflareConnection, CloudflareProject } from '../shared/local-settings.js';

type Props = {
  site: SiteConfig;
  revision: string;
  appearance?: boolean;
  initialTab?: string;
  flushRef: FlushRef;
  onSaved: (site: SiteConfig, revision: string) => void;
  onStatus: (status: string) => void;
  articleRoute?: string;
  onReset: () => Promise<void>;
};
export function Settings({
  site,
  revision,
  appearance,
  initialTab = 'general',
  flushRef,
  onSaved,
  onStatus,
  articleRoute,
  onReset,
}: Props) {
  const [draft, setDraft] = useState(() => siteSchema.parse(site)),
    [tab, setTab] = useState(() =>
      resolveSettingsSection(location.hash.split('/')[1]?.split('?')[0] || initialTab, appearance),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [picker, setPicker] = useState<'background' | SiteImageField | null>(null),
    [preview, setPreview] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false),
    [previewBusy, setPreviewBusy] = useState(false);
  const previewRequest = useRef<AbortController | null>(null);
  const [previewRoute, setPreviewRoute] = useState('/');
  const [validation, setValidation] = useState<{ path: (string | number)[]; message: string }[]>(
    [],
  );
  function activate(section: string) {
    const next = resolveSettingsSection(section, appearance);
    setTab(next);
    history.replaceState(null, '', `#${appearance ? 'appearance' : 'settings'}/${next}`);
  }
  useEffect(() => {
    const change = () => {
      if (location.hash.split('/')[0] === `#${appearance ? 'appearance' : 'settings'}`)
        setTab(
          resolveSettingsSection(
            location.hash.split('/')[1]?.split('?')[0] || initialTab,
            appearance,
          ),
        );
    };
    addEventListener('hashchange', change);
    return () => removeEventListener('hashchange', change);
  }, [appearance, initialTab]);
  function revealIssue(path: (string | number)[]) {
    activate(settingsFieldSection(path, appearance));
    requestAnimationFrame(() => {
      const fields = [
        ...document.querySelectorAll<HTMLInputElement>(
          '.settings-detail input, .settings-detail textarea, .settings-detail select',
        ),
      ].filter((field) => field.getClientRects().length && !field.disabled);
      (
        fields.find((field) => field.dataset.settingField === String(path.at(-1))) || fields[0]
      )?.focus();
    });
  }
  const [auth, setAuth] = useState<CloudflareConnection | null>(null),
    [checking, setChecking] = useState(false),
    [projects, setProjects] = useState<CloudflareProject[]>([]),
    [projectMessage, setProjectMessage] = useState('');
  const savedRevision = useRef(revision),
    baseline = useRef(JSON.stringify(siteSchema.parse(site))),
    latest = useRef(draft),
    pending = useRef<Promise<void> | null>(null);
  const connectionFlush = useRef<(() => Promise<void>) | null>(null),
    runtimeFlush = useRef<(() => Promise<void>) | null>(null),
    acaFlush = useRef<(() => Promise<void>) | null>(null);
  const connectionCheck = useRef(0);
  const [privateDirty, setPrivateDirty] = useState({
    connections: false,
    runtime: false,
    aca: false,
  });
  latest.current = draft;
  const savingSnapshot = useRef<string | null>(null);
  const serialized = JSON.stringify(draft),
    dirty =
      serialized !== baseline.current ||
      privateDirty.connections ||
      privateDirty.runtime ||
      privateDirty.aca;
  function update(patch: Partial<SiteConfig>) {
    if (patch.cloudflare) setProjectMessage('');
    if (patch.cloudflare && patch.cloudflare.accountId !== latest.current.cloudflare.accountId) {
      connectionCheck.current++;
      setAuth(null);
      setProjects([]);
    }
    setDraft((s) => ({ ...s, ...patch }));
  }
  function theme(patch: Partial<SiteConfig['theme']>) {
    setDraft((s) => ({ ...s, theme: { ...s.theme, ...patch } }));
  }
  async function saveSite() {
    if (pending.current) await pending.current;
    const value = latest.current;
    const text = JSON.stringify(value);
    if (text === baseline.current) return;
    if (conflict) throw new Error('Reload the latest settings before saving.');
    const parsed = siteSchema.safeParse(value);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('\n');
      setError(message);
      setValidation(
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String),
          message: issue.message,
        })),
      );
      revealIssue(parsed.error.issues[0].path.map(String));
      throw new Error(message);
    }
    try {
      parsed.data.collections = retainCollectionPaths(
        parsed.data.collections,
        JSON.parse(baseline.current).collections,
      );
    } catch (error) {
      const message = (error as Error).message;
      setError(message);
      throw error;
    }
    setBusy(true);
    setError('');
    setValidation([]);
    onStatus('Saving…');
    savingSnapshot.current = JSON.stringify(parsed.data);
    const operation = (async () => {
      try {
        const result = await send<{ value: SiteConfig; revision: string }>('site', 'PUT', {
          value,
          revision: savedRevision.current,
        });
        savedRevision.current = result.revision;
        baseline.current = JSON.stringify(result.value);
        if (JSON.stringify(latest.current) === text) {
          latest.current = result.value;
          setDraft(result.value);
        } else {
          // Keep edits made during the request while accepting the server's retained path history.
          const current = latest.current;
          latest.current = {
            ...current,
            collections: {
              posts: {
                ...current.collections.posts,
                aliases: result.value.collections.posts.aliases,
              },
              lab: { ...current.collections.lab, aliases: result.value.collections.lab.aliases },
              life: { ...current.collections.life, aliases: result.value.collections.life.aliases },
            },
          };
          setDraft(latest.current);
        }
        onSaved(result.value, result.revision);
        onStatus('All changes saved');
      } catch (e) {
        setError((e as Error).message);
        if (e instanceof ApiError && e.status === 409) setConflict(true);
        onStatus('Changes need attention');
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
      savingSnapshot.current = null;
    }
    if (JSON.stringify(latest.current) !== baseline.current) await saveSite();
  }
  async function save() {
    try {
      await saveSite();
      await connectionFlush.current?.();
      await runtimeFlush.current?.();
      await acaFlush.current?.();
      onStatus('All changes saved');
    } catch (e) {
      onStatus('Changes need attention');
      throw e;
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    flushRef.current = () => saveRef.current();
    return () => {
      flushRef.current = null;
    };
  }, []);
  useEffect(() => {
    onStatus(dirty ? 'Unsaved changes' : 'All changes saved');
  }, [dirty]);
  useEffect(() => {
    if (revision === savedRevision.current) return;
    if (savingSnapshot.current === JSON.stringify(site)) return;
    if (JSON.stringify(latest.current) === JSON.stringify(site)) return;
    if (JSON.stringify(latest.current) !== baseline.current) {
      setConflict(true);
      setError(
        'Settings changed outside Studio. Your changes are still here; reload when you are ready.',
      );
    } else {
      savedRevision.current = revision;
      baseline.current = JSON.stringify(siteSchema.parse(site));
      setDraft(siteSchema.parse(site));
    }
  }, [revision]);
  useEffect(() => {
    if (!appearance) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ url: string }>('preview', {
        method: 'POST',
        body: JSON.stringify({ site: draft, route: previewRoute }),
        signal: controller.signal,
      })
        .then((data) => setPreview(data.url))
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [serialized, appearance, previewRoute]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current) !== baseline.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  async function checkCloudflare() {
    setChecking(true);
    setError('');
    setAuth(null);
    setProjects([]);
    setProjectMessage('');
    try {
      await save();
      const check = ++connectionCheck.current;
      const result = await api<NonNullable<typeof auth>>('cloudflare');
      if (check !== connectionCheck.current) return;
      setAuth(result);
      setProjects(result.projects || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  const footer = (
    <div className="settings-save">
      <span>
        <Icon name={dirty ? 'Circle' : 'CheckCheck'} size={15} />
        {dirty ? t('Changes are previewed until you save.') : t('Your settings are saved locally.')}
      </span>
      <Button
        variant="primary"
        icon={busy ? 'LoaderCircle' : 'Check'}
        disabled={busy || !dirty || conflict}
        onClick={() => {
          void save().catch(() => undefined);
        }}
      >
        {busy ? t('Saving…') : t('Save changes')}
      </Button>
    </div>
  );
  function reload() {
    setDraft(siteSchema.parse(site));
    savedRevision.current = revision;
    baseline.current = JSON.stringify(siteSchema.parse(site));
    setConflict(false);
    setError('');
  }
  const mediaPicker = picker && (
    <MediaPicker
      rasterOnly={picker !== 'background'}
      onClose={() => setPicker(null)}
      onSelect={(url) => {
        if (picker === 'background') theme({ backgroundImage: url });
        else if (picker === 'socialImage')
          update({ metadata: { ...draft.metadata, socialImage: url } });
        else update({ branding: { ...draft.branding, [picker]: url } });
      }}
    />
  );
  async function openPreview() {
    previewRequest.current?.abort();
    const parsed = siteSchema.safeParse(latest.current);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      );
      return;
    }
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreview('');
    setPreviewOpen(true);
    setPreviewBusy(true);
    setError('');
    try {
      const result = await api<{ url: string }>('preview', {
        method: 'POST',
        body: JSON.stringify({ site: parsed.data, route: '/' }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
      });
      if (!controller.signal.aborted) setPreview(result.url);
    } catch (error) {
      if (!controller.signal.aborted) {
        setPreviewOpen(false);
        setError((error as Error).message);
      }
    } finally {
      if (previewRequest.current === controller) setPreviewBusy(false);
    }
  }
  useEffect(() => () => previewRequest.current?.abort(), []);
  return (
    <div className={`studio-page settings-page${appearance ? ' appearance-page' : ''}`}>
      <PageHeading
        eyebrow={appearance ? t('Make it feel like you') : t('The details that make it yours')}
        title={appearance ? t('A material, a mood.') : t('Your notebook, your way.')}
        description={
          appearance
            ? t(
                'Set the notebook’s appearance defaults. Readers can personalize their own view through Reader settings.',
              )
            : t('Focused settings for your site, services, and local workspace.')
        }
      >
        <Button
          icon={previewBusy ? 'LoaderCircle' : 'Eye'}
          disabled={previewBusy}
          onClick={() => void openPreview()}
        >
          <UiText message={'Preview site'} />
        </Button>
      </PageHeading>
      <ErrorBox error={validation.length ? '' : error} />
      {conflict && (
        <Button icon="RotateCcw" onClick={reload}>
          <UiText message={'Reload latest settings'} />
        </Button>
      )}
      {validation.length > 0 && (
        <div className="settings-validation" role="alert">
          {validation.map((issue, index) => (
            <button
              type="button"
              className="text-link"
              key={index}
              onClick={() => revealIssue(issue.path)}
            >
              {issue.path.join('.')} · {issue.message}
            </button>
          ))}
        </div>
      )}
      <div className="settings-workspace">
        <SettingsNavigation section={tab} appearance={appearance} onChange={activate} />
        <div className="settings-detail">
          {!appearance && (
            <section className="settings-card glass-panel settings-form">
              {['branding', 'icons', 'browser'].includes(tab) && (
                <BrandingSettings
                  section={tab}
                  value={draft}
                  onChange={update}
                  onPick={setPicker}
                />
              )}
              {['metadata', 'sharing', 'indexing'].includes(tab) && (
                <MetadataSettings
                  section={tab}
                  value={draft}
                  onChange={update}
                  onPick={setPicker}
                />
              )}
              {tab === 'languages' && <LanguageSettings value={draft} onChange={update} />}
              {tab === 'footer' && <FooterSettings value={draft} onChange={update} />}
              {tab === 'feeds' && <FeedSettings value={draft} onChange={update} />}
              <div hidden={tab !== 'local'}>
                <RuntimeControls
                  flushRef={runtimeFlush}
                  onDirty={(value) =>
                    setPrivateDirty((current) =>
                      current.runtime === value ? current : { ...current, runtime: value },
                    )
                  }
                />
              </div>
              <div hidden={tab !== 'reset'}>
                <NotebookResetControls
                  collections={draft.collections}
                  beforeReview={save}
                  onCompleted={async () => {
                    setPreview('');
                    await onReset();
                  }}
                />
              </div>
              <div hidden={tab !== 'connections'}>
                <ConnectionControls
                  flushRef={connectionFlush}
                  saveSite={saveSite}
                  onSaved={() => {
                    connectionCheck.current++;
                    setAuth(null);
                    setProjects([]);
                    setProjectMessage('');
                  }}
                  onDirty={(value) =>
                    setPrivateDirty((current) =>
                      current.connections === value ? current : { ...current, connections: value },
                    )
                  }
                />
              </div>
              <div
                hidden={
                  ![
                    'discussions',
                    'newsletter',
                    'aca',
                    'cloudflare-analytics',
                    'google-analytics',
                  ].includes(tab)
                }
              >
                <IntegrationSettings
                  section={tab}
                  value={draft.integrations}
                  theme={draft.theme}
                  onChange={(integrations) => update({ integrations })}
                  acaSetup={
                    <AcaDeploymentControls
                      contextKey={`${revision}:${connectionCheck.current}:${draft.cloudflare.accountId}:${draft.url}`}
                      flushRef={acaFlush}
                      saveSite={save}
                      onDirty={(aca) =>
                        setPrivateDirty((value) => (value.aca === aca ? value : { ...value, aca }))
                      }
                      onConnected={(job) => {
                        let origin: string;
                        try {
                          origin = new URL(latest.current.url).origin;
                        } catch {
                          return false;
                        }
                        if (
                          job.accountId !== latest.current.cloudflare.accountId ||
                          job.siteOrigin !== origin ||
                          !job.deploymentUrl
                        )
                          return false;
                        update({
                          integrations: {
                            ...latest.current.integrations,
                            aca: {
                              ...latest.current.integrations.aca,
                              endpoint: job.deploymentUrl,
                              siteId: job.options.siteId,
                              dailyNetworkEstimates: job.options.dailyNetworks,
                              collectAudience: job.options.audienceDetails,
                              optionalHistory: job.options.optionalHistory,
                            },
                          },
                        });
                        return true;
                      }}
                    />
                  }
                />
              </div>
              {tab === 'automation' && (
                <ScheduleSettings
                  value={draft.publishing}
                  onChange={(publishing) => update({ publishing })}
                  onSave={save}
                />
              )}
              {tab === 'collections' && (
                <CollectionSettings
                  value={draft.collections}
                  siteUrl={draft.url}
                  onChange={(collections) => update({ collections })}
                />
              )}
              <div hidden={tab !== 'media-delivery'}>
                <MediaDeliverySettings
                  value={draft.mediaDelivery}
                  onChange={(mediaDelivery) => update({ mediaDelivery })}
                  save={save}
                />
                <MediaProtectionSettings
                  site={draft}
                  onChange={(mediaProtection) => update({ mediaProtection })}
                  save={save}
                />
              </div>
              {tab === 'general' && (
                <>
                  <div className="settings-card-heading">
                    <Icon name="BookOpen" />
                    <h2 data-ui={'A little introduction'}>{t('A little introduction')}</h2>
                  </div>
                  <Field label={t('Notebook name')}>
                    <input
                      value={draft.name}
                      data-setting-field="name"
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </Field>
                  <Field
                    label={t('Site description')}
                    help={t('Used in search results and link previews.')}
                  >
                    <textarea
                      rows={3}
                      value={draft.description}
                      data-setting-field="description"
                      onChange={(e) => update({ description: e.target.value })}
                    />
                  </Field>
                  <Field
                    label={t('Canonical site URL')}
                    help={t(
                      'Your public HTTPS address, including a custom domain or your project’s pages.dev address.',
                    )}
                  >
                    <input
                      type="url"
                      value={draft.url}
                      data-setting-field="url"
                      onChange={(e) => update({ url: e.target.value })}
                    />
                  </Field>
                  <div className="settings-note">
                    <Icon name="FolderOpen" size={18} />
                    <p
                      data-ui={
                        'Your source lives in local Markdown and JSON files. Studio saves changes here; publishing sends the generated pages to Cloudflare.'
                      }
                    >
                      {t(
                        'Your source lives in local Markdown and JSON files. Studio saves changes here; publishing sends the generated pages to Cloudflare.',
                      )}
                    </p>
                  </div>
                </>
              )}
              {tab === 'navigation' && (
                <>
                  <div className="settings-card-heading">
                    <Icon name="Menu" />
                    <h2 data-ui={'A clear way around'}>{t('A clear way around')}</h2>
                  </div>
                  <p
                    className="modal-intro"
                    data-ui={'Five destinations, shared across the notebook.'}
                  >
                    {t('Five destinations, shared across the notebook.')}
                  </p>
                  <div className="fixed-navigation">
                    {publicNavigationFor(draft.collections).map((item) => (
                      <a
                        key={item.href}
                        className="chip"
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.label}
                        <Icon name="ArrowUpRight" size={13} />
                      </a>
                    ))}
                  </div>
                  <NavigationTools value={draft} onChange={update} />
                </>
              )}
              {tab === 'cloudflare' && (
                <>
                  <div className="settings-card-heading">
                    <Icon name="CloudUpload" />
                    <h2 data-ui={'Give your notebook a home'}>{t('Give your notebook a home')}</h2>
                  </div>
                  <p
                    className="modal-intro"
                    data-ui={
                      'Build locally, then publish your static pages to Cloudflare Pages. Your console stays on this computer.'
                    }
                  >
                    {t(
                      'Build locally, then publish your static pages to Cloudflare Pages. Your console stays on this computer.',
                    )}
                  </p>
                  <div className="connection-card">
                    <div className="connection-icon">
                      <Icon name="CloudUpload" size={24} />
                    </div>
                    <div>
                      <h3>
                        {auth?.pagesAccess === 'verified'
                          ? t('Pages access verified')
                          : auth?.pagesAccess === 'denied'
                            ? t('Pages access denied')
                            : auth?.pagesAccess === 'unavailable'
                              ? t('Pages access could not be checked')
                              : auth?.authenticated
                                ? t('Choose your Pages account')
                                : t('Connect your Cloudflare account')}
                      </h3>
                      <p>
                        {auth?.pagesAccess === 'verified'
                          ? t(
                              'Studio can list this account’s Pages projects. Deployment requires Cloudflare Pages → Edit permission.',
                            )
                          : t(
                              'Use an API token with Account → Cloudflare Pages → Edit for the account below. Saved tokens take precedence over Wrangler login.',
                            )}
                      </p>
                      {!auth?.authenticated && !auth?.error && (
                        <div className="command-line">
                          <code>npx wrangler login</code>
                          <CopyButton value="npx wrangler login" />
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    className="small"
                    icon={checking ? 'LoaderCircle' : 'RotateCcw'}
                    disabled={checking}
                    onClick={() => {
                      void checkCloudflare();
                    }}
                  >
                    {checking ? t('Checking connection…') : t('Check connection')}
                  </Button>
                  <ErrorBox error={auth?.error || ''} />
                  {auth?.proxyDetected && (
                    <p
                      className="help"
                      data-ui={
                        'Proxy settings were detected. Requests keep using your configured proxy; this notice is separate from the Pages access result.'
                      }
                    >
                      {t(
                        'Proxy settings were detected. Requests keep using your configured proxy; this notice is separate from the Pages access result.',
                      )}
                    </p>
                  )}
                  <a
                    className="text-link"
                    href="https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/#generate-an-api-token"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <UiText message={'Pages token setup '} />
                    <Icon name="ExternalLink" size={13} />
                  </a>
                  <div className="divider" />
                  <Field
                    label={t('Cloudflare account ID')}
                    help={t(
                      'Found in your Cloudflare dashboard; this is an identifier, not a secret.',
                    )}
                  >
                    {auth?.accounts.length ? (
                      <select
                        value={draft.cloudflare.accountId}
                        data-setting-field="accountId"
                        onChange={(e) =>
                          update({ cloudflare: { ...draft.cloudflare, accountId: e.target.value } })
                        }
                      >
                        <option value="" data-ui={'Choose an account'}>
                          {t('Choose an account')}
                        </option>
                        {draft.cloudflare.accountId &&
                          !auth.accounts.some(
                            (account) => account.id === draft.cloudflare.accountId,
                          ) && (
                            <option value={draft.cloudflare.accountId}>
                              <UiText message={'Selected account · '} />
                              {draft.cloudflare.accountId}
                            </option>
                          )}
                        {auth.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} · {a.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={draft.cloudflare.accountId}
                        data-setting-field="accountId"
                        placeholder={t('32-character account ID')}
                        onChange={(e) =>
                          update({
                            cloudflare: { ...draft.cloudflare, accountId: e.target.value.trim() },
                          })
                        }
                        data-ui-attrs={'{"placeholder":"32-character account ID"}'}
                      />
                    )}
                  </Field>
                  <div className="field-row">
                    <Field label={t('Pages project name')}>
                      <input
                        list="pages-projects"
                        value={draft.cloudflare.projectName}
                        data-setting-field="projectName"
                        placeholder={t('my-notebook')}
                        onChange={(e) =>
                          update({
                            cloudflare: { ...draft.cloudflare, projectName: e.target.value },
                          })
                        }
                        data-ui-attrs={'{"placeholder":"my-notebook"}'}
                      />
                      <datalist id="pages-projects">
                        {projects.map((p) => (
                          <option key={p.name} value={p.name} />
                        ))}
                      </datalist>
                    </Field>
                    <Field label={t('Production branch')}>
                      <input
                        value={draft.cloudflare.productionBranch}
                        data-setting-field="productionBranch"
                        onChange={(e) =>
                          update({
                            cloudflare: { ...draft.cloudflare, productionBranch: e.target.value },
                          })
                        }
                      />
                    </Field>
                  </div>
                  {auth?.pagesAccess === 'verified' && draft.cloudflare.projectName && (
                    <p className="help" role="status">
                      {projects.some((project) => project.name === draft.cloudflare.projectName)
                        ? t('Pages project “{value0}” exists in this account.', {
                            value0: draft.cloudflare.projectName,
                          })
                        : t(
                            'Pages project “{value0}” has not been created in this account. Create it below before publishing, or choose an existing project.',
                            { value0: draft.cloudflare.projectName },
                          )}
                    </p>
                  )}
                  <Button
                    className="small"
                    icon="Plus"
                    disabled={
                      busy ||
                      checking ||
                      !draft.cloudflare.projectName ||
                      !draft.cloudflare.accountId
                    }
                    onClick={async () => {
                      try {
                        setChecking(true);
                        setError('');
                        setProjectMessage('');
                        await save();
                        const target = latest.current.cloudflare;
                        const check = ++connectionCheck.current;
                        const result = await send<{ projects: CloudflareProject[] }>(
                          'cloudflare/project',
                          'POST',
                          {},
                        );
                        if (
                          check !== connectionCheck.current ||
                          target.projectName !== latest.current.cloudflare.projectName
                        )
                          return;
                        setProjects(result.projects);
                        setAuth((previous) => ({
                          authenticated: true,
                          accounts: previous?.accounts || [],
                          accountId: target.accountId,
                          pagesAccess: 'verified',
                          projects: result.projects,
                        }));
                        setProjectMessage(`Pages project “${target.projectName}” is ready.`);
                      } catch (e) {
                        setAuth(null);
                        setProjects([]);
                        setError((e as Error).message);
                      } finally {
                        setChecking(false);
                      }
                    }}
                  >
                    <UiText message={'Create this Pages project'} />
                  </Button>
                  <p
                    className="help"
                    data-ui={
                      'Use an existing project, or create a new Direct Upload project. Set the canonical URL in General before publishing.'
                    }
                  >
                    {t(
                      'Use an existing project, or create a new Direct Upload project. Set the canonical URL in General before publishing.',
                    )}
                  </p>
                  {projectMessage && <p className="success-message">{projectMessage}</p>}
                  <div className="settings-note">
                    <Icon name="CheckCircle2" size={18} />
                    <p
                      data-ui={
                        'Publishing always makes a fresh, validated build. Only public pages and their assets are uploaded; drafts and local files stay here.'
                      }
                    >
                      {t(
                        'Publishing always makes a fresh, validated build. Only public pages and their assets are uploaded; drafts and local files stay here.',
                      )}
                    </p>
                  </div>
                </>
              )}
            </section>
          )}
          {appearance && (
            <div className="appearance-layout">
              <div className="appearance-controls">
                <AppearanceSettings
                  value={draft}
                  section={tab}
                  theme={theme}
                  onReading={(reading) => update({ reading })}
                  onPicture={() => setPicker('background')}
                />
              </div>
              <aside className="appearance-preview glass-panel">
                <div className="appearance-preview-bar">
                  <span>
                    <span className="status-dot" />
                    <UiText message={'Live site preview'} />
                  </span>
                  <select
                    aria-label={t('Preview page')}
                    value={previewRoute}
                    onChange={(event) => setPreviewRoute(event.target.value)}
                    data-ui-attrs={'{"aria-label":"Preview page"}'}
                  >
                    <option value="/" data-ui={'Homepage'}>
                      {t('Homepage')}
                    </option>
                    {articleRoute && (
                      <option value={articleRoute} data-ui={'Article'}>
                        {t('Article')}
                      </option>
                    )}
                  </select>
                </div>
                {preview ? (
                  <iframe
                    src={preview}
                    title={t('Live appearance preview')}
                    sandbox="allow-scripts allow-same-origin"
                    data-ui-attrs={'{"title":"Live appearance preview"}'}
                  />
                ) : (
                  <div className="preview-loading">
                    <Icon name="LoaderCircle" className="spin" />
                    <p data-ui={'Preparing your preview…'}>{t('Preparing your preview…')}</p>
                  </div>
                )}
              </aside>
            </div>
          )}
          {footer}
        </div>
      </div>
      {mediaPicker}
      {previewOpen && (
        <Modal
          title={t('Site preview')}
          wide
          className="site-settings-preview"
          onClose={() => {
            previewRequest.current?.abort();
            setPreviewOpen(false);
            setPreviewBusy(false);
          }}
        >
          <p
            className="help"
            data-ui={'Your unsaved settings. Save and build to update the public pages.'}
          >
            {t('Your unsaved settings. Save and build to update the public pages.')}
          </p>
          {preview ? (
            <iframe
              src={preview}
              title={t('Site settings preview')}
              sandbox="allow-scripts allow-same-origin"
              data-ui-attrs={'{"title":"Site settings preview"}'}
            />
          ) : (
            <div className="preview-loading">
              <Icon name="LoaderCircle" className="spin" />
              <p data-ui={'Preparing your preview…'}>{t('Preparing your preview…')}</p>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
