# Markdown IDE maintenance

The source surface remains one mounted CodeMirror 6 view. Monaco and JetBrains are references for interaction, not alternate editor engines. Preserve the nested Source edit/Settings tabs, article Write/Split/Preview/Settings modes, one footer, selection, undo, and scroll positions.

## Structure and responsiveness

CodeMirror's incremental Markdown structure recognizes fenced languages and inline/display TeX. Remark remains authoritative for full Markdown validation, source component ranges, and production. Completion must query the local syntax context before inspecting document-wide references. Do not interpret dollar signs inside code as mathematics.

Gutter numbers use native measurement and source font metrics. Direct StateField decorations own block widgets. Their outer boxes have no vertical margins; keep spacing inside measured boxes. Request measurement after media or drawings load. Preview-only space never acquires invented source line numbers.

Keep source analysis to one active worker job and one replaceable successor. Cursor/scroll changes must not parse the whole document, recreate all decorations, or repaint minimap content. Language parsers are lazy; the TypeScript runtime and standard libraries belong only to the private worker. The complete source is never stored in browser preferences.

Math and component previews prioritize the viewport and nearby source. Cache identities depend on content and context, not absolute source positions. Prose edits map existing ranges and update tool callbacks without remounting unchanged widgets. Obsolete widgets cancel queued work; a prose edit must not abort an unrelated rendering request. Bound cache bytes as well as item counts.

Math uses the package registry in `src/shared/math-authoring.ts` throughout the engine and authoring pack. Range previews compile preceding context without off-screen SVG, preserve macro order, and reject late responses. See [math authoring](math-authoring.md). Pseudocode uses the shared vocabulary and [code project contract](pseudocode.md); source is copied from the inert canonical payload, not from rendered math text.

Pseudocode remains source-only in the editor: semantic syntax colors, local completion, accepted block snippets, native indentation guides, block folding and matching. Query the outer Markdown fence rather than a mounted language tree, handle headers before body routing, and never scan the whole document per pseudocode keystroke. Bound and cache the active-fence index (2,000 lines/64 KiB), paint only visible matching tokens, and retain literal math without inline widgets. Snippets own END insertion; ordinary Enter stays unchanged. Shared Quicksort examples feed slash commands, Insert component, capabilities and the portable references. Ignore legacy pseudocode preview flags without discarding other preferences or breaking the older private preview kind.

Visible math discovery may supplement background analysis, but cannot remove Remark-owned ranges: directives can contain valid display math that Lezer treats as paragraph content. Never interpret either half of a `$$` pair as a single-dollar delimiter. Autocomplete details live beside the list inside CodeMirror's tooltip; keep the outer autocomplete overflow visible and clip only its scrollable list.

## Safe collection conversion

The batch content API adds `action: "convert"`, `targetKind: "posts" | "lab"`, and optional `slugs: {entryId: destinationSlug}`. Items retain captured `{id,revision}` values. Studio flushes active editing before opening its reviewed conversion dialog. All selected changes are one journaled transaction; failures or collisions change nothing.

Conversion preserves IDs, authored data, status/schedules, short codes, source history, and annotations. It moves canonical files to the destination folder and records the replaced raw source with the existing `batch` history reason. Already-targeted entries stay unchanged.

`routeAliases` is a default-empty array of at most 80 former local article URLs. It is retained across later moves and collection-prefix changes. Specific redirects precede collection wildcard redirects and point directly to the latest canonical destination. Published aliases participate in build link validation; drafts do not create public redirects. Other entries cannot claim retained routes. Duplicates drop route aliases.

`discussion.articleTerm` captures the established article Giscus key before the first move. Line/section annotations keep their entry-ID keys. Duplicate drafts do not inherit the original article discussion term. Restoring an older revision restores authored metadata/body into the current collection and retains accumulated route/discussion history. Moving back uses conversion. After conversion, later slug changes also retain the displaced canonical routes; unchanged legacy entries keep their existing slug-edit behavior.

## Verification

Use temporary notebooks. Verify rich-block gutter baselines, wrapped lines, fonts, delayed images, both themes, both browser engines, and 320px layouts. Exercise actual worker execution and failure, completion insertion/undo, package changes, macro dependencies, stale responses, code-project isolation/imports/rename, conversion round trips/conflicts/rollback, and backup/Trash recovery. Public builds must contain static math and pseudocode without editor, compiler, language worker, or MathJax runtime files.

Compare identical 5,000/20,000-line workloads with hundreds of equations and rich blocks. Measure typing latency, frame stalls, viewport rendering, and repeated work separately; record browser/CPU settings and distinguish warm from cold costs. Run the repository checks and retain review screenshots and private benchmark reports.

### Recorded local comparison

On 2026-10-23, `npm run quality:editor -- --baseline HEAD --runs 3` compared editor files from `00cba59` with this implementation, using the same current server/compiler and outer Studio in temporary notebooks. Chromium 156.0.8078.4 ran at 1440×1000 on Apple M1 Pro without CPU throttling. Each viewport settled for 1,500 ms before three runs of 100 keystrokes at 12 ms intervals. Timing measures `beforeinput` to the next animation frame, rather than cold startup or every completion/preview cost.

| Workload     | Earlier median p95 | Current median p95 | Earlier/current math drawings near the final viewport |
| ------------ | -----------------: | -----------------: | ----------------------------------------------------: |
| 5,000 lines  |            16.3 ms |            16.4 ms |                                                 2 / 2 |
| 20,000 lines |            16.2 ms |            16.2 ms |                                                 0 / 2 |

This desktop workload shows no material typing-latency improvement or regression. The new viewport renderer retains math drawings in the 20,000-line document during typing, where the earlier editor displayed none. The separate Chromium/WebKit regression checks also verify equations beyond the former 200-expression limit, directive-nested equations, and gutter geometry. Reports remain private in `.studio/reports/markdown-ide-benchmark.json`; repeat the comparison under a matching environment before claiming broader speed gains.

### Pseudocode workload

On 2026-10-23, `npm run quality:editor -- --scenario pseudocode --runs 3` measured the current implementation while typing inside an active Quicksort fence appended to each mixed corpus (5,028 and 20,028 total lines). Chromium 156.0.8078.4 ran at 1440×1000 on Apple M1 Pro without CPU throttling, using the same 1,500 ms settling period and three 100-keystroke runs at 12 ms intervals. Median run p95 was 16.5 ms and 26.3 ms respectively, with no observed long tasks in the typing windows. This is a current-only measurement, not evidence of a speed improvement over an earlier revision. The private report is `.studio/reports/pseudocode-ide-benchmark.json`.
