# Production reader performance

The production artifact renders Markdown, MathJax 4 equations, Mermaid diagrams, plots/charts and syntax highlighting before publication. Reader JavaScript enhances controls, navigation and discussions; it does not compile content. Keep the selected Liquid Glass optics, materials and interactions intact.

The dedicated public `/tools/` utility is the intentional route-only exception for user-entered equations and developer data. Its separate asset graph, lazy CodeMirror modules, terminable workers and local MathJax font shards follow [Tools](tools.md). Keep that graph unreachable from ordinary article scripts and preserve existing reader budgets. Report tool payload separately rather than weakening the ordinary reader guard.

## Static rendering

Mermaid 12.2 uses its local browser bundle in isolated Playwright Chromium on the author’s machine. Install Chromium once with `npm run renderers:install`. Builds without diagrams and fully cached diagrams do not launch a browser. Rendering is serialized, bounded to 15 seconds and closed when rendering sessions finish. Network requests are blocked, source configuration cannot relax security, and generated SVG is sanitized. Invalid or unavailable rendering fails before replacing accepted output; Studio preserves its last successful preview.

Every diagram includes light and dark SVG variants selected by CSS from `data-theme`, plus an escaped source disclosure. SVG IDs, CSS references and accessible descriptions are namespaced per document/occurrence/theme. Native MathML inside diagram labels remains self-contained. The public bundle contains no Mermaid, KaTeX or MathJax runtime. Results are cached privately in `.studio/render-cache/mermaid/`, keyed by source, renderer code, Mermaid bundle and platform, with checksums. The cache is neither content nor a publication asset.

Transparent Mermaid styling, presentation-dependent cache keys, highlighted source disclosures and the shared intent-loaded SVG viewer follow [diagrams](diagrams.md). Viewer slides reuse compiled SVG and never rasterize or recompile it. Cached source-preview occurrences namespace the complete figure, including source-code IDs, when mounted.

MathJax keeps one TeX document per Markdown document so macros can span expressions without leaking between entries. Its SVG font-cache setting remains `none`: the showcase equations compressed better than local glyph caching. Display equations are keyboard-focusable scroll regions on narrow screens. Expressive Code and its Shiki plugin remain build-only; themed CSS and highlighted HTML ship as static output.

## Reader modules and assets

The profile homepage adds no JavaScript dependency; its brief entrance and bounded stagger are CSS-only. Settings has a page-linked `settings.css` through optional `ReaderAssets.settingsStyle`, plus existing content CSS for its compiled specimen. Only the lazy Settings module enhances preview scenes. Keep readability report copy in `contrast-report.ts`, separate from the prepaint contrast resolver, so it loads with Settings rather than shared startup code. Asset reports include a separate complete Settings visit; its form/demo CSS does not enter the initial homepage profile. Keep the 20 KiB initial JS and 45 KiB initial JS/CSS budgets unchanged.

The bootstrap applies appearance before paint and maintains reader preference synchronization. Settings form/picture tools load on the Settings route. Small widget modules load by type near the viewport without the authoring schema/registry. Charts keep their built SVG until hover, focus, tap or an action requests ECharts and the relevant modular chart family. Chart source schemas and Node renderers never enter that deferred runtime. Static representations remain useful on failed or disabled JavaScript; active controls are enabled after enhancement. The image viewer creates a native loading dialog immediately, then loads its implementation, PhotoSwipe and information tools; Escape and focus return work during loading and after opening.

The reader build rejects dependencies on authoring, server and Node rendering modules. `assets/reader-assets.json` resolves entry URLs and optional content styles for templates and local previews; readers do not fetch it during startup. Its validated chart module map supports fresh module URLs only after an explicit Retry following a failed import. ECharts core is separate from runtime controls and chart families, so retrying one failed module does not create a dependency cycle. Reader bundle files live below a content-fingerprinted `/assets/bundles/{hash}/` prefix and use immutable caching. Relative imports and preload dependencies stay within that prefix. HTML and fixed metadata/provider-style URLs remain revalidated. The annotation worker retains its fixed Pages entry outside the reader bundle.

