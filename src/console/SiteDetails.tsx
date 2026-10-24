import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useId, type ReactNode } from 'react';
import type { SiteConfig } from '../shared/contracts.js';
import { Brand, Button, Icon, type IconName } from '../shared/ui.js';
import {
  fallbackFavicon,
  feedLinks,
  footerCopyright,
  pageTitle,
} from '../shared/site-presentation.js';
import { Field, ToggleField } from './components.js';

export type SiteImageField = 'favicon' | 'logo' | 'darkLogo' | 'socialImage';
type Props = { value: SiteConfig; onChange: (patch: Partial<SiteConfig>) => void };
type ImageProps = Props & { onPick: (field: SiteImageField) => void; section?: string };

function Heading({
  icon,
  children,
  description,
}: {
  icon: IconName;
  children: ReactNode;
  description?: string;
}) {
  return (
    <>
      <div className="settings-card-heading">
        <Icon name={icon} />
        <h2>{children}</h2>
      </div>
      {description && <p className="modal-intro">{description}</p>}
    </>
  );
}
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="site-color-field">
        <input
          type="color"
          className="color-input"
          aria-label={t('{value0} picker', { value0: label })}
          value={/^#[a-f\d]{6}$/i.test(value) ? value : '#3868e8'}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          aria-label={label}
          value={value}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
function ImageField({
  label,
  value,
  fallback,
  help,
  wide,
  onPick,
  onClear,
}: {
  label: string;
  value: string;
  fallback?: string;
  help: string;
  wide?: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  const id = useId();
  return (
    <div
      className={`site-image-field${wide ? ' wide-image' : ''}`}
      role="group"
      aria-labelledby={id}
    >
      <div className="site-image-preview" aria-hidden="true">
        {value || fallback ? (
          <img src={value || fallback} alt="" />
        ) : (
          <Icon name="Image" size={26} />
        )}
      </div>
      <div className="site-image-details">
        <span className="field-label" id={id}>
          {label}
        </span>
        <small>{help}</small>
        {value && <code title={value}>{decodeURIComponent(value.split('/').at(-1) || '')}</code>}
        <div className="toolbar-group">
          <Button className="small" icon="Image" onClick={onPick}>
            <UiText message={'Choose '} />
            {label.toLowerCase()}
          </Button>
          {value && (
            <Button
              className="small"
              variant="ghost"
              icon="X"
              aria-label={t('Remove {value0}', { value0: label.toLowerCase() })}
              onClick={onClear}
            >
              <UiText message={'Remove'} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function BrandingSettings({ value: site, onChange, onPick, section }: ImageProps) {
  const value = site.branding;
  const update = (patch: Partial<typeof value>) => onChange({ branding: { ...value, ...patch } });
  const fallback = `data:image/svg+xml,${encodeURIComponent(fallbackFavicon(site))}`;
  return (
    <>
      <div hidden={!!section && section !== 'icons'}>
        <Heading
          icon="Palette"
          description={t(
            'A recognizable mark in tabs, navigation, and saved home-screen shortcuts.',
          )}
        >
          <UiText message={'Branding & icons'} />
        </Heading>
        <ImageField
          label={t('Favicon')}
          value={value.favicon}
          fallback={fallback}
          help={t(
            'Choose a square image, ideally 512 × 512 or larger. Crop and resize before uploading.',
          )}
          onPick={() => onPick('favicon')}
          onClear={() => update({ favicon: '' })}
        />
        <p
          className="help"
          data-ui={
            'Each build creates SVG, ICO, 16/32 px PNG, Apple touch, and home-screen icons. Clear the image to use the generated mark.'
          }
        >
          {t(
            'Each build creates SVG, ICO, 16/32 px PNG, Apple touch, and home-screen icons. Clear the image to use the generated mark.',
          )}
        </p>
        {!value.favicon && (
          <div className="site-settings-group">
            <div className="field-row">
              <Field label={t('Generated icon')}>
                <select
                  value={value.iconStyle}
                  data-setting-field="iconStyle"
                  onChange={(e) => update({ iconStyle: e.target.value as typeof value.iconStyle })}
                >
                  <option value="book" data-ui={'Notebook'}>
                    {t('Notebook')}
                  </option>
                  <option value="monogram" data-ui={'Monogram'}>
                    {t('Monogram')}
                  </option>
                </select>
              </Field>
              {value.iconStyle === 'monogram' && (
                <Field
                  label={t('Monogram')}
                  help={t(
                    'Up to two displayed characters; blank uses your short name or site name.',
                  )}
                >
                  <input
                    value={value.monogram}
                    data-setting-field="monogram"
                    maxLength={4}
                    onChange={(e) => update({ monogram: e.target.value })}
                  />
                </Field>
              )}
            </div>
          </div>
        )}
        <ColorField
          label={t('Icon background')}
          value={value.iconBackground}
          onChange={(iconBackground) => update({ iconBackground })}
        />
      </div>
      <div hidden={!!section && section !== 'branding'}>
        <Heading
          icon="BookOpen"
          description={t('The header and footer share this mark. Profile details stay in About.')}
        >
          <UiText message={'Navigation mark'} />
        </Heading>
        <ImageField
          label={t('Logo')}
          value={value.logo}
          help={t(
            'A compact raster mark, fitted without cropping. Blank uses the notebook symbol.',
          )}
          onPick={() => onPick('logo')}
          onClear={() => update({ logo: '' })}
        />
        <ImageField
          label={t('Dark logo')}
          value={value.darkLogo}
          help={t('Optional alternate image for dark appearance; requires a primary logo.')}
          onPick={() => onPick('darkLogo')}
          onClear={() => update({ darkLogo: '' })}
        />
        <ToggleField
          label={t('Show site name beside the logo')}
          checked={value.showName}
          onChange={(showName) => update({ showName })}
        />
        <ToggleField
          label={t('Show the accent period')}
          checked={value.namePeriod}
          onChange={(namePeriod) => update({ namePeriod })}
        />
        <div
          className="site-brand-preview glass-panel"
          aria-label={t('Navigation mark preview')}
          data-ui-attrs={'{"aria-label":"Navigation mark preview"}'}
        >
          <Brand name={site.name} {...value} appearance={site.theme.appearance} />
          <small data-ui={'Header & footer'}>{t('Header & footer')}</small>
        </div>
      </div>
      <div hidden={!!section && section !== 'browser'}>
        <Heading
          icon="Monitor"
          description={t(
            'Control the browser chrome and saved shortcut appearance. These settings do not enable offline caching.',
          )}
        >
          <UiText message={'Browser & home screen'} />
        </Heading>
        <Field
          label={t('Short name')}
          help={t('Used for home-screen icons. Blank uses the notebook name.')}
        >
          <input
            value={value.shortName}
            data-setting-field="shortName"
            maxLength={24}
            onChange={(e) => update({ shortName: e.target.value })}
          />
        </Field>
        <div className="field-row">
          <ColorField
            label={t('Browser color · light')}
            value={value.themeColorLight}
            onChange={(themeColorLight) => update({ themeColorLight })}
          />
          <ColorField
            label={t('Browser color · dark')}
            value={value.themeColorDark}
            onChange={(themeColorDark) => update({ themeColorDark })}
          />
        </div>
        <div className="field-row">
          <ColorField
            label={t('Launch background')}
            value={value.appBackground}
            onChange={(appBackground) => update({ appBackground })}
          />
          <Field label={t('Shortcut display')}>
            <select
              value={value.appDisplay}
              data-setting-field="appDisplay"
              onChange={(e) => update({ appDisplay: e.target.value as typeof value.appDisplay })}
            >
              <option value="browser" data-ui={'Browser tab'}>
                {t('Browser tab')}
              </option>
              <option value="minimal-ui" data-ui={'Minimal browser controls'}>
                {t('Minimal browser controls')}
              </option>
              <option value="standalone" data-ui={'Standalone window'}>
                {t('Standalone window')}
              </option>
            </select>
          </Field>
        </div>
      </div>
    </>
  );
}

export function MetadataSettings({ value: site, onChange, onPick, section }: ImageProps) {
  const value = site.metadata;
  const update = (patch: Partial<typeof value>) => onChange({ metadata: { ...value, ...patch } });
  return (
    <>
      <div hidden={!!section && section !== 'metadata'}>
        <Heading
          icon="Globe"
          description={t('Set the titles and descriptions readers see in search and shared links.')}
        >
          <UiText message={'Page titles'} />
        </Heading>
        <Field
          label={t('Home page title')}
          help={t('Blank uses the notebook name and its default title.')}
        >
          <input
            value={value.homeTitle}
            data-setting-field="homeTitle"
            maxLength={160}
            placeholder={t('{value0} — An open notebook', { value0: site.name })}
            onChange={(e) => update({ homeTitle: e.target.value })}
          />
        </Field>
        <Field
          label={t('Page title template')}
          help={t('Include {title}. Use {site} for the notebook name.')}
        >
          <input
            value={value.titleTemplate}
            data-setting-field="titleTemplate"
            maxLength={200}
            spellCheck={false}
            onChange={(e) => update({ titleTemplate: e.target.value })}
          />
        </Field>
      </div>
      <div hidden={!!section && section !== 'sharing'}>
        <Heading icon="Globe">
          <UiText message={'Social sharing'} />
        </Heading>
        <Field
          label={t('Social locale')}
          help={t(
            'Optional Open Graph locale, such as en_US or zh_CN. Blank derives it from the page language.',
          )}
        >
          <input
            value={value.locale}
            data-setting-field="locale"
            maxLength={6}
            placeholder={t('Automatic')}
            onChange={(e) => update({ locale: e.target.value })}
            data-ui-attrs={'{"placeholder":"Automatic"}'}
          />
        </Field>
        <ImageField
          label={t('Social image')}
          value={value.socialImage}
          wide
          help={t(
            'Default link-preview image; article covers take priority. A 1200 × 630 image works well.',
          )}
          onPick={() => onPick('socialImage')}
          onClear={() => update({ socialImage: '' })}
        />
        <Field label={t('Social image description')}>
          <input
            value={value.socialImageAlt}
            data-setting-field="socialImageAlt"
            maxLength={500}
            onChange={(e) => update({ socialImageAlt: e.target.value })}
          />
        </Field>
        <div
          className="site-social-preview glass-panel"
          aria-label={t('Link preview')}
          data-ui-attrs={'{"aria-label":"Link preview"}'}
        >
          {value.socialImage && <img src={value.socialImage} alt={value.socialImageAlt} />}
          <div>
            <small>
              {site.url.replace(/^https?:\/\//, '').replace(/\/$/, '') || t('Your site')}
            </small>
            <strong>{pageTitle(site, site.name, true)}</strong>
            <p>{site.description}</p>
          </div>
        </div>
        <div className="field-row">
          <Field label={t('X / Twitter site handle')}>
            <input
              value={value.twitterSite}
              data-setting-field="twitterSite"
              maxLength={16}
              placeholder={t('@yourname')}
              onChange={(e) => update({ twitterSite: e.target.value })}
              data-ui-attrs={'{"placeholder":"@yourname"}'}
            />
          </Field>
          <Field label={t('X / Twitter author handle')}>
            <input
              value={value.twitterCreator}
              data-setting-field="twitterCreator"
              maxLength={16}
              placeholder={t('@yourname')}
              onChange={(e) => update({ twitterCreator: e.target.value })}
              data-ui-attrs={'{"placeholder":"@yourname"}'}
            />
          </Field>
        </div>
        <Field label={t('Link card format')}>
          <select
            value={value.twitterCard}
            data-setting-field="twitterCard"
            onChange={(e) => update({ twitterCard: e.target.value as typeof value.twitterCard })}
          >
            <option value="auto" data-ui={'Automatic · large when an image exists'}>
              {t('Automatic · large when an image exists')}
            </option>
            <option value="summary" data-ui={'Compact summary'}>
              {t('Compact summary')}
            </option>
            <option value="summary_large_image" data-ui={'Large image summary'}>
              {t('Large image summary')}
            </option>
          </select>
        </Field>
      </div>
      <div hidden={!!section && section !== 'indexing'}>
        <Heading
          icon="Search"
          description={t(
            'These are requests to search engines. Existing results may take time to update.',
          )}
        >
          <UiText message={'Search visibility'} />
        </Heading>
        <ToggleField
          label={t('Allow search indexing')}
          help={t('Writes a robots meta directive. Pages remain publicly accessible.')}
          checked={value.indexing}
          onChange={(indexing) => update({ indexing })}
        />
        <ToggleField
          label={t('Allow search engines to follow links')}
          checked={value.followLinks}
          onChange={(followLinks) => update({ followLinks })}
        />
        <ToggleField
          label={t('Generate a sitemap')}
          help={t(
            'Available at /sitemap.xml when indexing is enabled; reader settings are excluded.',
          )}
          checked={value.sitemap}
          onChange={(sitemap) => update({ sitemap })}
        />
        <Field label={t('Search image previews')}>
          <select
            value={value.maxImagePreview}
            data-setting-field="maxImagePreview"
            onChange={(e) =>
              update({ maxImagePreview: e.target.value as typeof value.maxImagePreview })
            }
          >
            <option value="large" data-ui={'Allow large images'}>
              {t('Allow large images')}
            </option>
            <option value="standard" data-ui={'Standard thumbnails'}>
              {t('Standard thumbnails')}
            </option>
            <option value="none" data-ui={'No image previews'}>
              {t('No image previews')}
            </option>
          </select>
        </Field>
        <ToggleField
          label={t('Include structured metadata')}
          help={t('Generate WebSite and article JSON-LD for search engines.')}
          checked={value.structuredData}
          onChange={(structuredData) => update({ structuredData })}
        />
        <ToggleField
          label={t('Include author metadata')}
          help={t('Use the name from About in page metadata and article structured data.')}
          checked={value.author}
          onChange={(author) => update({ author })}
        />
        <div className="divider" />
        <Heading
          icon="CheckCheck"
          description={t('Paste the content token from the provider’s HTML meta tag.')}
        >
          <UiText message={'Site verification'} />
        </Heading>
        <Field label={t('Google verification token')}>
          <input
            autoComplete="off"
            spellCheck={false}
            value={value.googleVerification}
            data-setting-field="googleVerification"
            maxLength={200}
            onChange={(e) => update({ googleVerification: e.target.value })}
          />
        </Field>
        <Field label={t('Bing verification token')}>
          <input
            autoComplete="off"
            spellCheck={false}
            value={value.bingVerification}
            data-setting-field="bingVerification"
            maxLength={200}
            onChange={(e) => update({ bingVerification: e.target.value })}
          />
        </Field>
      </div>
    </>
  );
}

export function FooterSettings({ value: site, onChange }: Props) {
  const value = site.footer;
  const update = (patch: Partial<typeof value>) => onChange({ footer: { ...value, ...patch } });
  return (
    <>
      <Heading
        icon="Layers"
        description={t('A quiet, flexible footer using the same glass as the navigation.')}
      >
        <UiText message={'Footer'} />
      </Heading>
      <Field label={t('Footer tagline')} help={t('Leave blank to hide the tagline.')}>
        <input
          value={value.tagline}
          data-setting-field="tagline"
          maxLength={300}
          onChange={(e) => update({ tagline: e.target.value })}
        />
      </Field>
      <div className="field-row">
        <Field label={t('Copyright name')} help={t('Blank uses the profile name from About.')}>
          <input
            value={value.copyrightName}
            data-setting-field="copyrightName"
            maxLength={100}
            placeholder={site.profile.name}
            onChange={(e) => update({ copyrightName: e.target.value })}
          />
        </Field>
        <Field label={t('Copyright start year')} help={t('Use 0 to show only the current year.')}>
          <input
            type="number"
            min={0}
            max={9999}
            value={value.since}
            data-setting-field="since"
            onChange={(e) => update({ since: Number(e.target.value) })}
          />
        </Field>
      </div>
      <p className="site-copyright-preview">
        <Icon name="CalendarDays" size={15} />
        {footerCopyright(site)}
      </p>
      <ToggleField
        label={t('Show footer brand')}
        checked={value.showBrand}
        onChange={(showBrand) => update({ showBrand })}
      />
      <ToggleField
        label={t('Show profile links')}
        help={t('Use the ordered links from About → Profile.')}
        checked={value.showSocialLinks}
        onChange={(showSocialLinks) => update({ showSocialLinks })}
      />
      <Field label={t('Number of profile links')}>
        <input
          type="number"
          min={0}
          max={12}
          value={value.socialLinkLimit}
          data-setting-field="socialLinkLimit"
          onChange={(e) => update({ socialLinkLimit: Number(e.target.value) })}
        />
      </Field>
      <ToggleField
        label={t('Show feed links')}
        help={t('Only enabled feed formats appear.')}
        checked={value.showFeeds}
        onChange={(showFeeds) => update({ showFeeds })}
      />
      <ToggleField
        label={t('Open external footer links in a new tab')}
        checked={value.externalLinks}
        onChange={(externalLinks) => update({ externalLinks })}
      />
      <div className="divider" />
      <Heading
        icon="LinkIcon"
        description={t('Add up to eight links, such as a privacy page, contact, or a project.')}
      >
        <UiText message={'Additional links'} />
      </Heading>
      <div className="site-footer-link-list">
        {value.links.map((link, index) => (
          <div className="site-footer-link-row" key={index}>
            <Field label={t('Link {value0} label', { value0: index + 1 })}>
              <input
                value={link.label}
                data-setting-field="label"
                maxLength={50}
                onChange={(e) =>
                  update({
                    links: value.links.map((current, at) =>
                      at === index ? { ...current, label: e.target.value } : current,
                    ),
                  })
                }
              />
            </Field>
            <Field label={t('Link {value0} address', { value0: index + 1 })}>
              <input
                value={link.href}
                data-setting-field="href"
                maxLength={1000}
                placeholder="https://… or /about/"
                onChange={(e) =>
                  update({
                    links: value.links.map((current, at) =>
                      at === index ? { ...current, href: e.target.value } : current,
                    ),
                  })
                }
              />
            </Field>
            <div className="toolbar-group">
              <Button
                className="small icon-only"
                icon="ArrowUp"
                aria-label={t('Move link {value0} up', { value0: index + 1 })}
                disabled={index === 0}
                onClick={() => {
                  const links = [...value.links];
                  [links[index - 1], links[index]] = [links[index], links[index - 1]];
                  update({ links });
                }}
              />
              <Button
                className="small icon-only"
                icon="ArrowDown"
                aria-label={t('Move link {value0} down', { value0: index + 1 })}
                disabled={index === value.links.length - 1}
                onClick={() => {
                  const links = [...value.links];
                  [links[index + 1], links[index]] = [links[index], links[index + 1]];
                  update({ links });
                }}
              />
              <Button
                className="small icon-only"
                icon="Trash2"
                aria-label={t('Remove link {value0}', { value0: index + 1 })}
                onClick={() => update({ links: value.links.filter((_, at) => at !== index) })}
              />
            </div>
          </div>
        ))}
      </div>
      <Button
        className="small"
        icon="Plus"
        disabled={value.links.length >= 8}
        onClick={() => update({ links: [...value.links, { label: 'Link', href: '/about/' }] })}
      >
        <UiText message={'Add footer link'} />
      </Button>
    </>
  );
}

export function FeedSettings({ value: site, onChange }: Props) {
  const value = site.feeds;
  const update = (patch: Partial<typeof value>) => onChange({ feeds: { ...value, ...patch } });
  return (
    <>
      <Heading
        icon="Rss"
        description={t(
          'Let readers subscribe through their preferred app. Feeds contain published summaries only.',
        )}
      >
        <UiText message={'Feeds & subscriptions'} />
      </Heading>
      <ToggleField
        label={t('RSS feed')}
        help={t('RSS 2.0 at /feed.xml.')}
        checked={value.rss}
        onChange={(rss) => update({ rss })}
      />
      <ToggleField
        label={t('Atom feed')}
        help={t('Atom 1.0 at /atom.xml.')}
        checked={value.atom}
        onChange={(atom) => update({ atom })}
      />
      <ToggleField
        label={t('JSON feed')}
        help={t('JSON Feed 1.1 at /feed.json.')}
        checked={value.json}
        onChange={(json) => update({ json })}
      />
      <div
        className="site-feed-preview"
        aria-label={t('Enabled feeds')}
        data-ui-attrs={'{"aria-label":"Enabled feeds"}'}
      >
        {feedLinks(site).map((feed) => (
          <span className="chip" key={feed.href}>
            <Icon name="Rss" size={13} />
            {feed.label}
            <code>{feed.href}</code>
          </span>
        ))}
        {!feedLinks(site).length && (
          <p
            className="help"
            data-ui={
              'All feeds are disabled. Footer and browser subscription links will be hidden.'
            }
          >
            {t('All feeds are disabled. Footer and browser subscription links will be hidden.')}
          </p>
        )}
      </div>
      <div className="divider" />
      <Field label={t('Feed title')} help={t('Blank uses the notebook name.')}>
        <input
          value={value.title}
          data-setting-field="title"
          maxLength={160}
          placeholder={site.name}
          onChange={(e) => update({ title: e.target.value })}
        />
      </Field>
      <Field label={t('Feed description')} help={t('Blank uses the site description.')}>
        <textarea
          rows={3}
          value={value.description}
          data-setting-field="description"
          maxLength={500}
          placeholder={site.description}
          onChange={(e) => update({ description: e.target.value })}
        />
      </Field>
      <Field
        label={t('Maximum feed entries')}
        help={t('The most recent 1–200 published entries, ordered by date.')}
      >
        <input
          type="number"
          min={1}
          max={200}
          value={value.limit}
          data-setting-field="limit"
          onChange={(e) => update({ limit: Number(e.target.value) })}
        />
      </Field>
      <ToggleField
        label={t('Include {value0}', { value0: site.collections.posts.name })}
        checked={value.posts}
        onChange={(posts) => update({ posts })}
      />
      <ToggleField
        label={t('Include {value0}', { value0: site.collections.lab.name })}
        checked={value.lab}
        onChange={(lab) => update({ lab })}
      />
      <ToggleField
        label={t('Include profile author in feeds')}
        help={t('When disabled, Atom identifies the site as its author.')}
        checked={value.author}
        onChange={(author) => update({ author })}
      />
    </>
  );
}

export function NavigationTools({ value: site, onChange }: Props) {
  const value = site.navigationTools;
  const update = (patch: Partial<typeof value>) =>
    onChange({ navigationTools: { ...value, ...patch } });
  return (
    <>
      <div className="divider" />
      <Heading icon="Settings2">
        <UiText message={'Navigation tools'} />
      </Heading>
      <ToggleField
        label={t('Show Tools shortcut')}
        help={t('Developer utilities and equation editor. /tools/ remains available directly.')}
        checked={value.tools}
        onChange={(tools) => update({ tools })}
      />
      <ToggleField
        label={t('Show search')}
        help={t('Controls the search button, dialog, and keyboard shortcut.')}
        checked={value.search}
        onChange={(search) => update({ search })}
      />
      <ToggleField
        label={t('Show appearance toggle')}
        checked={value.themeToggle}
        onChange={(themeToggle) => update({ themeToggle })}
      />
      <ToggleField
        label={t('Show reader settings')}
        help={t('Hide the navigation shortcut; /settings/ remains available directly.')}
        checked={value.readerSettings}
        onChange={(readerSettings) => update({ readerSettings })}
      />
    </>
  );
}
