# Convert LaTeX and LLM drafts to Glass Markdown

This workflow uses an external LLM of the author's choice. Glass does not contact an AI service, execute TeX or automatically publish the result. The deliverable is readable Markdown, local media mappings and an explicit conversion report.

## Give the LLM the actual language

Run `npm run authoring:pack -- --out .studio/authoring-pack`. Supply the exported `capabilities.json`, authoring/reference/chart guides, an appropriate template and the source documents to the model. The pack is versioned `fieldnotes-markdown/1`. Its schemas and examples come from the same catalog as Studio and builds. Regenerate the pack after component changes.

Use [the conversion prompt](conversion/latex-to-markdown.prompt.md) for an existing work or [the generation prompt](conversion/generate-markdown.prompt.md) for a new template. Do not ask the model to infer unsupported components from the names of third-party Markdown plugins.

## Required outputs

1. `draft.md`: UTF-8 canonical Markdown, with draft frontmatter if it is a new entry.
2. `conversion-report.json`: the report described by [its schema](conversion/report.schema.json), including unresolved constructs, references, macros and media mappings.
3. A local asset folder or mapping to existing `/media/` URLs. Keep the original LaTeX and original assets separately.

Use a stable new entry ID, a unique slug and an accurate publication date. The content folder/kind remains `posts` or `lab`; public names and prefixes come from Studio settings. Obtain actual links from Studio rather than hardcoding `/blog/` or `/lab/`. Conversion must not rename existing IDs, discussion keys or media files.

## Mapping rules

| LaTeX source                                           | Markdown target                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `section`, `subsection`, `subsubsection`               | `##`, `###`, `####`; preserve logical hierarchy.                                                                                           |
| `textbf`, `emph`, `texttt`                             | Strong, emphasis and inline code.                                                                                                          |
| `itemize`, `enumerate`, descriptions                   | Markdown lists and definition lists.                                                                                                       |
| Inline math; equation/displaymath                      | `$...$`; `$$...$$`; use `:::equation` when a label/number is needed.                                                                       |
| `align`, `gather`, `cases`, matrices                   | Supported MathJax environments inside a display expression; prefer `aligned` for one numbered derivation.                                  |
| Theorem/lemma/proposition/corollary/definition/example | Matching directive with ordinary Markdown and an explicit label when referenced.                                                           |
| Proof                                                  | `:::proof`; the renderer adds the closing proof mark.                                                                                      |
| Algorithm / pseudocode                                 | `:::algorithm` with ordered steps or a code fence. Never execute algorithm code.                                                           |
| Figure and caption                                     | `:::figure[Caption]{#label}` with a local image.                                                                                           |
| `tabular` / booktabs                                   | `:::table[Caption]{#label}` around a GFM table. Preserve header meaning, units, precision and numeric alignment.                           |
| `label`, `ref`, `eqref`, `autoref`                     | Stable component `#labels` and `:ref[label]` outside TeX. Numbering is generated locally.                                                  |
| `cite` / bibliography                                  | `:cite[key]` and authored `:::reference` entries within `:::references`. Preserve bibliography content; no automatic BibTeX or CSL engine. |
| Footnotes                                              | `[^key]` and `[^key]: ...`.                                                                                                                |
| Concept hierarchy / outline                            | `:::mindmap` containing a nested Markdown list, when this communicates the original meaning.                                               |
| Numerical observations                                 | A validated chart block only when the source contains the actual numerical data.                                                           |

Keep `$` and TeX backslashes correct through JSON escaping. An equation's TeX is not a JSON string unless embedded in a configuration that explicitly defines it. Keep document-scoped `newcommand` definitions near their first use; core MathJax packages are base, ams and newcommand. Declare allowlisted additions in article `math.packages`; see [math authoring](math-authoring.md). Physics is opt-in because it changes some standard macros. Never assume a full TeX installation, package loading, shell escape, `input`, custom font packages or arbitrary HTML are available.

Labeled equation directives own numbering; remove their TeX `label`/`tag` after converting references. Preserve existing unwrapped math as-is. Put an explicitly authored display number in ordinary prose only when its historical value matters, and explain that choice in the report.

## Report rather than silently simplify

GFM does not support rowspan/colspan, nested tabulars or full `siunitx` alignment. Report those constructs and either split the table into semantically equivalent simple tables or request a manual diagram/image decision. Do not flatten merged headers if it changes meaning.

Report unresolved macros and citations, missing images, ambiguous labels, unsupported environments, TikZ/PGF output needing an exported asset, missing numerical chart data, and any manual editorial rewrite. Preserve the original symbol/meaning rather than inventing a replacement. Do not manufacture a bibliography entry, DOI, quotation, measurement or chart from a visual impression.

## Local validation and review

```sh
npm run markdown:check -- draft.md --json
npm run markdown:check -- draft.md --syntax-only
```

The default check also renders MathJax, Mermaid and charts. It does not write source or build the site. It returns a nonzero exit code for errors and emits file/range/code/message diagnostics with `--json`. Syntax-only checks are faster and cannot prove renderability of math/diagrams. Stdin is accepted with `-`.

Fix reported errors and repeat the check. Inspect the rendered draft in Studio: compare mathematical signs, subscripts, equation references, table units/precision, figure captions, bibliography links and narrative order with the original. Test charts by hovering/focusing and inspect their data tables. Validate assets and published local links through the normal build before publication.

Import the finished file using the existing Markdown import flow or create a draft and paste its body. Resolve revision conflicts through Studio. Keep conversion reports and original sources outside public content unless the author explicitly wants to publish them.

[A small source/target pair](conversion/example.tex) and [its Markdown](conversion/example.md) demonstrate the label, proof, table and bibliography conventions. [The future MCP contract](mcp-authoring.md) describes how these same capabilities can be exposed later; no MCP server is installed by this workflow.

## STEM and algorithm conversion

Map supported physics, mathtools, units and chemistry notation to the article package allowlist before validation. Do not translate `siunitx` to an invented MathJax package. Preserve mathematical meaning and document any rewritten units/macros. Convert algorithm2e/algorithmicx structure into the bounded [pseudocode notation](pseudocode.md), using an enclosing labelled `algorithm` directive when references are needed; keep unsupported layout or semantics explicit in the conversion report. Inline highlights can use `==text==` or `:mark[text]`.
