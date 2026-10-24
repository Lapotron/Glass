# Writing and making

Glass keeps canonical UTF-8 Markdown and JSON in the author's notebook. Studio edits those files; a custom engine generates the public blog. The authoring dialect is `fieldnotes-markdown/1`. Articles remain one continuous reading surface; use explicit components for a real semantic or interactive purpose.

Read [the complete component reference](markdown-reference.md), [chart options and examples](charts.md), [LaTeX conversion](latex-conversion.md) and [the local MCP contract](mcp-authoring.md). The reference and machine-readable pack come from the same catalog used by Studio and the renderer.

## Start in Studio

Run `npm run dev` and open <http://127.0.0.1:4310/studio/>. New entries start as drafts. Set title, date, language, tags, cover and discussion preferences in the Settings mode beside Write, Split and Preview. Title and summary live in General so Markdown keeps the available space. Markdown autosaves with revision checks; an external edit never silently replaces a dirty draft. About's Story uses the same editor and preview.

Collection display names and public prefixes are configurable in Site settings. Their stable source kinds/folders remain `posts` and `lab`; use Studio's actual canonical links instead of assuming a public prefix.

```sh
npm run content:new -- posts an-interesting-question An interesting question
npm run content:new -- lab a-small-experiment A small experiment
```

Required entry frontmatter: `id`, `slug`, `title`, `publishedAt` as a real YYYY-MM-DD date. Defaults include `status: draft`, `summary: ''`, `tags: []`, `lang: en`, `cover: ''`, `demo: false`, `comments: true`, `publishAt: ''`. Supported status values are draft, scheduled and published. Scheduled entries need a UTC publication timestamp; see [scheduling](scheduling.md). Use `lang: zh` for Chinese. Stable IDs, short codes and discussion keys must survive title/path changes.

## Editor assistance

See [the editor workspace](editor-workspace.md) for outline, minimap, search/replace, commands, shortcuts and private preferences.

- **Ctrl Space** requests context-aware completion by default. Change, reset or unassign it in Source Settings → Completion; the command palette always retains Complete at cursor. Type a slash at the start of a blank line for the component menu. Component snippets include editable fields; Tab/Shift-Tab moves between them and Escape exits snippet editing.
- Complete directive names, supported attributes and enum values, closing delimiters, interactive JSON fields, supported math commands, local links, media, headings, reference labels and citation keys. Suggestions do not take over ordinary code fences or inline code.
- **Insert component** is a searchable browser with Writing, Academic, Media, Interactive and Diagrams & math categories. Select a catalog item to configure it beside the library; switching interactive components retains this dialog's drafts. Search matches translated labels, descriptions and original component names. Chart types have data editors, CSV/TSV import, axes, formatting, legend, reference and range controls.
- **Table tools** inserts tables, adds/removes rows or columns, sets alignment, formats an existing table and pastes clipboard CSV/TSV as Markdown. Changes are ordinary undoable source edits.
- **Edit table** opens the visual source-table dialog. Its cell address and column letters track the selection; grouped row/column actions and alignment buttons apply to that selection. Table data holds CSV/TSV import and copy actions. Apply makes one undoable source edit; Cancel discards only the dialog draft. Editing the captured table in source still blocks stale Apply.
- The issue indicator opens the diagnostic panel. Checks are debounced; source ranges and configuration paths help locate mistakes. Expensive math/diagram rendering remains in the production preview.
- Split preview preserves reading position while text above the viewport changes. Follow editor is optional. CodeMirror edits source; CodeMirror also powers the read-only revision comparison.

## Ordinary Markdown

CommonMark plus GFM tables/task lists, footnotes and definition lists are supported. Use headings, paragraphs and lists directly. Inline HTML is sanitized; scripts, events, MDX and executable component code do not run.

````markdown
## An observation

A paragraph with **emphasis**, _a qualification_ and `inline code`.

- [x] Observe the system
- [ ] Repeat the measurement

Term
: A precise definition.

A supporting detail.[^detail]

[^detail]: A footnote with **Markdown** and a link.

```typescript title="experiment.ts" {2,4-6}
const estimate = 1;
const next = estimate / 2;
```
````

Fenced code is highlighted at build time. Optional `title="..."` labels the code block; `{2,4-6}` emphasizes lines. Copying code excludes displayed line numbers.

Local images use `/media/...` paths and descriptive alt text. Uploads use the shared crop/resize preparation flow, preserve private originals and publish optimized derivatives. Figures and galleries use the shared image dialog with zoom, download and optional published camera information. See [media](media.md).

Internal article links must resolve to published content before a public build. Draft links remain useful during editing but cannot create public targets. The normal build also validates local media. Use `/archive/`, `/life/` and `/about/` for fixed navigation destinations.

## Tables

