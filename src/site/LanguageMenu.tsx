import { Icon } from '../shared/ui.js';
import { UiText } from '../shared/UiText.js';
import { uiLocales, localeNames, uiAttrs } from '../shared/i18n.js';
export function LanguageMenu() {
  return <details className="ui-language-menu" data-ui-menu>
    <summary className="icon-button" {...uiAttrs({'aria-label':'Choose interface language',title:'Interface language'})}><Icon name="Languages" size={17}/></summary>
    <div className="ui-language-options glass-panel" role="group" {...uiAttrs({'aria-label':'Interface language'})}>
      <p><UiText message="Interface language"/></p>
      {uiLocales.map((locale) => <label key={locale}><input type="radio" name="public-ui-language" value={locale} defaultChecked={locale === 'en'} data-ui-language/><span lang={locale}>{localeNames[locale]}</span><Icon name="Check" size={14}/></label>)}
      <p className="help" role="status" data-ui-language-status/>
    </div>
  </details>;
}
