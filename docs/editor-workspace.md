# Markdown editor workspace

Articles and About use the same CodeMirror source workspace. Markdown is canonical; formatting, snippets and table tools make ordinary undoable source edits. Title and summary belong in **Settings → General**. The breadcrumb keeps the current title visible while the source toolbar stays compact.

## Navigation and layout

Write, Split, Preview and Settings share one view selector. Source and settings remain mounted across modes, preserving selection, scroll, undo history, source-to-preview anchors and settings drafts. Settings fills the workspace; its sections follow [article settings](article-settings.md). Arrow keys and Home/End navigate the view selector. Split remains the initial wide-screen view; at 1100px and below it resolves to Write and the selector omits Split. Live preview pauses in Write, Settings and History while retaining its last successful document. The navigator and minimap are enabled by default when there is room:

- A source pane at least 960px wide docks a 200px navigator and 64px minimap.
- At 640–959px the minimap stays docked and the navigator opens as a drawer.
- Below 640px both tools open as overlays. Escape closes an overlay and returns focus to source.
- Focus mode expands the existing workspace without creating another editor. Escape exits it; native dialogs retain their own Escape behavior.

In wide-screen Split, drag the divider to resize source and preview. Both panes retain at least 300px; the ratio is clamped on resize and retained across view changes for the current editor session. Left/Right adjust by 2 percentage points (Shift: 10); Home/End reach the limits, and Enter or double-click resets to equal widths. The separator exposes the current proportion to assistive technology and shields the preview iframe during dragging. This does not remount source or change public typography.

Outline includes ATX and Setext headings outside code fences, indentation by heading level, source line numbers, filtering, current-section tracking and jump-to-source actions. Fold all/Expand all use CodeMirror's native folding. Problems shows actionable diagnostics with line/column and selected source ranges. Search lists the first 200 results; native find navigation still reaches all matches.

The minimap draws a document overview, headings, diagnostics, active matches and caret location on canvas. Its viewport window listens directly to editor scrolling, including small movements inside CodeMirror's buffered viewport. Measured line blocks account for wrapping and folding. Edits, resizing and typography changes refresh it. Dragging the window or clicking the rail scrolls the source without moving the caret; keyboard arrows, Page Up/Down and Home/End also navigate. It is a labelled vertical slider with the current visible line announced.

The assistance and source-toolbar rows share a compact 40px height, 4px vertical padding and 30px controls; narrow panes reduce icon widths while retaining all actions. The assistance row comes first, then the source toolbar directly above Markdown. Formatting actions remain reachable at phone widths and larger interface scales; unusually tight rows scroll horizontally. Cursor line/column, selection length, word count, reading time and the article save state share one editor footer. Write keeps this footer on one line, using a compact save indicator and visually hiding selection detail on narrow panes while retaining accessible text. Clicking the cursor position opens Go to line/column. Encoding is shown when there is room. About uses the same source footer. `SourceEditor` owns its only footer; callers pass save state rather than footer markup.

## Duplicate an entry

The toolbar Duplicate action opens **Duplicate as a draft?**, naming the current title with Cancel initially focused. Opening or canceling the dialog does not initiate duplication. Confirming flushes pending Markdown and metadata through the existing revision checks before requesting a draft copy, then opens the returned entry. During the request, repeated submission, Cancel, close, Escape and backdrop dismissal are disabled. Save and duplication errors stay inside the review dialog without discarding the editor draft. A failure opening an already-created copy is reported separately without reopening creation. Idle cancellation restores focus to the toolbar action.

## Find and replace

Cmd/Ctrl+F opens a local search panel rather than the browser's page search while the editor owns focus. It supports next/previous, case, whole word, regular expressions, selection scope, replace, replace all and selecting matches. Empty/invalid queries and no matches have explicit states. Search terms and replacement text are never saved to browser storage. Replacements are ordinary undoable edits.

**In selection** captures the selection at panel opening and maps that range through later edits. Reopen Find with a new selection to choose a different scope. The panel caps its displayed match count at 2,000+ and the navigator at 200 rows; finding/replacing is not limited to those displayed results. Escape closes Find and returns focus to source.

## Commands and preferences

