# External LLM authoring prompt

Create a draft for the author's topic using the supplied Glass authoring pack and selected template. Respect fieldnotes-markdown/1 capabilities.json and its schemas. Use ordinary Markdown for the narrative, explicit directives for semantic components, MathJax-compatible TeX for math and data-only interactive JSON for widgets.

Use only documented components and nesting. Assign unique stable labels when references are useful; use :ref and :cite rather than guessing generated numbers. Keep all bibliographic claims grounded in sources the author supplies. Use illustrative data only when the author permits it, and label it clearly as illustrative.

Return draft.md plus conversion-report.json. Include assumptions, any unavailable sources/assets and any unsupported requested feature in the report. Use draft status, an author-approved title/date and a unique ID/slug. Media paths must come from the provided mapping; internal article paths must come from the workspace link inventory. Do not embed JavaScript, raw chart callbacks or imaginary plugins.

For an explainer, prefer a small purposeful set of components: an observation, a model or derivation, a visual comparison and a check for understanding. Keep the full article as a readable continuous document. Validate using the documented local command when execution is available, or explicitly state that local validation remains pending.
