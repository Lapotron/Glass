# Mathematics in Glass

MathJax 4 compiles TeX to static SVG in Studio previews and production. Readers do not download MathJax. Write `$x^2$` inline, or put `$$` on separate lines around a display equation. Source previews retain the complete editable TeX.

## Packages and compatibility

Core notation always includes `base`, `ams`, and `newcommand`. Existing articles retain these defaults. Studio → article Settings → Mathematics offers Core notation, Extended STEM, Physics, and individual package choices. These are article metadata, independent of browser-local editor preferences.

```yaml
math:
  packages: [physics, mathtools, units]
```

The allowlist is `mathtools`, `cancel`, `boldsymbol`, `amscd`, `cases`, `centernot`, `extpfeil`, `upgreek`, `gensymb`, `textcomp`, `units`, `mhchem`, and `physics`. The executable list and command catalog are exported in `capabilities.json`. Unknown packages fail validation. Enabling a package affects source math, component previews, unsaved page previews, validation, and production together.

Physics is opt-in because it changes standard commands: `\div` becomes divergence; `\divsymbol` retains the division sign. `\dv`, `\pdv`, `\dd`, `\vb`, `\va`, `\grad`, `\curl`, `\bra`, `\ket`, `\braket`, `\expval`, and `\mqty` cover common mechanics, electromagnetism, and quantum notation. This is MathJax's supported subset of the LaTeX physics package, not a complete LaTeX installation.

```tex
\dv[2]{x}{t} = -\omega^2 x
\pdv{f}{x} + \div{\vb{F}}
\bra{\phi}\ket{\psi}
```

Use `\units[3]{m/s}` with `units`, `\ce{2H2 + O2 -> 2H2O}` with `mhchem`, and `\cancel{x}` with `cancel`. The `units` extension does not implement `siunitx`; do not invent `\SI` or assume a LaTeX package can be loaded from the network. `\require`, arbitrary HTML/JavaScript, shell escape, file input, and remote package loading are unavailable.

## Completion and previews

Typing `\` in math opens package-aware suggestions. The list includes symbol glyphs; the selected suggestion offers its signature, description, origin, and a rendered example. Only the selected example is rendered, with bounded caching and cancellation. Explicit completion also searches descriptions and common symbol names. The configured Complete at cursor shortcut remains authoritative.

Templates have Tab/Shift+Tab placeholders. `\begin{` offers supported environments; `\end{` offers the matching open environment. Matrix, cases, and aligned templates can also be found by their names. Argument hints follow the current command's braces. Hover a command for its signature and example. F12 on a document-defined macro navigates to its earlier definition; the command palette includes matching-environment navigation.

Definitions such as `\newcommand`, `\renewcommand`, `\DeclareMathOperator`, and ordinary `\def` are indexed without evaluation. Keep definitions in a math expression before their first use. Macro context is ordered and isolated per document; an article cannot define commands for another article.

Visible and nearby equations render first. A document may contain more than 200 expressions: 200 remains a per-request target limit, not a whole-article limit. The range-based private renderer accepts at most 2 MiB of Markdown, compiles preceding context without drawing it, validates requested AST ranges, and caps returned SVG. Unchanged results survive prose edits. Over-limit or invalid expressions remain editable with a local error and retry control.

## Author and LLM checks

Run `npm run markdown:check -- draft.md --json` with full rendering before handing off a draft. Include frontmatter package choices in the document passed to validation. Syntax-only checks cannot prove that TeX renders. Consult the generated [math reference](math-reference.md), [authoring guide](authoring.md), and [LaTeX conversion guide](latex-conversion.md).
