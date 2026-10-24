# Image viewing and editing

Studio's missing/unused usage graph and reviewed cleanup are documented in [Studio operations](studio-operations.md). It protects current and retained-history references, creates a safety backup, and updates originals/derivative ownership transactionally. Cloud storage and retained deployments are outside this cleanup.

## One viewer

`src/shared/image-viewer.ts` owns the viewer used by public article images, Life photos, homepage image actions and Studio media inspection. PhotoSwipe is bundled locally and loaded on first opening. A native `<dialog>` owns the modal boundary, focus and Escape; disable PhotoSwipe's competing focus/Escape behavior and change its inner root to presentation. Append the viewer inside that dialog so it works above Studio's existing top-layer dialogs.

Use labeled shared-size controls for fit, actual size, zoom, close and previous/next. Keep pictures sharp; only the toolbar receives glass optics. The full-screen dialog is excluded from the optical runtime. Preserve captions, keyboard entry/exit, focus return, pinch/pan/double-tap, nearby loading, and reduced-motion transitions. Ordinary linked images retain their destination. Do not attach the photo viewer to comparison images, inline equations or individual diagram nodes. Mermaid uses the separate trusted-vector gallery described in [diagrams](diagrams.md), sharing the same viewer shell and tools. Public article image activation is progressive enhancement; static images remain readable without JavaScript.

Scope control geometry beneath `.media-viewer` so the shared `.glass` rule cannot change absolute positioning to relative positioning when Studio's styles load later. The single Image controls toolbar is a compact top capsule; Image navigation is a separate bottom group, hidden for one image. Test actual bounding boxes over a Media library dialog, including narrow screens; counting toolbar nodes alone does not detect stretched, overlapping glass layers.

Pass the activating element to `openImageViewer` and restore it without scrolling when closing. Safari pointer clicks do not focus buttons, so `document.activeElement` alone does not identify the opener reliably. Closing the viewer must preserve the underlying Media library dialog.

## Selecting existing media

Every shared **Choose from your media** dialog includes an initially focused filename/path search, matching all entered terms without case sensitivity. A result count, clear action and explicit empty state keep filtering recoverable. The dialog retains its height while results change; only the image grid scrolls. Raster-only pickers retain their file restrictions, PDF files stay outside image selection, and uploading still uses the shared preparation flow. Search is local to the open dialog and is not persisted.

## Upload preparation

Every raster upload path uses ImagePreparation: Media library (including drops), Markdown insertion, covers, portraits, wallpaper, Life and chapter media pickers. Multiple files are reviewed in order. Canceling before upload does not retain a source. The author can skip editing, use a free or preset crop, drag the crop and eight handles, edit exact coordinates, reset, and resize proportionally. Numeric controls provide keyboard operation.

`POST /api/media/inspect` takes multipart `file` and returns an oriented, bounded WebP preview plus oriented source dimensions and an animation flag. It writes nothing. Use its source dimensions when converting percentages or pointer movement to integer crop pixels. Do not crop coordinates against the small preview's dimensions or the raw EXIF orientation.

`POST /api/media` remains multipart `file`, with optional JSON `transform`:

```json
{
  "crop": { "x": 100, "y": 50, "width": 400, "height": 200 },
  "resize": { "width": 200, "height": 100 }
}
```

Cropping happens after orientation, then resizing inside the requested box. The server validates bounds, keeps the 20 MiB / 40 million input-pixel limits and 2400px output maximum, and prevents enlargement. WebP quality defaults to 88; preserve alpha and remove embedded public metadata. GIF/animated WebP retain animation; cropping is unavailable, resizing remains supported. PDF files bypass editing and remain unchanged. SVG uploads are not accepted as editable raster images; starter SVGs remain viewable.

`MediaAsset` adds optional width, height, sourceId and canEdit to name/url/bytes/modifiedAt. Legacy assets have no retained original and cannot be re-edited without a new upload.

## Originals and recipes

Each accepted raster upload stores original bytes at `.studio/media-originals/{sourceId}/original` with a validated `record.json`: stable source ID, original name, SHA-256, and public derivative names/dimensions/recipes. Original metadata is private. Public optimized files receive unique names in `content/media`. Edits create new derivatives; existing Markdown and collection references remain intact until the author selects a replacement.

Private local APIs:

- `GET /api/media/:id/inspect`: preview the retained source for re-editing.
- `GET /api/media/:id/source`: original bytes as a private, no-store attachment.
- `POST /api/media/:id/variants`: `{transform}` creates another derivative.