Tables use booktabs presentation: restrained top/header/bottom rules, no vertical grid or filled header, transparent background and aligned numbers. Alignment is explicit in the GFM delimiter row. Narrow screens scroll inside the table region rather than widening the page.

```markdown
:::table[Measured response]{#tab-response}

| Method   | Time (ms) |  Error |
| :------- | --------: | -----: |
| Baseline |      12.4 | $0.12$ |
| Refined  |      10.8 | $0.04$ |

Values are measured under identical conditions.
:::

Compare :ref[tab-response].
```

A table directive contains exactly one GFM table plus optional paragraphs/lists of notes. Math, links, emphasis and code work in cells. Escape literal cell pipes as `\|`. Rowspan/colspan and nested tabulars require manual conversion; they are not silently approximated.

## Single-image display size

A normal Markdown image keeps its existing presentation. To keep a single illustration or portrait smaller than the reading column, put optional display metadata on a figure:

```markdown
:::figure[A compact illustration]{width="480" max-height="640" align="center"}
![Describe the illustration](/media/illustration.webp)
:::
```

The caption is optional: `:::figure{width="60%"}` works too. Width accepts 64–2400 pixels (`480` or `480px`) or 10–100% of the prose column. `max-height` accepts 64–2400 pixels and preserves the complete image and its aspect ratio. Both limits shrink to fit phones. Alignment is `left`, `center` (default for sized figures), or `right`; text does not float around the image. An optional `#id` still enables numbering and references. The viewer and downloads retain the full published image. No arbitrary CSS is accepted.

Image tools can write these attributes while preserving the description, existing caption/label and reference definition, in one undo step. Inline images must first be placed in their own paragraph. Clearing the size fields restores the figure's automatic display; it does not delete the figure or its caption.

## Math and scholarly structure

MathJax 4 renders math to SVG during builds and previews. Readers do not load MathJax. Use `$...$` inline or `$$` delimiters on separate lines for display math. Core packages are base, ams and newcommand; optional article math packages add physics, mathtools, chemistry, units and other supported STEM notation. Macros are scoped to one document. See [math authoring](math-authoring.md) and the generated [command reference](math-reference.md).

```markdown
:::equation[A derivative]{#eq-derivative}

$$
\begin{aligned}
y(x) &= x^2 \\
y'(x) &= 2x
\end{aligned}
$$

:::

The derivation is :ref[eq-derivative].
```

Matrices and cases are supported within math. Display equations scroll on narrow screens. Invalid math fails validation before accepted output is replaced.

Use theorem, lemma, proposition, corollary, definition and example directives for statements; proof adds a closing mark; algorithm contains ordered steps or a pseudocode fence. Their bodies remain ordinary Markdown with supported math and media.

Explicit `#labels` enable numbering and references. Statements share a counter; figures, tables, equations and algorithms each have a separate document-local counter. Unlabeled components remain unnumbered. Forward references work. Duplicate/missing labels are errors. Component titles do not become outline headings.

```markdown
:::theorem[A bounded square]{#thm-square}
For $0\le x\le1$, $x^2\le x$.
:::

:::proof[Proof]
Multiply $x\le1$ by the nonnegative value $x$.
:::
```

Use `:cite[key]` to link to bibliography entries inside `:::references`. Numbers follow bibliography order. The author writes the bibliography content; no BibTeX or CSL processor is installed. See [the complete syntax](markdown-reference.md) and [the conversion example](conversion/example.md).

## Reading and visual components

Containers use colon fences: `:::name[Optional title]{attributes}`. Use four colons around a container with three-colon children. Close every container. Unknown components, incorrect nesting and invalid configurations produce diagnostics.

Supported families:

- Callouts: note, tip, important, warning, caution; GitHub-style `> [!TIP]` also works.
- Native details, discussion sections, question/answer, ordered steps, rich Markdown tabs, figures and galleries.
- Link cards and inline mark, kbd, abbr, sub and sup.
- Academic statements, proofs, algorithms, equations, captioned tables, references and citations.
- Nested-list mind maps, list-based timelines and two-to-four-option comparison layouts.

Mind maps compile directly to native static light/dark SVG with a text-outline disclosure. Map/tree layouts, branch collapse, search, keyboard navigation, pan/zoom, expanded viewing and exports load on intent. See [mindmaps](mindmaps.md). Timelines and comparisons use ordinary nested Markdown. Use [the catalog examples](markdown-reference.md) to choose a component rather than inventing a new directive name.

Discussion sections can request Giscus using `:::discussion[Question]{#stable-key comments="true"}`. Reader annotations attach to exact rendered lines through the right-edge button and appear in the left outline and final discussion tabs. Keep stable keys intact. Configure providers in Site settings → Integrations; see [integrations](integrations.md).

## Interactive widgets and diagrams

Widgets use a fenced `interactive` block containing validated JSON, not executable code. Every widget accepts a title and caption.

