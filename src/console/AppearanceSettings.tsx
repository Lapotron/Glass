import { Button, Icon } from '../shared/ui.js';
import { t } from '../shared/i18n.js';
import type { SiteConfig } from '../shared/contracts.js';
import { Field, ToggleField } from './components.js';
import { ThemeDetails, ReadingDetails, ThemeRange } from './ThemeDetails.js';
export function AppearanceSettings({ value, section, theme, onReading, onPicture }: {value: SiteConfig; section: string; theme: (patch: Partial<SiteConfig['theme']>) => void; onReading: (value: SiteConfig['reading']) => void; onPicture: () => void}) {
  const draft = value.theme;
  return <>
    <section className="settings-card glass-panel" hidden={section !== 'mode'}>
      <div className="settings-card-heading"><Icon name="SunMoon"/><h2>{t('Mode & colors')}</h2></div>
      <div className="appearance-choices">{(['light','dark','system'] as const).map((mode) => <button type="button" key={mode} className={`appearance-choice ${draft.appearance === mode ? 'active' : ''}`} aria-pressed={draft.appearance === mode} onClick={() => theme({appearance: mode})}><span className={`appearance-swatch ${mode}`}><i/><i/><i/></span><span>{t({light:'Light',dark:'Dark',system:'System'}[mode])}</span></button>)}</div>
      <Field label={t('Accent color')}><div className="color-swatches">
        {['#3868e8','#7854ba','#268673','#b45277','#b77935'].map((color) => <button type="button" key={color} style={{background:color}} aria-label={t('Use {color} accent',{color})} className={draft.accent === color ? 'active' : ''} onClick={() => theme({accent:color})}>{draft.accent === color && <Icon name="Check" size={15}/>}</button>)}
        <label className="custom-color" title={t('Custom accent')}><input type="color" aria-label={t('Custom accent color')} value={draft.accent} onChange={(event) => theme({accent:event.target.value})}/><Icon name="Plus" size={15}/></label><span className="mono">{draft.accent}</span>
      </div></Field>
      <Field label={t('Background atmosphere')}><div className="atmosphere-choices">{(['sky','sand','mist'] as const).map((background) => <button type="button" key={background} className={`atmosphere ${background} ${draft.background === background ? 'active' : ''}`} aria-pressed={draft.background === background} onClick={() => theme({background})}>{t({sky:'Sky',sand:'Sand',mist:'Mist'}[background])}{draft.background === background && <Icon name="Check" size={13}/>}</button>)}</div></Field>
    </section>
    <section className="settings-card glass-panel" hidden={section !== 'layout'}>
      <div className="settings-card-heading"><Icon name="Columns2"/><h2>{t('Layout')}</h2></div>
      <ThemeRange name="contentWidth" label={t('Page width')} value={draft.contentWidth} onChange={(contentWidth) => theme({contentWidth})}/>
      <ThemeRange name="articleWidth" label={t('Article width')} value={draft.articleWidth} onChange={(articleWidth) => theme({articleWidth})}/>
      <p className="help">{t('Page width controls the site shell. Article width controls the reading column inside it.')}</p>
    </section>
    <section className="settings-card glass-panel" hidden={section !== 'wallpaper'}>
      <div className="settings-card-heading"><Icon name="Image"/><h2>{t('Background picture')}</h2></div>
      <Field label={t('Background picture')} help={t('Choose an image or upload one from your media library. It is included when you build the notebook.')}><div className="input-with-button"><input value={draft.backgroundImage} readOnly aria-label={t('Background picture')} placeholder={t('No background picture')}/><Button className="small" icon="Image" onClick={onPicture}>{t('Choose picture')}</Button></div></Field>
      {draft.backgroundImage && <div className="wallpaper-preview"><img src={draft.backgroundImage} alt={t('Background picture preview')}/><Button className="small" icon="X" onClick={() => theme({backgroundImage:''})}>{t('Clear picture')}</Button></div>}
    </section>
    <ThemeDetails value={draft} onChange={theme} section={section}/>
    <section className="settings-card glass-panel" hidden={section !== 'accessibility'}>
      <div className="settings-card-heading"><Icon name="CheckCircle2"/><h2>{t('Accessibility')}</h2></div>
      <ToggleField label={t('Reduce transparency')} help={t('Use solid surfaces for extra clarity.')} checked={draft.reduceTransparency} onChange={(reduceTransparency) => theme({reduceTransparency})}/>
      <ToggleField label={t('Reduce motion')} help={t('Quiet transitions and pointer effects throughout the site.')} checked={draft.reduceMotion} onChange={(reduceMotion) => theme({reduceMotion})}/>
    </section>
    <div hidden={section !== 'reading'}><ReadingDetails value={value.reading} onChange={onReading}/></div>
  </>;
}
