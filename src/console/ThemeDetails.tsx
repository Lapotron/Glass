import { t } from '../shared/i18n.js';
import { appearanceLabels, appearanceRanges, textScaleRange } from '../shared/appearance-ranges.js';
import { Field, ToggleField } from './components.js';
import { Icon } from '../shared/ui.js';
import type { SiteConfig } from '../shared/contracts.js';
import { ContrastControls } from '../shared/ContrastControls.js';
import { contrastPreset } from '../shared/contrast.js';
type Theme = SiteConfig['theme'];
export function ThemeRange({
  name,
  label,
  value,
  onChange,
}: {
  name: keyof typeof appearanceRanges | 'textScale';
  label?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [min, max, step] = name === 'textScale' ? textScaleRange : appearanceRanges[name];
  const [defaultLabel, unit] = appearanceLabels[name];
  return (
    <Field
      label={t("{value0} · {value1}", {value0: label || t(defaultLabel), value1: name === 'textScale' ? Math.round(value * 100) + '%' : Number(value.toFixed(2)) + unit})}
    >
      <input
        data-setting-field={name}
        aria-label={label || t(defaultLabel)}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}
export function ThemeDetails({
  value,
  onChange,
  section,
}: {
  section?: string;
  value: Theme;
  onChange: (patch: Partial<Theme>) => void;
}) {
  return (
    <>
      <section className="settings-card glass-panel" hidden={!!section && section !== 'contrast'}>
        <ContrastControls
          theme={value}
          onChange={(contrast) => onChange({ contrast })}
          onReset={() => onChange({ contrast: contrastPreset() })}
        />
      </section>
      <section className="settings-card glass-panel" hidden={!!section && section !== 'typography'}>
        <div className="settings-card-heading">
          <Icon name="BookOpen" />
          <h2 data-ui={"Reading & typography"}>{t("Reading & typography")}</h2>
        </div>
        <Field label={t("Reading typeface")}>
          <select
            value={value.fontFamily}
            onChange={(event) =>
              onChange({ fontFamily: event.target.value as Theme['fontFamily'] })
            }
          >
            <option value="system" data-ui={"System sans"}>{t("System sans")}</option>
            <option value="serif" data-ui={"Literary serif"}>{t("Literary serif")}</option>
            <option value="humanist" data-ui={"Humanist"}>{t("Humanist")}</option>
          </select>
        </Field>
        <ThemeRange
          name="fontScale"
          value={value.fontScale}
          onChange={(fontScale) => onChange({ fontScale })}
        />
        <ThemeRange
          name="textScale"
          value={value.textScale}
          onChange={(textScale) => onChange({ textScale })}
        />
        <p className="help" data-ui={"The default prose size, independent of interface scale. Readers can choose their own size or restore this default."}>
          {t("The default prose size, independent of interface scale. Readers can choose their own size or restore this default.")}</p>
        <ThemeRange
          name="lineHeight"
          label={t("Line height")}
          value={value.lineHeight}
          onChange={(lineHeight) => onChange({ lineHeight })}
        />
        <ThemeRange
          name="paragraphSpace"
          label={t("Paragraph spacing")}
          value={value.paragraphSpace}
          onChange={(paragraphSpace) => onChange({ paragraphSpace })}
        />
        <ThemeRange
          name="readingOpacity"
          label={t("Article background tint")}
          value={value.readingOpacity}
          onChange={(readingOpacity) => onChange({ readingOpacity })}
        />
        <p className="help" data-ui={"Scales the glass tint beneath prose without changing navigation or cards. Zero clears the tint; code and data keep their own foundation."}>
          {t("Scales the glass tint beneath prose without changing navigation or cards. Zero clears the tint; code and data keep their own foundation.")}</p>
        <ToggleField
          label={t("Default article focus mode")}
          checked={value.focusMode}
          onChange={(focusMode) => onChange({ focusMode })}
          help={t("Open articles with quiet surrounding navigation. Readers can exit focus or choose their own default.")}
        />
      </section>
      <section className="settings-card glass-panel" hidden={!!section && section !== 'glass'}>
        <div className="settings-card-heading">
          <Icon name="Layers" />
          <h2 data-ui={"Glass & light"}>{t("Glass & light")}</h2>
        </div>
        <ThemeRange name="glass" label={t("Glass intensity")} value={value.glass} onChange={(glass) => onChange({ glass })} />
        <ThemeRange
          name="glassBlur"
          label={t("Glass blur")}
          value={value.glassBlur}
          onChange={(glassBlur) => onChange({ glassBlur })}
        />
        <ThemeRange
          name="glassOpacity"
          label={t("Glass tint opacity")}
          value={value.glassOpacity}
          onChange={(glassOpacity) => onChange({ glassOpacity })}
        />
        <ThemeRange
          name="glassSaturation"
          label={t("Glass saturation")}
          value={value.glassSaturation}
          onChange={(glassSaturation) => onChange({ glassSaturation })}
        />
        <ThemeRange
          name="cornerRadius"
          label={t("Panel corners")}
          value={value.cornerRadius}
          onChange={(cornerRadius) => onChange({ cornerRadius })}
        />
        <ThemeRange
          name="ambientIntensity"
          label={t("Ambient light")}
          value={value.ambientIntensity}
          onChange={(ambientIntensity) => onChange({ ambientIntensity })}
        />
      </section>
      <section className="settings-card glass-panel" hidden={!!section && section !== 'wallpaper'}>
        <div className="settings-card-heading">
          <Icon name="Image" />
          <h2 data-ui={"Wallpaper treatment"}>{t("Wallpaper treatment")}</h2>
        </div>
        <p className="help" data-ui={"Adjust the picture selected above. Text surfaces keep their own contrast."}>
          {t("Adjust the picture selected above. Text surfaces keep their own contrast.")}</p>
        <ThemeRange
          name="wallpaperBlur"
          label={t("Wallpaper blur")}
          value={value.wallpaperBlur}
          onChange={(wallpaperBlur) => onChange({ wallpaperBlur })}
        />
        <ThemeRange
          name="wallpaperDim"
          label={t("Wallpaper wash")}
          value={value.wallpaperDim}
          onChange={(wallpaperDim) => onChange({ wallpaperDim })}
        />
        <Field
          label={t("Wallpaper wash color")}
          help={t("Choose a light or dark wash independently of the theme. Automatic follows the active theme. Readers can override this on their device.")}
        >
          <select
            value={value.wallpaperWash}
            onChange={(event) =>
              onChange({ wallpaperWash: event.target.value as Theme['wallpaperWash'] })
            }
          >
            <option value="auto" data-ui={"Automatic — follow theme"}>{t("Automatic — follow theme")}</option>
            <option value="light" data-ui={"Light"}>{t("Light")}</option>
            <option value="dark" data-ui={"Dark"}>{t("Dark")}</option>
          </select>
        </Field>
        <Field label={t("Wallpaper focal point")}>
          <select
            value={value.wallpaperPosition}
            onChange={(event) =>
              onChange({ wallpaperPosition: event.target.value as Theme['wallpaperPosition'] })
            }
          >
            <option value="center" data-ui={"Center"}>{t("Center")}</option>
            <option value="top" data-ui={"Top"}>{t("Top")}</option>
            <option value="bottom" data-ui={"Bottom"}>{t("Bottom")}</option>
          </select>
        </Field>
      </section>
    </>
  );
}
export function ReadingDetails({
  value,
  onChange,
}: {
  value: SiteConfig['reading'];
  onChange: (value: SiteConfig['reading']) => void;
}) {
  const change = (patch: Partial<SiteConfig['reading']>) => onChange({ ...value, ...patch });
  return (
    <section className="settings-card glass-panel">
      <div className="settings-card-heading">
        <Icon name="ListTree" />
        <h2 data-ui={"Article experience"}>{t("Article experience")}</h2>
      </div>
      <ToggleField
        label={t("Floating outline")}
        checked={value.outline}
        onChange={(outline) => change({ outline })}
      />
      <ToggleField
        label={t("Reading progress")}
        checked={value.progress}
        onChange={(progress) => change({ progress })}
      />
      <ToggleField
        label={t("Reading time")}
        checked={value.readingTime}
        onChange={(readingTime) => change({ readingTime })}
      />
      <ToggleField
        label={t("Publication date")}
        checked={value.publishedDate}
        onChange={(publishedDate) => change({ publishedDate })}
      />
      <Field label={t("Modified date")} help={t("Only explicitly saved modification dates appear.")}>
        <select
          value={value.modifiedDate === undefined ? 'inherit' : String(value.modifiedDate)}
          onChange={(e) =>
            change({
              modifiedDate: e.target.value === 'inherit' ? undefined : e.target.value === 'true',
            })
          }
        >
          <option value="inherit" data-ui={"Follow publication date visibility"}>{t("Follow publication date visibility")}</option>
          <option value="true" data-ui={"Show"}>{t("Show")}</option>
          <option value="false" data-ui={"Hide"}>{t("Hide")}</option>
        </select>
      </Field>
      <ToggleField
        label={t("Article footer")}
        checked={value.articleFooter}
        onChange={(articleFooter) => change({ articleFooter })}
      />
      <ToggleField
        label={t("Author signature")}
        checked={value.author}
        onChange={(author) => change({ author })}
      />
      <ToggleField
        label={t("Code line numbers")}
        checked={value.codeLineNumbers}
        onChange={(codeLineNumbers) => change({ codeLineNumbers })}
      />
      <Field label={t("Related articles · {value0}", {value0: value.relatedCount})}>
        <input
          type="range"
          aria-label={t("Related articles")}
          min={0}
          max={4}
          step={1}
          value={value.relatedCount}
          onChange={(event) => change({ relatedCount: Number(event.target.value) })}
         data-ui-attrs={"{\"aria-label\":\"Related articles\"}"} />
      </Field>
    </section>
  );
}
