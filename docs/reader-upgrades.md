# Projects, search, code, and discussion presentation

These features extend the custom static engine. Studio remains local; generated pages work without the editing application. The root Cloudflare Pages Direct Upload workflow is unchanged.

## Projects

`content/projects.json` is a versioned collection: `{ "version": 1, "projects": [] }`. A missing file reads as an empty collection without creating or rewriting a file. The executable contract is `src/shared/projects.ts`.

Each record has a stable `id`, `title`, `description`, `technologies`, development `status`, independent `visibility`, optional canonical `/media/` cover and alt text, HTTPS links, optional `owner/repository`, and imported update time. Array order is the manual display order. Development status never publishes a draft. Only `visibility: public` enters `/projects/`, search, and public media references. Existing notebooks receive no invented project records.

Studio → Projects supports creation, editing, ordering, cover selection through the shared media preparation workflow, unsaved private preview, reviewed removal, save, and undo of the last save. Saves use their own digest revision and the Store transaction queue. External changes preserve a dirty draft and require an explicit reload. Navigation/build flush the active draft. Undo is restart-safe and revision-checked. Portable backups include the collection and recovery records; reset clears them while preserving site and connection settings. Media maintenance retains active and recoverable project images.

The technologies field preserves raw text and the caret while typing, including trailing commas and spaces. Preview and persistence receive the normalized array; blur formats the field. External reload, undo and reviewed imports show their actual technology values rather than a stale text draft. Verify with individual keystrokes and save/reload, since filling a complete value hides separator-input regressions.

Public GitHub import/refresh is explicit and read-only. Only a validated public `owner/repository` is fetched from the fixed GitHub API origin. The server caches results for five minutes, bounds request time and response size, and reports rate limits. Imports start as drafts. Refresh presents selectable title, description, technologies and links; it preserves ID, order, visibility, cover and development status. There are no reader-side GitHub requests or automatic scheduled replacements.

Navigation order is Home, Archive, Projects, the configured Life/Albums destination, About. `/projects/` is reserved against collection-path collisions.

## Full-text search

The old engine searched 12,000-character plain-text excerpts with a linear substring scan. Pagefind now indexes complete rendered published documents, including visible code, plus About, public projects, album names/descriptions and photo captions. Drafts, Studio, revision history, utility pages, navigation chrome, SVG paths, hidden text, duplicate code gutters/toolbars and protected email destinations stay outside the index. `/search.json` remains as a compatibility output; the reader uses Pagefind.

Each language gets its own native Pagefind index and tokenizer under `/assets/search/<content fingerprint>/<language>/`. Glass queries these independently and interleaves results by rank position, rather than comparing incomparable language-specific scores or merging Chinese into an English WASM instance. Entry `lang` remains authoritative; keep it correct for Chinese documents. About/projects/albums use the configured site language.

The index is generated and validated inside the pending build artifact before that artifact is accepted. `/assets/search-manifest.json` is revalidated, and each fingerprinted index is immutable. Its fingerprint includes the indexer implementation and dependency lock as well as content, so tokenizer/configuration updates cannot reuse old immutable URLs. Studio public search uses the accepted artifact; Build refreshes it. It never silently indexes unsaved private content.

Search opens on intent with Cmd/Ctrl+K, keyboard result navigation, excerpts, section links, pagination, and content/topic/language filters. `/search/?q=...&type=...&topic=...&language=...` is a shareable noindex utility outside the sitemap. Native Pagefind stemming, prefix matching and query syntax apply. A failed module/index load preserves the query and offers retry. Dynamic module retries use fresh import URLs, and a changed artifact uses its new fingerprint.

CSP permits WebAssembly compilation with `wasm-unsafe-eval` and self/blob workers; it does not permit JavaScript `unsafe-eval`. Pagefind bundles, code styles, Projects styles and search UI styles are separate from the initial reader payload.

## Code blocks

Expressive Code 0.44.3 renders syntax, file/terminal frames, markers, and folded sections at build time. No highlighter enters the browser. Unknown language identifiers fall back to safe plain text. Math, interactive JSON, Mermaid and mind maps retain their dedicated compiler paths.

