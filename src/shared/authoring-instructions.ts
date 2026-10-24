/** Product authoring guidance; independent of local development-assistant configuration. */
export function authoringInstructions(target: 'pack' | 'cloud' | 'mcp') {
  const guide = (name: string) =>
    target === 'mcp'
      ? name === 'markdown-reference'
        ? 'glass://authoring/reference'
        : 'glass://authoring/guides/' + name
      : (target === 'pack' ? 'references/' : './') + name + '.md';
  return `---
name: glass-markdown-authoring
description: Compose and convert research notes, STEM articles, tutorials and algorithms into validated Glass Markdown using supported components and the private draft workflow.
---

# Compose Glass Markdown

Use the versioned capabilities and [Markdown reference](${guide('markdown-reference')}) as the syntax authority. Read the [math guide](${guide('math-authoring')}), [algorithm guide](${guide('pseudocode')}), [diagram guide](${guide('diagrams')}) and [editor guide](${guide('markdown-ide')}) when relevant. Do not invent directives, packages or configuration keys.

## Workflow

1. Establish the intended reader, purpose and source material. Choose a research-note, tutorial, visual, STEM or code-project template. Produce ordinary editable Markdown in one continuous reading flow.
2. Preserve the author's facts, equations, citations, media descriptions and intended structure. Resolve local links and media through the notebook inventories instead of guessing paths. Report missing sources rather than inventing references.
3. Declare optional math packages in frontmatter. Physics is opt-in and can change standard commands; keep document-local macros before their first use. Supported math is a MathJax subset, not a full LaTeX installation.
4. Use pseudocode, pseudo or algorithm fences for algorithms. A numbered algorithm uses one labelled :::algorithm wrapper. The default Quicksort template uses zero-based inclusive bounds and Lomuto partition; retain its base guard and final invocation. Preserve quoted text, comments and TeX when adapting arrow/comparison notation. Deliver source without editor snippet markers.
5. Keep Mermaid self-contained, with accTitle/accDescr and meaningful authored colors. Diagrams are compiled before publication. Use ordinary Markdown panels inside ::::tabs. Group code examples with explicit project names and distinct file titles only when they should share virtual files; examples are not executed.
6. Follow the [LaTeX conversion guide](${guide('latex-conversion')}) for external sources. Report unsupported constructs and missing references instead of silently deleting or approximating them.
7. Run npm run markdown:check -- draft.md --json, or use the MCP validate_markdown tool with full rendering. Correct errors, preview, and review typography, captions, tables, mathematical meaning and exact code source.
8. Hand off Markdown and a concise conversion/validation report. When saving is authorized, prepare_draft uses the current revision for an existing draft. Keep IDs stable and status draft. Validation, preview and draft saving do not authorize publication.

## Connected authoring

Start with glass://authoring/capabilities, glass://authoring/reference and glass://authoring/templates/{name}. Use glass://workspace/links and glass://workspace/media for notebook-bound inventories. Fixed guide resources provide the supported math, pseudocode, diagram and conversion vocabulary.

Keep credentials, private history, drafts and generated recovery files out of public articles. Do not transmit a notebook to a remote renderer or invent citations. The authoring interface does not provide publication, arbitrary filesystem access, shell execution or credential export.
`;
}
