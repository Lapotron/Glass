# Site settings

Studio → Site settings owns public details around the notebook. About owns the profile, affiliations, story and guestbook; Homepage owns composition, ordered pinned writing and visual chapters; Appearance owns materials, typography and reading controls. Credentials and local launch settings remain private and revisioned independently.

## Configuration and preview

Settings use focused sections under General, Presentation, Discovery, Services, Publishing and Local Studio. Each section has a stable `#settings/{id}` address, with a searchable glass rail on desktop and a native section picker on narrow screens. Appearance follows the same shell at `#appearance/{id}`. The save row stays in normal flow at the full detail-column width. Hidden private-service drafts remain mounted and revision-safe. Validation reveals the affected section before focusing the field.

Languages separates the default authored-content language from reader/Studio interface preferences and optional Chinese collection labels. Follow [localization](localization.md). The Studio language button menu and public-site link live in the topbar beside appearance; the sidebar footer keeps Trash and local status.

Version 1 `SiteConfig` accepts defaulted `collections`, `language`, `localization`, `branding`, `metadata`, `navigationTools`, `footer` and `feeds` groups. Defaults live in `src/shared/collections.ts` and `src/shared/site-settings.ts`. Missing groups and partial nested groups load without rewriting files; a settings save persists the normalized configuration through the existing revision check.

General retains the name, description and canonical HTTPS origin. Languages owns the default authored-content `language`, a BCP 47 tag used for metadata, general-page prose, the web manifest and feeds; articles retain their frontmatter language. The Public language controls switch saves `localization.enabled`, defaulting on for existing notebooks. Off keeps public UI English and removes both choosers; Studio language remains available. See [localization](localization.md) for cache, preview and build behavior.

Preview site renders unsaved configuration through the production renderer in a native modal. Previews are noindex, omit providers/verification tags, and use selected local artwork directly. Generated icons update on the next successful build. Closing or leaving aborts the request. Tab changes retain drafts; saving, navigation and builds preserve the shared flush/conflict behavior.

Studio → Appearance → Wallpaper treatment configures `theme.wallpaperWash`: Automatic (`auto`, the legacy default), Light or Dark. It sets the site's wash independently of theme appearance, with unsaved preview, revision-checked saving and static output. Reader settings can override it per browser; resetting readers' background controls restores the current site default. See [reader preferences](reader-preferences.md) for the shared contrast and inheritance rules.

## Content names and paths

Studio → Site settings → Collection names & paths configures `collections.posts`, `collections.lab` and `collections.life`. Each group has `name` (plural or collective, 1–40 characters), `singular` (one item, 1–40 characters), `path` (one root segment) and retained `aliases`. Defaults are Writing / Entry / `blog` and Lab / Experiment / `lab`; Life defaults to Life / Moment / `life`. For Posts and Articles, use Posts / Post / `post` and Articles / Article / `article`. These names affect Studio navigation, creation/import tools, the editor, Archive filters and badges, search, Trash, feeds settings and build counts. The public navigation retains five destinations: Home, Archive, Projects, the configured Life collection, About.

Paths accept optional surrounding slashes and normalize to lowercase on preview/save. Use 1–48 ASCII letters, digits or hyphens, beginning with a letter. System paths such as `archive`, `about`, `settings`, `tags`, `s`, `api`, `studio`, `media` and `assets` are reserved. A collection cannot claim another collection's current, original or earlier path, including the original `life` prefix. Display names may use any language. Internal kind IDs, Markdown folders/files, stable entry IDs, revisions and backup contracts stay unchanged.

An ordinary revision-checked site save automatically retains the preceding prefix and its history, even when an older client omits that history. Each collection permits 40 saved aliases plus its original namespace. The original `blog`, `lab` and `life` namespaces always remain associated with their original collections. Returning to a previous prefix makes that prefix canonical and retains the one being replaced. Direct JSON edits must retain non-original aliases explicitly.