| Shortcut                  | Action                                 |
| ------------------------- | -------------------------------------- |
| Cmd/Ctrl+F                | Find and replace                       |
| Cmd/Ctrl+Shift+P          | Search editor commands                 |
| Cmd/Ctrl+Shift+O          | Open document outline                  |
| Cmd/Ctrl+Alt+G            | Go to line/column                      |
| Cmd/Ctrl+B / I            | Toggle bold/italic on selections       |
| Cmd/Ctrl+S                | Explicit save, optionally format first |
| Cmd/Ctrl+Shift+F          | Format document                        |
| Cmd/Ctrl+K                | Insert/edit link while source focused  |
| Cmd/Ctrl+Z                | Undo source changes                    |
| Ctrl+Space (customizable) | Contextual Markdown completion         |

Commands include heading/list/task/quote prefixes, links, code/math, folding, line movement/copy/deletion and multiple occurrences. The command dialog supports filtering, arrow selection and Enter. Formatting preserves multi-selection edits and does not replace the entire document. Studio's separate Cmd/Ctrl+K navigation palette retains its own save-before-navigation behavior.

Editor preferences control navigator, minimap, wrapping, numbers, visible whitespace, active-line tint, 2/4-space indentation source text scale (85–140%), format on explicit save, image previews (both, thumbnails only, hover/focus only, off), display-math previews, typing suggestions, bracket completion and the completion shortcut. They do not change the public reading theme. Reset restores defaults.

Preferences use `fieldnotes-editor:{workspaceId}` in private browser local storage, version 1. Only validated booleans, indentation, scale, the image-preview enum and a bounded completion key chord are stored. New fields default within version 1; formatOnSave is false, imagePreviews is both, mathPreviews/inlineMathPreviews/completeOnTyping/closeBrackets are true, and completionShortcut is `Ctrl-Space`. Source, credentials, titles, search terms and revision data are excluded. Different notebooks have different keys. Corrupt or unavailable storage falls back to defaults/session behavior.

Source Settings → Completion records a shortcut with Ctrl, Cmd or Alt, optionally Shift. Ordinary typing and existing editor/browser commands are rejected; modifier-only keys wait, Escape cancels and Tab leaves the recorder. Primary Ctrl/Cmd is stored as CodeMirror `Mod` for portability. Reset restores Ctrl+Space; Unassign stores an empty chord. Reconfiguration applies immediately without rebuilding the EditorView or losing undo. Stock completion triggers are removed so the old key does not remain active after rebinding; menu selection and Escape keys still work. The command palette shows the current shortcut and always offers Complete at cursor. This is independent of Suggest while typing. Studio's global commands remain reachable from the header when source owns Cmd/Ctrl+K.

## Formatting and linting

**Source edit** and **Settings** are the two inner tabs inside `.source-main`, independent of article Write/Split/Preview/Settings. The source remains mounted while its Settings panel is open. The compact navigator/search/command/status row is `.editor-assistance`, followed immediately by its sibling `.editor-source-tools` above the source editor. Formatting/completion/table selectors do not occupy this row. Settings groups writing preferences, formatting, images, math, completion, component previews and a searchable syntax reference. Formatting/completion actions use the retained source selection and return to Source edit; table actions now belong to their source preview and command palette. Keyboard shortcuts remain available.

Settings offers Format document, Format selected blocks, Preview formatting and Fix safe issues. The command palette exposes the same actions. Formatting runs Prettier in a lazy private worker with prose wrapping preserved, print width 100, indentation 2 and embedded-language formatting off. Selection formatting requires complete root Markdown blocks. The existing parser compares before/after ASTs without positions; changed math, code, HTML, links, directive attributes and hard breaks cause rejection. Source is retained with an explanation. Formatting makes a minimal, mapped transaction with one-step undo and a retained scroll anchor.

Preview uses the shared diff dialog and applies only if the source still matches its captured version. All async formatting results are guarded against new edits or an unmounted editor. The formatter has a 2 MiB source limit and a ten-second worker limit. Worker failure is recoverable and does not alter Markdown.

**Format on explicit save** is off by default. When enabled and Source edit owns focus, Cmd/Ctrl+S formats before invoking the existing save contract. The 900ms autosave, navigation, build flush and metadata saves never format implicitly. A failed formatter retains and saves the original draft with a visible tool error.

Problems includes core component errors plus nonblocking heading-order, alt-text, reference, local media/destination, table-column and whitespace warnings. Local checks use the loaded notebook inventory; a failed inventory load does not imply missing media. Severity/category filters and Previous/Next navigate exact ranges. Per-issue fixes and Fix safe issues perform source transactions and recheck parsed meaning. They preserve two-space hard breaks and do not invent alt text, redirect broken targets or change embedded code. Ordinary source edits remain the author’s responsibility; these warnings do not become publishing errors.

