# Article paper design

`src/site/print.css` is the last import in the page-linked content stylesheet. It owns print presentation; do not restore competing print blocks to component or footer stylesheets. The same design serves browser Print, Print / Save PDF, A4 and Letter. Paper size and browser headers/footers remain reader choices.

Paper uses white, dark ink, the configured reading family, 11pt body type, restrained headings and 18mm margins. The complete article remains continuous. Public navigation, outlines, focus controls, discussions, annotations, recommendations and sharing tools are omitted. Title, summary, permitted publication/modification and author information, and a public canonical source line are retained together in the print header. The on-screen footer is omitted on paper, preventing duplicate metadata and a separate last page containing only footer details. Private previews omit the public source URL.

The glass demonstration prints as a compact plain-text specimen; its decorative backdrop/grid and refractive filter definitions are omitted. End markers and entrance veils are screen-only, avoiding empty trailing sheets.

## Component treatments

| Component           | Paper behavior                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| GFM/academic tables | Booktabs rules, repeating headers, wrapping cells and page continuation                                    |
| Code                | Monospace, wrapping long lines, neutral ink, continuation rather than one oversized unbreakable block      |
| Equations           | Existing MathJax vector drawings and equation numbers; no browser math runtime                             |
| Mermaid             | Build-rendered light SVG, source controls omitted, caption kept with drawing                               |
| Charts              | Complete light static SVG even after ECharts activation; legend preserved, controls/tooltips omitted       |
| Mindmaps            | Complete authored drawing and text outline even after branches collapse; transformed screen canvas omitted |
| Tabs/disclosures    | Every panel and authored explanation, including closed disclosures                                         |
| Comparisons         | Both original images with labels, no divider                                                               |
| Figures/galleries   | Bounded images and captions, two-column galleries                                                          |
| Academic prose      | Quiet rules, numbering, proof marks, references and footnotes                                              |
| Pseudocode          | Academic serif or code mono, neutral ink, stable gutters and build-time MathJax operator SVG; wrapping and page continuation |
| Quizzes             | Question, options and authored explanation; live response controls omitted                                 |

`::details-content` supplies no-JavaScript disclosure printing in supported browsers. Reversible beforeprint/afterprint handling opens authored disclosures as a fallback and restores their original state after printing or cancellation. It does not open chart-data or diagram-source disclosures. The footer action promotes article images to eager loading and waits up to four seconds for fonts/images; failure does not prevent printing. No canvas screenshot/PDF library, remote renderer, or public PDF endpoint is introduced.

Enhanced mindmaps retain a uniquely namespaced full drawing for paper. An expanded viewer keeps that drawing in its original article position while its interactive stage is in a dialog. Screen focus mode does not change print output.

Verify real A4/Letter PDFs as well as print-media screenshots. Inspect images, SVG/math, table continuations, captions and page breaks in both light/dark screen themes, no JavaScript, activated widgets and focus mode. Keep initial reader budgets and private/public boundaries intact.
