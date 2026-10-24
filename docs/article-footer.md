# Article footer and reader actions

Each article can end with one compact `article-bottom glass-panel`. Its identity row uses existing profile name/role/portrait and the About link. A compact metadata group sits on the right with the permitted publication date, explicit modification date, word count and reading time. It wraps below the author on narrow screens. No new identity or biography field is introduced. The complete Markdown remains in its original continuous reading panel.

`site.reading.articleFooter` defaults to true; `entry.reading.articleFooter` optionally overrides it. Optional `modifiedDate` at either level inherits effective publication-date visibility when absent. Author, publication-date and reading-time flags continue to apply. Only an explicit `updatedAt` appears as Updated; file timestamps and build times do not invent a modification date. Site controls live in Appearance → Article experience; per-entry controls use Settings → Reading and preserve omitted/false values.

Sharing includes native Share, Copy canonical link, Copy short link when available, email with article title/URL only, a QR view and citations. The canonical URL uses the configured site origin and collection route; the short link uses the entry's existing stable code. Private previews show a layout explanation without canonical/QR/citation payloads, sharing/export actions or subscription links.

QR SVG is generated server-side by `engine/article-qr.ts` and embedded in HTML with a scan-safe quiet zone. Readers never load a QR library or call a QR service. The native disclosure works without JavaScript; enhancement opens a shared-material dialog and allows SVG download.

Citation text is generated from public metadata in plain, BibTeX and RIS forms, with escaped fields and no raw Markdown export or private email. Without JavaScript all formats are selectable text. An intent-loaded native dialog adds a format selector, copy and `.txt`/`.bib`/`.ris` downloads. Clipboard failure selects visible text or reveals labelled canonical/short-link fields. Unsupported native sharing falls back to copying the canonical link; user cancellation remains quiet. There are no third-party sharing SDKs or share beacons.

The primary row exposes Share, Copy link, Print / Save PDF, an available Short link and Cite this article. More contains email, QR and selectable canonical/short-link details. A native citation disclosure remains outside More. Reader settings and section navigation belong to the outline; subscription/adjacent-entry groups are not part of this footer. Citation/QR disclosures remain useful without JavaScript.

The lightweight article-tools bootstrap enables actions only on public pages. Dialog/export logic loads after activation. All object URLs are released after download. Native dialogs own focus and Escape and return focus to the opener; no competing modal trap is introduced.

Printing uses the dedicated [paper design](printing.md). It retains permitted identity/date information, public canonical source, build-rendered math/diagrams and static widget representations. Identity, permitted dates and the canonical source appear in the print header; the on-screen footer is omitted on paper. It is independent of screen focus mode.

Same-document prose/outline heading links retain their fragment URL and browser Back behavior. Destination focus supports keyboard reading; smooth scrolling accounts for the sticky navigation clearance. Native links remain available without JavaScript. System or saved reduced-motion settings suppress travel; other pages, downloads, external targets and modified clicks remain browser-owned.

Validate public/no-JavaScript output, private preview gates, inherited settings, renamed collection paths, short links, export bytes, denied Clipboard/Share, focus return, printing and compact action visibility. Check desktop/320px, light/dark, wallpaper, enlarged text and reduced motion in Chromium and WebKit. No Studio, CodeMirror, Prettier or QR generator runtime belongs in reader bundles.

Archive rows reuse these date/count visibility rules through the shared metadata projection, independently of the footer-container toggle. `shared/article-reading.ts` owns the established word count and multilingual reading estimate used by the Markdown renderer, public articles and Studio's visible archive page. The published archive catalog contains only the permitted facts, never source text or a private revision. See [Archive](visual-pages.md#archive) for its layout and version-1 compatibility.
