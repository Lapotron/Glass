import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useId, useRef, useState } from 'react';
import { appearanceRanges } from '../shared/appearance-ranges.js';
import {
  entrySchema,
  routeFor,
  type EntryMeta,
  type PublicEntry,
  type SiteConfig,
} from '../shared/contracts.js';
import { resolveEntrySettings } from '../shared/entry-settings.js';
import { shortLinkPath } from '../shared/shortlinks.js';
import { pageTitle } from '../shared/site-presentation.js';
import { Button, Icon, type IconName } from '../shared/ui.js';
import { openImageViewer } from '../shared/image-viewer.js';
import { api } from './api.js';
import { CopyButton, ErrorBox, Field, MediaPicker, ToggleField } from './components.js';
import './entry-settings.css';
import { MathSettingsFields } from './MathSettingsFields.js';

const tabs: { id: string; label: string; icon: IconName; description: string }[] = [
  {
    id: 'general',
    label: 'General',
    icon: 'Settings2',
    description: 'Title, summary, publication, topics, and permanent links.',
  },
  {
    id: 'cover',
    label: 'Cover',
    icon: 'Image',
    description: 'Give the first image room to tell its story.',
  },
  {
    id: 'reading',
    label: 'Reading',
    icon: 'BookOpen',
    description: 'A considered reading experience for this article.',
  },
  {
    id: 'math',
    label: 'Mathematics',
    icon: 'FlaskConical',
    description: 'Choose notation packages for this article and its previews.',
  },
  {
    id: 'discussion',
    label: 'Discussion',
    icon: 'MessageCircle',
    description: 'Choose where readers can join the conversation.',
  },
  {
    id: 'sharing',
    label: 'Sharing',
    icon: 'LinkIcon',
    description: 'Control how this article appears outside your notebook.',
  },
];
const localTime = (value: string) =>
  value
    ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : '';
const readingLabels = {
  outline: 'Table of contents',
  progress: 'Reading progress',
  readingTime: 'Reading time',
  publishedDate: 'Publication date',
  modifiedDate: 'Modified date',
  articleFooter: 'Article footer',
  author: 'Author signature',
  codeLineNumbers: 'Code line numbers',
} as const;