Use the Store write queue for source/derivative commits and coordinate with backup restore. Roll back new files when processing/commit fails. Validate checksums and constrained paths when reading sources. Do not serve private storage through public `/media`, scan it into build references, or put it in Pages artifacts. Only referenced public derivatives and responsive variants belong in the build.

Portable backup version 2 includes About/page history and private originals/recipes. Version 1 imports still work; absent new storage is restored as empty. Both versions keep full path validation, checksums, restore review, stale-source detection and safety backups. Original retention uses the existing portable backup size limits; report a size-limit error instead of silently omitting originals.

## Image information and downloads

The shared viewer adds Image information, Download image, Copy image link and capability-detected fullscreen through its existing toolbar. On phones secondary zoom/fullscreen/copy actions move into More image actions. Preserve one toolbar, separate image navigation, and native dialog ownership. Information uses an internal glass pane or mobile sheet, with a keyboard-focusable scroll region. Escape closes an open action disclosure, then information, then the viewer.

Public downloads save the full published image rather than a responsive thumbnail. The activated viewer reads each loaded raster slide into a Blob once and shares those bytes with downloads; inline page images retain native responsive loading. Vector documents retain native URLs and their sandboxed response headers. Reads omit credentials, allow 25 MiB per image and 50 MiB across the viewer, and abort on close. Object URLs live until the owning slide is discarded or the viewer closes; downloads get a separate short-lived URL so closing does not cancel a save. Camera information, captions and copied links retain their public image URLs.

A cross-origin read failure retries a stale browser response with `cache: reload`. When CDN access still fails, the generated media manifest can identify the same-origin published copy retained in the Pages artifact. Only an exact registered media destination can use that fallback; no filename guessing, arbitrary proxy or private Studio endpoint is involved. Images without readable bytes keep native image display and an Open image download fallback. Studio alone supplies an original-download target.

`assets/media-details.json` is a versioned public manifest keyed by canonical local image URL. It contains public filename, delivery URL, dimensions, format and byte size. The viewer loads it on demand. Metadata responses must follow the current image when navigating; ignore stale requests and preserve ordinary image viewing when details fail. Public metadata never contains source IDs, library revisions, retained-original filenames or original URLs.

Studio's media inspector previews camera fields and saves a per-image Publish camera EXIF choice under `library.mediaDetails` using library revision checks. The default is off, including newly created derivatives. The server reads retained-original metadata when available, and returns only make, model, lens, exposure time, aperture, ISO, focal length and 35mm equivalent. Locations, dates, owners, notes and serial numbers are excluded. Never serialize a parser's raw object. Malformed or missing EXIF yields an empty camera object. Existing manually added raster metadata is stripped in public output as well; canonical files stay intact. Public camera fields are separately emitted only for opted-in, referenced images.

Original download attachments preserve the original filename through an encoded Content-Disposition header. Originals remain private local endpoints and are included only in the existing private backup workflow.

Fullscreen targets a dedicated viewer viewport inside the native dialog, containing the image, toolbar and information. Do not fullscreen the document root: WebKit can raise the page above the open dialog and let navigation intercept its controls. Keep the PhotoSwipe root below sibling information/action layers and verify real pointer interaction and image pixels in both engines.

## Production delivery

Use actual, distinct responsive widths, capped at 1600; smaller sources include their natural width rather than duplicate files advertised as larger pixels. Images, preload candidates and viewer sources use the same dimension map in builds and Studio previews. Preserve oriented dimensions, frames and published full-size downloads. The native viewer shell remains available during deferred loading, cancellation and retries. See [production performance](production-performance.md).

Article covers use the shared top-layer viewer from both the editor Settings workspace and the public hero. Framing, alt text, captions and hero visibility follow [article settings](article-settings.md). Public cover links retain native open-image behavior without JavaScript and modified-click navigation; ordinary archive/home cards retain their article destination. Sharing-only frontmatter images are protected in current/revision/Trash references and enter media delivery even when no hero is shown.

## Linked attachments

The link composer’s Files tab lists and uploads non-image files in canonical `content/media/`: PDF; MP3/M4A/AAC/WAV/OGG/FLAC; MP4/M4V/MOV/WebM; TXT/CSV/TSV/Markdown/TeX/JSON; ZIP/EPUB/DOCX/XLSX/PPTX. The shared attachment map owns MIME types and picker classification. Keep image pickers image-only; images still use crop/resize preparation. Media-library attachment cards use generic file/open actions, not image viewers or EXIF tools.

