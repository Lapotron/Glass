import { LanguageMenu } from './LanguageMenu.js';
import { t, uiAttrs } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { digest } from '../engine/store.js';
import { ProjectsPage } from './ProjectsPage.js';
import { ToolsPage } from './ToolsPage.js';
import { discussionThemePrefix } from '../engine/integrations.js';
import { ArticleFooter } from './ArticleFooter.js';
import path from 'node:path';
import { ContactLink } from './ContactLink.js';
import { ReaderSettings } from './ReaderSettings.js';
import { ProfileHeader } from './ProfileHeader.js';
import {
  readerSpecimenSources,
  readerMaterialSources,
  type SpecimenContent,
} from './ReaderSpecimen.js';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode, CSSProperties } from 'react';
import {
  Brand,
  Icon,
  ThemeStyle,
  EmptyState,
  navigationIconFor,
  socialIconFor,
  type IconName,
} from '../shared/ui.js';
import {
  formatDate,
  publicNavigationFor,
  routeFor,
  type ContentEntry,
  type Repository,
  type SiteConfig,
} from '../shared/contracts.js';
import { pinnedHomeEntries, recentHomeEntries, resolveSlides } from '../shared/home.js';
import {
  collectionIndexRoute,
  defaultCollections,
  type CollectionsConfig,
} from '../shared/collections.js';
import {
  pageTitle,
  socialLocale,
  feedLinks,
  footerCopyright,
  fallbackFavicon,
} from '../shared/site-presentation.js';
import { headingSlug, imageSet, scriptJson } from '../shared/utils.js';
import type { MarkdownResult } from '../engine/markdown.js';
import { markdownCompiler } from '../engine/markdown-cache.js';
import { topK } from '../shared/algorithms.js';
import { ArchiveTimeline } from '../shared/ArchiveTimeline.js';
import { chronologicalEntries } from '../shared/contracts.js';
import { interactiveRegistry, renderInteractive } from '../shared/interactives.js';
import { renderIcon } from '../engine/icons.js';
import { Discussion } from './Discussion.js';
import { AnnotationList } from './AnnotationList.js';
import { createDiagramRenderer } from '../engine/diagrams.js';
import { diagramPresentation } from '../shared/diagram-presentation.js';
import { renderChartSvg } from '../engine/charts.js';
import { resolveAlbums, albumRoute } from '../shared/albums.js';
import { legacyReaderAssets, type ReaderAssets } from '../shared/reader-assets.js';
import { resolveEntrySettings } from '../shared/entry-settings.js';