Cache policies use disjoint paths. [Cloudflare Pages combines headers from matching rules](https://developers.cloudflare.com/pages/configuration/headers/), so a broad `/assets/*` cache rule would add `max-age=0` to immutable bundles. Keep CORS on that broad rule and cache lifetimes on specific paths. Verify the exact resulting Cache-Control value in the Pages emulator.

Raster candidates use distinct actual widths: 480, 960 and 1600 where available, plus the natural width when smaller than 1600. A 736px source produces 480px and 736px WebP candidates. One dimension map resolves image `srcset`, preload candidates and the image data read by the viewer in builds and Studio previews. Canonical paths, published full-size downloads, animation and private originals remain intact. R2 delivery rewrites these accepted candidates through the existing frozen-artifact pipeline.

Brand artwork is also prepared at build time: small browser/touch/maskable icons and logos capped at 128 px. Versioned references update after artwork changes; their canonical originals are not loaded by readers. See [site settings](site-settings.md) for manifest and metadata delivery contracts.

## Verification and budgets

After building, run `npm run quality:report`. It traces static imports and reports gzip bytes; it fails when base initial JavaScript exceeds 20 KiB, base initial scripts/styles exceed 45 KiB, or activated showcase modules exceed 90 KiB. Conditional annotation/widget modules count in the showcase profile. Explicitly opened image dialogs, the Settings form and third-party providers are reported separately from that profile.

Diagram viewer registration loads only on articles with diagrams. Its SVG cloning/serialization module loads when opening the viewer; caption lookup remains lightweight. The automatic showcase profile includes registration, while opened-viewer payload is deferred. Browser budget measurements count each successful asset URL once, matching the graph report even when WebKit reports duplicate preload/module responses under routed tests.

Run `npm run preview`, then `npm run quality:readers -- --label optimized --runs 3`. The default desktop profile uses 1440×1000, normal CPU speed and 10 Mbps/40 ms networking. Use `--profile mobile` for the retained 390×844, 4× CPU slowdown, 1.6 Mbps/150 ms profile. The benchmark checks Home, an article and the showcase when present, waits for diagrams and widgets, and records LCP, layout shifts, long tasks and successful script/style payloads in `.studio/reports/`. External providers are blocked for repeatable first-party comparisons. Compare medians under the same conditions; these local measurements are not field performance guarantees.

Browser checks use generated Pages output as well as isolated Studio previews. Verify no-JavaScript diagrams/math, unchanged SVG DOM on theme switches, narrow/large-text layouts, widget interactions, deferred-module failures, cache headers and actual image dimensions. Keep generated artifacts and reports out of git.

The outline starts as a closed native disclosure so it does not cover mobile prose when JavaScript is disabled. Enhancement opens the desktop sidebar and keeps the compact control on smaller viewports.

## Charts and page styles

ECharts 6.1.0 SVG compilation runs locally with animation disabled, bounded validated data, namespaced resources and a private checksum-verified chart cache. Static light/dark variants switch through CSS; chart libraries are not requested during ordinary page reading. Browser enhancement uses the same data-only adapter, renders before hiding the accepted SVG, and retains the data table on errors. No read-time chart API is needed.

`ReaderAssets.contentStyle` is an optional version-1 manifest field. A separate fingerprinted content.css is linked in article/About/specimen HTML, so component styling is present with JavaScript disabled while Home avoids those styles. Existing artifacts without the field remain readable. New component styles stay outside the base initial profile.

The automatic-showcase budget includes page-linked content CSS and lightweight widget handlers. Intent-loaded ECharts core/family modules are reported separately, like the explicitly opened image viewer. Report their actual compressed size and benchmark first interaction under the same throttling profile; do not describe them as free initial payload. Keep the 20 KiB JS, 45 KiB initial and 90 KiB automatic-showcase limits.

## Native mindmaps

List-based mindmap directives render deterministic namespaced light/dark SVG directly in the engine, plus a readable native text outline. They do not launch Mermaid/Chromium. The optional `layout` attribute and generated data contract are documented in [mindmaps](mindmaps.md). The small navigation/export module loads on pointer or focus intent; no-JavaScript output fits the complete map. Keep it distinct from the heavier opt-in chart profile, and measure it in asset reports.

Article actions use a small bootstrap and an intent-loaded dialog/export module. QR SVG and citation text are generated during the static build; QR libraries, Prettier workers and CodeMirror remain private authoring/build dependencies. Print uses the accepted static chart/math/diagram output. See [article footer](article-footer.md).

## Studio authoring payload

An isolated build of commit `7d834e5` compared with the Markdown IDE revision on 2026-10-21 measured the following with the same Node gzip defaults. Totals include every emitted Studio JavaScript chunk and worker; these are output sizes, not initial network requests.

| Studio output       |    Earlier raw / gzip |  Current raw / gzip |
| ------------------- | --------------------: | ------------------: |
| All JavaScript      | 4,946.6 / 1,381.6 KiB | 2,617.1 / 828.1 KiB |
| Source Editor chunk |     887.9 / 293.9 KiB |   933.9 / 307.5 KiB |
| Diff adapter        |   2,829.7 / 717.9 KiB |     33.5 / 11.9 KiB |

The new bounded diff worker adds 68.2 / 22.7 KiB and the lazy formatting worker 646.4 / 205.5 KiB. CodeMirror source dependencies are reused by the comparison. Math thumbnails receive SVG from the private local MathJax batch endpoint, with no MathJax browser runtime. Reports live in private `.studio/reports/studio-bundle-comparison.json`; rerun comparison after changing dependency boundaries. Public reader budgets remain independent.

Article navigation/focus/progress loads only on article pages and counts in the automatic-showcase profile. Paper CSS remains in page-linked content styling. Source previews and attachment authoring are private Studio features; no editor, chart renderer, MathJax/Mermaid runtime or attachment upload API enters public reader bundles. R2 attachment delivery is static MIME-preserving file delivery.

## Reusing local work

Canonical bytes remain authoritative. Store reads still pass through its transaction queue, read current bytes and calculate revisions; only parsing is reused by raw content hash. Snapshots are independent objects, so unsaved preview overrides cannot change a cached notebook. Deleted files leave the parse index. Same-size, same-mtime edits remain detectable.

Builds and previews share complete, per-document Markdown results in private `.studio/render-cache/markdown/`. Keys include source, explicit document identity, preview mode, effective renderer settings and a fingerprint of engine/shared code, dependencies and platform. Keep every output-affecting setting in the key; never key only by article ID or cache an isolated equation independently of its macro context. Results retain headings, media references and source ranges alongside HTML. Production and preview entries cannot share a key. Failures are not cached.

The rendered-content memory LRU is limited to 64 MiB per workspace (at most four workspaces retained), with a 256 MiB disk cache. Disk records and every cached file have checksums, installations are atomic and concurrent identical requests share work. Corrupt/missing entries regenerate; unavailable caches fall back to rendering. Cache directory replacement clears memory on the next renderer acquisition. Prune after accepted builds and every 64 new artifacts, using recorded access times. Oversized individual artifacts are used without retention. Cache cleanup never deletes canonical files or accepted builds.

Public media transformations use `.studio/render-cache/images/`, limited to 4 GiB. Keys cover freshly hashed source bytes, implementation, extension and Sharp versions. A verified artifact contains the sanitized full image, its actual responsive variants and dimensions. Read source bytes even on a warm build: metadata timestamps must not conceal an external edit. Keep two transformations active, retain animation/orientation/ICC/transparency and never reuse private originals as public output. Branding uses the same verified artifact mechanism with a separate 64 MiB limit and its full branding-input/settings key.

Media listings validate source records and file paths without opening original bytes. Cached dimensions use file identity, size, mtime and ctime; source records are reread and validated when changed. Original access, editing, source validation, exports, backup and restore retain their byte/checksum checks. Do not add original-byte reads back to ordinary listing or extract private camera data during builds unless publication is opted in. R2 upload and verification remain bounded and mandatory.

Caches and performance reports are disposable private state, excluded from portable backups and publication; notebook reset clears them. In-flight writes verify the cache-directory generation and cannot reinstall an old artifact after reset replaces that directory. Restore or external changes cannot produce stale output because source/context hashes are rechecked and source-record/file fingerprints are reconciled.

## Algorithms and editor scheduling

Route, tag and album maps replace repeated collection searches. Related posts use a tag index and stable bounded top-k heap; preserve overlap weighting, descending date and original-order ties, including zero-score fallback. Reader search normalizes fields once in an intent-loaded worker, keeps the original AND matching and weighting, and uses a stable heap for its twelve results. A shared loading promise avoids duplicate index fetches. Worker failure retains equivalent local fallback. A failed search-module download offers an explicit Retry using its validated build URL with a fresh query parameter; this also works when WebKit retains an import failure across page reloads. The typed query stays intact. Search queries remain transient.

Source analysis has one active request and one replaceable successor. Settle superseded requests without showing their results or errors. Transfer notebook/media context only when it changes; outline, lint, statistics and decorations reuse the same result. Diagnostic positions use a line-offset index, excluded intervals use binary search, reference lookup uses maps/sets, and word counting streams the segmenter. Keep full Markdown parsing and document-ordered math semantics rather than patching AST fragments without dependency tracking.

The source/diff minimap caches its canvas drawing. Scroll/caret updates move separate viewport/cursor overlays; only source, diagnostics, markers, search results, theme or size invalidate the drawing. Cache search matches by document and query. Preserve wrapped-line geometry, real scroll listeners, keyboard controls and dragging without moving the caret. `data-paints` on the private minimap canvas supports regression checks.

Reader outline tracking measures heading geometry on layout changes and uses binary search while scrolling, updating only changed active links. Media/font/disclosure/reader changes invalidate it. Annotation placement indexes references by block and measures visible blocks before updating badges. Archive sorts published metadata once, groups/counts in one linear pass, and emits 24-row static pages. Archive CSS is page-linked through discovery styles rather than the ordinary reader stylesheet. Filtering loads the fingerprinted catalog in a dedicated worker only on intent; the main thread receives one page and at most 20 topic suggestions. Cache filtered selections for pagination, reject stale replies, retain native links on failure, and use the shared pure fallback if workers are unavailable. See [visual pages](visual-pages.md#archive) and the 1k/10k model/browser regression fixtures. Liquid Glass keeps the accepted resolution and edge values: neutral interiors are filled directly, and only the edge band needs optical calculations. Pixel hash tests guard byte equivalence.

## Workspace benchmarks

`npm run quality:workspace -- --label optimized` generates a temporary notebook with 1,000 entries, 3,000 media files (150 published raster images), retained originals and 5,000-line authoring samples. It measures cold/warm snapshots, media listing, article previews, analysis, prepared reader search, lens generation and builds without changing author content. Three timed warm runs produce medians, expensive-operation counters and peak RSS in private `.studio/reports/workspace-optimized.json`. `--entries`, `--media`, `--runs`, `--skip-build` and `--source` support smaller investigations or comparison against an isolated earlier checkout; use the same workload/environment. Generated fixtures are removed even on failure.

On the local Node 22.17 macOS workstation, comparing commit `85265e2` with this optimization on that fixture gave:

| Warm operation                           |    Before |    After | Reduction |
| ---------------------------------------- | --------: | -------: | --------: |
| Notebook snapshot                        |    161 ms |    37 ms |       77% |
| Media listing                            |  1,034 ms |    75 ms |       93% |
| Article preview including snapshot/media |  3,363 ms |   167 ms |       95% |
| Repeat static build                      | 13,159 ms | 4,897 ms |       63% |
| Diagnostic-heavy 5,000-line analysis     |    249 ms |   152 ms |       39% |
| 700×600 glass lens map                   |   11.4 ms |   5.7 ms |       50% |

Cold preview preparation stayed approximately 3.3 seconds; it pays the initial cache-write cost. Cold builds measured 14.1 versus 11.7 seconds. These synthetic measurements are not reader field guarantees. Warm build counters must show no Markdown recompilation, image encoding or branding rendering when source/settings are unchanged; warm media listings must read no originals. Compare complete artifacts and correctness as well as time.

The complete fixture process peaked at 1,747 versus 2,171 MiB RSS, including the transient Vite bundler and Sharp. This release reduces repeated CPU/I/O work through bounded caches; it does not claim a lower process-memory peak.

A separate ten-query batch over the same 1,000 generated entries measured 40.2 versus 5.5 ms of search CPU work after index preparation (86% less); worker startup/network are excluded. The desktop Pages benchmark recorded median initial LCP of 208 ms on Home, 260 ms on the authoring article and 280 ms on the component showcase, with no JavaScript errors and near-zero CLS. Those are repeatable local-emulator observations, not live-CDN or mobile guarantees. Reports remain private under `.studio/reports/`.

## Discovery and analytics loading

Pagefind is generated inside the pending artifact and loaded on search intent, with independent native bundles per language. Its CSS and Projects presentation use the separate discovery stylesheet; code's EC base/theme/control CSS is page-linked separately. Asset reporting includes code CSS and the automatic code-tools enhancement in activated article cost. The initial reader budgets remain unchanged.

ACA loads only when enabled on an eligible public page. Its collector uses bounded cumulative batches and intent/visibility sampling; Web Vitals is a separate optional import. Studio ECharts and its report API/credentials never enter the public reader graph. The Vinext prototype has separate output and measurements and must not inflate or replace the production reader's asset report.