export function EntrySettings({
  id: panelId,
  active,
  entry,
  metadata,
  site,
  onChange,
  onReturn,
  onTrash,
  error,
  dirty,
  onSave,
}: {
  id: string;
  active: boolean;
  entry: PublicEntry;
  metadata: EntryMeta;
  site: SiteConfig;
  onChange: (patch: Partial<EntryMeta>) => void;
  onReturn: () => void;
  onTrash: () => void;
  error: string;
  dirty: boolean;
  onSave: () => Promise<void>;
}) {
  const [tab, setTab] = useState('general'),
    [picker, setPicker] = useState<'cover' | 'sharing' | null>(null);
  const [saving, setSaving] = useState(false);
  const [horizontal, setHorizontal] = useState(() => matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const query = matchMedia('(max-width: 760px)'),
      update = () => setHorizontal(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const tabList = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const id = useId();
  const resolved = resolveEntrySettings(site, metadata);
  const cover = resolved.cover;
  const canonical = new URL(routeFor({ ...entry, ...metadata }, site.collections), site.url).href;
  const shortLink = new URL(shortLinkPath(metadata), site.url).href;
  const validation = entrySchema.safeParse(metadata);
  const problems = validation.success ? [] : validation.error.issues;
  const fieldError = (key: string) =>
    problems.find((problem) => problem.path.join('.') === key)?.message;
  const coverPatch = (patch: NonNullable<EntryMeta['coverOptions']>) =>
    onChange({ coverOptions: { ...metadata.coverOptions, ...patch } });
  const readingPatch = (patch: NonNullable<EntryMeta['reading']>) =>
    onChange({ reading: { ...metadata.reading, ...patch } });
  const typePatch = (patch: NonNullable<EntryMeta['typography']>) =>
    onChange({ typography: { ...metadata.typography, ...patch } });
  const seoPatch = (patch: NonNullable<EntryMeta['seo']>) =>
    onChange({ seo: { ...metadata.seo, ...patch } });
  function selectTab(value: string, focus = false) {
    setTab(value);
    scroll.current?.scrollTo({ top: 0 });
    if (focus) tabList.current?.querySelector<HTMLButtonElement>(`[data-tab="${value}"]`)?.focus();
  }
  function statusChange(status: EntryMeta['status']) {
    if (status === 'scheduled' && !metadata.publishAt) {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      date.setHours(9, 0, 0, 0);
      onChange({
        status,
        publishAt: date.toISOString(),
        publishedAt: localTime(date.toISOString()).slice(0, 10),
      });
    } else onChange({ status });
  }
  const current = tabs.find((item) => item.id === tab)!;
  return (
    <section
      className="entry-settings-workspace"
      id={panelId}
      role="region"
      aria-label={t('{value0} settings', { value0: site.collections[entry.kind].singular })}
      hidden={!active}
    >
      <div className="entry-settings-layout">
        <aside
          className="entry-settings-sidebar"
          aria-label={t('Article settings navigation')}
          data-ui-attrs={'{"aria-label":"Article settings navigation"}'}
        >
          <div className="entry-settings-context">
            <div className="entry-settings-context-meta">
              <span className="entry-settings-kind">
                <Icon name={entry.kind === 'posts' ? 'PenLine' : 'FlaskConical'} size={13} />
                {site.collections[entry.kind].singular}
              </span>
              <span className={`badge ${metadata.status}`}>{metadata.status}</span>
            </div>
            <strong title={metadata.title || t('Untitled')}>
              {metadata.title || t('Untitled')}
            </strong>
            <span className="entry-settings-context-path">
              <Icon name="LinkIcon" size={12} />
              <span>{routeFor({ ...entry, slug: metadata.slug }, site.collections)}</span>
            </span>
          </div>
          <div
            className="entry-settings-tabs"
            role="tablist"
            aria-label={t('Article settings sections')}
            aria-orientation={horizontal ? 'horizontal' : 'vertical'}
            ref={tabList}
            onKeyDown={(event) => {
              if (
                !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              const at = tabs.findIndex((item) => item.id === tab);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (at +
                        (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              selectTab(tabs[next].id, true);
            }}
            data-ui-attrs={'{"aria-label":"Article settings sections"}'}
          >
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                data-tab={item.id}
                id={`${id}-${item.id}-tab`}
                aria-controls={`${id}-${item.id}`}
                aria-selected={tab === item.id}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => selectTab(item.id)}
              >
                <Icon name={item.icon} size={16} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </aside>
        <div
          className="entry-settings-scroll"
          ref={scroll}
          tabIndex={0}
          role="region"
          aria-label={t('Article settings fields')}
          data-ui-attrs={'{"aria-label":"Article settings fields"}'}
        >
          <p className="entry-settings-intro">{current.description}</p>
          <ErrorBox
            error={
              error ||
              (problems.length
                ? problems.map((p) => `${p.path.join('.')}: ${p.message}`).join('\n')
                : '')
            }
          />
          <section
            id={`${id}-general`}
            role="tabpanel"
            aria-labelledby={`${id}-general-tab`}
            hidden={tab !== 'general'}
          >
            <div className="entry-settings-section">
              <h3>
                <Icon name="PenLine" size={16} /> <UiText message={' Title and summary'} />
              </h3>
              <Field label={t('Article title')}>
                <input
                  value={metadata.title}
                  placeholder={t('An interesting thought…')}
                  aria-invalid={!!fieldError('title')}
                  onChange={(e) => onChange({ title: e.target.value })}
                  data-ui-attrs={'{"placeholder":"An interesting thought…"}'}
                />
              </Field>
              <Field
                label={t('Article summary')}
                help={t('A sentence or two for the archive and link previews.')}
              >
                <textarea
                  rows={3}
                  value={metadata.summary}
                  placeholder={t('A sentence or two to set the scene.')}
                  aria-invalid={!!fieldError('summary')}
                  onChange={(e) => onChange({ summary: e.target.value })}
                  data-ui-attrs={'{"placeholder":"A sentence or two to set the scene."}'}
                />
              </Field>
            </div>
            <div className="entry-settings-section">
              <h3>
                <Icon name="CalendarDays" size={16} /> <UiText message={' Publication'} />
              </h3>
              <Field label={t('Publication status')}>
                <select
                  value={metadata.status}
                  onChange={(e) => statusChange(e.target.value as EntryMeta['status'])}
                >
                  <option value="draft" data-ui={'Draft'}>
                    {t('Draft')}
                  </option>
                  <option value="scheduled" data-ui={'Scheduled'}>
                    {t('Scheduled')}
                  </option>
                  <option value="published" data-ui={'Published'}>
                    {t('Published')}
                  </option>
                </select>
              </Field>
              <div className="field-row">
                <Field label={t('Publication date')}>
                  <input
                    type="date"
                    value={metadata.publishedAt}
                    aria-invalid={!!fieldError('publishedAt')}
                    onChange={(e) => onChange({ publishedAt: e.target.value })}
                  />
                </Field>
                <Field label={t('Updated date')} help={t('Optional; included in search metadata.')}>
                  <input
                    type="date"
                    value={metadata.updatedAt || ''}
                    aria-invalid={!!fieldError('updatedAt')}
                    onChange={(e) => onChange({ updatedAt: e.target.value || undefined })}
                  />
                </Field>
              </div>
              {metadata.status === 'scheduled' && (
                <Field
                  label={t('Publish at')}
                  help={t(
                    'Time on this computer ({value0}). Automation is configured in Site settings.',
                    { value0: Intl.DateTimeFormat().resolvedOptions().timeZone },
                  )}
                >
                  <input
                    type="datetime-local"
                    value={localTime(metadata.publishAt)}
                    onChange={(e) => {
                      const date = new Date(e.target.value);
                      if (Number.isFinite(date.getTime()))
                        onChange({
                          publishAt: date.toISOString(),
                          publishedAt: e.target.value.slice(0, 10),
                        });
                      else onChange({ publishAt: '' });
                    }}
                  />
                </Field>
              )}
              <Field label={t('Language')}>
                <select
                  value={metadata.lang}
                  onChange={(e) => onChange({ lang: e.target.value as 'en' | 'zh' })}
                >
                  <option value="en" data-ui={'English'}>
                    {t('English')}
                  </option>
                  <option value="zh" data-ui={'中文 · Chinese'}>
                    {t('中文 · Chinese')}
                  </option>
                </select>
              </Field>
              <Field label={t('Tags')} help={t('Separate topics with commas.')}>
                <input
                  value={metadata.tags.join(', ')}
                  onChange={(e) =>
                    onChange({ tags: e.target.value.split(',').map((s) => s.trim()) })
                  }
                  onBlur={() => onChange({ tags: metadata.tags.filter(Boolean) })}
                />
              </Field>
              <ToggleField
                label={t('Sample content label')}
                checked={metadata.demo}
                onChange={(demo) => onChange({ demo })}
              />
            </div>
            <div className="entry-settings-section">
              <h3>
                <Icon name="LinkIcon" size={16} /> <UiText message={' Permanent links'} />
              </h3>
              <Field label={t('URL slug')}>
                <input
                  value={metadata.slug}
                  aria-invalid={!!fieldError('slug')}
                  onChange={(e) => onChange({ slug: e.target.value })}
                />
              </Field>
              <div className="entry-link-preview">
                <span data-ui={'Canonical link'}>{t('Canonical link')}</span>
                <code>{canonical}</code>
                <CopyButton label={t('Copy canonical link')} value={canonical} />
              </div>
              <Field
                label={t('Short link')}
                help={
                  metadata.status === 'published'
                    ? t(
                        'Follows this entry after URL changes. Publish a build to activate changes.',
                      )
                    : t('Becomes active after publication.')
                }
              >
                <input readOnly value={shortLink} />
              </Field>
              <CopyButton label={t('Copy short link')} value={shortLink} />
              <Field
                label={t('Short-link aliases')}
                help={t(
                  'Up to 10 comma-separated aliases; lowercase letters, digits, hyphens or underscores.',
                )}
              >
                <input
                  value={metadata.shortAliases.join(', ')}
                  onChange={(e) =>
                    onChange({
                      shortAliases: e.target.value
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
            </div>
            <div className="entry-settings-danger">
              <div>
                <strong data-ui={'Move to Trash'}>{t('Move to Trash')}</strong>
                <p data-ui={'You can restore this entry from Trash.'}>
                  {t('You can restore this entry from Trash.')}
                </p>
              </div>
              <Button className="small" variant="danger" icon="Trash2" onClick={onTrash}>
                <UiText message={'Move to Trash'} />
              </Button>
            </div>
          </section>
          <section
            id={`${id}-cover`}
            role="tabpanel"
            aria-labelledby={`${id}-cover-tab`}
            hidden={tab !== 'cover'}
          >
            <div className="entry-settings-section">
              {metadata.cover ? (
                <a
                  className="settings-cover-preview"
                  data-ratio={cover.ratio}
                  href={metadata.cover}
                  aria-label={t('View cover image')}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    void openImageViewer(
                      [
                        {
                          src: metadata.cover,
                          alt: cover.alt,
                          caption: cover.caption,
                          loadDetails: (signal) =>
                            api('media/details?url=' + encodeURIComponent(metadata.cover), {
                              signal,
                            }),
                        },
                      ],
                      0,
                      event.currentTarget,
                    );
                  }}
                  data-ui-attrs={'{"aria-label":"View cover image"}'}
                >
                  <img
                    src={metadata.cover}
                    alt={cover.alt}
                    style={{ objectPosition: `${cover.focalX}% ${cover.focalY}%` }}
                  />
                  <span>
                    <Icon name="Expand" size={16} /> <UiText message={' View image'} />
                  </span>
                </a>
              ) : (
                <div className="settings-cover-empty">
                  <Icon name="Image" size={30} />
                  <strong data-ui={'A first impression'}>{t('A first impression')}</strong>
                  <span data-ui={'Choose an image or upload one to crop and resize.'}>
                    {t('Choose an image or upload one to crop and resize.')}
                  </span>
                </div>
              )}
              <div className="entry-settings-actions">
                <Button className="small" icon="Image" onClick={() => setPicker('cover')}>
                  {metadata.cover ? t('Replace cover') : t('Choose cover')}
                </Button>
                {metadata.cover && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => onChange({ cover: '' })}
                  >
                    <Icon name="X" size={14} /> <UiText message={' Remove'} />
                  </button>
                )}
              </div>
              <Field
                label={t('Cover image')}
                help={t('Choose from media, upload, or paste an image URL.')}
              >
                <input
                  value={metadata.cover}
                  placeholder={t('/media/…')}
                  onChange={(e) => onChange({ cover: e.target.value })}
                  data-ui-attrs={'{"placeholder":"/media/…"}'}
                />
              </Field>
              <Field
                label={t('Cover alt text')}
                help={t(
                  'Describe the image for readers who cannot see it. The article title is the fallback.',
                )}
              >
                <input
                  maxLength={500}
                  value={metadata.coverOptions?.alt || ''}
                  placeholder={metadata.title}
                  onChange={(e) => coverPatch({ alt: e.target.value })}
                />
              </Field>
              <Field label={t('Cover caption')}>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={cover.caption}
                  onChange={(e) => coverPatch({ caption: e.target.value })}
                />
              </Field>
            </div>
            <div className="entry-settings-section">
              <h3>
                <Icon name="Crop" size={16} /> <UiText message={' Framing'} />
              </h3>
              <ToggleField
                label={t('Show cover on article')}
                help={t(
                  'The image is still available to archive cards and sharing when hidden here.',
                )}
                checked={cover.visible}
                onChange={(visible) => coverPatch({ visible })}
              />
              <Field label={t('Cover aspect ratio')}>
                <select
                  value={cover.ratio}
                  onChange={(e) => coverPatch({ ratio: e.target.value as typeof cover.ratio })}
                >
                  <option value="default" data-ui={'Default · panorama'}>
                    {t('Default · panorama')}
                  </option>
                  <option value="wide" data-ui={'Wide · 16:9'}>
                    {t('Wide · 16:9')}
                  </option>
                  <option value="landscape" data-ui={'Landscape · 3:2'}>
                    {t('Landscape · 3:2')}
                  </option>
                  <option value="original" data-ui={'Original ratio'}>
                    {t('Original ratio')}
                  </option>
                </select>
              </Field>
              <div className="field-row">
                {(['focalX', 'focalY'] as const).map((key) => (
                  <Field
                    key={key}
                    label={t('{value0} focal point · {value1}%', {
                      value0: key === 'focalX' ? 'Horizontal' : 'Vertical',
                      value1: cover[key],
                    })}
                  >
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={cover[key]}
                      onChange={(e) => coverPatch({ [key]: Number(e.target.value) })}
                    />
                  </Field>
                ))}
              </div>
              <button
                type="button"
                className="text-link"
                onClick={() =>
                  onChange({
                    coverOptions: {
                      ...metadata.coverOptions,
                      ratio: undefined,
                      focalX: undefined,
                      focalY: undefined,
                    },
                  })
                }
              >
                <Icon name="RotateCcw" size={14} /> <UiText message={' Reset framing'} />
              </button>
              <p
                className="help"
                data-ui={'Framing changes the presentation. Your uploaded image is preserved.'}
              >
                {t('Framing changes the presentation. Your uploaded image is preserved.')}
              </p>
            </div>
          </section>
          <section
            id={`${id}-reading`}
            role="tabpanel"
            aria-labelledby={`${id}-reading-tab`}
            hidden={tab !== 'reading'}
          >
            <div className="entry-settings-section">
              <div className="entry-section-heading">
                <h3>
                  <Icon name="ListTree" size={16} /> <UiText message={' Reading features'} />
                </h3>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => onChange({ reading: undefined })}
                  data-ui={'Use site defaults'}
                >
                  {t('Use site defaults')}
                </button>
              </div>
              <p
                className="help"
                data-ui={'Leave a setting inherited to follow future site changes.'}
              >
                {t('Leave a setting inherited to follow future site changes.')}
              </p>
              {Object.entries(readingLabels).map(([name, label]) => {
                const key = name as keyof typeof readingLabels;
                return (
                  <div className="entry-override-row" key={key}>
                    <label htmlFor={`${id}-reading-${key}`}>{label}</label>
                    <select
                      id={`${id}-reading-${key}`}
                      value={
                        metadata.reading?.[key] === undefined
                          ? 'inherit'
                          : String(metadata.reading[key])
                      }
                      onChange={(e) =>
                        readingPatch({
                          [key]:
                            e.target.value === 'inherit' ? undefined : e.target.value === 'true',
                        })
                      }
                    >
                      <option value="inherit">
                        <UiText message={'Site default ·'} />{' '}
                        {(site.reading[key] ?? site.reading.publishedDate) ? t('On') : t('Off')}
                      </option>
                      <option value="true" data-ui={'On'}>
                        {t('On')}
                      </option>
                      <option value="false" data-ui={'Off'}>
                        {t('Off')}
                      </option>
                    </select>
                  </div>
                );
              })}
              <Field label={t('Related articles')}>
                <select
                  value={metadata.reading?.relatedCount ?? 'inherit'}
                  onChange={(e) =>
                    readingPatch({
                      relatedCount:
                        e.target.value === 'inherit' ? undefined : Number(e.target.value),
                    })
                  }
                >
                  <option value="inherit">
                    <UiText message={'Site default · '} />
                    {site.reading.relatedCount}
                  </option>
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? t('None') : n}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="entry-settings-section">
              <div className="entry-section-heading">
                <h3>
                  <Icon name="BookOpen" size={16} /> <UiText message={' Typography'} />
                </h3>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => onChange({ typography: undefined })}
                  data-ui={'Use site typography'}
                >
                  {t('Use site typography')}
                </button>
              </div>
              <Field label={t('Reading typeface')}>
                <select
                  value={metadata.typography?.fontFamily || 'inherit'}
                  onChange={(e) =>
                    typePatch({
                      fontFamily:
                        e.target.value === 'inherit'
                          ? undefined
                          : (e.target.value as NonNullable<EntryMeta['typography']>['fontFamily']),
                    })
                  }
                >
                  <option value="inherit">
                    <UiText message={'Site default · '} />
                    {site.theme.fontFamily}
                  </option>
                  <option value="system" data-ui={'System sans'}>
                    {t('System sans')}
                  </option>
                  <option value="serif" data-ui={'Literary serif'}>
                    {t('Literary serif')}
                  </option>
                  <option value="humanist" data-ui={'Humanist'}>
                    {t('Humanist')}
                  </option>
                </select>
              </Field>
              {(
                [
                  {
                    key: 'articleWidth',
                    label: 'Reading width',
                    min: appearanceRanges.articleWidth[0],
                    max: appearanceRanges.articleWidth[1],
                    step: appearanceRanges.articleWidth[2],
                    unit: 'px',
                  },
                  {
                    key: 'lineHeight',
                    label: 'Line height',
                    min: appearanceRanges.lineHeight[0],
                    max: appearanceRanges.lineHeight[1],
                    step: appearanceRanges.lineHeight[2],
                    unit: '',
                  },
                  {
                    key: 'paragraphSpace',
                    label: 'Paragraph spacing',
                    min: appearanceRanges.paragraphSpace[0],
                    max: appearanceRanges.paragraphSpace[1],
                    step: appearanceRanges.paragraphSpace[2],
                    unit: 'em',
                  },
                ] as const
              ).map((item) => (
                <div className="entry-type-control" key={item.key}>
                  <div className="entry-section-heading">
                    <label htmlFor={`${id}-${item.key}`}>
                      {item.label}
                      <output>
                        {resolved.theme[item.key]}
                        {item.unit}
                      </output>
                    </label>
                    <button
                      type="button"
                      className="text-link"
                      disabled={metadata.typography?.[item.key] === undefined}
                      onClick={() => typePatch({ [item.key]: undefined })}
                    >
                      {metadata.typography?.[item.key] === undefined ? t('Inherited') : t('Reset')}
                    </button>
                  </div>
                  <input
                    id={`${id}-${item.key}`}
                    type="range"
                    min={item.min}
                    max={item.max}
                    step={item.step}
                    value={resolved.theme[item.key]}
                    onChange={(e) => typePatch({ [item.key]: Number(e.target.value) })}
                  />
                </div>
              ))}
              <p
                className="help"
                data-ui={
                  'Changes apply to the article and its live preview. Readers can still choose their own typography and accessibility preferences.'
                }
              >
                {t(
                  'Changes apply to the article and its live preview. Readers can still choose their own typography and accessibility preferences.',
                )}
              </p>
            </div>
          </section>
          <section
            id={`${id}-math`}
            role="tabpanel"
            aria-labelledby={`${id}-math-tab`}
            hidden={tab !== 'math'}
          >
            <MathSettingsFields value={metadata.math} onChange={(math) => onChange({ math })} />
          </section>
          <section
            id={`${id}-discussion`}
            role="tabpanel"
            aria-labelledby={`${id}-discussion-tab`}
            hidden={tab !== 'discussion'}
          >
            <div className="entry-settings-section">
              <ToggleField
                label={t('Allow article discussion')}
                help={t('The main switch for every conversation on this article.')}
                checked={metadata.comments}
                onChange={(comments) => onChange({ comments })}
              />
              {!site.integrations.comments.enabled && (
                <p className="entry-settings-notice">
                  <Icon name="Info" size={16} />{' '}
                  <UiText
                    message={
                      ' Discussions are disabled in Site settings. Your article choices are saved for when Giscus is enabled.'
                    }
                  />
                </p>
              )}
              <fieldset disabled={!metadata.comments} className="entry-discussion-options">
                <legend className="sr-only" data-ui={'Discussion locations'}>
                  {t('Discussion locations')}
                </legend>
                <ToggleField
                  label={t('Article conversation')}
                  help={t('The main discussion at the end of the article.')}
                  checked={metadata.discussion?.article !== false}
                  onChange={(article) =>
                    onChange({ discussion: { ...metadata.discussion, article } })
                  }
                />
                <ToggleField
                  label={t('Markdown discussion blocks')}
                  help={t('Conversations you explicitly place beside a section.')}
                  checked={metadata.discussion?.blocks !== false}
                  onChange={(blocks) =>
                    onChange({ discussion: { ...metadata.discussion, blocks } })
                  }
                />
                <ToggleField
                  label={t('Line annotations')}
                  help={t('Reader notes on exact lines, badges, and annotation tabs.')}
                  checked={metadata.discussion?.annotations !== false}
                  onChange={(annotations) =>
                    onChange({ discussion: { ...metadata.discussion, annotations } })
                  }
                />
              </fieldset>
            </div>
          </section>
          <section
            id={`${id}-sharing`}
            role="tabpanel"
            aria-labelledby={`${id}-sharing-tab`}
            hidden={tab !== 'sharing'}
          >
            <div className="entry-settings-section">
              <h3>
                <Icon name="Search" size={16} /> <UiText message={' Search & social metadata'} />
              </h3>
              <Field
                label={t('Sharing title')}
                help={t('{value0}/160 characters. Leave empty to use the article title.', {
                  value0: (metadata.seo?.title || '').length,
                })}
              >
                <input
                  maxLength={160}
                  value={metadata.seo?.title || ''}
                  placeholder={metadata.title}
                  onChange={(e) => seoPatch({ title: e.target.value })}
                />
              </Field>
              <Field
                label={t('Sharing description')}
                help={t('{value0}/500 characters. Leave empty to use the article summary.', {
                  value0: (metadata.seo?.description || '').length,
                })}
              >
                <textarea
                  rows={3}
                  maxLength={500}
                  value={metadata.seo?.description || ''}
                  placeholder={metadata.summary || site.description}
                  onChange={(e) => seoPatch({ description: e.target.value })}
                />
              </Field>
              <Field
                label={t('Sharing image')}
                help={t('Falls back to the cover, then the site sharing image.')}
              >
                <input
                  value={metadata.seo?.image || ''}
                  aria-invalid={!!fieldError('seo.image')}
                  placeholder={metadata.cover || site.metadata.socialImage || t('/media/…')}
                  onChange={(e) => seoPatch({ image: e.target.value })}
                />
              </Field>
              <div className="entry-settings-actions">
                <Button className="small" icon="Image" onClick={() => setPicker('sharing')}>
                  <UiText message={'Choose sharing image'} />
                </Button>
                {metadata.seo?.image && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => seoPatch({ image: '', imageAlt: '' })}
                    data-ui={'Use fallback image'}
                  >
                    {t('Use fallback image')}
                  </button>
                )}
              </div>
              <Field
                label={t('Sharing image alt text')}
                help={t(
                  'Used for a custom sharing image; cover and site images keep their own descriptions.',
                )}
              >
                <input
                  disabled={!metadata.seo?.image}
                  maxLength={500}
                  value={metadata.seo?.imageAlt || ''}
                  placeholder={metadata.title}
                  onChange={(e) => seoPatch({ imageAlt: e.target.value })}
                />
              </Field>
              <Field
                label={t('Search engine indexing')}
                help={
                  !site.metadata.indexing
                    ? t('Site-wide indexing is disabled; an article cannot override it.')
                    : t('Noindex requests removal from search engines. The article stays public.')
                }
              >
                <select
                  value={metadata.seo?.indexing || 'inherit'}
                  onChange={(e) => seoPatch({ indexing: e.target.value as 'inherit' | 'noindex' })}
                >
                  <option value="inherit">
                    <UiText message={'Use site setting · '} />
                    {site.metadata.indexing ? t('Index') : t('Noindex')}
                  </option>
                  <option value="noindex" data-ui={'Noindex this article'}>
                    {t('Noindex this article')}
                  </option>
                </select>
              </Field>
            </div>
            <div className="entry-settings-section">
              <h3>
                <Icon name="Eye" size={16} /> <UiText message={' Sharing preview'} />
              </h3>
              <div className="entry-sharing-preview">
                {resolved.seo.image && <img src={resolved.seo.image} alt={resolved.seo.imageAlt} />}
                <div>
                  <small>{canonical}</small>
                  <strong>{pageTitle(site, resolved.seo.title, false)}</strong>
                  <p>{resolved.seo.description}</p>
                </div>
              </div>
              <CopyButton label={t('Copy canonical link')} value={canonical} />
              <p
                className="help"
                data-ui={
                  'A preview of the metadata you publish. Services choose their own presentation and may cache earlier versions.'
                }
              >
                {t(
                  'A preview of the metadata you publish. Services choose their own presentation and may cache earlier versions.',
                )}
              </p>
            </div>
          </section>
        </div>
      </div>
      <div className="entry-settings-footer">
        <span className="entry-settings-status" role="status">
          <span className={`status-dot ${dirty ? 'unsaved' : ''}`} />
          {error || problems.length
            ? t('Changes need attention')
            : dirty
              ? t('Saving changes…')
              : t('All changes saved')}
        </span>
        {(error || problems.length > 0) && (
          <Button
            className="small"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void onSave()
                .catch(() => {})
                .finally(() => setSaving(false));
            }}
          >
            <UiText message={'Retry save'} />
          </Button>
        )}
        <Button onClick={onReturn} icon="ChevronLeft">
          <UiText message={'Back to editor'} />
        </Button>
      </div>
      {picker && (
        <MediaPicker
          onClose={() => setPicker(null)}
          onSelect={(url) =>
            picker === 'cover' ? onChange({ cover: url }) : seoPatch({ image: url })
          }
        />
      )}
    </section>
  );
}
