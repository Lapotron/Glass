# Article settings

**Settings** sits beside Write, Split and Preview in the Markdown editor's view selector. It fills the existing workspace and uses the configured collection's singular name. General, Cover, Reading, Discussion and Sharing use a quiet section sidebar on desktop and a horizontal tab strip on phones. The fields scroll independently above a stable save footer. Source and settings stay mounted: selection, scroll, undo history, the selected section and invalid drafts survive view changes. Back to editor returns to the last editing view and focuses its mode button. The existing revision-checked autosave owns every change; navigation/build still requires a successful flush. Native media pickers and image viewers retain their own focus containment and Escape behavior.

## Frontmatter and inheritance

`entrySchema` validates optional groups in canonical YAML. Reading/typography fields omitted from a group inherit the current site configuration; `false` and `0` are overrides. Clearing/resetting removes the override. No read/build migration rewrites old files. `resolveEntrySettings` is the shared resolver for preview, generated output and discussion eligibility. The authoring capabilities/pack expose the input `entrySchema` for external converters.

| Group          | Fields and behavior                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coverOptions` | `alt` (up to 500 chars; fallback article title), `caption` (up to 1000 chars), `visible` (default true), `ratio` (`default`, `wide`, `landscape`, `original`), `focalX`/`focalY` (0–100, default 50). Default preserves the legacy panorama; wide is 16:9, landscape 3:2. |
| `reading`      | Optional `outline`, `progress`, `readingTime`, `publishedDate`, `modifiedDate`, `articleFooter`, `author`, `codeLineNumbers` booleans and `relatedCount` (integer 0–4). Inherits site reading settings.                                                                   |
| `typography`   | `fontFamily` (`system`, `serif`, `humanist`), `articleWidth` (640–960px), `lineHeight` (1.55–2.15), `paragraphSpace` (0.8–1.8em). Inherits site theme values; does not change materials or interface scale.                                                               |
| `discussion`   | `article`, `blocks`, `annotations` independently default true, gated by both `comments` and site Giscus enablement. Blocks still require explicit `comments="true"` and a stable directive key.                                                                           |
| `seo`          | Optional `title` (160 chars), `description` (500 chars), `image` (local `/media/` or credential-free HTTPS), `imageAlt` (500 chars), `indexing` (`inherit`, `noindex`). Blank text inherits title/summary/site description.                                               |

Title and summary are the first General section; the source pane no longer duplicates these inputs. The context header separates collection/status, a wrapping title and the canonical path. Title edits update the breadcrumb and preview through the same autosave path without remounting the source editor.

Existing publication fields, tags, language, sample label, canonical/short links, aliases and optional `updatedAt` are in General. `updatedAt` is a calendar date for modified-time metadata; clearing it restores the publication-date fallback. Retired `featured` remains compatible on disk and has no editor control.

```yaml
cover: /media/coast.webp
coverOptions:
  alt: Evening light along the coast
  caption: A small pause on the way home.
  ratio: wide
  focalY: 35
reading:
  codeLineNumbers: true
  relatedCount: 0
typography:
  fontFamily: serif
  articleWidth: 720
discussion:
  article: false
  annotations: true
seo:
  description: A closer look at changing light.
  image: /media/sharing.webp
  imageAlt: The coast at sunset
```

## Output and reader preferences

Effective article typography is embedded in `reader-defaults` and static `ThemeStyle` before paint. Browser-local reader overrides and system accessibility preferences retain priority. Private previews ignore reader overrides. Site-level settings and other pages keep the site theme. An outline still tracks headings when progress is disabled.

Cover framing never edits media bytes. Hiding the hero retains the archive/social image. The editor preview and public hero open the existing viewer; public cover anchors also work without JavaScript and preserve modified clicks. Archive/home covers retain navigation. Reuse one top-layer viewer toolbar, downloads, metadata and focus restoration above the settings workspace or media picker.

Sharing title changes document/OG/Twitter titles, not the visible heading, feed title or discussion identity. Sharing images fall back from explicit entry image to cover to site image; each source keeps its corresponding alt text. Metadata-only media enters the build/CDN manifest and active, revision and Trash reference protection. Local/private original files stay outside public output.

Article `noindex` also removes its route from the sitemap, while Archive, feeds, search and direct links remain available. It cannot override site-wide noindex and is not a privacy setting. Previews remain noindex and provider-free.

Discussion switches control their matching buttons, panels and frames. Annotation-only pages select the annotation tab initially. Disabling annotations removes line controls, annotation tabs and the article ID from both local and built worker allowlists. Stable Giscus mappings remain independent of configurable public collection paths.

## Verification

Use isolated notebook fixtures for metadata round trips, revision/conflict handling, reset previews, sharing-only assets, sitemap behavior and all discussion combinations. Browser checks cover tab keyboard access, desktop/320px geometry, invalid-draft preservation, nested cover viewer focus, inherited typography and public output. Never mutate the author's notebook to test these controls.

Article-footer grouping, modified-date inheritance and private-preview action gates follow [article footer](article-footer.md).