- **Function plot:** preset sine, gaussian or polynomial; amplitude 0.1–3 and frequency 0.2–4. SVG and controls have a useful static state.
- **Chart:** the full supported type/data/interaction contract is in [charts](charts.md). Existing line/bar configurations remain valid.
- **Image comparison:** local `before`/`after` URLs and optional labels. The divider is a vertical line over the image, moved horizontally by pointer/touch or arrows/Home/End.
- **Quiz:** prompt, 2–8 choices, zero-based answer and optional explanation. Explanation remains available without JavaScript.
- **Plain-text tabs:** 2–6 `{label,body}` items and zero-based active index. Use rich Markdown tab directives when panels need Markdown.

````markdown
```interactive
{
  "type": "function-plot",
  "title": "A little wave",
  "preset": "sine",
  "amplitude": 1,
  "frequency": 1,
  "caption": "Change a parameter and watch the shape."
}
```
````

Mermaid diagrams use a `mermaid` code fence. The engine compiles and caches light/dark SVG locally, includes a source disclosure, blocks network resources and rejects invalid output. Install its local browser with `npm run renderers:install`. Mermaid, MathJax and syntax-highlighting engines do not enter reader bundles. See [production performance](production-performance.md).

See [Mermaid diagrams](diagrams.md) for transparent figure styling, quiet node typography, retained authored colors, vector viewing/downloads, source highlighting and reviewed newer diagram examples. Add `accTitle` for a useful accessible name/caption. Rich `::::tabs` render as an unframed reading flow with a thin divider below the labels and a quiet active underline; all panels remain available without JavaScript and on paper.

## Validate, convert and extend

```sh
npm run markdown:check -- draft.md --json
npm run authoring:pack -- --out .studio/authoring-pack
npm run authoring:docs
```

`markdown:check` reads files or stdin and never rewrites them. Full checks include math/diagram/chart rendering; `--syntax-only` checks structure and schemas. The authoring pack contains capabilities, schemas, templates, prompts and conversion examples. The docs command regenerates the component reference and chart examples after catalog changes.

Use [the LaTeX conversion workflow](latex-conversion.md) for external LLMs. The [MCP document](mcp-authoring.md) specifies a future integration; no MCP server or AI service is activated by these commands.

## Photo journal and albums

Photo journal has album management, cover selection, descriptions, public paths, photo filters, selection/batch moves and undo. Create an empty album first or name one while adding a moment. Album renames update membership atomically and keep earlier public paths as redirects. Deleting an album moves its photos to the chosen destination; it does not delete media. Build to update Life and album pages.

Life shows album covers and a journal of all moments. Album pages display the description, cover, date range and their photographs. Empty albums stay in Studio until they have photos. The Image description field can use a nonempty caption as its fallback; otherwise the dialog asks for a description before saving.

Archive is generated from published entries and has no separate records. Studio → Homepage owns the profile/recent-writing layout and alternate visual chapters; the retired article-level featured control is not the slide editor. About owns profile, links, affiliations and guestbook settings. Appearance owns typography/materials/backgrounds; [reader preferences](reader-preferences.md) stay browser-local. Use [revisions/backups](recovery.md), [Studio operations](studio-operations.md) and [publishing](publishing.md) for maintenance and release workflows.

Optional per-article cover, reading, typography, discussion and SEO frontmatter follows [article settings](article-settings.md). The exported authoring pack includes that guide and the executable input `entrySchema`, so external generators can retain these settings without embedding presentation code in Markdown.

The shared link dialog can insert reference-style local links or formal `:cite` references using configured routes and stable target IDs. Formatting/lint controls and optional source image thumbnails follow [editor workspace](editor-workspace.md); they never replace canonical Markdown with visual blocks.

Code fences additionally support Expressive Code file/terminal frames, insert/delete/text markers, wrapping and inclusive folded ranges. See [code syntax and behavior](reader-upgrades.md#code-blocks). Studio fence metadata completions and the external authoring capability pack share this catalog. Continue using ordinary Markdown fences; code is highlighted at build time and is never executed.

## Inline highlighting

Use `==important text==` for inline highlights, including nested emphasis, links and math, or the existing `:mark[important text]` component. Keep the opening and closing markers beside non-whitespace content on one line. Escaped markers, code and unmatched markers remain literal. Source editing and published output share this syntax. The command palette includes Highlight selection.

## Algorithms and linked code examples

See [pseudocode and code projects](pseudocode.md) for academic/code presentations, inline math, exact source exports and JS/TS virtual-file groups. Use `project="name"` with distinct `title="file.ts"` values to share imports within an article; examples remain non-executable. Use `check="off"` for intentionally incomplete code.

The exported authoring pack now includes a portable `skills/glass-markdown-authoring/SKILL.md`, current math capabilities, and STEM/code-project templates. The local MCP bridge exposes the same skills, guides and templates.