## Image decorations

Image-only logical source lines can show a bounded thumbnail underneath; inline/reference images offer hover and keyboard-focusable image tools. Source text always stays visible. The parser excludes code/math lookalikes and resolves image definitions. StateField-owned direct block decorations, estimated heights and requestMeasure after image loading preserve native gutter metrics, the minimap and preview anchors. Changed source ranges discard stale decorations.

Local /media/ thumbnails load lazily. External images require activation; URL schemes are restricted and no remote URL is proxied through Studio. Tools reuse the shared viewer and media preparation picker, and provide Replace, Edit description and Copy path with selection fallback. Replacing a reference image changes only that occurrence. A changed draft invalidates an open edit instead of writing into newer text.

## Math decorations

Display equations have an optional rendered preview beneath editable TeX; inline equations render immediately after their closing dollar delimiter. The shared parser collects inline/display math in source order, excluding code lookalikes. The private `POST /api/authoring/math-preview` accepts `{expressions:[{source,display}]}` and returns matching `{results:[{html}|{error}]}`. It uses the same restricted MathJax 4 SVG renderer as production; inline expressions establish document-local macro context and return inline SVG. Macro-only expressions with no drawing do not add an empty chip. A fresh math document per request prevents macro leakage between articles. Invalid equations retain source and produce an accessible error while later valid equations still render.

Missing/invalid API responses show a recovery message instead of a raw JSON parser exception. After a same-notebook server restart, the client can refresh an expired token once and retry an operation rejected before authentication; a different workspace blocks the replay and retains the draft. Restart the local server after changing server APIs during development.

The endpoint retains Studio's loopback, same-origin, write-token and no-store protection. Batches allow 200 expressions, 16,384 characters per expression and 128 KiB UTF-8 input; returned SVG is capped at 2 MiB. Over-limit source stays editable with a preview explanation. No URL is fetched. Math analysis runs on every source edit without waiting for the lint debounce, and the matching analysis promise is reused by linting. Rendering starts as soon as the latest analysis is ready; there is no preview debounce. Requests abort after 15 seconds, on edits, preference changes or unmount; captured-source checks reject late results. Four bounded batches can be reused in private memory; no equation or SVG is stored in browser preferences or notebook files.

Direct StateField decorations retain ordinary source and gutter measurement: block widgets follow display equations and inline widgets follow inline source. Prose edits map existing ranges; changed math/macro context invalidates affected drawings. Widgets request measurement after insertion and scroll large formulas internally. Source Settings → Math independently toggles Display math previews and Inline math previews (both default on) for article and About. MathJax runtime is never imported into Studio's browser bundle or public readers. Static publication continues to prerender equations at build time.

## Links and local citations

Insert link (toolbar or Cmd/Ctrl+K) opens a shared dialog for web addresses, local content and headings. It searches configured post/article names and routes, fixed pages, collections and populated photo albums. Heading IDs use the engine’s Unicode slug/duplicate numbering. Existing links under the caret are editable and selected text pre-fills the label. Ordinary local destinations remain root-relative; unsafe schemes, credential URLs, loopback Studio URLs and private /api or /studio paths are rejected. Unpublished targets require acknowledgement.

Inline and reference-style links escape labels/destinations; matching reference definitions are reused. Formal citations use the existing :cite and references/reference dialect, a stable target-ID key and an absolute canonical URL. Existing matching bibliography entries are reused. A new entry is appended to the first valid references container or a new one at the document end; manually authored bibliography text stays unchanged. Citation and bibliography are one undoable edit. Nested short colon fences require author correction rather than an unsafe automatic ancestor rewrite. Async dialog actions never replace newer source.

## Implementation and verification

`SourceEditor.tsx` owns one EditorView and reconfigures display settings with a Compartment. `source-analysis.worker.ts` parses Markdown for outline, diagnostics and Unicode-aware statistics; late results cannot replace analysis of newer source. Worker failure falls back to the same local analyzer. Studio’s Vite alias selects the pure entity decoder rather than its DOM-only browser export; a worker has no `document`. Verify real worker execution as well as recovered analysis. Disposing the workspace terminates the worker and observers. CodeMirror owns vertical content padding and gutter measurement.

Keep article and About behavior aligned. Verify selection/undo after mode and preference changes, find/replace and invalid regex, scoped settings after reload, actual gutter baselines, source/preview scroll anchors, minimap following without caret movement, keyboard focus and 320px layouts in Chromium and WebKit. Use temporary notebook fixtures; no editor UI state enters public output.

