import { uiLocales, localeNames, uiAttrs } from '../shared/i18n.js';
import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import type { SiteConfig } from '../shared/contracts.js';
import { Icon } from '../shared/ui.js';
import { readerRanges } from '../shared/reader-preferences.js';
import { appearanceLabels, textScaleRange } from '../shared/appearance-ranges.js';
import { ContrastControls } from '../shared/ContrastControls.js';
import { ReaderSpecimen, type SpecimenContent } from './ReaderSpecimen.js';

type Theme = SiteConfig['theme'];
function Range({ name, value }: { name: keyof typeof readerRanges | 'textScale'; value: number }) {
  const [min, max, step] = name === 'textScale' ? textScaleRange : readerRanges[name];
  const [label, unit] = appearanceLabels[name];
  return (
    <label className="reader-field">
      <span>
        <UiText message={label} />
        <output htmlFor={'reader-' + name} data-reader-output={name}>
          {name === 'textScale' || name === 'fontScale'
            ? Math.round(value * 100) + '%'
            : value + unit}
        </output>
      </span>
      <input
        id={'reader-' + name}
        data-reader-control={name}
        type="range"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        {...uiAttrs({ 'aria-label': label })}
      />
    </label>
  );
}
function Choice({
  name,
  label,
  value,
  choices,
}: {
  name: string;
  label: string;
  value: string;
  choices: [string, string][];
}) {
  return (
    <label className="reader-field">
      <span>
        <UiText message={label} />
      </span>
      <select data-reader-control={name} {...uiAttrs({ 'aria-label': label })} defaultValue={value}>
        {choices.map(([key, text]) => (
          <option value={key} key={key} data-ui={text}>
            {t(text)}
          </option>
        ))}
      </select>
    </label>
  );
}
function Reset({ section }: { section: string }) {
  return (
    <button className="text-link reader-reset" type="button" data-reader-reset={section}>
      <Icon name="RotateCcw" size={13} />
      <UiText message={'Reset section'} />
    </button>
  );
}
export function ReaderSettings({
  theme,
  readingHtml,
  materialsHtml,
  translations,
  languageControls = true,
  aca,
}: {
  theme: Theme;
  readingHtml: string;
  materialsHtml: string;
  translations?: Partial<Record<'en' | 'zh-Hans' | 'zh-Hant', SpecimenContent>>;
  languageControls?: boolean;
  aca?: SiteConfig['integrations']['aca'];
}) {
  return (
    <div className="reader-settings">
      {aca?.enabled && (
        <button
          type="button"
          hidden
          data-aca-privacy={JSON.stringify(aca)}
          aria-label="Analytics privacy"
        />
      )}
      <div className="reader-page-heading">
        <span className="eyebrow">
          <Icon name="Settings2" size={15} />
          <UiText message={'Your reading space'} />
        </span>
        <h1 data-ui={'Make yourself comfortable.'}>{t('Make yourself comfortable.')}</h1>
        <p
          data-ui={
            'Choose how this notebook looks on your device. Your preferences and pictures stay in this browser.'
          }
        >
          {t(
            'Choose how this notebook looks on your device. Your preferences and pictures stay in this browser.',
          )}
        </p>
        <div className="reader-page-actions">
          {languageControls && (
            <label className="reader-ui-language">
              <Icon name="Languages" size={15} />
              <UiText message="Interface language" />
              <select
                data-ui-language
                {...uiAttrs({ 'aria-label': 'Interface language' })}
                defaultValue="en"
              >
                {uiLocales.map((locale) => (
                  <option key={locale} value={locale}>
                    {localeNames[locale]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span
            className="help"
            role="status"
            data-reader-status
            data-ui={'Loading your preferences…'}
          >
            {t('Loading your preferences…')}
          </span>
          <button type="button" className="button secondary small" data-reader-reset="all">
            <Icon name="RotateCcw" size={15} />
            <UiText message={'Reset everything'} />
          </button>
        </div>
      </div>
      <div className="reader-settings-layout">
        <form data-reader-settings onSubmit={undefined}>
          <fieldset
            disabled
            className="reader-section glass-panel"
            data-reader-section="appearance"
          >
            <div className="reader-section-heading">
              <h2>
                <Icon name="SunMoon" />
                <UiText message={'Appearance'} />
              </h2>
              <Reset section="appearance" />
            </div>
            <Choice
              name="appearance"
              label={t('Appearance')}
              value={theme.appearance}
              choices={[
                ['system', 'Follow system'],
                ['light', 'Light'],
                ['dark', 'Dark'],
              ]}
            />
            <Choice
              name="background"
              label={t('Atmosphere')}
              value={theme.background}
              choices={[
                ['sky', 'Sky'],
                ['sand', 'Sand'],
                ['mist', 'Mist'],
              ]}
            />
            <label className="reader-field reader-color">
              <span data-ui={'Accent color'}>{t('Accent color')}</span>
              <input
                type="color"
                className="color-input"
                data-reader-control="accent"
                aria-label={t('Accent color')}
                defaultValue={theme.accent}
                data-ui-attrs={'{"aria-label":"Accent color"}'}
              />
              <span className="reader-accent-value" data-reader-accent>
                {theme.accent}
              </span>
            </label>
            <Range name="fontScale" value={theme.fontScale} />
            <Range name="contentWidth" value={theme.contentWidth} />
          </fieldset>
          <fieldset disabled className="reader-section glass-panel" data-reader-section="reading">
            <div className="reader-section-heading">
              <h2>
                <Icon name="BookOpen" />
                <UiText message={'Reading'} />
              </h2>
              <Reset section="reading" />
            </div>
            <Choice
              name="fontFamily"
              label={t('Reading typeface')}
              value={theme.fontFamily}
              choices={[
                ['system', 'System sans'],
                ['serif', 'Literary serif'],
                ['humanist', 'Humanist'],
              ]}
            />
            <Range name="textScale" value={theme.textScale} />
            <label className="reader-toggle">
              <span>
                <strong data-ui={'Article focus mode'}>{t('Article focus mode')}</strong>
                <small data-ui={'Keep the article and outline; quiet surrounding navigation.'}>
                  {t('Keep the article and outline; quiet surrounding navigation.')}
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label={t('Article focus mode')}
                data-reader-control="focusMode"
                defaultChecked={theme.focusMode}
                data-ui-attrs={'{"aria-label":"Article focus mode"}'}
              />
            </label>
            {(['articleWidth', 'lineHeight', 'paragraphSpace', 'readingOpacity'] as const).map(
              (name) => (
                <Range key={name} name={name} value={theme[name]} />
              ),
            )}
          </fieldset>
          <fieldset disabled className="reader-section glass-panel" data-reader-section="contrast">
            <ContrastControls theme={theme} />
          </fieldset>
          <fieldset disabled className="reader-section glass-panel" data-reader-section="glass">
            <div className="reader-section-heading">
              <h2>
                <Icon name="Layers" />
                <UiText message={'Glass & light'} />
              </h2>
              <Reset section="glass" />
            </div>
            {(
              [
                'glass',
                'glassBlur',
                'glassOpacity',
                'glassSaturation',
                'cornerRadius',
                'ambientIntensity',
              ] as const
            ).map((name) => (
              <Range key={name} name={name} value={theme[name]} />
            ))}
            <label className="reader-toggle">
              <span>
                <strong data-ui={'Reduce motion'}>{t('Reduce motion')}</strong>
                <small data-ui={'Quiet page transitions and pointer effects.'}>
                  {t('Quiet page transitions and pointer effects.')}
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                data-reader-control="reduceMotion"
                defaultChecked={theme.reduceMotion}
              />
            </label>
            <label className="reader-toggle">
              <span>
                <strong data-ui={'Reduce transparency'}>{t('Reduce transparency')}</strong>
                <small data-ui={'Use solid surfaces for a calmer view.'}>
                  {t('Use solid surfaces for a calmer view.')}
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                data-reader-control="reduceTransparency"
                defaultChecked={theme.reduceTransparency}
              />
            </label>
            <p
              className="help"
              data-ui={'Your system’s accessibility preferences always take priority.'}
            >
              {t('Your system’s accessibility preferences always take priority.')}
            </p>
          </fieldset>
          <fieldset
            disabled
            className="reader-section glass-panel"
            data-reader-section="background"
          >
            <div className="reader-section-heading">
              <h2>
                <Icon name="Image" />
                <UiText message={'Background picture'} />
              </h2>
              <Reset section="background" />
            </div>
            <Choice
              name="wallpaper"
              label={t('Background picture')}
              value="site"
              choices={[
                ['site', 'Site background'],
                ['none', 'Atmosphere only'],
                ['local', 'My picture'],
              ]}
            />
            <div className="reader-picture-preview" data-reader-picture hidden>
              <img
                alt={t('Your background preview')}
                data-ui-attrs={'{"alt":"Your background preview"}'}
              />
              <button type="button" className="button secondary small" data-reader-remove-picture>
                <Icon name="Trash2" size={14} />
                <UiText message={'Remove picture'} />
              </button>
            </div>
            <label className="reader-field">
              <span data-ui={'Choose a picture'}>{t('Choose a picture')}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                data-reader-picture-input
                aria-label={t('Choose a background picture')}
                data-ui-attrs={'{"aria-label":"Choose a background picture"}'}
              />
              <small
                className="help"
                data-ui={'JPEG, PNG, WebP or AVIF, up to 20 MiB. Saved on this device.'}
              >
                {t('JPEG, PNG, WebP or AVIF, up to 20 MiB. Saved on this device.')}
              </small>
            </label>
            <Choice
              name="wallpaperPosition"
              label={t('Picture position')}
              value={theme.wallpaperPosition}
              choices={[
                ['center', 'Center'],
                ['top', 'Top'],
                ['bottom', 'Bottom'],
              ]}
            />
            <Range name="wallpaperBlur" value={theme.wallpaperBlur} />
            <Choice
              name="wallpaperWash"
              label={t('Picture wash color')}
              value={theme.wallpaperWash}
              choices={[
                ['auto', 'Automatic — follow theme'],
                ['light', 'Light'],
                ['dark', 'Dark'],
              ]}
            />
            <p
              className="help"
              data-ui={
                'Choose a light or dark wash without changing your theme. Automatic follows the active theme.'
              }
            >
              {t(
                'Choose a light or dark wash without changing your theme. Automatic follows the active theme.',
              )}
            </p>
            <Range name="wallpaperDim" value={theme.wallpaperDim} />
          </fieldset>
        </form>
        <ReaderSpecimen
          readingHtml={readingHtml}
          materialsHtml={materialsHtml}
          translations={translations}
        />
      </div>
      <noscript>
        <p
          data-ui={
            'Enable JavaScript to personalize this browser. The notebook remains readable with the site’s default appearance.'
          }
        >
          {t(
            'Enable JavaScript to personalize this browser. The notebook remains readable with the site’s default appearance.',
          )}
        </p>
      </noscript>
    </div>
  );
}