export type RenderedEntry = ContentEntry & { rendered: MarkdownResult; minutes: number };
export type SiteRenderer = Awaited<ReturnType<typeof createRenderer>>;
const specimenResults = new Map<string, Promise<SpecimenContent>>();
function Tag({ tag }: { tag: string }) {
  return (
    <a className="chip" href={`/tags/${encodeURIComponent(headingSlug(tag))}/`}>
      {tag}
    </a>
  );
}
function Meta({ entry, reading }: { entry: RenderedEntry; reading?: SiteConfig['reading'] }) {
  const date = reading?.publishedDate !== false;
  const time = reading?.readingTime !== false;
  return (
    <div className="post-meta">
      {date && (
        <time dateTime={entry.publishedAt}>
          <Icon name="CalendarDays" size={12} />
          {formatDate(entry.publishedAt, true)}
        </time>
      )}
      {date && time && <span className="meta-divider" />}
      {time && (
        <span className="meta-item">
          <Icon name="Clock3" size={12} />
          {entry.minutes} <UiText message={' min read'} />
        </span>
      )}
      {entry.lang === 'zh' && (
        <>
          <span className="meta-divider" />
          <span className="meta-item">
            <Icon name="Languages" size={12} />
            中文
          </span>
        </>
      )}
    </div>
  );
}
function Picture({
  src,
  alt,
  className,
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      srcSet={imageSet(src)}
      sizes="(max-width:680px) 100vw, (max-width:1100px) 50vw, 560px"
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}
function PostCard({
  entry,
  row = false,
  reading,
  collections = defaultCollections,
}: {
  entry: RenderedEntry;
  row?: boolean;
  reading?: SiteConfig['reading'];
  collections?: CollectionsConfig;
}) {
  return (
    <article
      className={`${row ? 'post-row' : 'post-feature'} glass-panel`}
      data-aca-item={entry.id}
      data-aca-surface="listing"
      data-entry
      data-title={`${entry.title} ${entry.summary} ${entry.tags.join(' ')}`.toLowerCase()}
      data-tags={JSON.stringify(entry.tags)}
    >
      {!row && entry.cover && (
        <a href={routeFor(entry, collections)} tabIndex={-1} aria-hidden="true">
          <Picture src={entry.cover} alt="" className="post-cover" />
        </a>
      )}
      <div className={row ? '' : 'post-feature-body'}>
        <Meta entry={entry} reading={reading} />
        <h3 lang={entry.lang}>
          <a href={routeFor(entry, collections)}>{entry.title}</a>
        </h3>
        <p lang={entry.lang}>{entry.summary}</p>
        <div className="post-card-bottom">
          <div className="tags">
            {entry.tags.slice(0, 2).map((tag) => (
              <Tag key={tag} tag={tag} />
            ))}
          </div>
          <a
            className="round-arrow"
            href={routeFor(entry, collections)}
            aria-label={t('Read {value0}', { value0: entry.title })}
          >
            <Icon name="ArrowUpRight" size={14} />
          </a>
        </div>
      </div>
    </article>
  );
}
function LabCard({ entry, collections }: { entry: RenderedEntry; collections: CollectionsConfig }) {
  return (
    <article className="lab-card glass-panel" data-aca-item={entry.id} data-aca-surface="listing">
      {entry.cover && <Picture src={entry.cover} alt="" />}
      <div className="lab-card-body">
        <span className="eyebrow">
          <Icon name="FlaskConical" size={12} />
          {collections.lab.singular}
        </span>
        <h3>
          <a href={routeFor(entry, collections)}>{entry.title}</a>
        </h3>
        <p>{entry.summary}</p>
      </div>
    </article>
  );
}
function Photos({
  library,
  limit,
  album,
}: {
  library: Repository['library'];
  limit?: number;
  album?: string;
}) {
  const photos = library.photos.filter((p) => !album || p.album === album).slice(0, limit);
  return (
    <div className={limit ? 'photo-grid' : 'life-grid life-masonry'}>
      {photos.map((photo) => (
        <a
          href={photo.src}
          key={photo.id}
          className="photo-button"
          data-photo={JSON.stringify(photo)}
          aria-labelledby={`photo-caption-${photo.id}`}
        >
          <Picture src={photo.src} alt={photo.alt} />
          <span className="photo-caption" id={`photo-caption-${photo.id}`}>
            {photo.caption || photo.alt}
            <span>
              {photo.album} ·{' '}
              {new Date(`${photo.takenAt}T12:00:00Z`).toLocaleDateString('en-US', {
                month: 'short',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}
export async function createRenderer(
  model: Repository,
  rendererOptions: {
    includeDrafts?: boolean;
    preview?: boolean;
    diagramCacheDir?: string;
    readerAssets?: ReaderAssets;
    brandingVersion?: string;
  } = {},
) {
  const includeDrafts = rendererOptions.includeDrafts === true;
  const isPreview = rendererOptions.preview === true;
  const { site, library } = model;
  const assets = rendererOptions.readerAssets || legacyReaderAssets;
  const entries: RenderedEntry[] = [];
  const photoAlbums = resolveAlbums(library).filter((a) => a.photos.length);
  const compiler = await markdownCompiler(
    rendererOptions.diagramCacheDir && path.join(rendererOptions.diagramCacheDir, '../markdown'),
  );
  const diagrams = createDiagramRenderer({ cacheDir: rendererOptions.diagramCacheDir });
  const diagramStyle = diagramPresentation(site.theme);
  let about: MarkdownResult;
  try {
    for (const entry of model.entries.filter((e) => includeDrafts || e.status === 'published')) {
      let rendered: MarkdownResult;
      try {
        rendered = await compiler.render(entry.body, {
          protectEmailLinks: site.profile.protectEmailLinks,
          entryId: entry.id,
          math: entry.math,
          comments: resolveEntrySettings(site, entry).discussion.blocks,
          preview: isPreview,
          diagrams,
          diagramPresentation: diagramStyle,
          chartFontScale: site.theme.fontScale,
          chartCacheDir: rendererOptions.diagramCacheDir?.replace(/mermaid\/?$/, 'charts'),
        });
      } catch (error) {
        throw new Error(`${entry.kind}/${entry.file}: ${(error as Error).message}`, {
          cause: error,
        });
      }
      const chinese = (entry.body.match(/[\p{Script=Han}]/gu) || []).length;
      entries.push({
        ...entry,
        rendered,
        minutes: Math.max(1, Math.ceil((rendered.words + chinese / 2) / 220)),
      });
    }
    about = await compiler.render(model.about.body, {
      preview: isPreview,
      protectEmailLinks: site.profile.protectEmailLinks,
      aboutName: site.profile.name,
      chartFontScale: site.theme.fontScale,
      documentId: 'about',
      diagrams,
      diagramPresentation: diagramStyle,
    });
  } finally {
    await diagrams.close();
  }
  const specimenLocales = site.localization.enabled
    ? (['en', 'zh-Hans', 'zh-Hant'] as const)
    : (['en'] as const);
  const specimens = Object.fromEntries(
    await Promise.all(
      specimenLocales.map(async (locale) => {
        const key = locale + readerSpecimenSources[locale] + readerMaterialSources[locale];
        let pending = specimenResults.get(key);
        if (!pending) {
          pending = Promise.all([
            compiler.render(readerSpecimenSources[locale], {
              documentId: `reader-settings-specimen-${locale}`,
            }),
            compiler.render(readerMaterialSources[locale], {
              documentId: `reader-settings-materials-${locale}`,
            }),
          ])
            .then(([reading, materials]) => ({ reading: reading.html, materials: materials.html }))
            .catch((error) => {
              specimenResults.delete(key);
              throw error;
            });
          specimenResults.set(key, pending);
        }
        return [locale, await pending] as const;
      }),
    ),
  );
  const posts = entries.filter((e) => e.kind === 'posts'),
    labs = entries.filter((e) => e.kind === 'lab');
  const tags = [...new Set(entries.flatMap((e) => e.tags))];
  const byTag = new Map<string, RenderedEntry[]>();
  for (const entry of entries)
    for (const tag of new Set(entry.tags)) {
      const group = byTag.get(tag) || [];
      group.push(entry);
      byTag.set(tag, group);
    }
  const order = new Map(entries.map((entry, index) => [entry, index]));
  const publishedByDate = entries
    .filter((entry) => entry.status === 'published')
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const albumsByName = new Map(photoAlbums.map((album) => [album.name, album]));
  const profileLinks = [...site.profile.links];
  if (
    site.profile.email &&
    !profileLinks.some(
      (link) =>
        link.href.toLowerCase().split('?')[0] === 'mailto:' + site.profile.email.toLowerCase(),
    )
  )
    profileLinks.push({ label: 'Email', href: 'mailto:' + site.profile.email });
  const brandingVersion = rendererOptions.brandingVersion || model.siteRevision.slice(0, 16);
  const iconUrl = (name: string) => `/${name}?v=${brandingVersion}`;
  const brand = () => (
    <Brand
      name={site.name}
      {...site.branding}
      logo={
        site.branding.logo
          ? isPreview
            ? site.branding.logo
            : iconUrl('assets/brand-logo.png')
          : ''
      }
      darkLogo={
        site.branding.darkLogo
          ? isPreview
            ? site.branding.darkLogo
            : iconUrl('assets/brand-logo-dark.png')
          : ''
      }
      appearance={site.theme.appearance}
    />
  );
  function header(current: string) {
    return (
      <header className="site-header">
        <div className="header-inner glass">
          <a href="/" aria-label={t('{value0} home', { value0: site.name })}>
            {brand()}
          </a>
          <div className="header-navigation">
          <nav
            className="site-nav"
            aria-label={t('Main navigation')}
            data-ui-attrs={'{"aria-label":"Main navigation"}'}
          >
            {publicNavigationFor(site.collections).map((item) => (
              <a
                key={item.href}
                href={item.href}
                aria-current={
                  current === item.href ||
                  (item.href === '/archive/' &&
                    (current.startsWith('/tags/') ||
                      (['posts', 'lab'] as const).some((kind) =>
                        current.startsWith(collectionIndexRoute(kind, site.collections)),
                      ))) ||
                  (item.href === collectionIndexRoute('life', site.collections) &&
                    current.startsWith(item.href))
                    ? 'page'
                    : undefined
                }
              >
                <Icon
                  name={
                    item.href === collectionIndexRoute('life', site.collections)
                      ? 'Image'
                      : navigationIconFor(item.href)
                  }
                  size={15}
                  className="nav-icon"
                />
                {item.href === collectionIndexRoute('life', site.collections) ? (
                  <span data-ui-collection="life" data-ui-source={item.label}>
                    {item.label}
                  </span>
                ) : (
                  <UiText message={item.label} />
                )}
              </a>
            ))}
          </nav>
          {site.navigationTools.tools && <div className="header-tools-mobile"><a className="text-link" href="/tools/" aria-current={current === '/tools/' ? 'page' : undefined}><Icon name="Wrench" size={16}/><UiText message="Tools"/></a></div>}
          </div>
          <div className="header-actions">
            {site.navigationTools.tools && <a className="icon-button tools-shortcut" href="/tools/" aria-current={current === '/tools/' ? 'page' : undefined} {...uiAttrs({'aria-label':'Tools'})}><Icon name="Wrench" size={18}/></a>}
            {site.navigationTools.search && (
              <button
                type="button"
                className="icon-button"
                data-search-open
                aria-label={t('Search this notebook')}
                data-ui-attrs={'{"aria-label":"Search this notebook"}'}
              >
                <Icon name="Search" size={17} />
              </button>
            )}
            {site.navigationTools.search &&
              (site.navigationTools.themeToggle || site.navigationTools.readerSettings) && (
                <span className="header-separator" />
              )}
            {site.localization.enabled && <LanguageMenu />}
            {site.navigationTools.themeToggle && (
              <button
                type="button"
                className="icon-button"
                data-theme-toggle
                aria-label={t('Change appearance')}
                data-ui-attrs={'{"aria-label":"Change appearance"}'}
              >
                <Icon name="SunMoon" size={18} />
              </button>
            )}
            {site.navigationTools.readerSettings && (
              <a
                className="icon-button reader-settings-link"
                href="/settings/"
                aria-label={t('Reader settings')}
                aria-current={current === '/settings/' ? 'page' : undefined}
                data-ui-attrs={'{"aria-label":"Reader settings"}'}
              >
                <Icon name="Settings2" size={18} />
              </a>
            )}
            <button
              className="icon-button mobile-menu"
              type="button"
              aria-label={t('Open navigation')}
              aria-expanded="false"
              data-menu
              data-ui-attrs={'{"aria-label":"Open navigation"}'}
            >
              <Icon name="Menu" size={18} />
            </button>
          </div>
        </div>
      </header>
    );
  }
  function document(
    current: string,
    title: string,
    content: ReactNode,
    options: {
      description?: string;
      image?: string;
      lang?: string;
      article?: RenderedEntry;
      noindex?: boolean;
      layout?: 'listing';
    } = {},
  ) {
    const canonical = new URL(current, site.url).href;
    const settings = options.article ? resolveEntrySettings(site, options.article) : undefined;
    const theme = settings?.theme || site.theme;
    const description = options.description || site.description;
    const language = options.lang || site.language;
    const fullTitle = pageTitle(site, title, current === '/');
    const image = options.image || site.metadata.socialImage;
    const imageAlt = settings
      ? settings.seo.imageAlt
      : options.image
        ? title
        : site.metadata.socialImageAlt;
    const noindex = options.noindex || isPreview;
    const schema = options.article
      ? {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          '@id': canonical + '#article',
          url: canonical,
          headline: options.article.title,
          description,
          inLanguage: language,
          mainEntityOfPage: canonical,
          datePublished: options.article.publishedAt + 'T12:00:00.000Z',
          dateModified:
            (options.article.updatedAt || options.article.publishedAt) + 'T12:00:00.000Z',
          ...(site.metadata.author
            ? {
                author: {
                  '@type': 'Person',
                  name: site.profile.name,
                  url: new URL('/about/', site.url).href,
                },
              }
            : {}),
          ...(image ? { image: new URL(image, site.url).href } : {}),
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          '@id': new URL('/#website', site.url).href,
          url: new URL('/', site.url).href,
          name: site.name,
          description: site.description,
          inLanguage: site.language,
        };
    return (
      '<!doctype html>' +
      renderToStaticMarkup(
        <html
          lang="en"
          data-content-language={language}
          data-ui-language-enabled={String(site.localization.enabled)}
          data-theme={site.theme.appearance === 'dark' ? 'dark' : 'light'}
          data-appearance={site.theme.appearance}
          data-preview={isPreview ? 'true' : undefined}
          data-wallpaper={site.theme.backgroundImage ? 'true' : undefined}
          data-wallpaper-wash={site.theme.wallpaperWash}
          data-background={site.theme.background}
          data-reduce-transparency={String(site.theme.reduceTransparency)}
          data-reduce-motion={String(site.theme.reduceMotion)}
        >
          <head>
            <meta charSet="UTF-8" />
            <meta name="viewport" content="width=device-width,initial-scale=1" />
            <meta name="description" content={description} />
            <meta name="application-name" content={site.branding.shortName || site.name} />
            <meta
              name="apple-mobile-web-app-title"
              content={site.branding.shortName || site.name}
            />
            <meta
              name="theme-color"
              data-theme-color="light"
              media={
                site.theme.appearance === 'system'
                  ? '(prefers-color-scheme: light)'
                  : site.theme.appearance === 'light'
                    ? 'all'
                    : 'not all'
              }
              content={site.branding.themeColorLight}
            />
            <meta
              name="theme-color"
              data-theme-color="dark"
              media={
                site.theme.appearance === 'system'
                  ? '(prefers-color-scheme: dark)'
                  : site.theme.appearance === 'dark'
                    ? 'all'
                    : 'not all'
              }
              content={site.branding.themeColorDark}
            />
            <title>{fullTitle}</title>
            <link rel="canonical" href={canonical} />
            <meta property="og:title" content={fullTitle} />
            <meta property="og:description" content={description} />
            <meta property="og:url" content={canonical} />
            {!isPreview &&
              site.integrations.aca.enabled &&
              !['/settings/', '/__components/', '/404.html'].includes(current) && (
                <>
                  <meta name="aca-config" content={scriptJson(site.integrations.aca)} />
                  <meta
                    name="aca-content"
                    content={scriptJson({
                      id: options.article?.id || `page:${current}`,
                      revision:
                        options.article?.revision ||
                        digest(
                          current === '/about/'
                            ? model.about.body
                            : current === '/projects/'
                              ? JSON.stringify(model.projects)
                              : current,
                        ),
                    })}
                  />
                </>
              )}
            <meta property="og:type" content={options.article ? 'article' : 'website'} />
            <meta property="og:site_name" content={site.name} />
            <meta property="og:locale" content={socialLocale(site, language)} />
            {image && <meta property="og:image" content={new URL(image, site.url).href} />}
            {image && imageAlt && <meta property="og:image:alt" content={imageAlt} />}
            <meta
              name="twitter:card"
              content={
                site.metadata.twitterCard === 'auto'
                  ? image
                    ? 'summary_large_image'
                    : 'summary'
                  : site.metadata.twitterCard
              }
            />
            <meta name="twitter:title" content={fullTitle} />
            <meta name="twitter:description" content={description} />
            {image && <meta name="twitter:image" content={new URL(image, site.url).href} />}
            {image && imageAlt && <meta name="twitter:image:alt" content={imageAlt} />}
            {site.metadata.twitterSite && (
              <meta
                name="twitter:site"
                content={'@' + site.metadata.twitterSite.replace(/^@/, '')}
              />
            )}
            {site.metadata.twitterCreator && (
              <meta
                name="twitter:creator"
                content={'@' + site.metadata.twitterCreator.replace(/^@/, '')}
              />
            )}
            <meta
              name="robots"
              content={
                noindex
                  ? 'noindex,nofollow'
                  : `${site.metadata.indexing ? 'index' : 'noindex'},${site.metadata.followLinks ? 'follow' : 'nofollow'},max-image-preview:${site.metadata.maxImagePreview}`
              }
            />
            {site.metadata.author && <meta name="author" content={site.profile.name} />}
            {!isPreview && site.metadata.googleVerification && (
              <meta name="google-site-verification" content={site.metadata.googleVerification} />
            )}
            {!isPreview && site.metadata.bingVerification && (
              <meta name="msvalidate.01" content={site.metadata.bingVerification} />
            )}
            {options.article && (
              <>
                <meta
                  property="article:published_time"
                  content={options.article.publishedAt + 'T12:00:00.000Z'}
                />
                <meta
                  property="article:modified_time"
                  content={
                    (options.article.updatedAt || options.article.publishedAt) + 'T12:00:00.000Z'
                  }
                />
                {site.metadata.author && (
                  <meta property="article:author" content={new URL('/about/', site.url).href} />
                )}
                {options.article.tags.map((tag) => (
                  <meta key={tag} property="article:tag" content={tag} />
                ))}
              </>
            )}
            {site.metadata.structuredData && !noindex && (
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: scriptJson(schema) }}
              />
            )}
            {isPreview ? (
              <link
                rel="icon"
                href={
                  site.branding.favicon ||
                  `data:image/svg+xml,${encodeURIComponent(fallbackFavicon(site))}`
                }
              />
            ) : (
              <>
                <link rel="icon" href={iconUrl('favicon.ico')} sizes="any" />
                <link rel="icon" href={iconUrl('favicon.svg')} type="image/svg+xml" />
                <link
                  rel="icon"
                  href={iconUrl('favicon-32x32.png')}
                  type="image/png"
                  sizes="32x32"
                />
                <link
                  rel="icon"
                  href={iconUrl('favicon-16x16.png')}
                  type="image/png"
                  sizes="16x16"
                />
                <link
                  rel="apple-touch-icon"
                  href={iconUrl('apple-touch-icon.png')}
                  sizes="180x180"
                />
                <link rel="manifest" href={iconUrl('site.webmanifest')} />
              </>
            )}
            {feedLinks(site).map((feed) => (
              <link
                key={feed.href}
                rel="alternate"
                type={feed.type}
                title={t('{value0} {value1}', {
                  value0: site.feeds.title || site.name,
                  value1: feed.label,
                })}
                href={feed.href}
              />
            ))}
            {options.article && !isPreview && (
              <meta
                name="reading-entry"
                content={scriptJson({
                  id: options.article.id,
                  title: options.article.title,
                  url: current,
                  revision: options.article.revision,
                })}
              />
            )}
            <script
              type="application/json"
              id="reader-defaults"
              dangerouslySetInnerHTML={{ __html: scriptJson(theme) }}
            />
            {site.integrations.comments.enabled && (
              <meta name="discussion-theme-prefix" content={discussionThemePrefix(site)} />
            )}
            <script src={assets.appearance} />
            <link rel="stylesheet" href={assets.style} />
            {assets.discoveryStyle && ['/projects/', '/search/'].includes(current) && (
              <link rel="stylesheet" href={assets.discoveryStyle} />
            )}
            {assets.codeStyle &&
              (options.article ||
                current === '/about/' ||
                current === '/__components/' ||
                current === '/settings/') && <link rel="stylesheet" href={assets.codeStyle} />}
            {assets.contentStyle &&
              (options.article ||
                current === '/about/' ||
                current === '/__components/' ||
                current === '/settings/') && <link rel="stylesheet" href={assets.contentStyle} />}
            {current === '/settings/' && assets.settingsStyle && (
              <link rel="stylesheet" href={assets.settingsStyle} />
            )}
            {current === '/tools/' && assets.toolsStyle && <link rel="stylesheet" href={assets.toolsStyle}/>}
            <ThemeStyle theme={theme} />
            <script type="module" src={assets.script} />
            {current === '/tools/' && assets.toolsScript && <script type="module" src={assets.toolsScript}/>}
          </head>
          <body
            data-home-layout={current === '/' ? site.home.layout : undefined}
            data-page={
              options.article
                ? 'article'
                : current === '/'
                  ? 'home'
                  : current === '/settings/'
                    ? 'settings'
                    : options.layout
            }
          >
            {site.localization.enabled && (
              <script
                type="application/json"
                id="ui-collection-labels"
                dangerouslySetInnerHTML={{ __html: scriptJson(site.localization.labels) }}
              />
            )}
            {site.integrations.analytics.enabled &&
              site.integrations.analytics.mode !== 'managed' &&
              !isPreview && <div hidden data-analytics={scriptJson(site.integrations.analytics)} />}
            {site.integrations.googleAnalytics.enabled &&
              !isPreview &&
              current !== '/settings/' &&
              current !== '/404.html' && (
                <div hidden data-google-analytics={scriptJson(site.integrations.googleAnalytics)} />
              )}
            <div className="navigation-progress" aria-hidden="true" />
            <a className="skip-link" href="#main" data-ui={'Skip to content'}>
              {t('Skip to content')}
            </a>
            {options.article && settings?.reading.progress && (
              <div className="article-progress" aria-hidden="true" />
            )}
            {header(current)}
            <main
              id="main"
              className={`site-main${current === '/' ? (site.home.layout === 'chapters' ? ' visual-home' : ' profile-home') : ''}${options.layout === 'listing' ? ' listing-main' : ''}`}
              data-listing-browser={options.layout === 'listing' ? '' : undefined}
            >
              {content}
            </main>
            {current !== '/' &&
              current !== '/settings/' &&
              current !== '/tools/' &&
              site.integrations.newsletter.enabled && (
                <aside className="newsletter-invitation glass-panel">
                  <span className="section-icon">
                    <Icon name="Mail" size={20} />
                  </span>
                  <div>
                    <h2>{site.integrations.newsletter.title}</h2>
                    <p>{site.integrations.newsletter.description}</p>
                  </div>
                  <a className="button secondary" href={site.integrations.newsletter.url}>
                    {site.integrations.newsletter.buttonLabel}
                    <Icon name="ArrowUpRight" size={15} />
                  </a>
                </aside>
              )}
            <footer className="site-footer glass">
              {(site.footer.showBrand || site.footer.tagline) && (
                <div className="footer-left">
                  {site.footer.showBrand && (
                    <a href="/" aria-label={t('{value0} home', { value0: site.name })}>
                      {brand()}
                    </a>
                  )}
                  {site.footer.tagline && <span>{site.footer.tagline}</span>}
                </div>
              )}
              <div className="footer-links">
                <span>{footerCopyright(site)}</span>
                {!isPreview && (
                  <button
                    type="button"
                    className="text-link"
                    data-reading-list
                    disabled
                    data-ui="Reading list"
                  >
                    {t('Reading list')}
                  </button>
                )}
                {[
                  ...(site.footer.showSocialLinks
                    ? [
                        ...site.profile.links.slice(0, site.footer.socialLinkLimit),
                        ...profileLinks.filter(
                          (link) =>
                            site.profile.email &&
                            link.href.toLowerCase().split('?')[0] ===
                              'mailto:' + site.profile.email.toLowerCase() &&
                            !site.profile.links
                              .slice(0, site.footer.socialLinkLimit)
                              .some((existing) => existing.href === link.href),
                        ),
                      ]
                    : []),
                  ...site.footer.links,
                ].map((link, index) => (
                  <ContactLink
                    label={link.label}
                    protect={site.profile.protectEmailLinks}
                    href={link.href}
                    key={index}
                    target={
                      site.footer.externalLinks && /^https:\/\//i.test(link.href)
                        ? '_blank'
                        : undefined
                    }
                    rel={
                      site.footer.externalLinks && /^https:\/\//i.test(link.href)
                        ? 'noopener noreferrer'
                        : undefined
                    }
                  >
                    {socialIconFor(link.href) === 'Github' && <Icon name="Github" size={15} />}
                    {link.label}
                  </ContactLink>
                ))}
                {site.footer.showFeeds &&
                  feedLinks(site).map((feed) => (
                    <a
                      key={feed.href}
                      href={feed.href}
                      aria-label={t('{value0} feed', { value0: feed.label })}
                      title={t('{value0} feed', { value0: feed.label })}
                    >
                      <Icon name="Rss" size={13} />
                      {feed.label !== 'RSS' && feed.label}
                    </a>
                  ))}
              </div>
            </footer>
            {site.navigationTools.search && (
              <dialog
                id="search-dialog"
                className="search-dialog"
                aria-label={t('Search this notebook')}
                data-search-module={assets.search}
                data-search-style={assets.discoveryStyle}
                data-ui-attrs={'{"aria-label":"Search this notebook"}'}
              >
                <div className="search-top">
                  <Icon name="Search" size={20} />
                  <input
                    type="search"
                    placeholder={t('Find a thought, a topic, an experiment…')}
                    aria-label={t('Search {value0} and {value1}', {
                      value0: site.collections.posts.name,
                      value1: site.collections.lab.name,
                    })}
                    autoComplete="off"
                    data-ui-attrs={'{"placeholder":"Find a thought, a topic, an experiment…"}'}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    data-dialog-close
                    aria-label={t('Close search')}
                    data-ui-attrs={'{"aria-label":"Close search"}'}
                  >
                    <Icon name="X" />
                  </button>
                </div>
                <div className="search-results" aria-live="polite">
                  <p className="no-results" data-ui={'Start typing to explore the notebook.'}>
                    {t('Start typing to explore the notebook.')}
                  </p>
                </div>
                <div className="search-help">
                  <kbd className="hint-key" data-ui={'esc'}>
                    {t('esc')}
                  </kbd>{' '}
                  <UiText message={' to close'} />
                  <span style={{ marginLeft: 'auto' }} data-ui={'Local full-text search'}>
                    {t('Local full-text search')}
                  </span>
                </div>
              </dialog>
            )}
          </body>
        </html>,
      )
    );
  }
  function home() {
    if (site.home.layout === 'profile') {
      const pinned = pinnedHomeEntries(model);
      const pins = new Set(pinned.map((entry) => entry.id));
      const writing = [...pinned, ...recentHomeEntries(model)];
      const preferences = site.home.recent;
      return document(
        '/',
        site.name,
        <div className="home-notebook" data-home-motion={site.home.motion}>
          <ProfileHeader
            compact
            profile={site.profile}
            links={profileLinks}
            visibility={site.home.profile}
            eyebrow={site.name}
          />
          <section className="home-recent" aria-labelledby="home-recent-title">
            <div className="home-section-heading">
              <h2 id="home-recent-title">
                {pinned.length ? t('From the notebook') : t('Recently published')}
              </h2>
              <a className="text-link" href="/archive/">
                <UiText message={'View archive'} />
                <Icon name="ArrowUpRight" size={14} />
              </a>
            </div>
            <div className="home-writing glass-panel">
              {writing.length ? (
                <ol className="home-entry-list">
                  {writing.map((entry, index) => (
                    <li
                      key={entry.id}
                      style={{ '--home-order': Math.min(index, 5) } as CSSProperties}
                    >
                      <a
                        className="home-entry"
                        href={routeFor(entry, site.collections)}
                        data-aca-item={entry.id}
                        data-aca-surface="home"
                        data-aca-rank={index + 1}
                        data-home-pinned={pins.has(entry.id) ? 'true' : undefined}
                      >
                        {preferences.showCover && entry.cover && (
                          <img
                            className="home-entry-cover"
                            src={entry.cover}
                            srcSet={imageSet(entry.cover)}
                            sizes="96px"
                            alt={entry.coverOptions?.alt || entry.title}
                            width={96}
                            height={72}
                            style={{
                              objectPosition: `${entry.coverOptions?.focalX ?? 50}% ${entry.coverOptions?.focalY ?? 50}%`,
                            }}
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                        <div className="home-entry-copy">
                          <div className="home-entry-meta">
                            {pins.has(entry.id) && (
                              <span className="home-entry-pin">
                                <Icon name="Pin" size={12} /> <UiText message={' Pinned'} />
                              </span>
                            )}
                            <span>{site.collections[entry.kind].singular}</span>
                            {preferences.showDate &&
                              resolveEntrySettings(site, entry).reading.publishedDate && (
                                <time dateTime={entry.publishedAt}>
                                  {formatDate(entry.publishedAt, true)}
                                </time>
                              )}
                          </div>
                          <h3 lang={entry.lang}>{entry.title}</h3>
                          {preferences.showSummary && entry.summary && (
                            <p lang={entry.lang}>{entry.summary}</p>
                          )}
                        </div>
                        <Icon name="ArrowUpRight" size={18} />
                      </a>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="home-empty" data-ui={'New writing will appear here.'}>
                  {t('New writing will appear here.')}
                </p>
              )}
            </div>
          </section>
        </div>,
      );
    }
    const slides = resolveSlides(model);
    const chapters = slides.length
      ? slides
      : [
          {
            id: 'welcome',
            image: site.theme.backgroundImage,
            title: site.profile.headline,
            caption: site.description,
            alt: '',
            href: '/archive/',
            focalX: 50,
            focalY: 50,
          },
        ];
    return document(
      '/',
      site.name,
      <>
        <div className="visual-chapters" data-chapters data-home-motion={site.home.motion}>
          {chapters.map((slide, index) => (
            <section
              className="visual-chapter"
              id={`chapter-${slide.id}`}
              key={slide.id}
              data-chapter
            >
              {slide.image && (
                <img
                  className="chapter-image"
                  src={slide.image}
                  srcSet={imageSet(slide.image)}
                  sizes="100vw"
                  alt={slide.alt}
                  loading={index === 0 ? 'eager' : 'lazy'}
                  fetchPriority={index === 0 ? 'high' : 'auto'}
                  decoding="async"
                  style={{ objectPosition: `${slide.focalX}% ${slide.focalY}%` }}
                />
              )}
              <div className="chapter-shade" />
              <div className="chapter-copy">
                <span className="chapter-number">
                  {String(index + 1).padStart(2, '0')} / {String(chapters.length).padStart(2, '0')}
                </span>
                {index === 0 ? <h1>{slide.title}</h1> : <h2>{slide.title}</h2>}
                {slide.caption && <p>{slide.caption}</p>}
                <div className="chapter-actions">
                  {slide.href && (
                    <a className="chapter-link" href={slide.href}>
                      <UiText message={'Explore '} />
                      <Icon name="ArrowUpRight" size={18} />
                    </a>
                  )}
                  {slide.image && (
                    <button
                      type="button"
                      className="chapter-image-action icon-button"
                      data-view-image={slide.image}
                      data-view-caption={slide.title}
                      aria-label={t('View image: {value0}', { value0: slide.title })}
                    >
                      <Icon name="Expand" size={18} />
                    </button>
                  )}
                </div>
              </div>
              {index === 0 && chapters.length > 1 && (
                <a className="chapter-scroll" href={`#chapter-${chapters[1].id}`}>
                  <Icon name="ArrowDown" size={17} /> <UiText message={' Scroll to discover'} />
                </a>
              )}
            </section>
          ))}
        </div>
        <nav
          className="chapter-index glass"
          aria-label={t('Visual chapters')}
          data-ui-attrs={'{"aria-label":"Visual chapters"}'}
        >
          {chapters.map((slide, index) => (
            <a
              key={slide.id}
              href={`#chapter-${slide.id}`}
              aria-label={t('Chapter {value0}: {value1}', {
                value0: index + 1,
                value1: slide.title,
              })}
              data-chapter-link
            >
              <span />
            </a>
          ))}
        </nav>
      </>,
    );
  }
  function aboutPage() {
    return document(
      '/about/',
      'About',
      <article className="about-page">
        <ProfileHeader
          profile={site.profile}
          links={profileLinks}
          titleAnchor={about.titleAnchor || undefined}
          sourceRange={isPreview ? about.titleRange : undefined}
        />
        <div
          className="article-body prose reading-surface glass-panel"
          lang={site.language}
          dangerouslySetInnerHTML={{ __html: about.html }}
        />
        {site.integrations.comments.enabled && site.about.guestbook.enabled && (
          <Discussion
            config={site.integrations.comments}
            term="page/about/guestbook"
            id="about-guestbook"
            preview={isPreview}
            title={site.about.guestbook.title}
            description={site.about.guestbook.description}
          />
        )}
      </article>,
    );
  }
  function archive(kind: 'posts' | 'lab', tag?: string) {
    const source = tag ? byTag.get(tag) || [] : kind === 'posts' ? posts : labs;
    const isLab = kind === 'lab' && !tag;
    const title = tag ? `Notes on ${tag}` : site.collections[kind].name;
    const current = tag
      ? `/tags/${encodeURIComponent(headingSlug(tag))}/`
      : collectionIndexRoute(kind, site.collections);
    return document(
      current,
      tag || site.collections[kind].name,
      <>
        <h1 className="sr-only">{title}</h1>
        {tag && (
          <div className="listing-context">
            <span className="listing-topic">
              <Icon name="Hash" size={16} />
              {tag}
            </span>
            <a className="text-link" href={collectionIndexRoute('posts', site.collections)}>
              <Icon name="ChevronLeft" size={14} />
              <UiText message={'All '} />
              {site.collections.posts.name}
            </a>
          </div>
        )}
        {!isLab && (
          <div className="archive-tools">
            <div className="archive-search">
              <Icon name="Search" size={15} />
              <input
                type="search"
                placeholder={t('Find something…')}
                aria-label={t('Filter {value0}', {
                  value0: tag ? 'entries' : site.collections[kind].name,
                })}
                data-archive-search
                data-ui-attrs={'{"placeholder":"Find something…"}'}
              />
            </div>
            <div
              className="archive-tags"
              role="group"
              aria-label={t('Filter by topic')}
              data-ui-attrs={'{"aria-label":"Filter by topic"}'}
            >
              <button className="chip active" data-tag-filter="" aria-pressed="true">
                <Icon name="BookOpen" size={13} />
                {tag
                  ? t('All in this topic')
                  : t('All {value0}', { value0: site.collections[kind].name })}
              </button>
              {[...new Set(source.flatMap((e) => e.tags))]
                .filter((t) => t !== tag)
                .sort()
                .map((t) => (
                  <button key={t} className="chip" data-tag-filter={t} aria-pressed="false">
                    {t}
                  </button>
                ))}
            </div>
          </div>
        )}
        <p
          className="archive-count"
          data-archive-count
          data-count-singular={tag ? 'entry' : site.collections[kind].singular}
          data-count-plural={tag ? 'entries' : site.collections[kind].name}
          data-count-context={tag ? 'in this topic' : 'in the notebook'}
          aria-live="polite"
          aria-atomic="true"
        >
          {source.length}{' '}
          {tag
            ? source.length === 1
              ? t('entry')
              : t('entries')
            : source.length === 1
              ? site.collections[kind].singular
              : site.collections[kind].name}{' '}
          {tag ? t('in this topic') : t('in the notebook')}
        </p>
        <div className={isLab ? 'archive-lab-grid' : 'archive-grid'}>
          {source.map((e) =>
            isLab ? (
              <LabCard entry={e} key={e.id} collections={site.collections} />
            ) : (
              <PostCard
                entry={e}
                key={e.id}
                reading={site.reading}
                collections={site.collections}
              />
            ),
          )}
        </div>
        {source.length > 0 && (
          <p
            className="no-results"
            data-archive-empty
            hidden
            data-ui={'No entries match. Try another word or topic.'}
          >
            {t('No entries match. Try another word or topic.')}
          </p>
        )}
        {!source.length && (
          <EmptyState title={t('The next page is yours')}>
            <UiText message={'New ideas will appear here.'} />
          </EmptyState>
        )}
      </>,
      { layout: isLab ? undefined : 'listing' },
    );
  }
  function article(entry: RenderedEntry) {
    const { reading, cover, discussion, seo } = resolveEntrySettings(site, entry);
    const annotations = discussion.annotations;
    const outline = reading.outline
      ? entry.rendered.headings.filter((heading) => heading.level <= 3)
      : [];
    const hasOutline = reading.outline && (outline.length > 0 || annotations);
    const scores = new Map<RenderedEntry, number>();
    if (reading.relatedCount)
      for (const tag of new Set(entry.tags))
        for (const candidate of byTag.get(tag) || [])
          if (candidate.id !== entry.id && candidate.status === 'published')
            scores.set(
              candidate,
              (scores.get(candidate) || 0) + candidate.tags.filter((value) => value === tag).length,
            );
    const candidates = [...scores.keys()];
    if (candidates.length < reading.relatedCount)
      for (const candidate of publishedByDate) {
        if (candidate.id !== entry.id && !scores.has(candidate)) candidates.push(candidate);
        if (candidates.length >= reading.relatedCount) break;
      }
    const related = topK(
      candidates,
      reading.relatedCount,
      (a, b) =>
        (scores.get(b) || 0) - (scores.get(a) || 0) ||
        b.publishedAt.localeCompare(a.publishedAt) ||
        order.get(a)! - order.get(b)!,
    );
    return document(
      routeFor(entry, site.collections),
      seo.title,
      <article
        className={`article-shell has-margin-rail${hasOutline ? ' has-outline' : ''}`}
        lang={entry.lang}
        data-annotation-endpoint={
          annotations && !isPreview ? `/api/annotations/${encodeURIComponent(entry.id)}` : undefined
        }
      >
        <a className="article-back" href={collectionIndexRoute(entry.kind, site.collections)}>
          <Icon name="ArrowRight" size={13} />
          <UiText message={'Back to '} />
          {site.collections[entry.kind].name}
        </a>
        <div className="article-layout">
          <div className="article-content">
            <header className="article-header">
              <div className="tags">
                {entry.tags.map((tag) => (
                  <Tag tag={tag} key={tag} />
                ))}
                {entry.status !== 'published' && (
                  <span className={`badge ${entry.status}`}>
                    {entry.status === 'scheduled' ? t('Scheduled preview') : t('Draft preview')}
                  </span>
                )}
                {entry.demo && (
                  <span className="badge demo" data-ui={'Sample content'}>
                    {t('Sample content')}
                  </span>
                )}
              </div>
              <h1>{entry.title}</h1>
              <p className="article-summary">{entry.summary}</p>
              <Meta entry={entry} reading={reading} />
              {(reading.author || (reading.modifiedDate && entry.updatedAt)) && (
                <p className="article-print-meta">
                  {reading.author && (
                    <>
                      <UiText message={'Written by '} />
                      {site.profile.name}
                    </>
                  )}
                  {reading.modifiedDate && entry.updatedAt && (
                    <>
                      {reading.author ? ' · ' : ''}
                      <UiText message={'Updated '} />
                      {formatDate(entry.updatedAt, true)}
                    </>
                  )}
                </p>
              )}
              {!isPreview && (
                <p className="article-print-source">
                  <UiText message={'Source: '} />
                  {new URL(routeFor(entry, site.collections), site.url).href}
                </p>
              )}
              {!hasOutline && (
                <button
                  type="button"
                  className="text-link"
                  data-article-focus-toggle
                  disabled
                  aria-pressed="false"
                >
                  <Icon name="ScanLine" size={15} /> <UiText message={' Focus mode'} />
                </button>
              )}
              {(discussion.article || annotations) && (
                <div className="article-discussion-tools">
                  {discussion.article && (
                    <a className="article-discussion-jump text-link" href="#discussion">
                      <Icon name="MessageCircle" size={15} />
                      <span data-discussion-jump-label data-ui={'Join the discussion'}>
                        {t('Join the discussion')}
                      </span>
                      <Icon name="ArrowRight" size={13} />
                    </a>
                  )}
                  {annotations && (
                    <button
                      type="button"
                      className="text-link"
                      data-discuss-line
                      disabled
                      title={
                        isPreview
                          ? t('Annotations are available on the published page')
                          : t(
                              'Annotate the exact line under your pointer, or choose a line with the keyboard',
                            )
                      }
                    >
                      <Icon name="PenLine" size={15} /> <UiText message={' Annotate a line'} />
                    </button>
                  )}
                </div>
              )}
            </header>
            {entry.cover && cover.visible && (
              <figure
                className="article-cover-figure"
                data-cover-ratio={cover.ratio}
                style={{ '--cover-position': `${cover.focalX}% ${cover.focalY}%` } as CSSProperties}
              >
                <a
                  href={entry.cover}
                  className="article-cover-link"
                  data-view-image={entry.cover}
                  data-view-caption={cover.caption}
                  aria-label={t('View cover image: {value0}', { value0: cover.alt })}
                >
                  <Picture src={entry.cover} alt={cover.alt} className="article-cover" eager />
                  <span className="cover-view-hint">
                    <Icon name="Expand" size={16} /> <UiText message={' View image'} />
                  </span>
                </a>
                {cover.caption && <figcaption>{cover.caption}</figcaption>}
              </figure>
            )}
            <div
              className="article-body prose reading-surface glass-panel"
              lang={entry.lang}
              data-code-lines={String(reading.codeLineNumbers)}
              data-entry-id={entry.id}
              dangerouslySetInnerHTML={{ __html: entry.rendered.html }}
            />
            <div
              id="article-end"
              className="article-end"
              tabIndex={-1}
              role="note"
              aria-label={t('End of article')}
              data-ui-attrs={'{"aria-label":"End of article"}'}
            />
            <ArticleFooter entry={entry} site={site} preview={isPreview} />
            <template data-article-margin-template>
              <button type="button" data-margin-fold>
                <Icon name="ChevronRight" size={16} />
              </button>
              <button type="button" data-margin-footnotes disabled>
                <Icon name="BookOpen" size={14} />
                <span data-margin-footnote-count />
              </button>
              <button type="button" data-margin-annotate disabled>
                <Icon name="PenLine" size={16} />
              </button>
            </template>
            {annotations && !isPreview && (
              <>
                <button
                  type="button"
                  className="line-discussion-trigger icon-button glass"
                  data-line-trigger
                  aria-label={t('Annotate this line')}
                  aria-describedby="line-discussion-tooltip"
                  aria-haspopup="dialog"
                  aria-expanded="false"
                  aria-controls="line-discussion-panel"
                  hidden
                  data-ui-attrs={'{"aria-label":"Annotate this line"}'}
                >
                  <Icon name="PenLine" size={17} />
                </button>
                <template data-annotation-badge-template>
                  <button
                    type="button"
                    className="line-annotation-badge glass-panel"
                    aria-haspopup="dialog"
                    aria-expanded="false"
                    aria-controls="line-discussion-panel"
                  >
                    <Icon name="MessageCircle" size={14} />
                    <span data-line-annotation-count aria-hidden="true" />
                  </button>
                </template>
                <span
                  className="line-discussion-tooltip"
                  id="line-discussion-tooltip"
                  role="tooltip"
                  hidden
                  data-ui={'Annotate this line'}
                >
                  {t('Annotate this line')}
                </span>
                <p className="sr-only" data-line-announcement role="status" aria-live="polite" />
                <template data-line-discussion-template>
                  <aside
                    className="line-discussion-popover glass"
                    id="line-discussion-panel"
                    popover="auto"
                    role="dialog"
                    aria-label={t('Line annotation')}
                    data-ui-attrs={'{"aria-label":"Line annotation"}'}
                  >
                    <div className="line-thread-heading">
                      <h2>
                        <Icon name="PenLine" size={18} />
                        <UiText message={'Line annotation'} />
                      </h2>
                      <button
                        type="button"
                        className="icon-button"
                        data-close-line-thread
                        aria-label={t('Close annotation')}
                        data-ui-attrs={'{"aria-label":"Close annotation"}'}
                      >
                        <Icon name="X" size={18} />
                      </button>
                    </div>
                    <div className="line-thread-body">
                      <blockquote className="line-thread-quote" data-line-quote />
                      <p className="help" data-line-outdated role="status" hidden />
                      <Discussion
                        config={site.integrations.comments}
                        term=""
                        id="line-thread"
                        compact
                      />
                      <a
                        className="text-link line-thread-browse"
                        data-line-browse
                        href={`https://github.com/search?type=discussions&q=${encodeURIComponent(`repo:${site.integrations.comments.repo} in:title "entry/${entry.id}/line/"`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Icon name="PenLine" size={14} /> <UiText message={' Browse annotations'} />
                        <Icon name="ArrowUpRight" size={13} />
                      </a>
                    </div>
                  </aside>
                </template>
              </>
            )}
          </div>
          {hasOutline && (
            <aside
              className="post-outline"
              aria-label={t('Article outline')}
              data-ui-attrs={'{"aria-label":"Article outline"}'}
            >
              <details className="outline-card glass-panel">
                <summary>
                  <Icon name="ListTree" size={15} />
                  <span data-ui={'On this page'}>{t('On this page')}</span>
                  <Icon name="ChevronDown" size={13} className="outline-chevron" />
                </summary>
                {annotations && (
                  <div
                    className="outline-tabs segmented"
                    role="tablist"
                    aria-label={t('Article sidebar')}
                    data-annotation-tabs
                    data-ui-attrs={'{"aria-label":"Article sidebar"}'}
                  >
                    <button
                      type="button"
                      role="tab"
                      id="outline-tab"
                      aria-controls="outline-content"
                      aria-selected="true"
                      data-annotation-view="outline"
                    >
                      <Icon name="ListTree" size={13} /> <UiText message={' Outline'} />
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id="outline-annotations-tab"
                      aria-controls="outline-annotations"
                      aria-selected="false"
                      tabIndex={-1}
                      disabled
                      data-annotation-view="annotations"
                    >
                      <Icon name="PenLine" size={13} /> <UiText message={' Annotations'} />{' '}
                      <span data-annotation-count hidden />
                    </button>
                  </div>
                )}
                <div
                  id={annotations ? 'outline-content' : undefined}
                  role={annotations ? 'tabpanel' : undefined}
                  aria-labelledby={annotations ? 'outline-tab' : undefined}
                >
                  <nav
                    aria-label={t('Table of contents')}
                    data-ui-attrs={'{"aria-label":"Table of contents"}'}
                  >
                    {outline.map((heading) => (
                      <a
                        href={`#${heading.id}`}
                        key={heading.id}
                        data-outline-link
                        data-outline-level={heading.level}
                      >
                        {heading.text}
                      </a>
                    ))}
                  </nav>
                  {!outline.length && (
                    <p
                      className="help outline-empty"
                      data-ui={'This article has no section headings.'}
                    >
                      {t('This article has no section headings.')}
                    </p>
                  )}
                </div>
                {annotations && (
                  <div
                    id="outline-annotations"
                    role="tabpanel"
                    aria-labelledby="outline-annotations-tab"
                    hidden
                  >
                    <AnnotationList
                      repo={site.integrations.comments.repo}
                      entryId={entry.id}
                      compact
                      preview={isPreview}
                    />
                  </div>
                )}
                {reading.progress && (
                  <div className="outline-progress" hidden data-outline-reading>
                    <span data-ui={'Reading progress'}>{t('Reading progress')}</span>
                    <output
                      data-outline-progress
                      aria-label={t('Reading progress')}
                      aria-live="off"
                      data-ui-attrs={'{"aria-label":"Reading progress"}'}
                    >
                      0%
                    </output>
                  </div>
                )}
                <div
                  className="outline-actions"
                  role="group"
                  aria-label={t('Article navigation')}
                  data-ui-attrs={'{"aria-label":"Article navigation"}'}
                >
                  <a
                    className="icon-button"
                    href="#main"
                    aria-label={t('Back to top')}
                    title={t('Back to top')}
                    data-ui-attrs={'{"aria-label":"Back to top","title":"Back to top"}'}
                  >
                    <Icon name="ArrowUpToLine" size={16} />
                  </a>
                  <a
                    className="icon-button"
                    href="#article-end"
                    aria-label={t('End of article')}
                    title={t('End of article')}
                    data-ui-attrs={'{"aria-label":"End of article","title":"End of article"}'}
                  >
                    <Icon name="ArrowDownToLine" size={16} />
                  </a>
                  <button
                    type="button"
                    className="icon-button"
                    data-outline-step="-1"
                    aria-label={t('Previous section')}
                    title={t('Previous section')}
                    disabled
                    data-ui-attrs={'{"aria-label":"Previous section","title":"Previous section"}'}
                  >
                    <Icon name="ChevronUp" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    data-outline-step="1"
                    aria-label={t('Next section')}
                    title={t('Next section')}
                    disabled
                    data-ui-attrs={'{"aria-label":"Next section","title":"Next section"}'}
                  >
                    <Icon name="ChevronDown" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    data-article-focus-toggle
                    aria-label={t('Article focus mode')}
                    title={t('Article focus mode')}
                    aria-pressed="false"
                    disabled
                    data-ui-attrs={
                      '{"aria-label":"Article focus mode","title":"Article focus mode"}'
                    }
                  >
                    <Icon name="ScanLine" size={16} />
                  </button>
                </div>
              </details>
            </aside>
          )}
        </div>
        <button
          type="button"
          className="article-focus-exit glass-panel text-link"
          data-article-focus-exit
          hidden
        >
          <Icon name="Minimize2" size={15} /> <UiText message={' Exit focus'} />
        </button>
        {related.length > 0 && (
          <section
            className="article-related"
            aria-label={t('Related articles')}
            data-ui-attrs={'{"aria-label":"Related articles"}'}
          >
            <h2 data-ui={'Follow another thread'}>{t('Follow another thread')}</h2>
            <div className="related-grid">
              {related.map((candidate) => (
                <PostCard
                  entry={candidate}
                  key={candidate.id}
                  row
                  reading={site.reading}
                  collections={site.collections}
                />
              ))}
            </div>
          </section>
        )}
        {(discussion.article || annotations) && (
          <section className="article-conversations glass-panel">
            <div
              className="conversation-tabs segmented"
              role="tablist"
              aria-label={t('Article conversations')}
              data-annotation-tabs
              data-ui-attrs={'{"aria-label":"Article conversations"}'}
            >
              {discussion.article && (
                <button
                  type="button"
                  role="tab"
                  id="article-discussion-tab"
                  aria-controls="article-discussion-panel"
                  aria-selected="true"
                  data-annotation-view="discussion"
                >
                  <Icon name="MessageCircle" size={15} /> <UiText message={' Discussion'} />
                </button>
              )}
              {annotations && (
                <button
                  type="button"
                  role="tab"
                  id="article-annotations-tab"
                  aria-controls="article-annotations"
                  aria-selected={!discussion.article}
                  tabIndex={discussion.article ? -1 : 0}
                  disabled
                  data-annotation-view="annotations"
                >
                  <Icon name="PenLine" size={15} /> <UiText message={' Annotations'} />{' '}
                  <span data-annotation-count hidden />
                </button>
              )}
            </div>
            {discussion.article && (
              <div
                id="article-discussion-panel"
                role="tabpanel"
                aria-labelledby="article-discussion-tab"
              >
                <Discussion
                  config={site.integrations.comments}
                  // Keep the established Giscus key when public collection paths change.
                  term={entry.discussion?.articleTerm || routeFor(entry)}
                  preview={isPreview}
                  lang={entry.lang}
                  embedded
                />
              </div>
            )}
            {annotations && (
              <div
                id="article-annotations"
                role="tabpanel"
                aria-labelledby="article-annotations-tab"
                hidden={discussion.article}
              >
                <div className="annotation-index-heading">
                  <span className="section-icon">
                    <Icon name="PenLine" size={18} />
                  </span>
                  <div>
                    <h2 data-ui={'Notes in the margins'}>{t('Notes in the margins')}</h2>
                    <p
                      data-ui={
                        'Annotations follow specific passages. Open a note to read or reply.'
                      }
                    >
                      {t('Annotations follow specific passages. Open a note to read or reply.')}
                    </p>
                  </div>
                </div>
                <AnnotationList
                  repo={site.integrations.comments.repo}
                  entryId={entry.id}
                  preview={isPreview}
                />
              </div>
            )}
          </section>
        )}
      </article>,
      {
        description: seo.description,
        image: seo.image || undefined,
        lang: entry.lang,
        article: entry,
        noindex: entry.status !== 'published' || seo.noindex,
      },
    );
  }
  function life(album?: string) {
    const selected = albumsByName.get(album || '');
    const index = collectionIndexRoute('life', site.collections);
    const count = selected?.photos.length ?? library.photos.length;
    const adjacent = selected ? photoAlbums.indexOf(selected) : -1;
    return document(
      selected ? albumRoute(selected, site.collections) : index,
      album || site.collections.life.name,
      <div
        className={`album-page${selected ? ' album-detail-page' : ''}`}
        data-album-browser={!selected ? '' : undefined}
      >
        {selected && (
          <nav
            className="album-breadcrumb"
            aria-label={t('Album breadcrumb')}
            data-ui-attrs={'{"aria-label":"Album breadcrumb"}'}
          >
            <a
              className="text-link"
              href={index}
              {...uiAttrs(
                { 'aria-label': 'Back to {value0}' },
                { value0: site.collections.life.name },
              )}
            >
              <Icon name="ChevronLeft" size={14} />
              <span data-ui-collection="life" data-ui-source={site.collections.life.name}>
                {site.collections.life.name}
              </span>
            </a>
            <Icon name="ChevronRight" size={12} />
            <span>{selected.name}</span>
          </nav>
        )}
        <div className={`life-header${selected ? ' life-album-intro' : ''}`}>
          <header className="page-heading">
            <span className="eyebrow">
              <Icon name="Image" size={14} />
              <UiText message="A visual journal" />
            </span>
            <h1>
              {selected ? (
                selected.name
              ) : (
                <span data-ui-collection="life" data-ui-source={site.collections.life.name}>
                  {site.collections.life.name}
                </span>
              )}
            </h1>
            {selected?.description ? (
              <p>{selected.description}</p>
            ) : (
              <p>
                <UiText message="Quiet places, changing light, and moments worth keeping." />
              </p>
            )}
            <div className="life-count">
              <Icon name={selected ? 'Image' : 'FolderOpen'} size={14} />
              {!selected && (
                <>
                  <UiText message="{count} albums" params={{ count: photoAlbums.length }} />
                  <span aria-hidden="true">·</span>
                </>
              )}
              <UiText
                message={count === 1 ? '{count} photograph' : '{count} photographs'}
                params={{ count }}
              />
              {selected && (
                <>
                  <span aria-hidden="true">·</span>
                  <time dateTime={selected.from} data-ui-date={selected.from}>
                    {formatDate(selected.from, true)}
                  </time>
                  {selected.to !== selected.from && (
                    <>
                      <span aria-hidden="true">—</span>
                      <time dateTime={selected.to} data-ui-date={selected.to}>
                        {formatDate(selected.to, true)}
                      </time>
                    </>
                  )}
                </>
              )}
            </div>
          </header>
          {selected?.effectiveCover && (
            <div className="album-cover-frame">
              <Picture src={selected.effectiveCover} alt="" className="life-album-cover" eager />
            </div>
          )}
        </div>
        {!selected && (
          <>
            <nav
              className="album-view-tabs"
              aria-label={t('Photo collection views')}
              data-album-tabs
              data-ui-attrs={'{"aria-label":"Photo collection views"}'}
            >
              <a href={`${index}?view=albums`} data-album-tab="albums">
                <Icon name="FolderOpen" size={16} />
                <UiText message="Albums" />
                <span className="album-tab-count">{photoAlbums.length}</span>
              </a>
              <a href={`${index}?view=photos#moments`} data-album-tab="photos">
                <Icon name="Image" size={16} />
                <UiText message="All photos" />
                <span className="album-tab-count">{library.photos.length}</span>
              </a>
            </nav>
            <section
              className="life-albums"
              data-album-panel="albums"
              id="album-collections"
              aria-label={t('Photo albums')}
              data-ui-attrs={'{"aria-label":"Photo albums"}'}
            >
              <div className="life-album-grid">
                {photoAlbums.map((item) => (
                  <a
                    key={item.id}
                    href={albumRoute(item, site.collections)}
                    className="life-album-card glass-panel"
                  >
                    <div className="life-album-image">
                      <Picture src={item.effectiveCover} alt="" />
                    </div>
                    <div className="life-album-card-body">
                      <div>
                        <h2>{item.name}</h2>
                        <span className="album-card-count">
                          <Icon name="Image" size={12} />
                          {item.photos.length}
                        </span>
                      </div>
                      {item.description && <p>{item.description}</p>}
                      <div className="life-album-date">
                        <span>
                          <time dateTime={item.from} data-ui-date={item.from}>
                            {formatDate(item.from, true)}
                          </time>
                          {item.from !== item.to && (
                            <>
                              {' '}
                              —{' '}
                              <time dateTime={item.to} data-ui-date={item.to}>
                                {formatDate(item.to, true)}
                              </time>
                            </>
                          )}
                        </span>
                        <span className="album-card-open">
                          <UiText message="View album" />
                          <Icon name="ArrowUpRight" size={15} />
                        </span>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
              {!photoAlbums.length && (
                <EmptyState icon="FolderOpen" title={t('A journal waiting for its first moment')}>
                  <UiText message="Photos and albums will appear here after they are added in Studio." />
                </EmptyState>
              )}
            </section>
          </>
        )}
        <section
          className="album-photographs"
          id="moments"
          data-album-panel={!selected ? 'photos' : undefined}
        >
          <div className="life-section-heading">
            <h2>
              <UiText message={selected ? 'In this album' : 'All photos'} />
            </h2>
            <span className="muted">
              <UiText message="Open a photograph to explore its details." />
            </span>
          </div>
          <Photos library={library} album={album} />
          {!count && (
            <EmptyState icon="Image" title={t('No photographs yet')}>
              <UiText message="Your next moment has a place here." />
            </EmptyState>
          )}
        </section>
        {selected && (
          <nav
            className="album-pagination"
            aria-label={t('Browse albums')}
            data-ui-attrs={'{"aria-label":"Browse albums"}'}
          >
            {photoAlbums[adjacent - 1] ? (
              <a
                className="text-link"
                href={albumRoute(photoAlbums[adjacent - 1], site.collections)}
              >
                <Icon name="ChevronLeft" size={15} />
                <span>
                  <small>
                    <UiText message="Previous album" />
                  </small>
                  {photoAlbums[adjacent - 1].name}
                </span>
              </a>
            ) : (
              <span />
            )}
            {photoAlbums[adjacent + 1] && (
              <a
                className="text-link"
                href={albumRoute(photoAlbums[adjacent + 1], site.collections)}
              >
                <span>
                  <small>
                    <UiText message="Next album" />
                  </small>
                  {photoAlbums[adjacent + 1].name}
                </span>
                <Icon name="ChevronRight" size={15} />
              </a>
            )}
          </nav>
        )}
      </div>,
      {
        description: selected?.description || undefined,
        image: selected?.effectiveCover || undefined,
      },
    );
  }
  function chronologicalArchive() {
    const published = chronologicalEntries(entries);
    return document(
      '/archive/',
      'Archive',
      <div className="archive-page" data-timeline-browser>
        <h1 className="sr-only" data-ui={'Archive'}>
          {t('Archive')}
        </h1>
        <div className="timeline-controls">
          <div
            className="timeline-filters"
            role="group"
            aria-label={t('Filter archive by kind')}
            data-ui-attrs={'{"aria-label":"Filter archive by kind"}'}
          >
            {(
              [
                ['all', 'All entries'],
                ['posts', site.collections.posts.name],
                ['lab', site.collections.lab.name],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                className={`chip${kind === 'all' ? ' active' : ''}`}
                data-timeline-filter={kind}
                aria-pressed={kind === 'all'}
              >
                <Icon
                  name={kind === 'all' ? 'Archive' : kind === 'posts' ? 'BookOpen' : 'FlaskConical'}
                  size={13}
                />
                {label}
              </button>
            ))}
          </div>
          <div className="archive-search">
            <Icon name="Search" size={15} />
            <input
              type="search"
              aria-label={t('Filter archive')}
              placeholder={t('Find a page…')}
              data-timeline-search
              data-ui-attrs={'{"aria-label":"Filter archive","placeholder":"Find a page…"}'}
            />
          </div>
        </div>
        <p className="timeline-count" data-timeline-count aria-live="polite">
          {published.length} <UiText message={' published '} />
          {published.length === 1 ? t('entry') : t('entries')}
        </p>
        <label className="timeline-tag-select">
          <UiText message={'Topic'} />{' '}
          <select
            data-timeline-tag
            aria-label={t('Filter archive by topic')}
            data-ui-attrs={'{"aria-label":"Filter archive by topic"}'}
          >
            <option value="" data-ui={'All topics'}>
              {t('All topics')}
            </option>
            {[...new Set(published.flatMap((e) => e.tags))].sort().map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <ArchiveTimeline entries={published} collections={site.collections} />
        <p
          className="no-results"
          data-timeline-empty
          hidden
          data-ui={'No entries match. Try another word or kind.'}
        >
          {t('No entries match. Try another word or kind.')}
        </p>
        {!published.length && (
          <EmptyState icon="BookOpen" title={t('Your timeline starts here')}>
            <UiText message={'Published entries from '} />
            {site.collections.posts.name} <UiText message={' and '} />
            {site.collections.lab.name} <UiText message={'will appear in the archive.'} />
          </EmptyState>
        )}
      </div>,
    );
  }
  const specimenChart = interactiveRegistry.find((d) => d.type === 'chart')!.example;
  const specimenSvg =
    isPreview && specimenChart.type === 'chart'
      ? await renderChartSvg(specimenChart, 'specimen-chart')
      : undefined;
  function components() {
    return document(
      '/__components/',
      'Material library',
      <>
        <header className="page-heading">
          <span className="eyebrow" data-ui={'Development reference'}>
            {t('Development reference')}
          </span>
          <h1 data-ui={'A shared visual language.'}>{t('A shared visual language.')}</h1>
          <p
            data-ui={'The same materials, controls, and typography across the notebook and Studio.'}
          >
            {t('The same materials, controls, and typography across the notebook and Studio.')}
          </p>
        </header>
        <section
          className="component-material"
          aria-label={t('Liquid Glass material specimen')}
          data-ui-attrs={'{"aria-label":"Liquid Glass material specimen"}'}
        >
          <div className="material-playground">
            <img
              className="material-scene-image"
              src="/media/coast-dusk.svg"
              alt={t('An original blue-hour coastline illustration behind the glass specimen')}
              data-ui-attrs={
                '{"alt":"An original blue-hour coastline illustration behind the glass specimen"}'
              }
            />
            <div className="material-grid" aria-hidden="true" />
            <div className="liquid-lens liquid-clear material-demo-lens">
              <span className="material-eyebrow" data-ui={'A little light'}>
                {t('A little light')}
              </span>
              <h3 data-ui={'Light, with a little depth.'}>{t('Light, with a little depth.')}</h3>
              <p
                data-ui={
                  'Move across the glass. Follow the light around its edge and the grid through the lens.'
                }
              >
                {t(
                  'Move across the glass. Follow the light around its edge and the grid through the lens.',
                )}
              </p>
              <a href="/archive/" data-ui={'Explore the archive ↗'}>
                {t('Explore the archive ↗')}
              </a>
            </div>
          </div>
        </section>
        <div className="component-grid">
          <section className="component-card glass-panel" id="typography-contrast">
            <h2 data-ui={'Readable text, through the glass.'}>
              {t('Readable text, through the glass.')}
            </h2>
            {[
              ['Heading ink', '--heading'],
              ['Body text', '--text'],
              ['Secondary text', '--muted'],
              ['Metadata and captions', '--faint'],
              ['Links', '--link-text'],
              ['Placeholders', '--placeholder-text'],
            ].map(([label, token]) => (
              <p key={token} style={{ color: `var(${token})` }}>
                {label} · 留一点清晰，让阅读自然。
              </p>
            ))}
            <p
              className="help"
              data-ui={
                'Appearance and reader settings share these roles, contrast targets and wallpaper protection.'
              }
            >
              {t(
                'Appearance and reader settings share these roles, contrast targets and wallpaper protection.',
              )}
            </p>
            <a className="text-link" href="/settings/">
              <UiText message={'Adjust text & contrast '} />
              <Icon name="ArrowUpRight" size={13} />
            </a>
          </section>
          <section className="component-card glass-panel" id="material-controls">
            <h2 data-ui={'Controls'}>{t('Controls')}</h2>
            <p className="form-state-note">
              <UiText message={'Reader customization uses these same controls.'} />{' '}
              <a className="text-link" href="/settings/">
                <UiText message={'Open reader settings '} />
                <Icon name="ArrowUpRight" size={13} />
              </a>
            </p>
            <div className="component-row">
              <button className="button primary">
                <UiText message={'Primary action'} />
                <Icon name="ArrowRight" size={15} />
              </button>
              <button className="button secondary" data-ui={'Secondary'}>
                {t('Secondary')}
              </button>
              <button className="button ghost" data-ui={'Quiet action'}>
                {t('Quiet action')}
              </button>
            </div>
            <div className="component-row">
              <button className="text-link" type="button">
                <Icon name="Sparkles" size={14} /> <UiText message={' Text action'} />
              </button>
              <button className="text-link" type="button" disabled>
                <Icon name="Check" size={14} /> <UiText message={' Unavailable text action'} />
              </button>
            </div>
            <div className="divider" />
            <div className="component-row">
              <button className="button primary" disabled data-ui={'Disabled'}>
                {t('Disabled')}
              </button>
              <span className="chip active" data-ui={'Selected topic'}>
                {t('Selected topic')}
              </span>
              <span className="badge draft" data-ui={'Draft'}>
                {t('Draft')}
              </span>
              <span className="badge" data-ui={'Published'}>
                {t('Published')}
              </span>
            </div>
          </section>
          <section className="component-card component-form-card glass-panel" id="material-forms">
            <h2 data-ui={'Forms, in the same material'}>{t('Forms, in the same material')}</h2>
            <p
              className="form-state-note"
              data-ui={
                'Native controls, a quieter inset surface, and a clear focus ring. Try the keyboard.'
              }
            >
              {t(
                'Native controls, a quieter inset surface, and a clear focus ring. Try the keyboard.',
              )}
            </p>
            <div className="component-form-grid">
              <label className="field">
                <span data-ui={'Accent color'}>{t('Accent color')}</span>
                <input
                  type="color"
                  className="color-input"
                  defaultValue={site.theme.accent}
                  aria-label={t('Specimen accent color')}
                  data-ui-attrs={'{"aria-label":"Specimen accent color"}'}
                />
              </label>
              <label className="field">
                <span data-ui={'Field label'}>{t('Field label')}</span>
                <input
                  placeholder={t('A thought goes here')}
                  data-ui-attrs={'{"placeholder":"A thought goes here"}'}
                />
              </label>
              <label className="field">
                <span data-ui={'Reading mode'}>{t('Reading mode')}</span>
                <select defaultValue="comfortable">
                  <option value="comfortable" data-ui={'Comfortable'}>
                    {t('Comfortable')}
                  </option>
                  <option value="compact" data-ui={'Compact'}>
                    {t('Compact')}
                  </option>
                </select>
              </label>
              <label className="field">
                <span data-ui={'Read only'}>{t('Read only')}</span>
                <input value="A saved detail" readOnly />
              </label>
              <label className="field">
                <span data-ui={'Unavailable field'}>{t('Unavailable field')}</span>
                <input value="Available after publication" disabled />
              </label>
              <label className="field">
                <span data-ui={'Invalid example'}>{t('Invalid example')}</span>
                <input
                  defaultValue="unfinished"
                  aria-invalid="true"
                  aria-describedby="form-example-error"
                />
                <small
                  id="form-example-error"
                  className="form-error"
                  data-ui={'Add a complete address.'}
                >
                  {t('Add a complete address.')}
                </small>
              </label>
              <label className="field">
                <span data-ui={'Sample intensity'}>{t('Sample intensity')}</span>
                <input
                  type="range"
                  aria-label={t('Sample intensity')}
                  min="0"
                  max="100"
                  defaultValue="48"
                  data-ui-attrs={'{"aria-label":"Sample intensity"}'}
                />
              </label>
              <label className="field form-wide">
                <span data-ui={'A longer note'}>{t('A longer note')}</span>
                <textarea
                  rows={3}
                  placeholder={t('Leave a little room for an idea.')}
                  data-ui-attrs={'{"placeholder":"Leave a little room for an idea."}'}
                />
              </label>
              <label className="field">
                <span data-ui={'Quantity'}>{t('Quantity')}</span>
                <input type="number" min="0" max="100" defaultValue="3" />
              </label>
              <label className="field">
                <span data-ui={'Local publication time'}>{t('Local publication time')}</span>
                <input type="datetime-local" defaultValue="2030-01-02T09:00" />
              </label>
              <label className="field form-wide">
                <span data-ui={'A file to keep'}>{t('A file to keep')}</span>
                <input type="file" />
              </label>
              <fieldset>
                <legend data-ui={'Checkboxes'}>{t('Checkboxes')}</legend>
                <label className="check-label">
                  <input type="checkbox" defaultChecked />
                  <UiText message={'Keep the details'} />
                </label>
                <br />
                <label className="check-label">
                  <input type="checkbox" />
                  <UiText message={'Send a quiet reminder'} />
                </label>
                <br />
                <label className="check-label">
                  <input type="checkbox" defaultChecked disabled />
                  <UiText message={'Archived preference'} />
                </label>
                <br />
                <label className="check-label">
                  <input type="checkbox" data-mixed-checkbox="true" />
                  <UiText message={'Some details selected'} />
                </label>
              </fieldset>
              <fieldset>
                <legend data-ui={'One choice'}>{t('One choice')}</legend>
                <label className="check-label">
                  <input type="radio" name="sample-density" value="comfortable" defaultChecked />
                  <UiText message={'Room to breathe'} />
                </label>
                <br />
                <label className="check-label">
                  <input type="radio" name="sample-density" value="compact" />
                  <UiText message={'A little closer'} />
                </label>
                <label className="toggle-row">
                  <span data-ui={'Sample switch'}>{t('Sample switch')}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={t('Sample switch')}
                    defaultChecked
                    data-ui-attrs={'{"aria-label":"Sample switch"}'}
                  />
                </label>
              </fieldset>
            </div>
            <p className="success-message" data-ui={'Changes saved to your notebook.'}>
              {t('Changes saved to your notebook.')}
            </p>
          </section>
          <section
            className="component-card reading-surface reading-material glass-panel"
            id="reading-material"
          >
            <h2 data-ui={'Reading material'}>{t('Reading material')}</h2>
            <p
              data-ui={
                "Translucent glass carries the page's color and light beneath sharp, readable text. Headings, paragraphs, formulas, and code share a consistent type scale."
              }
            >
              {t(
                "Translucent glass carries the page's color and light beneath sharp, readable text. Headings, paragraphs, formulas, and code share a consistent type scale.",
              )}
            </p>
            <span className="eyebrow" data-ui={'A quieter layer'}>
              {t('A quieter layer')}
            </span>
          </section>
          <section className="component-card reading-surface" id="outline-specimen">
            <h2 data-ui={'Article outline'}>{t('Article outline')}</h2>
            <p
              data-ui={'A floating reading companion, with a current section and nested headings.'}
            >
              {t('A floating reading companion, with a current section and nested headings.')}
            </p>
            <details className="outline-card glass-panel" open>
              <summary>
                <Icon name="Menu" size={14} />
                <span data-ui={'On this page'}>{t('On this page')}</span>
                <Icon name="ChevronDown" size={13} className="outline-chevron" />
              </summary>
              <nav
                aria-label={t('Example outline')}
                data-ui-attrs={'{"aria-label":"Example outline"}'}
              >
                <a href="#outline-specimen" aria-current="location" data-ui={'Article outline'}>
                  {t('Article outline')}
                </a>
                <a href="#material-controls" data-ui={'Controls'}>
                  {t('Controls')}
                </a>
                <a href="#reading-material" data-outline-level="3" data-ui={'Reading material'}>
                  {t('Reading material')}
                </a>
              </nav>
            </details>
          </section>
          <section className="component-card reading-surface">
            <h2 data-ui={'Archive timeline'}>{t('Archive timeline')}</h2>
            <ArchiveTimeline
              entries={chronologicalEntries(entries).slice(0, 3)}
              compact
              collections={site.collections}
            />
          </section>
          <section className="component-card glass-panel">
            <h2 data-ui={'Regular glass'}>{t('Regular glass')}</h2>
            <p
              data-ui={
                'Blur, a soft edge highlight, and a subtle shadow establish a functional layer above the page.'
              }
            >
              {t(
                'Blur, a soft edge highlight, and a subtle shadow establish a functional layer above the page.',
              )}
            </p>
            <div className="component-row">
              {(['Search', 'SunMoon', 'FlaskConical', 'Image', 'Settings2'] as IconName[]).map(
                (n) => (
                  <button key={n} className="icon-button" aria-label={n}>
                    <Icon name={n} />
                  </button>
                ),
              )}
            </div>
          </section>
        </div>
        {interactiveRegistry.map((d) => (
          <div
            key={d.type}
            dangerouslySetInnerHTML={{
              __html: renderInteractive(
                d.example,
                renderIcon,
                `specimen-${d.type}`,
                d.type === 'chart' ? specimenSvg : undefined,
              ),
            }}
          />
        ))}
      </>,
      { noindex: true },
    );
  }
  const routes = [
    '/',
    collectionIndexRoute('posts', site.collections),
    collectionIndexRoute('lab', site.collections),
    collectionIndexRoute('life', site.collections),
    '/archive/',
    '/projects/',
    '/search/',
    '/about/',
    '/settings/',
    '/tools/',
    ...entries.map((entry) => routeFor(entry, site.collections)),
    ...tags.map((t) => `/tags/${encodeURIComponent(headingSlug(t))}/`),
    ...photoAlbums.map((a) => albumRoute(a, site.collections)),
  ];
  const entriesByRoute = new Map(
    entries.map((entry) => [routeFor(entry, site.collections), entry]),
  );
  const tagsByRoute = new Map(
    tags.map((tag) => [`/tags/${encodeURIComponent(headingSlug(tag))}/`, tag]),
  );
  const albumsByRoute = new Map(
    photoAlbums.map((album) => [albumRoute(album, site.collections), album.name]),
  );
  function render(current: string) {
    if (current === '/') return home();
    if (current === collectionIndexRoute('posts', site.collections)) return archive('posts');
    if (current === collectionIndexRoute('lab', site.collections)) return archive('lab');
    if (current === collectionIndexRoute('life', site.collections)) return life();
    if (current === '/archive/') return chronologicalArchive();
    if (current === '/search/')
      return document(
        '/search/',
        'Search',
        <section className="search-page">
          <header>
            <span className="eyebrow" data-ui={'Explore the notebook'}>
              {t('Explore the notebook')}
            </span>
            <h1 data-ui={'Search'}>{t('Search')}</h1>
          </header>
          <div className="glass-panel" data-search-page>
            <div className="search-top">
              <Icon name="Search" />
              <input
                type="search"
                aria-label={t('Search this site')}
                placeholder={t('Search writing, projects, albums, and code…')}
                autoComplete="off"
                data-ui-attrs={
                  '{"aria-label":"Search this site","placeholder":"Search writing, projects, albums, and code…"}'
                }
              />
            </div>
            <div className="search-results" aria-live="polite" />
          </div>
        </section>,
        { noindex: true },
      );
    if (current === '/projects/')
      return document(
        '/projects/',
        'Projects',
        <ProjectsPage
          projects={(model.projects?.projects || []).filter(
            (p) => p.visibility === 'public' || rendererOptions.includeDrafts,
          )}
        />,
      );
    if (current === '/about/') return aboutPage();
    if (current === '/tools/') return document('/tools/', 'Tools', <ToolsPage/>);
    if (current === '/settings/')
      return document(
        '/settings/',
        'Reader settings',
        <ReaderSettings
          theme={site.theme}
          readingHtml={specimens.en.reading}
          materialsHtml={specimens.en.materials}
          translations={specimens}
          languageControls={site.localization.enabled}
          aca={site.integrations.aca}
        />,
        {
          noindex: true,
        },
      );
    if (current === '/__components/') return components();
    const entry = entriesByRoute.get(current);
    if (entry) return article(entry);
    const tag = tagsByRoute.get(current);
    if (tag) return archive('posts', tag);
    const album = albumsByRoute.get(current);
    if (album) return life(album);
    return document(
      '/404.html',
      'Page not found',
      <section className="not-found">
        <span className="eyebrow" data-ui={'An unwritten page · 404'}>
          {t('An unwritten page · 404')}
        </span>
        <h1 data-ui={'A little off the path.'}>{t('A little off the path.')}</h1>
        <p data-ui={'This page has wandered off. There’s still plenty to explore.'}>
          {t('This page has wandered off. There’s still plenty to explore.')}
        </p>
        <a className="button primary" href="/">
          <UiText message={'Back to the notebook'} />
          <Icon name="ArrowRight" size={15} />
        </a>
      </section>,
      { noindex: true },
    );
  }
  const search = entries.map((e) => ({
    title: e.title,
    summary: e.summary,
    tags: e.tags,
    kind: e.kind,
    kindLabel: site.collections[e.kind].singular,
    url: routeFor(e, site.collections),
    text: e.rendered.html
      .replace(/<(svg|noscript|style|script|pre)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(
        /&(?:amp|lt|gt|quot|#39);/g,
        (value) =>
          ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[value] || value,
      )
      .replace(/\s+/g, ' ')
      .slice(0, 12000),
  }));
  return {
    render,
    routes,
    entries,
    search,
    about,
    site,
    library,
    json: scriptJson,
    pruneCache: compiler.prune,
  };
}
