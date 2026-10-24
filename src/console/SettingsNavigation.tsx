import { useState } from 'react';
import { Icon, type IconName } from '../shared/ui.js';
import { t } from '../shared/i18n.js';
import { appearanceGroups, settingsGroups } from './settings-navigation.js';
export function SettingsNavigation({ section, appearance, onChange }: { section: string; appearance?: boolean; onChange: (section: string) => void }) {
  const [search, setSearch] = useState('');
  const groups = appearance ? appearanceGroups : settingsGroups;
  const query = search.trim().toLocaleLowerCase();
  const matches = (group: string, label: string) => `${group} ${label} ${t(group)} ${t(label)}`.toLocaleLowerCase().includes(query);
  return <aside className="settings-navigation glass-panel" data-liquid="surface">
    <label className="search-field settings-section-search"><Icon name="Search" size={15}/><input type="search" value={search} placeholder={t('Find a setting…')} aria-label={t('Find a setting')} onChange={(event) => setSearch(event.target.value)}/></label>
    <label className="settings-mobile-picker"><span>{t('Settings section')}</span><select aria-label={t('Settings section')} value={section} onChange={(event) => onChange(event.target.value)}>
      {groups.map(([group, items]) => <optgroup key={group} label={t(group)}>{items.filter(([,label]) => matches(group,label)).map(([id,label]) => <option key={id} value={id}>{t(label)}</option>)}</optgroup>)}
    </select></label>
    <nav className="settings-section-rail" aria-label={t('Site settings sections')}>
      {groups.map(([group, items]) => {
        const visible = items.filter(([,label]) => matches(group,label));
        return visible.length ? <div className="settings-nav-group" key={group}>
          <h2>{t(group)}</h2>{visible.map(([id,label,icon]) => <a href={`#${appearance ? 'appearance' : 'settings'}/${id}`} key={id} aria-current={section === id ? 'page' : undefined} onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); onChange(id);
          }}><Icon name={icon as IconName} size={16}/><span>{t(label)}</span>{section === id && <Icon className="settings-nav-active" name="ChevronRight" size={13}/>}</a>)}
        </div> : null;
      })}
      {!groups.some(([group,items]) => items.some(([,label]) => matches(group,label))) && <p className="help">{t('No matching sections.')}</p>}
    </nav>
  </aside>;
}