````markdown
```typescript title="src/example.ts" {2} ins={3} del={4} collapse={5-8} wrap
const input = 1;
console.log(input);
const added = true;
const removed = false;
// Longer setup can be folded.
// ...
// ...
// ...
```

```bash title="Terminal" frame="terminal"
npm run build
```
````

Legacy `title="..." {2,4-6}` remains supported. `mark="text"` emphasizes text; `showLineNumbers=false` hides a block's numbers. A single folded line uses `collapse={5-5}`. The shared authoring catalog exposes metadata completions and external generation capabilities.

Each block has one dense header. Filename/caption and an optional language badge share a row with icon/text controls; long names truncate with a full title tooltip. Phones retain named icon controls. Copy/download gather only original code lines, preserving indentation and excluding gutters, markers, fold summaries and UI. Wrap changes presentation only. Line permalinks and annotation targets reveal folded content. Reader line-number preferences remain effective. Print expands code and removes controls.

The adapter removes `has-title` only from `figure.frame` inside Expressive Code, avoiding the provider's editor-tab chrome while preserving any other title classes. The custom filename row remains visible independently of that class.

Annotation identity uses the same `code` + rendered source text hash and occurrence as the previous Shiki `.line` adapter. EC source lines use `data-code-line`; fold summaries and control text never become source lines or alter those hashes.

## Giscus

Custom themes follow [Giscus advanced usage](https://github.com/giscus/giscus/blob/main/ADVANCED-USAGE.md#data-theme). The engine generates self-contained light/dark Primer and syntax variables plus the dedicated `src/site/giscus-theme.css` component styles. Materials use the shared contrast resolver's atmosphere tint/canvas and the site's accent, opacity, interface scale and radius. Editor tabs, fields, sign-in/actions, inner comment cards, continuous replies, reaction chips/menus, pagination, Markdown, focus/disabled and reduced-material/motion states form one maintained set. No remote theme import is required. The outer discussion panel carries Liquid Glass depth; the iframe's inner materials remain transparent and readable.

Theme URLs are fingerprinted under `/assets/themes/`, with public CSS MIME, CORS and immutable caching. A theme change produces a new fingerprint. Legacy fixed CSS URLs remain available with revalidation. An active HTTPS origin supplies the custom theme after MIME/CORS checks; local or failed theme requests use supported Giscus built-ins. An open conversation responds to runtime theme changes.

The parent Glass panel carries the main material. Giscus keeps its HTML/body/main canvas and structural editor/comment wrappers transparent; individual comment/editor insets use only a light environmental tint, bounded at 8% in light mode and 12% in dark mode. There is no minimum opacity when the author lowers glass opacity. Tabs, controls and code share those inset tokens instead of stacking Primer's white/gray fills. Popovers and primary actions retain their readable roles, and reduced transparency deliberately uses a solid fallback. Check actual composited screenshots after theme CSS finishes loading, plus a provider-style opaque utility class on the inner editor; canvas transparency alone does not prove clear inner surfaces.

Both the widget host and exposed iframe part inherit the page color scheme, overriding the SDK's `light dark` styles on both layers. This prevents Chromium's opaque dark compositing fallback when the embedded theme uses dark mode. Check both layers' computed schemes after light/dark switches and inspect actual composited pixels in addition to document backgrounds.

Real sign-in anchors carry important provider corner utilities. The maintained theme explicitly keeps actions at 10px and editor tabs at 9px, with the same provider utility modeled in the Studio regression specimen. Preview readiness includes the iframe's actual load, so a theme switch cannot report the old document as ready.

Studio's Preview discussion styles dialog provides a sandboxed Light/Dark specimen without GitHub access, including local sample editor and reaction states. It uses the current appearance draft and the same generated styles. A real local Giscus iframe still uses its supported fallback; publish the generated HTTPS theme assets to apply the custom set to live conversations.

Article, section and exact-line thread mappings, isolated frames, annotations/counts, OAuth restoration and provider fallbacks retain their existing contracts. Updating appearance does not enable discussions or post comments on the author's behalf.