Read [recovery](recovery.md) for the shared read-only CodeMirror comparison and [authoring](authoring.md) for the Markdown dialect and conversion tools.

## Component previews and table tools

Tables, Mermaid, list mindmaps, charts/function plots and image comparisons have optional source previews. Canonical Markdown remains visible. Source Settings → Component previews stores validated per-kind booleans in the existing workspace-local version-1 preference; all default on. Table operations no longer occupy Settings or its navigation.

Worker analysis returns typed component ranges plus reference/math context. Direct StateField block decorations map through edits and drop changed blocks. Visible widgets request batches of four; a bounded cache reuses unchanged source/context. Requests abort on edits/unmount, and captured source rejects late results. Rendering failures remain local to that preview with Retry; source and full-page preview remain available. No MathJax/Mermaid runtime is bundled into the author’s browser. Existing real-time math behavior is unchanged.

Private `POST /api/authoring/component-preview` accepts `{source, blocks:[{from,to}]}` and returns `{results:[{html}|{error}]}` in request order. It requires the existing local origin/token and no-store policy. Source is bounded to 2 MiB, a block to 64 KiB, a batch to 12 blocks and output to 2 MiB. The server validates ranges against parsed components, reuses production rendering and private caches, resolves link definitions and preceding document-local math context, and isolates per-block errors. These endpoints never enter Pages output.

Table previews use booktabs styling. Their header’s right corner owns Edit table and More (row/column insertion/removal, alignment, formatting, CSV/TSV copying). Preview cells select a source cell; Enter opens editing. The dialog edits raw Markdown cells, supports CSV/TSV import and paginates large tables at 50 rows. Apply replaces only the captured table in one undo step. Changes outside it map the capture; changes touching it invalidate Apply without discarding the dialog draft. Escaped pipes, inline code/math and reference syntax remain canonical. Copy failure provides selectable text.

The dialog has a selected-cell address/count header, grouped row/column controls, pressed-state alignment buttons and a Table data disclosure for import/copy. Sticky column letters and the editable header retain context while scrolling. Focus/selection uses one restrained cell boundary; the editor's denser data surface does not change the transparent booktabs output. Insert component uses a categorized library beside its configuration pane, retains configured interactive values across choice changes and inserts through the existing source transaction. Library metadata and Studio translation extraction share the component catalogs.

Visual headers provide Edit/Expand. Editing reuses chart forms, comparison media pickers and validated fenced configuration; Mermaid/mindmaps retain editable source and mindmaps offer map/tree layout. Apply requires a successful preview of the current draft. Explore loads the existing widget controllers on intent and supports SVG export. External image URLs are stripped while previews are inert; loading requires explicit activation. Local image pickers keep the shared preparation flow.

## Local file links

Insert link includes a Files tab for managed PDF/audio/video/documents/archives. Search/type filters and uploads select canonical `/media/` URLs for ordinary inline or reference-style links. Attachments do not become bibliography entries. Existing file links reopen on Files, and source snapshot guards and one-step undo match other link insertions. See [media contracts](media.md) for file types, upload bounds, publishing and portable backups.

Image tools include bounded display width, maximum height and left/center/right alignment. They write the existing figure metadata described in [authoring](authoring.md#single-image-display-size), preserving caption/labels/reference definitions and the full-size viewer/download. A standalone image gains a figure only when a display option is set; inline images retain their prose. Description plus layout changes apply as one captured-source undo step.

Reopening a preview pane with unchanged input reuses its last successful document. Explicit refresh still rerenders; changed hidden drafts render on return. CodeMirror scroll snapshots restore source position after mode changes using measured editor geometry, rather than racing a pixel assignment against remeasurement.

## Advanced source assistance

Follow [Markdown IDE maintenance](markdown-ide.md) for source-language injection, native gutter geometry, viewport-prioritized rendering, code projects and collection conversion. [Math authoring](math-authoring.md) describes package-aware command/symbol completion, rendered suggestion examples, environment templates, local macro navigation and range previews beyond 200 equations. The older expression-batch endpoint remains compatible; source editing now requests ranges with bounded document context. Pseudocode uses source highlighting, local completion, linked block snippets and block matching/folding instead of inline previews; legacy preview flags are ignored. Inline `==highlight==` works in source and published output, with a Highlight selection palette action.
