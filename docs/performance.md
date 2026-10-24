# Asset and loading baseline

Run `npm run quality:report` after a successful public build. It records raw and gzip sizes, follows static JavaScript imports, and lists the largest deferred chunks in private `.studio/reports/assets.json`. The report never enters Pages or R2 output.

The contrast and local-settings release baseline is approximately:

| Initial asset       |       Raw |     Gzip |
| ------------------- | --------: | -------: |
| Prepaint appearance |   9.6 KiB |  3.8 KiB |
| Public stylesheet   | 112.9 KiB | 22.5 KiB |
| Public client       |  53.1 KiB | 18.5 KiB |
| Initial total       | 175.5 KiB | 44.7 KiB |

PhotoSwipe and its information/download tools load only when opening a viewer. Lightweight registered widgets load on demand; MathJax and Mermaid SVG are compiled during the build. Public pages do not load CodeMirror, Monaco, Prettier, QR generation, EXIF parsing or the R2/S3 client. The Studio's source and revision editors remain separate lazy modules. Current budgets and rendering boundaries are maintained in [production performance](production-performance.md); the table above is a historical release baseline.

Review the report when changing shared controls or appearance startup. Preserve the standalone classic appearance script, avoid pulling a server renderer into browser code, and keep information manifests lazy. Use browser request traces, settled screenshots and real deployment checks to assess loading behavior; byte counts alone are not a network-speed measurement.

For engine and Studio algorithms, run `npm run quality:workspace -- --label optimized`. It creates and removes an isolated generated notebook and records timings/counters in `.studio/reports/`; it never benchmarks by rewriting the author's files. Cache ownership, invalidation, measured before/after results and desktop/mobile reader profiles are maintained in [production performance](production-performance.md#reusing-local-work).