Uploads reuse authenticated POST /api/media with a 20 MiB bound, extension/signature checks for binary formats and atomic Store-queued writes. Bytes are retained unchanged, names are sanitized and unique, and attachments have no image-original or derivative records. Studio serves correct MIME and single byte ranges for audio/video. Markdown hrefs and reference-style links add media references to the build; only public references are copied. Fragment/query suffixes survive, R2 uses matching MIME and content-addressed delivery, and source Markdown stays local/canonical. Existing backup and reference/history cleanup protection includes attachments.

Single-image figure metadata can cap rendered width/height without changing bytes, intrinsic dimensions, responsive candidates or the full-size viewer/download. Source Image tools preserve captions, labels and references when editing it. See [image sizing syntax](authoring.md#single-image-display-size); gallery and cover layouts retain their separate contracts.

## Readable names and media short links

Media library → inspect a file → **Name and sharing** edits its display name, short code, aliases and **Publish for sharing**. Names apply to Studio lists/search/pickers and named viewer downloads; canonical filenames, Markdown, originals and R2 hashes stay unchanged. Direct native CDN URLs retain their server filename. Image downloads still use full published bytes. A canonical image identity in generated CDN markup disambiguates differently named files with identical bytes.

`library.mediaDetails[/media/encoded-name]` retains `publishCameraExif` and adds defaulted `displayName:''`, `shortCode:''`, `shortAliases:[]` and `publishForSharing:false`. The private generic `GET /api/media/metadata?url=...` returns `{url,name,metadata,shortPath,downloadName,libraryRevision}`; `PUT` accepts `{url,metadata,revision}`. It supports images and attachments, validates names/extensions, checks collisions, writes through the Store transaction queue and retains library undo. Existing camera-only saves preserve these fields. Publication flags and names survive checksum-verified portable backups/restoration.

Legacy effective codes derive from the canonical URL using a namespaced SHA-256 prefix without rewriting on read/build. `/m/{code}` and aliases are native Pages 302 rules; trailing slashes normalize. Changing a code retains its predecessor as an alias, up to ten. A previous alias may be promoted to the main code. Codes use the established 3–32-character vocabulary, and `m` is a reserved public prefix. Entry and media redirects share the native 2,000-static/100-dynamic limits; fail before accepting output if exceeded.

Only media referenced by public content/settings or explicitly marked Publish for sharing enter output. Copying a short link does not publish an unused file. Standalone sharing includes that file in frozen Pages/R2 manifests and protects it from cleanup. Short-link references in Markdown/HTML/directives are resolved for rendering and usage; retained library history supplies old alias mappings. Unknown aliases block cleanup instead of guessing. Builds resolve eligible short links to the captured delivery destination and preserve canonical authored source. Local preview may resolve draft media through the private Studio server; generated output never includes the complete local library or a public alias catalog.

Unsharing removes standalone eligibility and redirect rules from subsequent builds. Current public references still publish the file, and older accepted deployments remain independently protected; unsharing does not delete existing remote bytes.

## Asset discovery and embedding

Site settings → Media delivery → **Asset protection** owns `site.mediaProtection`: default-on `discourageIndexing`, default-off `blockForeignEmbeds`, and up to 20 exact `allowedHosts`. Pages builds emit `X-Robots-Tag: noindex` for `/assets/*`, `/media/*` and short-link paths. Keep resources fetchable so compliant crawlers can read this header and render article pages; do not add a conflicting robots.txt Disallow. Article HTML, native loading, CORS, viewer downloads and existing cache lifetimes retain their contracts.

**Check Cloudflare protection** saves settings and performs read-only discovery of the selected account/zones and relevant rulesets, with conservative free-tier slot checks. **Apply scoped rules** uses the captured source/credential revision and remote fingerprints, adds or patches only Glass-owned rule references, and preserves unrelated rules. Response Header Transform Rules cover the site paths and captured custom media hostname/prefix. The optional WAF custom rule covers media (including WebP/AVIF), trusts exact site/media/configured referrer origins, permits blank referrers and document navigation, and leaves scripts/styles/API traffic alone. No paid plan or additional serving Worker is required.

The private `/api/cloud-media/protection` status and POST `/check`/`apply` endpoints retain Studio token/origin protection. Ownership/partial-operation receipts live privately in `.studio/cloud-media/protection.json`; source saves are distinct from verified cloud application. Changed configuration, credentials or rules expire the check. Never replace a ruleset or retry an uncertain mutation. Each apply attempt consumes its review. After a propagation delay or lost reply, check again: matching owned rules require no cloud write and **Verify saved rules** rechecks delivery. After applying, verify public indexing headers and, when enabled, foreign-versus-own embed behavior. Missing scopes/slots and unverified propagation remain actionable errors. Public URLs are not authentication: bots can ignore indexing directives or forge referrers, and known URLs remain downloadable.
