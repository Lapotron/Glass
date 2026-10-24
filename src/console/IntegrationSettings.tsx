import { t } from '../shared/i18n.js';
import { languageOptionLabel } from '../shared/content-languages.js';
import { UiText } from '../shared/UiText.js';
import { useRef, useState, type ReactNode } from 'react';
import { Field, ToggleField, ErrorBox } from './components.js';
import { Button, Icon } from '../shared/ui.js';
import { commentsSchema, type SiteConfig } from '../shared/contracts.js';
import {
  discussionLanguages,
  discussionThemes,
  readGiscusSnippet,
  type DiscussionCheck,
} from '../shared/discussions.js';
import { send } from './api.js';
import { GiscusThemePreview } from './GiscusThemePreview.js';
type Integrations = SiteConfig['integrations'];
export function IntegrationSettings({
  value,
  theme,
  onChange,
  section,
  acaSetup,
}: {
  section?: string;
  acaSetup?: ReactNode;
  value: Integrations;
  theme: SiteConfig['theme'];
  onChange: (value: Integrations) => void;
}) {
  const [check, setCheck] = useState<{ repo: string; value: DiscussionCheck } | null>(null),
    [checking, setChecking] = useState(false),
    [error, setError] = useState(''),
    [snippet, setSnippet] = useState(''),
    [imported, setImported] = useState(false),
    [stylePreview, setStylePreview] = useState(false);
  const current = useRef(value.comments);
  current.current = value.comments;
  const sequence = useRef(0);
  const verified = check?.repo === value.comments.repo ? check.value : null;
  const checkIssues = verified?.repositoryId
    ? [
        value.comments.repoId !== verified.repositoryId
          ? 'The repository ID needs to match the verified repository.'
          : '',
        !verified.categories.some((category) => category.id === value.comments.categoryId)
          ? 'Choose a verified discussion category.'
          : '',
      ].filter(Boolean)
    : verified?.issues || [];
  const comments = (patch: Partial<Integrations['comments']>) =>
    onChange({ ...value, comments: { ...value.comments, ...patch } });
  const analytics = (patch: Partial<Integrations['analytics']>) =>
    onChange({ ...value, analytics: { ...value.analytics, ...patch } });
  const googleAnalytics = (patch: Partial<Integrations['googleAnalytics']>) =>
    onChange({ ...value, googleAnalytics: { ...value.googleAnalytics, ...patch } });
  const newsletter = (patch: Partial<Integrations['newsletter']>) =>
    onChange({ ...value, newsletter: { ...value.newsletter, ...patch } });
  return (
    <>
      <div className="settings-card-heading">
        <Icon name="LinkIcon" />
        <h2 data-ui={'Connect the notebook'}>{t('Connect the notebook')}</h2>
      </div>
      <section hidden={!!section && section !== 'aca'} className="integration-section-focused">
        <h3>
          <Icon name="ChartNoAxesCombined" size={17} />
          <UiText message={'Advanced Customized Analytics'} />
        </h3>
        <p className="help">
          {t(
            'ACA observes anonymous engagement. Optional daily network estimates use short-lived keyed hashes, never stored IP addresses or real names. Store the private report token in Connections.',
          )}
        </p>
        {acaSetup}
        <ToggleField
          label={t('Enable ACA')}
          checked={value.aca.enabled}
          onChange={(enabled) => onChange({ ...value, aca: { ...value.aca, enabled } })}
        />
        <div className="field-row">
          <Field label={t('ACA Worker origin')}>
            <input
              type="url"
              placeholder="https://glass-aca.example.workers.dev"
              value={value.aca.endpoint}
              data-setting-field="endpoint"
              onChange={(e) =>
                onChange({ ...value, aca: { ...value.aca, endpoint: e.target.value } })
              }
            />
          </Field>
          <Field label={t('Public site ID')}>
            <input
              value={value.aca.siteId}
              data-setting-field="siteId"
              placeholder={t('glass')}
              onChange={(e) =>
                onChange({ ...value, aca: { ...value.aca, siteId: e.target.value } })
              }
              data-ui-attrs={'{"placeholder":"glass"}'}
            />
          </Field>
        </div>
        <ToggleField
          label={t('Estimate daily networks')}
          help={t(
            'Requires daily network mode on your Worker. Counts are approximate networks, not people; identifiers expire after 48 hours. Daily networks remain separate from optional consented browser history.',
          )}
          checked={value.aca.dailyNetworkEstimates}
          onChange={(dailyNetworkEstimates) =>
            onChange({ ...value, aca: { ...value.aca, dailyNetworkEstimates } })
          }
        />
        <ToggleField
          label={t('Detailed audience reports')}
          checked={value.aca.collectAudience}
          onChange={(collectAudience) =>
            onChange({ ...value, aca: { ...value.aca, collectAudience } })
          }
        />
        <ToggleField
          label={t('Offer optional cross-day history')}
          checked={value.aca.optionalHistory}
          onChange={(optionalHistory) =>
            onChange({ ...value, aca: { ...value.aca, optionalHistory } })
          }
          help={t(
            'Requires an ACA deployment with optional history enabled. A minimal Privacy dialog lets readers opt in or withdraw.',
          )}
        />
        <ToggleField
          label={t('Measure interactions')}
          help={t(
            'Impressions, internal clicks, downloads, shares, and component use. Search queries and form text are excluded.',
          )}
          checked={value.aca.collectInteractions}
          onChange={(collectInteractions) =>
            onChange({ ...value, aca: { ...value.aca, collectInteractions } })
          }
        />
        <ToggleField
          label={t('Measure Core Web Vitals')}
          checked={value.aca.collectVitals}
          onChange={(collectVitals) => onChange({ ...value, aca: { ...value.aca, collectVitals } })}
        />
      </section>
      <section
        hidden={!!section && section !== 'discussions'}
        className="integration-section-focused"
      >
        <h3>
          <Icon name="BookOpen" size={17} />
          <UiText message={'Discussions'} />
        </h3>
        <p className="help">
          <UiText
            message={
              'Giscus connects articles to GitHub Discussions. Get your public repository and category IDs from'
            }
          />{' '}
          <a href="https://giscus.app/" target="_blank" rel="noreferrer" data-ui={'giscus.app'}>
            {t('giscus.app')}
          </a>
          .
        </p>
        <ToggleField
          label={t('Enable article discussions')}
          help={t(
            'Also enables configured section conversations and the optional About guestbook.',
          )}
          checked={value.comments.enabled}
          onChange={(enabled) => comments({ enabled })}
        />
        <div className="field-row">
          <Field label={t('GitHub repository')}>
            <input
              placeholder={t('owner/repository')}
              value={value.comments.repo}
              data-setting-field="repo"
              onChange={(event) => comments({ repo: event.target.value })}
              data-ui-attrs={'{"placeholder":"owner/repository"}'}
            />
          </Field>
          <Field label={t('Repository ID')}>
            <input
              value={value.comments.repoId}
              data-setting-field="repoId"
              onChange={(event) => comments({ repoId: event.target.value })}
            />
          </Field>
        </div>
        <div className="discussion-check-actions">
          <Button
            icon={checking ? 'LoaderCircle' : 'CheckCircle2'}
            disabled={checking || !value.comments.repo}
            onClick={async () => {
              const generation = ++sequence.current,
                snapshot = value.comments;
              setChecking(true);
              setError('');
              try {
                const result = await send<DiscussionCheck>('integrations/giscus/check', 'POST', {
                  repo: snapshot.repo,
                  repoId: snapshot.repoId,
                  categoryId: snapshot.categoryId,
                });
                if (generation === sequence.current && current.current.repo === snapshot.repo)
                  setCheck({ repo: snapshot.repo, value: result });
              } catch (failure) {
                if (generation === sequence.current) setError((failure as Error).message);
              } finally {
                if (generation === sequence.current) setChecking(false);
              }
            }}
          >
            {checking ? t('Checking Giscus…') : t('Check configuration')}
          </Button>
          <a
            className="text-link"
            href={`https://github.com/${value.comments.repo || 'giscus/giscus'}/discussions`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="Github" size={15} />
            <UiText message={'Repository discussions'} />
            <Icon name="ArrowUpRight" size={13} />
          </a>
        </div>
        <ErrorBox error={error} />
        {verified && (
          <div className={`integration-check-result ${verified.status}`} role="status">
            <Icon name={verified.status === 'ready' ? 'CheckCircle2' : 'AlertCircle'} size={18} />
            <div>
              <strong>
                {verified.repositoryId
                  ? t('Repository is available to Giscus')
                  : verified.status === 'unreachable'
                    ? t('Giscus could not be reached')
                    : t('Configuration needs attention')}
              </strong>
              {checkIssues.map((issue, index) => (
                <p className="help" key={index}>
                  {issue}
                </p>
              ))}
              {verified.repositoryId && value.comments.repoId !== verified.repositoryId && (
                <Button
                  className="small"
                  icon="Check"
                  onClick={() => comments({ repoId: verified.repositoryId })}
                >
                  <UiText message={'Use verified repository ID'} />
                </Button>
              )}
              {verified.categories.length > 0 && (
                <Field
                  label={t('Verified discussion categories')}
                  help={t(
                    'Choosing a category also fills in the verified repository and category IDs.',
                  )}
                >
                  <select
                    value={
                      verified.categories.some((item) => item.id === value.comments.categoryId)
                        ? value.comments.categoryId
                        : ''
                    }
                    onChange={(event) => {
                      const category = verified.categories.find(
                        (item) => item.id === event.target.value,
                      );
                      if (category)
                        comments({
                          repoId: verified.repositoryId,
                          categoryId: category.id,
                          category: category.name,
                        });
                    }}
                  >
                    <option value="" disabled data-ui={'Choose a category'}>
                      {t('Choose a category')}
                    </option>
                    {verified.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.emoji} {category.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <p
                className="help"
                data-ui={
                  'This checks the repository and category. The published conversation reports its own loading status.'
                }
              >
                {t(
                  'This checks the repository and category. The published conversation reports its own loading status.',
                )}
              </p>
            </div>
          </div>
        )}
        <details className="giscus-import">
          <summary>
            <Icon name="Code2" size={15} />
            <UiText message={'Import a Giscus embed'} />
          </summary>
          <Field
            label={t('Giscus configuration snippet')}
            help={t(
              'Paste the embed generated by giscus.app. Only supported public settings are imported.',
            )}
          >
            <textarea
              rows={5}
              className="mono"
              value={snippet}
              onChange={(event) => {
                setSnippet(event.target.value);
                setImported(false);
              }}
            />
          </Field>
          <Button
            className="small"
            icon="Check"
            disabled={!snippet.trim()}
            onClick={() => {
              try {
                const next = commentsSchema.parse({
                  ...value.comments,
                  ...readGiscusSnippet(snippet),
                });
                onChange({ ...value, comments: next });
                setImported(true);
                setError('');
              } catch (failure) {
                setError((failure as Error).message);
              }
            }}
          >
            <UiText message={'Apply embed settings'} />
          </Button>
          {imported && (
            <p
              className="help"
              role="status"
              data-ui={'Settings imported into this draft. Save changes when you are ready.'}
            >
              {t('Settings imported into this draft. Save changes when you are ready.')}
            </p>
          )}
        </details>
        <div className="field-row">
          <Field label={t('Discussion category')}>
            <input
              value={value.comments.category}
              data-setting-field="category"
              onChange={(event) => comments({ category: event.target.value })}
            />
          </Field>
          <Field label={t('Category ID')}>
            <input
              value={value.comments.categoryId}
              data-setting-field="categoryId"
              onChange={(event) => comments({ categoryId: event.target.value })}
            />
          </Field>
        </div>
        <ToggleField
          label={t('Load discussions on request')}
          help={t('Readers choose when to connect to GitHub.')}
          checked={value.comments.onDemand}
          onChange={(onDemand) => comments({ onDemand })}
        />
        <ToggleField
          label={t('Allow reactions')}
          checked={value.comments.reactions}
          onChange={(reactions) => comments({ reactions })}
        />
        <ToggleField
          label={t('Show discussion counts')}
          help={t('Show comment, reply, and reaction totals once a conversation loads.')}
          checked={value.comments.showMetadata}
          onChange={(showMetadata) => comments({ showMetadata })}
        />
        <div className="field-row">
          <Field label={t('Discussion language')}>
            <select
              value={value.comments.language}
              data-setting-field="language"
              onChange={(event) =>
                comments({ language: event.target.value as Integrations['comments']['language'] })
              }
            >
              <option value="auto" data-ui={'Follow page language'}>
                {t('Follow page language')}
              </option>
              {discussionLanguages.map((language) => (
                <option key={language} value={language}>
                  {languageOptionLabel(language)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Comment box position')}>
            <select
              value={value.comments.inputPosition}
              data-setting-field="inputPosition"
              onChange={(event) =>
                comments({ inputPosition: event.target.value as 'top' | 'bottom' })
              }
            >
              <option value="top" data-ui={'Above comments'}>
                {t('Above comments')}
              </option>
              <option value="bottom" data-ui={'Below comments'}>
                {t('Below comments')}
              </option>
            </select>
          </Field>
        </div>
        <Field
          label={t('Discussion appearance')}
          help={t(
            'Glass styles the complete discussion on HTTPS pages. Preview its light and dark materials here; localhost conversations use a provider fallback.',
          )}
        >
          <select
            value={value.comments.theme}
            data-setting-field="theme"
            onChange={(event) =>
              comments({ theme: event.target.value as Integrations['comments']['theme'] })
            }
          >
            <option value="site" data-ui={'Glass · follow site material'}>
              {t('Glass · follow site material')}
            </option>
            {discussionThemes.map((theme) => (
              <option key={theme} value={theme}>
                {theme
                  .replace('noborder', 'borderless')
                  .replaceAll('_', ' ')
                  .replace(/^./, (letter) => letter.toUpperCase())}
              </option>
            ))}
          </select>
        </Field>
        <Button
          icon="Eye"
          className="small"
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            setStylePreview(true);
          }}
        >
          <UiText message={'Preview discussion styles'} />
        </Button>
        {stylePreview && (
          <GiscusThemePreview theme={theme} onClose={() => setStylePreview(false)} />
        )}
        <Field label={t('Discussion heading')}>
          <input
            value={value.comments.title}
            data-setting-field="title"
            maxLength={100}
            onChange={(event) => comments({ title: event.target.value })}
          />
        </Field>
        <Field label={t('Discussion invitation')}>
          <textarea
            rows={2}
            value={value.comments.description}
            data-setting-field="description"
            maxLength={300}
            onChange={(event) => comments({ description: event.target.value })}
          />
        </Field>
        <p
          className="help"
          data-ui={
            'Article conversations keep their existing mapping. Add section conversations through Insert component → Discussion. The optional About guestbook lives in About → Guestbook.'
          }
        >
          {t(
            'Article conversations keep their existing mapping. Add section conversations through Insert component → Discussion. The optional About guestbook lives in About → Guestbook.',
          )}
        </p>
      </section>
      <section
        hidden={!!section && section !== 'newsletter'}
        className="integration-section-focused"
      >
        <h3>
          <Icon name="Radio" size={17} />
          <UiText message={'Newsletter'} />
        </h3>
        <p
          className="help"
          data-ui={
            'Send readers to your existing subscription page. Your newsletter provider manages signups and delivery.'
          }
        >
          {t(
            'Send readers to your existing subscription page. Your newsletter provider manages signups and delivery.',
          )}
        </p>
        <ToggleField
          label={t('Show newsletter invitation')}
          checked={value.newsletter.enabled}
          onChange={(enabled) => newsletter({ enabled })}
        />
        <Field label={t('Subscription page')}>
          <input
            type="url"
            value={value.newsletter.url}
            data-setting-field="url"
            onChange={(event) => newsletter({ url: event.target.value })}
          />
        </Field>
        <Field label={t('Invitation title')}>
          <input
            value={value.newsletter.title}
            data-setting-field="title"
            onChange={(event) => newsletter({ title: event.target.value })}
          />
        </Field>
        <Field label={t('Invitation description')}>
          <textarea
            rows={2}
            value={value.newsletter.description}
            data-setting-field="description"
            onChange={(event) => newsletter({ description: event.target.value })}
          />
        </Field>
        <Field label={t('Subscribe button label')}>
          <input
            value={value.newsletter.buttonLabel}
            data-setting-field="buttonLabel"
            onChange={(event) => newsletter({ buttonLabel: event.target.value })}
          />
        </Field>
      </section>
      <section
        hidden={!!section && section !== 'cloudflare-analytics'}
        className="integration-section-focused"
      >
        <h3>
          <Icon name="ChartNoAxesCombined" size={17} />
          <UiText message={'Cloudflare Web Analytics'} />
        </h3>
        <p className="help">
          <UiText message="Choose who installs the beacon. Cloudflare-managed installation permits its injected script without adding a second beacon." />
        </p>
        <ToggleField
          label={t('Enable Cloudflare Web Analytics')}
          checked={value.analytics.enabled}
          onChange={(enabled) => analytics({ enabled })}
        />
        <Field label={t('Beacon installation')}>
          <select
            value={value.analytics.mode}
            data-setting-field="mode"
            onChange={(event) => analytics({ mode: event.target.value as 'manual' | 'managed' })}
          >
            <option value="managed">{t('Cloudflare automatic injection')}</option>
            <option value="manual">{t('Studio with public token')}</option>
          </select>
        </Field>
        {value.analytics.mode === 'managed' ? (
          <p className="help" role="note">
            <UiText message="Cloudflare controls injection, privacy behavior and page exclusions. Configure those in its dashboard. Studio only supplies matching script and connection permissions." />
          </p>
        ) : (
          <>
            <Field label={t('Public analytics token')}>
              <input
                value={value.analytics.token}
                data-setting-field="token"
                onChange={(event) => analytics({ token: event.target.value })}
              />
            </Field>
            <ToggleField
              label={t('Respect browser privacy signals')}
              help={t('Skip measurement when Do Not Track or Global Privacy Control is enabled.')}
              checked={value.analytics.respectPrivacy}
              onChange={(respectPrivacy) => analytics({ respectPrivacy })}
            />
            <p
              className="help"
              data-ui={'Studio, unsaved previews, and localhost visits are excluded.'}
            >
              {t('Studio, unsaved previews, and localhost visits are excluded.')}
            </p>
          </>
        )}
      </section>
      <section
        hidden={!!section && section !== 'google-analytics'}
        className="integration-section-focused"
        aria-labelledby="google-analytics-heading"
      >
        <h3 id="google-analytics-heading">
          <Icon name="ChartNoAxesCombined" size={17} />
          <UiText message={'Google Analytics 4'} />
        </h3>
        <p
          className="help"
          data-ui={'Connect a GA4 web data stream to measure visits to your published pages.'}
        >
          {t('Connect a GA4 web data stream to measure visits to your published pages.')}
        </p>
        <ToggleField
          label={t('Enable Google Analytics 4')}
          checked={value.googleAnalytics.enabled}
          onChange={(enabled) => googleAnalytics({ enabled })}
        />
        <Field
          label={t('GA4 measurement ID')}
          help={t(
            'Find the G-… measurement ID in Google Analytics → Admin → Data streams → your web stream.',
          )}
        >
          <input
            value={value.googleAnalytics.measurementId}
            data-setting-field="measurementId"
            placeholder={t('G-ABC1234567')}
            spellCheck={false}
            autoCapitalize="characters"
            autoCorrect="off"
            maxLength={32}
            onChange={(event) => googleAnalytics({ measurementId: event.target.value })}
            data-ui-attrs={'{"placeholder":"G-ABC1234567"}'}
          />
        </Field>
        <ToggleField
          label={t('Respect privacy signals for Google Analytics')}
          help={t('Skip Google Analytics when Do Not Track or Global Privacy Control is enabled.')}
          checked={value.googleAnalytics.respectPrivacy}
          onChange={(respectPrivacy) => googleAnalytics({ respectPrivacy })}
        />
        <ToggleField
          label={t('Google Analytics debug mode')}
          help={t('Send debug events for inspection in GA4 DebugView. Turn off after testing.')}
          checked={value.googleAnalytics.debugMode}
          onChange={(debugMode) => googleAnalytics({ debugMode })}
        />
        <p
          className="help"
          data-ui={
            'Studio, private previews, reader settings, missing pages and localhost visits are excluded. Advertising signals stay off.'
          }
        >
          {t(
            'Studio, private previews, reader settings, missing pages and localhost visits are excluded. Advertising signals stay off.',
          )}
        </p>
        <a
          className="text-link"
          href="https://analytics.google.com/"
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="ExternalLink" size={14} />
          <UiText message={'Open Google Analytics'} />
        </a>
      </section>
    </>
  );
}
