import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState } from 'react';
import type { Library, PublicEntry, SiteConfig } from '../shared/contracts.js';
import { Button, Icon } from '../shared/ui.js';
import { ErrorBox, Field, PageHeading, ToggleField } from './components.js';
import type { FlushRef } from './Editor.js';
import { HomeSlides } from './HomeSlides.js';
import { HomePins } from './HomePins.js';
import { useHomeSiteDraft } from './useSiteDraft.js';
import { LivePreview, PreviewError, useLivePreview } from './LivePreview.js';
import './homepage.css';

export function HomeSettings({
  site,
  revision,
  entries,
  library,
  flushRef,
  onSaved,
  onStatus,
  onProfile,
}: {
  site: SiteConfig;
  revision: string;
  entries: PublicEntry[];
  library: Library;
  flushRef: FlushRef;
  onSaved: (site: SiteConfig, revision: string) => void;
  onStatus: (status: string) => void;
  onProfile: () => void;
}) {
  const settings = useHomeSiteDraft(site, revision, onSaved);
  const { draft, dirty, busy, conflict, error } = settings;
  const latest = useRef(settings);
  latest.current = settings;
  const [device, setDevice] = useState('responsive');
  const home = draft.home;
  const update = (patch: Partial<SiteConfig['home']>) =>
    settings.setDraft((current) => ({ ...current, home: { ...current.home, ...patch } }));
  const preview = useLivePreview({
    identity: 'homepage',
    source: JSON.stringify({ home, profile: draft.profile, theme: draft.theme }),
    request: { route: '/', site: draft },
  });
  useEffect(() => {
    flushRef.current = () => latest.current.save();
    const leave = (event: BeforeUnloadEvent) => {
      if (latest.current.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      flushRef.current = null;
      window.removeEventListener('beforeunload', leave);
    };
  }, []);
  useEffect(
    () => onStatus(busy ? 'Saving homepage…' : dirty ? 'Unsaved changes' : 'All changes saved'),
    [dirty, busy],
  );
  return (
    <div className="studio-page homepage-settings">
      <PageHeading
        eyebrow={t("A welcoming first page")}
        title={t("Your homepage, thoughtfully arranged.")}
        description={t("Introduce yourself, share your latest writing, or curate a sequence of visual chapters.")}
      />
      <ErrorBox error={error} />
      {conflict && (
        <Button icon="RotateCcw" onClick={settings.reload}>
          <UiText message={"Reload latest homepage settings"}/></Button>
      )}
      <div className="appearance-layout home-settings-layout">
        <div className="appearance-controls home-settings-controls">
          <section className="settings-card glass-panel">
            <div className="settings-card-heading">
              <Icon name="Layers" />
              <h2 data-ui={"Layout"}>{t("Layout")}</h2>
            </div>
            <div className="home-layout-choices">
              {(
                [
                  [
                    'profile',
                    'Profile & recent writing',
                    'A quiet introduction and your latest published work.',
                  ],
                  [
                    'chapters',
                    'Visual chapters',
                    'Image-led writing, photographs, and custom scenes.',
                  ],
                ] as const
              ).map(([value, label, description]) => (
                <label
                  key={value}
                  className="home-layout-choice"
                  data-selected={home.layout === value}
                >
                  <input
                    type="radio"
                    name="homepage-layout"
                    value={value}
                    checked={home.layout === value}
                    onChange={() => update({ layout: value })}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </div>
            <p className="help" data-ui={"Switch layouts freely. Your saved chapters and display options stay here."}>
              {t("Switch layouts freely. Your saved chapters and display options stay here.")}</p>
          </section>
          {home.layout === 'profile' ? (
            <>
              <section className="settings-card glass-panel">
                <div className="settings-card-heading">
                  <Icon name="UserRound" />
                  <h2 data-ui={"Profile presentation"}>{t("Profile presentation")}</h2>
                </div>
                <div className="home-profile-context">
                  <strong>{draft.profile.name}</strong>
                  <p>{draft.profile.headline}</p>
                  <Button className="small" icon="ArrowUpRight" onClick={onProfile}>
                    <UiText message={"Edit profile in About"}/></Button>
                </div>
                {(
                  [
                    ['showPortrait', 'Portrait'],
                    ['showRole', 'Role'],
                    ['showLocation', 'Location'],
                    ['showAffiliations', 'Affiliations'],
                    ['showLinks', 'Social & contact links'],
                  ] as const
                ).map(([key, label]) => (
                  <ToggleField
                    key={key}
                    label={label}
                    checked={home.profile[key]}
                    onChange={(checked) => update({ profile: { ...home.profile, [key]: checked } })}
                  />
                ))}
              </section>
              <HomePins site={draft} entries={entries} onChange={(pinned) => update({ pinned })} />
              <section className="settings-card glass-panel">
                <div className="settings-card-heading">
                  <Icon name="BookOpen" />
                  <h2 data-ui={"Recent writing"}>{t("Recent writing")}</h2>
                </div>
                <fieldset className="home-source-choices">
                  <legend data-ui={"Collections"}>{t("Collections")}</legend>
                  {(['posts', 'lab'] as const).map((kind) => (
                    <label key={kind}>
                      <input
                        type="checkbox"
                        checked={home.recent.sources.includes(kind)}
                        disabled={
                          home.recent.sources.length === 1 && home.recent.sources.includes(kind)
                        }
                        onChange={(event) =>
                          update({
                            recent: {
                              ...home.recent,
                              sources: event.target.checked
                                ? [...home.recent.sources, kind]
                                : home.recent.sources.filter((source) => source !== kind),
                            },
                          })
                        }
                      />
                      <Icon name={kind === 'posts' ? 'BookOpen' : 'FlaskConical'} size={15} />
                      {draft.collections[kind].name}
                    </label>
                  ))}
                </fieldset>
                <Field label={t("Number of recent entries")}>
                  <select
                    value={home.recent.limit}
                    onChange={(event) =>
                      update({ recent: { ...home.recent, limit: Number(event.target.value) } })
                    }
                  >
                    {Array.from({ length: 12 }, (_, index) => (
                      <option key={index + 1} value={index + 1}>
                        {index + 1}
                      </option>
                    ))}
                  </select>
                </Field>
                {(
                  [
                    ['showSummary', 'Summaries'],
                    ['showDate', 'Publication dates'],
                    ['showCover', 'Cover thumbnails'],
                  ] as const
                ).map(([key, label]) => (
                  <ToggleField
                    key={key}
                    label={label}
                    checked={home.recent[key]}
                    onChange={(checked) => update({ recent: { ...home.recent, [key]: checked } })}
                  />
                ))}
                <p className="help" data-ui={"Published entries appear newest first. Drafts and scheduled entries stay private."}>
                  {t("Published entries appear newest first. Drafts and scheduled entries stay private.")}</p>
              </section>
            </>
          ) : (
            <HomeSlides site={draft} entries={entries} library={library} onChange={update} />
          )}
          <section className="settings-card glass-panel">
            <div className="settings-card-heading">
              <Icon name="Sparkles" />
              <h2 data-ui={"Motion"}>{t("Motion")}</h2>
            </div>
            <ToggleField
              label={t("Subtle entrance animation")}
              checked={home.motion === 'subtle'}
              onChange={(enabled) => update({ motion: enabled ? 'subtle' : 'off' })}
              help={t("A brief introduction and gentle entry stagger. Reduced-motion preferences take priority.")}
            />
          </section>
          <div className="settings-save">
            <span>
              <Icon name={dirty ? 'Circle' : 'CheckCheck'} size={14} />
              {dirty ? t("Changes are previewed until you save.") : t("Your homepage is saved locally.")}
            </span>
            <Button
              type="button"
              variant="primary"
              icon={busy ? 'LoaderCircle' : 'Check'}
              disabled={!dirty || busy || conflict}
              onClick={() => void settings.save().catch(() => undefined)}
            >
              {busy ? t("Saving…") : t("Save homepage")}
            </Button>
          </div>
        </div>
        <div className="appearance-preview glass-panel home-settings-preview" data-device={device}>
          <div className="appearance-preview-bar">
            <span>
              <span className="status-dot" />
              <UiText message={"Live homepage preview"}/></span>
            <label>
              <span className="sr-only" data-ui={"Homepage preview size"}>{t("Homepage preview size")}</span>
              <select
                aria-label={t("Homepage preview size")}
                value={device}
                onChange={(event) => setDevice(event.target.value)}
               data-ui-attrs={"{\"aria-label\":\"Homepage preview size\"}"} >
                <option value="responsive" data-ui={"Responsive"}>{t("Responsive")}</option>
                <option value="tablet" data-ui={"Tablet · 768px"}>{t("Tablet · 768px")}</option>
                <option value="phone" data-ui={"Phone · 390px"}>{t("Phone · 390px")}</option>
              </select>
            </label>
          </div>
          <PreviewError controller={preview} />
          <div className="home-preview-viewport">
            <LivePreview controller={preview} identity="homepage" title={t("Homepage preview")} />
          </div>
        </div>
      </div>
    </div>
  );
}