The next build emits only canonical pages and native Pages 301 redirects from earlier collection indexes and article paths, directly to the latest prefix. Names/path changes affect unsaved previews as well as generated HTML, canonicals, JSON-LD, homepage chapters, related links, search, all feed formats, sitemap and stable short-link destinations. Authored Markdown URLs are not rewritten. Redirects use the [Pages static and dynamic rule format](https://developers.cloudflare.com/pages/configuration/redirects/); the combined static count includes collection indexes and short links. Link validation accepts only known aliases of published destinations, so a wildcard redirect cannot disguise a missing or unpublished article. The local preview server mirrors the accepted artifact’s redirects and preserves query strings. Unsaved or unbuilt path changes cannot redirect readers away from the previous accepted build.

Article-wide Giscus conversations retain their established `/blog/{slug}/` or `/lab/{slug}/` specific term, independently of the visible path. Section/line annotations retain their stable entry IDs. A collection rename therefore keeps existing threads discoverable. Build results optionally capture `entryRoutes` for publication verification and `collectionNames` for historical counts; older results remain readable.

Life names and paths use the same retained-prefix contract. Its singular name labels the add-photo action. The configured prefix drives journal and album pages, Studio album links, homepage photo links and sitemap; earlier prefix/album alias combinations redirect directly to current albums. Photo IDs and library data stay unchanged. The original default path remains reserved for Life, and retained prefixes share Pages' 100-dynamic-rule limit with writing collections.

## Branding

| Field                                     | Effect                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `shortName`                               | Manifest/application title; blank uses the site name.                                                            |
| `favicon`                                 | Local raster artwork for generated browser and home-screen icons.                                                |
| `iconStyle`, `monogram`, `iconBackground` | Notebook/monogram fallback and opaque icon background. Monograms display up to two Unicode code points.          |
| `logo`, `darkLogo`                        | Shared header/footer mark and optional dark alternate. The alternate requires a primary logo.                    |
| `showName`, `namePeriod`                  | Site name and accent period. Accessible home-link names remain present.                                          |
| `themeColorLight`, `themeColorDark`       | Browser chrome synchronized with the reader's appearance.                                                        |
| `appBackground`, `appDisplay`             | Saved-shortcut launch background and browser/minimal-ui/standalone display. These do not enable offline caching. |

New artwork is local PNG, JPEG, WebP, AVIF or GIF. Every upload uses shared crop/resize review and private original retention. The restricted picker excludes SVG/PDF without changing existing gallery support. Icon/logo generation uses the first frame, strips embedded metadata, and never accepts executable custom markup.

The engine generates `favicon.svg`, `favicon.ico` (16/32/48 px), 16/32 px PNGs, `apple-touch-icon.png` (180 px), 192/512 px app icons and a separate 512 px maskable icon with a central safe area. Custom favicon SVG contains only an embedded, freshly encoded PNG; fallback SVG is engine-owned. Logos become at most 128 × 128 PNGs under `assets/`. Readers never resize original logo artwork.

`site.webmanifest` references generated icons. Versioned icon/logo URLs derive from rendered bytes and settings, including replacements at the same canonical path. Files stay on Pages with revalidated caching. Source artwork is copied publicly only if another feature references it; private originals stay private. Missing/undecodable artwork fails before accepted output is replaced.

## Metadata and sharing

`metadata.homeTitle` overrides the home title. Other titles use `titleTemplate`, requiring `{title}` and optionally `{site}`; unknown placeholders are invalid. Open Graph/Twitter metadata includes the resulting title, description and absolute canonical URL. Optional `locale` overrides the locale derived from the page language.

`socialImage` supplies fallback sharing artwork; article sharing images and then covers take priority. See [article settings](article-settings.md). `socialImageAlt` describes the fallback only; article covers use their configured alt text with the article title as fallback. Sharing-only media enters the build even without a body/gallery reference. Site/creator handles and `twitterCard` configure cards without a provider script.

`indexing`, `followLinks`, `maxImagePreview` control robots metadata. `sitemap` emits `/sitemap.xml` only when indexing is enabled. Reader settings and missing pages stay noindex/outside the sitemap. `robots.txt` allows crawling so robots can read noindex directives; these settings do not make a public site private.

`structuredData` emits safe WebSite/BlogPosting JSON-LD on normal public pages, with article dates, language, URL and optional image/author. `author` controls profile author metadata independently of the visible article author. Draft/local previews omit JSON-LD. Verification fields accept only Google/Bing content tokens, never raw HTML. Search providers may take time to apply changed metadata.

R2 preparation resolves accepted media URLs in Open Graph/Twitter tags, article JSON-LD and JSON Feed images through the frozen delivery manifest. It preserves canonical source, ordinary prose and Pages icon URLs.

## Navigation and footer

`navigationTools` independently enables search, appearance and reader-settings shortcuts. Disabling search removes its button/dialog/keyboard action. Hiding the settings shortcut leaves `/settings/` accessible directly. Public destinations remain Home, Archive, Projects, the configured Life collection, About.

`footer` controls the tagline, brand, copyright name/start year, ordered profile-link visibility/limit and feed links. Blank copyright uses the About profile name. Up to eight additional label/address pairs support HTTPS, mailto and local links with reorder/remove controls. External-tab behavior applies to HTTPS footer links with `noopener noreferrer`; About's external links remain independent. Long links wrap within the shared glass footer.

## Feeds

`feeds` independently enables RSS 2.0 (`/feed.xml`), Atom 1.0 (`/atom.xml`) and JSON Feed 1.1 (`/feed.json`). Discovery/footer links list only enabled formats; replacement builds remove disabled files. If authored Markdown still links to a disabled feed, the build gives the affected route and directs the author to enable the format or update the link, preserving the last accepted output.

Title/description overrides fall back to site values. Kind switches include writing/Lab; the limit selects 1–200 recent published entries with deterministic date/ID ordering. Content is a summary, not an interactive article copy. Drafts, scheduled entries, About and settings stay out. When profile authors are disabled, Atom identifies the site as its required author. See [Atom](https://www.rfc-editor.org/rfc/rfc4287#section-4.1.1) and [JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/).

## Validation

Checks cover defaults/validation, preview/persistence/conflicts, rendered metadata/controls, icon dimensions/metadata removal, feed filtering, R2 rewriting and artifact replacement. Browser checks exercise crop/upload, unsaved preview, save/reload/build, icon files, XML parsing, themes, accessible labels and phone overflow.

Tests copy stable `tests/fixtures/notebook/` samples into temporary workspaces. They never clone, restore, publish or mutate the author's live notebook. The fixture uses generic Markdown/JSON and original SVG illustrations, so author content/identity changes cannot invalidate test assumptions. Production builds still use the selected notebook.

The isolated Studio fixture listens on port 4387. Pages header/routing checks use a second temporary sample artifact on port 4174; they never reuse the author’s normal `dist/` preview on 4173. Both fixtures clean up their temporary notebooks on exit.
