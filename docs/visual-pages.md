# Visual pages

Public navigation has exactly five destinations, in order: Home `/`, Archive `/archive/`, Projects `/projects/`, Life (configurable name and prefix, default `/life/`), About `/about/`. Writing, Lab and tag routes activate Archive. Those routes remain valid; the five public tabs do not limit Studio navigation. Legacy configuration is accepted, but a settings save writes the canonical five links using the current Life collection settings.

## Homepage

Studio → Homepage owns the defaulted `site.home` composition. Missing `layout` selects `profile`; `chapters` preserves the visual alternative. Switching layouts retains both sets of options and all curated slides. About remains the sole editor of profile content. Home uses the shared `ProfileHeader`, never a second biography or identity record.

Profile layout shows the name and headline, followed by recent published writing inside one calm glass panel. `home.profile` controls `showPortrait`, `showRole`, `showLocation`, `showAffiliations` and `showLinks`; all default on except affiliations. Social/contact links preserve About's external navigation and protected-email behavior. The About link and archive link stay available.

`home.recent` defaults to `sources:['posts','lab']`, `limit:6`, `showSummary:true`, `showDate:true`, `showCover:false`. Sources must be unique and nonempty; the limit is 1–12. Select by publication date descending, then title and stable ID, through the shared chronological selector. Drafts and scheduled entries are excluded, and modification dates do not change order. Use configured collection labels/routes and respect an entry's hidden publication date. Optional covers are bounded thumbnails; rows without covers retain their text space. Empty notebooks show a quiet message with the archive link. The entire composition remains useful without JavaScript.

`home.pinned` defaults to `[]`: up to 12 unique, ordered stable entry IDs. Studio → Homepage → Pinned writing selects from either writing collection, with title/topic search and keyboard-accessible reorder/remove controls. In profile layout, published pins appear first with a small Pinned marker, followed by up to `home.recent.limit` remaining entries. Recent source filters apply only to the remaining entries; a pin from either collection stays visible without duplication. Pins affect this homepage only, not Archive, collection indexes or feeds. Keep missing, trashed, draft and scheduled references in settings, show their state in Studio, and omit them from public output until available and published. Title/slug changes preserve a pin; switching to visual chapters retains pins without displaying an extra writing section. No per-entry pin flag is written.

Homepage saves own only `home` through the existing revision-checked site endpoint. Rebase unrelated site/profile updates, preserve edits made during a save, and block conflicting external homepage changes with a visible reload action. Navigation, profile navigation, keyboard save and Build flush the active homepage draft. Unsaved preview uses the production renderer and shared preview controller with responsive, tablet and phone widths; it never writes content or loads external providers.

`home.motion` accepts `subtle` (default) or `off`. Subtle uses a 400ms opacity/8px entrance for the profile and writing rows, with a bounded 35ms stagger, or the first chapter's introduction. There is no autoplay or scroll-driven JavaScript. Author/reader reduced motion and the system preference override this entrance. Hover/focus retains shared quiet material feedback.

### Visual chapters

`site.home.slides` is an ordered array of stable chapter records. `null` means derive up to three published entries with covers and three Life photos; an empty array renders a quiet welcome chapter. A record has `id`, `source` (`entry`, `photo`, `custom`), stable `reference`, `enabled`, optional overrides `image`, `title`, `caption`, `alt`, `href`, and `focalX`/`focalY` percentages. Blank overrides use source values. Missing and unpublished entry references are omitted, with a Studio notice. Never resolve drafts into public slides. Duplicate chapter IDs are invalid.

Curate chapters in Studio → Homepage → Visual chapters. Reorder with Up/Down, duplicate, disable, or remove before saving. Pick an image and adjust its focal point. Use one concise title and caption; imagery carries the page. Do not append profile/writing sections beneath the chapters; the two layouts are alternatives. A quiet footer and shared navigation remain.

The homepage is a normal static document with viewport-height chapters, proximity scroll snapping and anchor links. It does not intercept wheel gestures or autoplay. The first image receives eager/high-priority loading; later images load lazily. Public builds include intrinsic dimensions and responsive images. Reduced motion removes animated travel. Verify 390px, tablet, and desktop compositions, caption contrast, top navigation, and the safe area near the chapter indicator.

## Archive

