export const settingsGroups = [
  ['General', [['general','Site details','Settings2'],['languages','Languages','Languages'],['collections','Collection names & paths','FolderOpen']]],
  ['Presentation', [['branding','Navigation mark','BookOpen'],['icons','Favicon','Image'],['browser','Browser & app','Monitor'],['navigation','Navigation tools','Menu'],['footer','Footer','Layers']]],
  ['Discovery', [['metadata','Page titles','FileText'],['sharing','Social sharing','Globe'],['indexing','Indexing & verification','Search'],['feeds','Feeds','Rss']]],
  ['Services', [['discussions','Giscus discussions','BookOpen'],['newsletter','Newsletter','Radio'],['aca','Advanced analytics','ChartNoAxesCombined'],['cloudflare-analytics','Cloudflare Analytics','ChartNoAxesCombined'],['google-analytics','Google Analytics','ChartNoAxesCombined']]],
  ['Publishing', [['cloudflare','Pages project','CloudUpload'],['media-delivery','R2 media delivery','Image'],['automation','Scheduling','Clock3']]],
  ['Local Studio', [['connections','Credentials','LockKeyhole'],['local','Runtime','Monitor'],['reset','Data reset','Trash2']]],
] as const;
export const appearanceGroups = [
  ['Appearance', [['mode','Mode & colors','SunMoon'],['typography','Typography','BookOpen'],['layout','Layout','Columns2'],['glass','Glass & light','Layers'],['wallpaper','Wallpaper','Image'],['contrast','Text contrast','Eye'],['reading','Article experience','SlidersHorizontal'],['accessibility','Accessibility','CheckCircle2']]],
] as const;
export function resolveSettingsSection(section: string, appearance = false) {
  const mapped = section === 'integrations' ? 'discussions' : section === 'profile' ? 'general' : section;
  const groups = appearance ? appearanceGroups : settingsGroups;
  return groups.some(([, items]) => items.some(([id]) => id === mapped)) ? mapped : appearance ? 'mode' : 'general';
}
export function settingsFieldSection(path: (string | number)[], appearance = false) {
  const key = String(path[0]), field = String(path[1]);
  if (appearance && key === 'theme') {
    if (['appearance','accent','background'].includes(field)) return 'mode';
    if (field.startsWith('wallpaper') || field === 'backgroundImage') return 'wallpaper';
    if (field === 'contrast') return 'contrast';
    if (field.startsWith('reduce')) return 'accessibility';
    if (['contentWidth','articleWidth'].includes(field)) return 'layout';
    if (['fontScale','fontFamily','textScale','lineHeight','paragraphSpace','readingOpacity','focusMode'].includes(field)) return 'typography';
    return 'glass';
  }
  if (appearance) return 'reading';
  if (key === 'branding') return ['favicon','iconStyle','monogram','iconBackground'].includes(field) ? 'icons' : ['logo','darkLogo','showName','namePeriod'].includes(field) ? 'branding' : 'browser';
  if (key === 'metadata') return ['homeTitle','titleTemplate'].includes(field) ? 'metadata' : ['locale','socialImage','socialImageAlt','twitterSite','twitterCreator','twitterCard'].includes(field) ? 'sharing' : 'indexing';
  if (key === 'integrations') return ({comments:'discussions',newsletter:'newsletter',aca:'aca',analytics:'cloudflare-analytics',googleAnalytics:'google-analytics'} as Record<string,string>)[field] || 'discussions';
  return ({collections:'collections',localization:'languages',language:'languages',navigationTools:'navigation',mediaDelivery:'media-delivery',mediaProtection:'media-delivery',publishing:'automation',cloudflare:'cloudflare',footer:'footer',feeds:'feeds'} as Record<string,string>)[key] || 'general';
}
