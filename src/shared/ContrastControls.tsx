import { t } from './i18n.js';
import { UiText } from './UiText.js';
import type { SiteConfig } from './contracts.js';
import { contrastFloorRange } from './appearance-ranges.js';
import { Icon } from './ui.js';
import {
  baseTextColors,
  contrastPreset,
  mergeContrast,
  resolveContrast,
  roleLabels,
  textRoles,
  type ContrastSettings,
} from './contrast.js';
import { contrastProtectionSummary } from './contrast-report.js';

export function ContrastControls({
  theme,
  onChange,
  onReset,
}: {
  theme: SiteConfig['theme'];
  onChange?: (value: ContrastSettings) => void;
  onReset?: () => void;
}) {
  const value = mergeContrast(theme.contrast);
  const change = (patch: Partial<ContrastSettings>) =>
    onChange?.({ ...value, ...patch, colors: patch.colors || value.colors });
  const binding = (current: string | number) =>
    onChange ? { value: current } : { defaultValue: current };
  return (
    <div className="contrast-controls">
      <div className="contrast-heading">
        <h2>
          <Icon name="SunMoon" size={19} />
          <UiText message={"Text & contrast"}/></h2>
        <button
          type="button"
          className="text-link reader-reset"
          data-reader-reset={onChange ? undefined : 'contrast'}
          onClick={onReset}
        >
          <Icon name="RotateCcw" size={13} />
          <UiText message={"Reset contrast"}/></button>
      </div>
      <p className="help" data-ui={"Sharper ink, a quiet hierarchy, and protection when a picture competes with the words."}>
        {t("Sharper ink, a quiet hierarchy, and protection when a picture competes with the words.")}</p>
      <label className="contrast-field">
        <span data-ui={"Contrast preset"}>{t("Contrast preset")}</span>
        <select
          aria-label={t("Contrast preset")}
          data-contrast-control="preset"
          {...binding(value.preset)}
          onChange={
            onChange
              ? (e) => onChange(contrastPreset(e.target.value as ContrastSettings['preset']))
              : undefined
          }
         data-ui-attrs={"{\"aria-label\":\"Contrast preset\"}"} >
          <option value="balanced" data-ui={"Balanced"}>{t("Balanced")}</option>
          <option value="high" data-ui={"High Contrast"}>{t("High Contrast")}</option>
        </select>
      </label>
      <div className="contrast-columns">
        {(['readingTarget', 'interfaceTarget'] as const).map((key) => (
          <label className="contrast-field" key={key}>
            <span>
              {key === 'readingTarget' ? t("Reading text contrast") : t("Interface text contrast")}
            </span>
            <select
              aria-label={
                key === 'readingTarget' ? t("Reading text contrast") : t("Interface text contrast")
              }
              data-contrast-control={key}
              {...binding(value[key])}
              onChange={onChange ? (e) => change({ [key]: Number(e.target.value) }) : undefined}
            >
              <option value="4.5" data-ui={"Standard · 4.5:1"}>{t("Standard · 4.5:1")}</option>
              <option value="7" data-ui={"Enhanced · 7:1"}>{t("Enhanced · 7:1")}</option>
            </select>
          </label>
        ))}
      </div>
      <label className="reader-toggle contrast-toggle">
        <span>
          <strong data-ui={"Automatic wallpaper protection"}>{t("Automatic wallpaper protection")}</strong>
          <small data-ui={"Adjust colors and supporting tints when text needs more contrast."}>{t("Adjust colors and supporting tints when text needs more contrast.")}</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          data-contrast-control="automatic"
          {...(onChange ? { checked: value.automatic } : { defaultChecked: value.automatic })}
          onChange={onChange ? (e) => change({ automatic: e.target.checked }) : undefined}
        />
      </label>
      <label className="contrast-field">
        <span>
          <UiText message={"Minimum functional glass tint"}/>{' '}
          <output data-contrast-output="glassFloor">{Math.round(value.glassFloor * 100)}%</output>
        </span>
        <input
          type="range"
          aria-label={t("Minimum functional glass tint")}
          min={contrastFloorRange[0]}
          max={contrastFloorRange[1]}
          step={contrastFloorRange[2]}
          data-contrast-control="glassFloor"
          {...binding(value.glassFloor)}
          onChange={
            onChange ? (event) => change({ glassFloor: Number(event.target.value) }) : undefined
          }
         data-ui-attrs={"{\"aria-label\":\"Minimum functional glass tint\"}"} />
      </label>
      <p className="help" data-ui={"Automatic protection may strengthen functional glass. Picture wash and article background tint stay at your chosen strength."}>
        {t("Automatic protection may strengthen functional glass. Picture wash and article background tint stay at your chosen strength.")}</p>
      <details className="contrast-advanced">
        <summary>
          <Icon name="Palette" size={16} />
          <UiText message={"Advanced text colors"}/></summary>
        <p className="help" data-ui={"Choose separate colors for each appearance. Reset an override to follow the preset and accent."}>
          {t("Choose separate colors for each appearance. Reset an override to follow the preset and accent.")}</p>
        {(['light', 'dark'] as const).map((mode) => (
          <fieldset className="contrast-palette" key={mode}>
            <legend>{mode === 'light' ? t("Light appearance") : t("Dark appearance")}</legend>
            {textRoles.map((role) => {
              const selected = baseTextColors(value, mode, theme.accent)[role];
              return (
                <div className="contrast-color" key={role}>
                  <label htmlFor={`contrast-${mode}-${role}`}><UiText message={roleLabels[role]}/></label>
                  <input
                    id={`contrast-${mode}-${role}`}
                    type="color"
                    className="color-input"
                    aria-label={t("{value0} {value1} color", {value0: mode === 'light' ? 'Light' : 'Dark', value1: roleLabels[role].toLowerCase()})}
                    data-contrast-mode={mode}
                    data-contrast-role={role}
                    {...binding(selected)}
                    onChange={
                      onChange
                        ? (e) =>
                            change({
                              colors: {
                                ...value.colors,
                                [mode]: { ...value.colors[mode], [role]: e.target.value },
                              },
                            })
                        : undefined
                    }
                  />
                  <code data-contrast-hex={`${mode}.${role}`}>{selected}</code>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("Reset {value0} {value1} color", {value0: mode, value1: roleLabels[role].toLowerCase()})}
                    data-contrast-clear={`${mode}.${role}`}
                    onClick={
                      onChange
                        ? (e) => {
                            e.preventDefault();
                            const colors = { ...value.colors, [mode]: { ...value.colors[mode] } };
                            delete colors[mode][role];
                            change({ colors });
                          }
                        : undefined
                    }
                  >
                    <Icon name="RotateCcw" size={13} />
                  </button>
                </div>
              );
            })}
          </fieldset>
        ))}
      </details>
      <details className="contrast-report">
        <summary>
          <Icon name="Eye" size={16} />
          <UiText message={"Readability & effective colors"}/></summary>
        {(['light', 'dark'] as const).map((mode) => {
          const result = resolveContrast(theme, mode);
          return (
            <div key={mode} data-contrast-report-mode={mode}>
              <p className="help" data-contrast-protection={mode}>
                {contrastProtectionSummary(result)}
              </p>
              <dl>
                {textRoles.map((role) => {
                  return (
                    <div key={role}>
                      <dt><UiText message={roleLabels[role]}/></dt>
                      <dd data-contrast-result={`${mode}.${role}`}>
                        {result.requested[role]} → {result.colors[role]} ·{' '}
                        {result.ratios[role].toFixed(2)}:1
                        {result.ratios[role] <
                        (role === 'body' || role === 'heading'
                          ? value.readingTarget
                          : value.interfaceTarget)
                          ? t(" · Needs attention")
                          : ''}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          );
        })}
        <p className="help" data-ui={"Estimates guide these surfaces; the preview shows the rendered result. System accessibility preferences take priority."}>
          {t("Estimates guide these surfaces; the preview shows the rendered result. System accessibility preferences take priority.")}</p>
      </details>
    </div>
  );
}
