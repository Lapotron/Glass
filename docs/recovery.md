# Author data and recovery

Canonical Markdown and JSON remain the source of truth. Private recovery data lives under `.studio/` and is excluded from public output.

For batch Trash/restore/purge, backup labels and combined downloads, optional daily backups and interrupted-operation recovery, read [Studio operations](studio-operations.md). Large portable backups use streaming version 3; versions 1 and 2 remain importable; operation journals, export tickets and local daily-backup preferences are excluded. Metadata batches add the `batch` revision reason while retaining exact previous Markdown bytes.

Photo records use the persistent [Photo Trash contract](photo-albums.md#photo-trash). Their receipts share the private Trash backup namespace, media-reference protection and transactional mixed restore/purge, while collection Undo stays available independently.

[Notebook reset](notebook-reset.md) creates a portable recovery archive in its own private namespace, preserves site/connection settings and their artwork, and journals the complete reset. Restore the retained archive with the ordinary Backups review; it excludes previous archive files and credentials.

## Article revisions

`Store.saveEntry` records the previous, byte-exact Markdown source at `.studio/revisions/{entry-id}/{sha256}.json` before changing it. Version 1 records carry `kind`, original `file`, `raw`, `savedAt`, and a reason. The filename digest must match `raw`, and the parsed entry ID must match its namespace. Duplicate content states share one digest.

The local API lists revisions at `GET /api/content/:id/revisions`, loads one at `GET /api/content/:id/revisions/:revision`, and restores through `POST /api/content/:id/revisions/:selected/restore` with the current `{revision}` token. Restore follows the ordinary save validation and records the version being replaced. It cannot silently replace an external edit or create a duplicate route.

Studio flushes pending Markdown and details before opening the labelled **History** tab beside Export and Duplicate. It fills the editor workspace, separately from Write/Split/Preview/Settings. The source/settings stay mounted; returning retains source selection, scroll and undo. History keeps its filters, selected revisions and scroll during view switches. Search covers titles, status, reasons and revision IDs; date/reason filters, newest/oldest order and pages of 25 keep large histories usable.

The selected saved revision compares with **Current saved version** by default, or with another saved revision. Metadata shows human-readable before/after values alongside Markdown. **Review restore** always compares the selected version against the actual current saved article, even when the workspace compares two historical versions. Confirmation restores complete validated metadata/body through the ordinary revision-checked API; display filters cannot change it. Conflicts retain the current draft and selected revision. A successful restore keeps the replaced source in history. List/load failures offer retry and stale requests cannot replace a newly selected pair.

`MarkdownDiff.tsx` lazily loads `codemirror-diff.tsx`, using pinned `@codemirror/merge` with the shared Markdown highlighting and material tokens. Article, About and formatting preview reuse it. Both panes set `EditorState.readOnly.of(true)` and `EditorView.editable.of(false)` and remain keyboard-focusable; merge accept/reject controls are omitted. No Monaco worker, icon font, CSS alias or dependency remains.

`diff.worker.ts` performs bounded computation before creating views. The limit is two seconds and 8 MiB of UTF-8 per source. Approximate regions are labelled explicitly; timeout, worker failure and oversized documents show an unavailable state rather than “No changes”. Exact source copy/download and full-document replacement patches are independent of this runtime. CodeMirror normalizes CRLF/CR/LF in its display; a line-ending-only difference is explicitly identified, while sources and patches retain original bytes and final newlines.

Auto uses Split above 680px and Inline below it. Explicit Split, Inline and Accessible modes are available. Accessible mode contains semantic earlier/current change blocks, keyboard navigation and an explicit Return action. Escape returns to the preceding comparison mode and focuses its button without leaving History. Previous/Next and the region list navigate both line ranges. Find searches read-only source. Wrapping, whitespace visibility, ignored edge whitespace and unchanged-region collapse affect display only.

Both split panes have canvas minimaps with changed-line markers, using the same measured-scroll behavior as the source editor. Minimap navigation leaves the caret intact. View options can hide them. Views, workers, minimap roots, observers and pending requests are disposed when the pair or component is replaced. History preserves mounted view state when switching back to editing. No source, query or revision data is persisted in browser preferences.

Complete read-only sources and patch downloads stay usable if a lazy chunk or worker fails. The patch is an exact full-document replacement unified hunk, not a minimal region patch, and is never applied automatically. Verify actual changes, minimap movement, accessible navigation, theme changes, load recovery, restore review and conflict handling in both browser engines, including About.

## Portable backups

Studio → Backups defaults to a streaming version-3 `.tar.gz` notebook. Choose Compatibility for the older version-2 `.json.gz` format. Saved backups live in `.studio/backups/`. Importing first produces a review of added, changed, and removed files. Restoration requires that review plus its whole-workspace revision; any newer edit makes the review stale. The author explicitly confirms restoration in a glass dialog.

The version 1 `fieldnotes-notebook` manifest contains a creation timestamp and files with canonical relative path, base64 bytes, and SHA-256. It includes all `content/` source/media plus private revision history, Trash, and photo-collection undo. Portable `history/revisions`, `history/trash`, and `history/collections` map back into `.studio/`. Generated pages, previews, jobs, runtime locks, backup archives, credentials, and unrelated files are excluded.

Legacy JSON imports remain bounded to 128 MiB compressed, 384 MiB expanded JSON and 10,000 files. Streaming version 3 supports 4 GiB compressed, 8 GiB expanded, 4 GiB per file and 20,000 files. These are application limits; available private storage and build disk/time can impose smaller practical limits. It rejects traversal, duplicate paths, symbolic links, corrupt checksums, unsupported source/history layouts, invalid schemas, and colliding routes. Staged reviews expire after 20 minutes; at most three are retained. Review is read-only for canonical source.

Restore runs under the Store write queue, revalidates the original archive, and creates a complete safety backup before replacing source/history directories. Partial installation rolls back its completed moves. Restoring does not rebuild or deploy. The file watcher is rearmed; scheduling is held for review even if restored configuration enables it. Media responses use a sandbox policy, so importing a portable asset does not authorize same-origin executable content.

Local interfaces: `GET/POST /api/backups`, `GET /api/backups/:id/download`, `POST /api/backups/review` (multipart `file`), `POST /api/backups/:id/review`, and `POST /api/backups/:review-id/restore` with `{sourceRevision}`. All mutations use the existing Studio write token. Restore waits for active build/publication/scheduling work.

## Version 2 backup additions

Portable archives now include `content/about.md`, `history/pages/about/{sha256}.json`, and `private/media-originals/{uuid}/original|record.json`. The latter maps to private `.studio/media-originals`, never public media. Validate page-history hashes and image source/derivative references before approving a restore. Version 1 remains importable; absent new directories become empty on restore. Snapshot revisions include these files, so a new image edit invalidates an older restore review. Preserve the applicable format bounds and safety rollback. See [media](media.md) and [visual pages](visual-pages.md) for the authoritative data contracts.

## Revisions across collection moves

A reviewed Post/Article conversion stores the preceding raw source under the existing stable ID with reason `batch` and moves source/history in one transaction. Earlier revisions remain readable after conversion. Restoring one uses the current collection, preserves accumulated `routeAliases` and `discussion.articleTerm`, and validates collisions before writing. Use the conversion action to move back. Duplicating creates fresh identity/routing/discussion ownership. Portable backups and Trash retain the ordinary frontmatter fields; no backup format change is needed. See [conversion contracts](markdown-ide.md#safe-collection-conversion).

## Streaming version 3 and resumable imports

The gzip stream contains a regular TAR archive. Its first member is bounded `manifest.json`: `{format:'fieldnotes-notebook',version:3,createdAt,files:[{path,sha256,bytes}]}`. Each file follows as `data/<portable path>`, with exact declared size and SHA-256. Reuse the version-2 allowlist and private-original mappings. Reject links, duplicate/unlisted/missing members, traversal and corrupt/truncated streams. Content is identified from bytes rather than the filename. Credentials, old backup archives, transactions and generated output remain excluded.

Archive creation, hashing, extraction, downloads, CI materialization and result uploads stream files. The operation journal accepts a checksum-verified `source` file alongside existing byte changes and retains its existing rollback format. Restore restages from the original archive, validates the full file graph and writes a streaming safety backup before directory installation. Free-disk checks run before packing and after reading the import manifest. Staging, safety archives and captured media require additional space beyond the final compressed size.

`POST /api/backups` accepts `{format:'large'|'legacy'}` and defaults to `large`. Saved metadata adds optional `archiveFormat:'tar'` and `unpackedBytes`; absent format retains the legacy filename. Downloads set the correct filename and stream the verified file. Combined selection exports remain bounded to 512 MiB; download larger archives individually. Notebook reset retains its existing bounded legacy recovery format.

Local and hosted Studio share these owner-authenticated endpoints:

- `POST /api/backups/uploads` with `{name,bytes,fingerprint}` creates or resumes a private 24-hour transfer.
- `GET /api/backups/uploads/:id` returns confirmed parts and expiry, never source bytes.
- `PUT /api/backups/uploads/:id/parts/:part` sends an exact 8 MiB part (shorter final part) with `X-Part-SHA256`.
- `POST /api/backups/uploads/:id/complete` assembles and validates the archive. Hosted validation uses an ordinary captured CI job. A fresh `requestId` is an explicit retry after failed validation; ordinary retries reuse the original job.
- `DELETE /api/backups/uploads/:id` discards only that inactive private transfer. It cannot discard an active job's input or touch notebook/public media.

The browser stores only transfer ID and a bounded file fingerprint, scoped to the notebook. Resume requires reselecting the original archive and verifying confirmed part hashes. Pausing stops transfer/waiting, not an already captured validation job. Upload and validation progress are separate. Reload or navigation keeps server-side staged parts; it never persists archive bytes or draft source in browser preferences. Local reviews are recreated after a server restart. Validated upload inputs remain available for restore replay and can be explicitly discarded; a successful restore releases its matching input. Selecting a completed input again explicitly requests a fresh validation rather than retaining a stale review. Review expiry remains 20 minutes.

Hosted parts use private R2 multipart objects and D1 transfer metadata from migration `0003_transfers.sql`. Reserve temporary and final storage before writes; R2 verifies assembled file SHA-256 while consuming its stream. Native Worker bodies stay bounded, and CI stages metadata after streaming large output into its content-addressed object. Completed CI/migration transfers release their exact temporary reservation; archive inputs remain resumable until expiry/discard. There is no broad immutable-object garbage collection. The default 5 GiB private budget may need a deliberate increase for multi-GiB migration with retained history; never increase it automatically.

Run `npm run quality:backups` for an isolated, real 2 GiB-plus compressed archive, exact-media restore, stale-review refusal, safety restore and peak-RSS measurement. It uses temporary fixtures and removes them after completion; it is intentionally separate from routine tests. `GLASS_BACKUP_BENCH_BYTES` can choose a smaller development fixture. Hosted infrastructure validation uses workerd/R2 multipart tests and the isolated Cloud CI browser bridge, not a production notebook upload.
