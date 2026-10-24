import { useState } from 'react';
import { Field, ToggleField } from './components.js';
import { LanguageControl } from './LanguageControl.js';
import { Icon } from '../shared/ui.js';
import { t } from '../shared/i18n.js';
import type { SiteConfig } from '../shared/contracts.js';
import { contentLanguages, languageOptionLabel } from '../shared/content-languages.js';
export function LanguageSettings({
  value,
  onChange,
}: {
  value: SiteConfig;
  onChange: (patch: Partial<SiteConfig>) => void;
}) {
  const [locale, setLocale] = useState<'zh-Hans' | 'zh-Hant'>('zh-Hans');
  return (
    <>
      <div className="settings-card-heading">
        <Icon name="Languages" />
        <h2>{t('Languages')}</h2>
      </div>
      <p className="modal-intro">
        {t(
          'English is the default. Interface language does not translate your writing or change its address.',
        )}
      </p>
      <ToggleField
        label={t('Public language controls')}
        help={t(
          'Show language choices in public navigation and Reader settings. When disabled, the public interface stays in English. Studio keeps its own language preference.',
        )}
        checked={value.localization.enabled}
        onChange={(enabled) => onChange({ localization: { ...value.localization, enabled } })}
      />
      <Field label={t('Studio interface language')}>
        <LanguageControl />
      </Field>
      <Field
        label={t('Default content language')}
        help={t('Used by general-page metadata and feeds. Articles retain their own language.')}
      >
        <select
          value={value.language}
          data-setting-field="language"
          onChange={(event) => onChange({ language: event.target.value })}
        >
          {[...new Set([value.language, ...contentLanguages])].map((code) => (
            <option value={code} key={code}>
              {languageOptionLabel(code)}
            </option>
          ))}
        </select>
      </Field>
      <div
        className="settings-label-locales"
        role="tablist"
        aria-label={t('Collection label language')}
      >
        {(['zh-Hans', 'zh-Hant'] as const).map((language) => (
          <button
            key={language}
            type="button"
            role="tab"
            aria-selected={locale === language}
            aria-controls="collection-label-panel"
            id={`label-locale-${language}`}
            tabIndex={locale === language ? 0 : -1}
            onClick={() => setLocale(language)}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 'zh-Hans'
                    : event.key === 'End'
                      ? 'zh-Hant'
                      : locale === 'zh-Hans'
                        ? 'zh-Hant'
                        : 'zh-Hans';
                setLocale(next);
                document.getElementById(`label-locale-${next}`)?.focus();
              }
            }}
          >
            {languageOptionLabel(language)}
          </button>
        ))}
      </div>
      <div id="collection-label-panel" role="tabpanel" aria-labelledby={`label-locale-${locale}`}>
        <p className="help">
          {t(
            'Optional interface labels. Blank fields use your existing names. Public paths and article titles stay as written.',
          )}
        </p>
        {(['posts', 'lab', 'life'] as const).map((kind) => (
          <div className="settings-localized-collection" key={kind}>
            <h3>{value.collections[kind].name}</h3>
            <div className="field-row">
              {(['name', 'singular'] as const).map((field) => (
                <Field
                  key={field}
                  label={t(field === 'name' ? 'Collection name' : 'Singular name')}
                >
                  <input
                    value={value.localization.labels[locale]?.[kind]?.[field] || ''}
                    placeholder={value.collections[kind][field]}
                    maxLength={40}
                    onChange={(event) =>
                      onChange({
                        localization: {
                          ...value.localization,
                          labels: {
                            ...value.localization.labels,
                            [locale]: {
                              ...value.localization.labels[locale],
                              [kind]: {
                                ...value.localization.labels[locale]?.[kind],
                                [field]: event.target.value,
                              },
                            },
                          },
                        },
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