Archive, collection indexes and tag pages open directly with filters and entries, without a visible title or introduction. Retain a screen-reader heading and a compact gap below the shared navigation. Collection names, filters, badges and article paths use `site.collections`; see [collection settings](site-settings.md#content-names-and-paths). The five main navigation destinations remain fixed.

Archive is derived from published entries, sorted deterministically by date, title and stable ID. The shared timeline has a sticky year rail, month groups with prominent 14px markers, and publication days. Covers are always visible inside their entry: a thumbnail beside the text on wider screens, and a full-width image above it on phones. Entries without covers keep the full text width. Hover and keyboard focus provide subtle surface feedback without moving covers or changing the layout. Mobile years form a horizontally scrollable sticky selector. Keep entries as calm editorial rows rather than alternating cards.

The public filters persist `q`, `kind=posts|lab`, and `tag` in the URL. Back/reload restores filters. Hidden entries must also hide empty months/years and update counts. The year rail tracks the visible year and reading progress. Without JavaScript, every published entry remains in chronological order and year anchors work.

## Post and topic indexes

The configured Posts index and `/tags/{topic}/` use the scoped listing layout, independently of the chronological Archive and Lab index. `site-main` shares the navigation/footer gutters and configured page-width limit, with 48px clearance below navigation on desktop and 32px on phones. The page fills at least the viewport, keeping the footer near the bottom for short or empty lists without stretching cards. No visible archive heading returns; a topic has only a compact context label and a link to the configured Posts index. `/tags/` is not a generated topic directory.

Keep three equal grid tracks on desktop, two at 1000px and below, and one at 680px and below. Covers have a stable 16:9 frame; coverless cards remain typographic. Card footers align within each row, long titles/topics wrap, and hover/focus use shared glass feedback. The desktop toolbar places topics beside search; phones place full-width search above a contained horizontal topic strip. Scoped filtering updates the configured singular/plural labels and distinguishes an empty notebook from an unmatched search. No JavaScript still exposes all entries. Preserve shared motion/transparency preferences, five-destination navigation and custom collection paths.

## About

`content/about.md` is a fixed-route Markdown page, separate from post frontmatter. When absent, read-time fallback uses the current profile name, biography and links; no biography is invented. An intentionally empty existing file stays empty.

`GET /api/pages/about` and `PUT /api/pages/about` use `{body, revision}`. Writes are atomic and reject stale revisions. `GET /api/pages/about/revisions` returns earlier Markdown, revision, reason and savedAt. `POST /api/pages/about/restore` accepts `{selected, revision}` and records the replaced version. Private history lives under `.studio/pages/about`.

Studio reuses the Markdown source editor, production preview, component Composer and lazy CodeMirror comparison. Navigation/build flushes edits. External changes preserve dirty text and expose Reload latest About. Preview requests accept `{route:'/about/', body}` and never load discussion providers.

The public page has an unframed profile header (portrait, name, headline, role, location, optional affiliations and icon-labeled social links), followed by one continuous Markdown reading panel. Affiliations belong inside `.about-introduction` between the metadata and social links: compact icon-led rows with wrapping organization names and quieter descriptions. About social links open externally with `target="_blank" rel="noopener noreferrer"`; preserve native handling of email links. Do not create another section below the story. A leading Markdown H1 exactly matching the profile name becomes the header title; keep its existing anchor and omit only that duplicate from rendered prose. Other story headings move down one level. The canonical file is never rewritten for this presentation change. About uses the site description for search and sharing metadata. Studio has no separate short-biography field; write the biography in Story. Legacy `profile.bio` is accepted and preserved only for the missing-file fallback, defaults to an empty string when omitted, and is not independently rendered or collected as public media.

Profile controls belong in Studio → About, beside Story and Guestbook, and are removed from Site settings. Profile values remain at `site.profile`; guestbook options are defaulted under `site.about.guestbook` (`enabled:false`, title and description). The guestbook requires globally enabled Giscus and uses the stable `page/about/guestbook` mapping. It stays disabled in private previews.

Profile also owns optional contact email and default-on click-to-reveal protection. Protected mail links use a lazy native glass dialog; ordinary external social links retain native navigation. The exact coverage and generated search behavior are in [Studio operations](studio-operations.md).

Save About, keyboard save, navigation and Build flush both the page and owned site settings. Track each revision separately and preserve either remaining draft after a partial save. Reload latest About affects the story only; Reload latest profile and guestbook affects those settings only. Unrelated external site changes rebase safely, while conflicting profile/page changes require explicit resolution. Story revisions compare and restore Markdown only.

## Live Markdown preview

`LivePreview` and `useLivePreview` are shared by articles and About. The current document stays visible until its replacement has loaded and restored its reading anchor. Ignore stale request generations, keep the last successful preview on errors, and bound requests to 12 seconds. Preview documents alone carry source-range markers generated from the sanitized syntax tree and retained through code, math and widget transformations; published pages never expose them.

Preserve the visible source block, its relative position within the block, and its screen coordinate across updates. Map ranges through CodeMirror changes, with a nearest-block/proportional fallback for deleted passages or external restores. Reapply the anchor after content/viewport geometry changes without fighting manual scroll. Hidden panes must not replace their remembered anchor with zero-size geometry. Write/Split/Preview and device changes retain position; another document starts fresh.

Follow editor is optional, off by default, and stored locally by workspace. It follows source scrolling/caret changes in one direction; preview scrolling never moves the source editor. About previews include unsaved profile and guestbook changes via `{route:'/about/', body, site}`. Native `[hidden]` behavior is enforced by shared styles.
