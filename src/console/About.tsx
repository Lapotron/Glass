import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { Button, Icon } from '../shared/ui.js';
import { siteSchema, type SiteConfig, type PageDocument } from '../shared/contracts.js';
import { api, send, ApiError } from './api.js';
import { CodeEditor, Composer, type FlushRef } from './Editor.js';
import { MarkdownDiff } from './MarkdownDiff.js';
import { PageHeading, ErrorBox, Modal, Field, ToggleField, MediaPicker } from './components.js';
import { ProfileSettings } from './ProfileSettings.js';
import { useAboutSiteDraft } from './useSiteDraft.js';
import { FollowEditor, LivePreview, PreviewError, useLivePreview } from './LivePreview.js';
type Revision = PageDocument & { savedAt: string; reason: string };
export function About({
  document: source,
  flushRef,
  onSaved,
  onStatus,
  site,
  siteRevision,
  onSiteSaved,
  onIntegrations,
  initialTab = 'story',
}: {
  document: PageDocument;
  flushRef: FlushRef;
  onSaved: (value: PageDocument) => void;
  onStatus: (value: string) => void;
  site: SiteConfig;
  siteRevision: string;
  onSiteSaved: (site: SiteConfig, revision: string) => void;
  onIntegrations: () => void;
  initialTab?: 'story' | 'profile' | 'guestbook';
}) {
  const [body, setBody] = useState(source.body),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [busy, setBusy] = useState(false),
    [composer, setComposer] = useState(false),
    [history, setHistory] = useState<Revision[] | null>(null),
    [selected, setSelected] = useState<Revision | null>(null);
  const [tab, setTab] = useState<'story' | 'profile' | 'guestbook'>(initialTab);
  const [mode, setMode] = useState<'write' | 'split' | 'preview'>('split');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [portraitPicker, setPortraitPicker] = useState(false);
  const profile = useAboutSiteDraft(site, siteRevision, onSiteSaved);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const preview = useLivePreview({
    identity: 'about',
    source: body,
    request: { route: '/about/', body, site: profile.draft },
    delay: 450,
  });
  const viewRef = useRef<EditorView | null>(null),
    latest = useRef(body),
    baseline = useRef(source.body),
    revision = useRef(source.revision),
    pending = useRef<Promise<void> | null>(null);
  const savingStory = useRef<string | null>(null);
  latest.current = body;
  async function saveStory() {
    if (pending.current) await pending.current;
    const text = latest.current;
    if (text === baseline.current) return;
    if (conflict) throw new Error('Reload About before saving. Your text is still here.');
    const operation = (async () => {
      setBusy(true);
      savingStory.current = text;
      onStatus('Saving…');
      try {
        const result = await send<PageDocument>('pages/about', 'PUT', {
          body: text,
          revision: revision.current,
        });
        baseline.current = result.body;
        revision.current = result.revision;
        onSaved(result);
      } catch (e) {
        setError((e as Error).message);
        if (e instanceof ApiError && e.status === 409) setConflict(true);
        throw e;
      } finally {
        setBusy(false);
        savingStory.current = null;
      }
    })();
    pending.current = operation;
    try {
      await operation;
    } finally {
      pending.current = null;
    }
    if (latest.current !== baseline.current) await saveStory();
  }
  async function save() {
    try {
      if (conflict || profile.conflict)
        throw new Error(
          'Resolve the changed About story or profile before saving. Your drafts are preserved.',
        );
      const parsed = siteSchema.safeParse(profile.draft);
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('\n'),
        );
      setError('');
      onStatus('Saving…');
      await saveStory();
      await profile.save();
      onStatus('All changes saved');
    } catch (failure) {
      setError((failure as Error).message);
      onStatus('Changes need attention');
      throw failure;
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const handler = () => {
      void saveRef.current().catch(() => {});
    };
    document.addEventListener('studio-save', handler);
    return () => document.removeEventListener('studio-save', handler);
  }, []);
  useEffect(() => {
    flushRef.current = () => saveRef.current();
    return () => {
      flushRef.current = null;
    };
  }, []);
  useEffect(() => {
    onStatus(
      busy || profile.busy
        ? 'Saving…'
        : conflict || profile.conflict
          ? 'Changes need attention'
          : body === baseline.current && !profile.dirty
            ? 'All changes saved'
            : 'Unsaved changes',
    );
  }, [body, busy, conflict, profile.dirty, profile.busy, profile.conflict]);
  useEffect(() => {
    if (source.revision === revision.current) return;
    if (source.body === savingStory.current) return;
    if (latest.current !== baseline.current) {
      setConflict(true);
      setError('About changed outside Studio. Your text is preserved.');
    } else {
      baseline.current = source.body;
      revision.current = source.revision;
      setBody(source.body);
    }
  }, [source.revision]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (latest.current !== baseline.current || profileRef.current.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  const insert = (value: string) => {
    const view = viewRef.current;
    if (view) {
      const selection = view.state.selection.main;
      view.dispatch({ changes: { from: selection.from, to: selection.to, insert: value } });
      view.focus();
    } else setBody((b) => b + value);
  };
  return (
    <div className="studio-page about-editor-page">
      <PageHeading
        eyebrow={t("A page of your own")}
        title={t("About")}
        description={t("Your profile, your story, and a place for conversation.")}
      >
        <Button
          icon="History"
          disabled={busy || profile.busy}
          onClick={async () => {
            try {
              await save();
              setHistory(await api<Revision[]>('pages/about/revisions'));
              setSelected(null);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <UiText message={"Revisions"}/></Button>
        <Button
          variant="primary"
          icon="Save"
          disabled={busy || profile.busy || conflict || profile.conflict}
          onClick={() => {
            void save().catch(() => {});
          }}
        >
          {busy || profile.busy ? t("Saving…") : t("Save About")}
        </Button>
      </PageHeading>
      <ErrorBox error={error} />
      <ErrorBox error={profile.error} />
      {profile.conflict && (
        <Button icon="RotateCcw" onClick={profile.reload}>
          <UiText message={"Reload latest profile and guestbook"}/></Button>
      )}
      {conflict && (
        <Button
          icon="RotateCcw"
          onClick={async () => {
            try {
              const next = await api<PageDocument>('pages/about');
              baseline.current = next.body;
              revision.current = next.revision;
              setBody(next.body);
              setConflict(false);
              setError('');
              onSaved(next);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <UiText message={"Reload latest About"}/></Button>
      )}
      <div className="about-workspace-toolbar">
        <div className="settings-tabs about-tabs" role="group" aria-label={t("About sections")} data-ui-attrs={"{\"aria-label\":\"About sections\"}"} >
          {(['story', 'profile', 'guestbook'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={tab === value}
              className={tab === value ? 'active' : ''}
              onClick={() => {
                setTab(value);
                if (mode === 'preview') setMode('split');
              }}
            >
              <Icon
                name={
                  value === 'story'
                    ? 'PenLine'
                    : value === 'profile'
                      ? 'UserRound'
                      : 'MessageCircle'
                }
                size={15}
              />
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <div className="toolbar-group">
          <div className="segmented about-view-modes">
            {(['write', 'split', 'preview'] as const).map((value) => (
              <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
                {value === 'write' ? t("Edit") : value === 'split' ? t("Split") : t("Preview")}
              </button>
            ))}
          </div>
          <a
            className="icon-button"
            href="/about/"
            target="_blank"
            rel="noreferrer"
            aria-label={t("Visit About page")}
           data-ui-attrs={"{\"aria-label\":\"Visit About page\"}"} >
            <Icon name="ExternalLink" size={16} />
          </a>
        </div>
      </div>
      <div className={`about-editor-grid about-mode-${mode}`}>
        <section className="glass-panel about-source">
          <div className="about-story-editor" hidden={tab !== 'story'}>
            <div className="editor-formatting">
              <Icon name="PenLine" size={15} />
              <span data-ui={"Markdown"}>{t("Markdown")}</span>
              <Button className="small" icon="Plus" onClick={() => setComposer(true)}>
                <UiText message={"Insert component"}/></Button>
            </div>
            <CodeEditor
              value={body}
              onChange={setBody}
              viewRef={viewRef}
              onUpdate={preview.onEditorUpdate}
            />
          </div>
          <div className="about-profile-editor" hidden={tab !== 'profile'}>
            <ProfileSettings
              value={profile.draft.profile}
              onChange={(value) => profile.setDraft((draft) => ({ ...draft, profile: value }))}
              onPickPortrait={() => setPortraitPicker(true)}
            />
          </div>
          <div className="about-guestbook-editor" hidden={tab !== 'guestbook'}>
            <div className="settings-card-heading">
              <Icon name="MessageCircle" />
              <h2 data-ui={"A place to say hello"}>{t("A place to say hello")}</h2>
            </div>
            <p className="help" data-ui={"An optional conversation after your story. It uses your existing Giscus repository and keeps the same thread when your profile changes."}>
              {t("An optional conversation after your story. It uses your existing Giscus repository and keeps the same thread when your profile changes.")}</p>
            <ToggleField
              label={t("Show guestbook on About")}
              checked={profile.draft.about.guestbook.enabled}
              onChange={(enabled) =>
                profile.setDraft((draft) => ({
                  ...draft,
                  about: { guestbook: { ...draft.about.guestbook, enabled } },
                }))
              }
            />
            <Field label={t("Guestbook title")}>
              <input
                value={profile.draft.about.guestbook.title}
                onChange={(event) =>
                  profile.setDraft((draft) => ({
                    ...draft,
                    about: { guestbook: { ...draft.about.guestbook, title: event.target.value } },
                  }))
                }
              />
            </Field>
            <Field label={t("Guestbook invitation")}>
              <textarea
                rows={3}
                value={profile.draft.about.guestbook.description}
                onChange={(event) =>
                  profile.setDraft((draft) => ({
                    ...draft,
                    about: {
                      guestbook: { ...draft.about.guestbook, description: event.target.value },
                    },
                  }))
                }
              />
            </Field>
            <div className="integration-notice">
              <Icon
                name={profile.draft.integrations.comments.enabled ? 'Github' : 'AlertCircle'}
                size={18}
              />
              <div>
                <strong>
                  {profile.draft.integrations.comments.enabled
                    ? profile.draft.integrations.comments.repo
                    : t("Giscus is not enabled yet")}
                </strong>
                <p className="help">
                  {profile.draft.integrations.comments.enabled
                    ? t("Language, reactions, loading, and appearance follow your discussion settings.")
                    : t("Configure Giscus to make the guestbook available on the public page.")}
                </p>
                <Button className="small" icon="Settings2" onClick={onIntegrations}>
                  <UiText message={"Discussion settings"}/></Button>
              </div>
            </div>
          </div>
        </section>
        <section
          className={`glass-panel about-preview-panel${device === 'mobile' ? ' about-preview-mobile' : ''}`}
        >
          <div className="preview-toolbar">
            <span>
              <Icon name="Eye" size={15} />
              <UiText message={"Preview "}/>{preview.busy && <Icon name="LoaderCircle" size={12} className="spin" />}
            </span>
            <div className="toolbar-group">
              <FollowEditor controller={preview} />
              <button
                className="icon-button"
                aria-label={t("Desktop preview")}
                aria-pressed={device === 'desktop'}
                onClick={() => setDevice('desktop')}
               data-ui-attrs={"{\"aria-label\":\"Desktop preview\"}"} >
                <Icon name="Monitor" size={15} />
              </button>
              <button
                className="icon-button"
                aria-label={t("Mobile preview")}
                aria-pressed={device === 'mobile'}
                onClick={() => setDevice('mobile')}
               data-ui-attrs={"{\"aria-label\":\"Mobile preview\"}"} >
                <Icon name="Smartphone" size={15} />
              </button>
            </div>
          </div>
          <PreviewError controller={preview} />
          <LivePreview
            controller={preview}
            title={t("About preview")}
            identity="about"
            className="about-preview"
          />
        </section>
      </div>
      {portraitPicker && (
        <MediaPicker
          onClose={() => setPortraitPicker(false)}
          onSelect={(portrait) =>
            profile.setDraft((draft) => ({ ...draft, profile: { ...draft.profile, portrait } }))
          }
        />
      )}
      {composer && <Composer onInsert={insert} onClose={() => setComposer(false)} />}
      {history && (
        <Modal
          title={t("About revisions")}
          wide
          onClose={() => setHistory(null)}
          footer={
            <>
              <Button onClick={() => setHistory(null)}><UiText message={"Close"}/></Button>
              <Button
                variant="primary"
                icon="History"
                disabled={!selected || busy}
                onClick={async () => {
                  if (!selected) return;
                  setBusy(true);
                  try {
                    const value = await send<PageDocument>('pages/about/restore', 'POST', {
                      selected: selected.revision,
                      revision: revision.current,
                    });
                    baseline.current = value.body;
                    revision.current = value.revision;
                    setBody(value.body);
                    onSaved(value);
                    setHistory(null);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <UiText message={"Restore selected revision"}/></Button>
            </>
          }
        >
          <div className="page-revisions">
            {history.map((r) => (
              <button
                key={r.revision}
                className={`chip ${selected?.revision === r.revision ? 'active' : ''}`}
                onClick={() => setSelected(r)}
              >
                {new Date(r.savedAt).toLocaleString()}
              </button>
            ))}
          </div>
          {!history.length && <p className="help" data-ui={"Earlier versions appear after your next edit."}>{t("Earlier versions appear after your next edit.")}</p>}
          {selected && <MarkdownDiff earlier={selected.body} current={body} />}
        </Modal>
      )}
    </div>
  );
}
