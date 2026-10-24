# Reset notebook data

Studio → Site settings → **Reset notebook data** → **Review data reset** prepares a reset that keeps site settings. Flush active site, connection and launcher edits before preparing the review. The review names the site, counts the affected data, lists retained site media and offers a recovery download. Its destructive action requires the exact text `RESET`. Preparing a fresh review clears that confirmation immediately and blocks downloads until the new recovery copy is ready.

## Hosted reset

Hosted Studio retains an immutable reference snapshot, keeps settings, connections and their private artwork/originals, and clears authoring data through native version-checked D1/R2 staging. Previous backup references move to seven-day recovery. No CI build or public deployment starts, and the current public site remains available. Publish explicitly when the cleared notebook should replace it. Both the review and retained recovery links assemble a portable archive through the browser worker; a stored compressed archive is not required. Restore it in Backups. Shared physical blobs remain protected until all retained references expire or are reviewed and purged.

## Local filesystem reset

The reset clears all Writing/Lab Markdown, photo moments/albums/legacy news, About introduction, image publication choices, unused-by-settings media, Trash, revisions, collection Undo, About history, saved notebook backups, build history/artifacts, temporary imports/exports, renderer caches and reports. It rebuilds a validated empty public artifact locally, replacing old `dist/` routes and assets. It does not publish or remove anything from Cloudflare Pages, R2 or GitHub discussions.

Keep `content/site.json` byte for byte, including identity/profile, appearance, collection names/paths, home curation and integration/publishing settings. References to removed entries/photos stop resolving in the homepage; explicit custom site links must still be valid for the empty build. Keep `.studio/connections.json`, launcher settings, automatic-backup preferences, runtime ownership, compiled Studio/reader code, Git and browser-local reader/editor preferences. Retain all files explicitly referenced by site settings, including wallpaper, portrait, branding and sharing artwork; keep their private originals and only their still-used variants. Missing site media or invalid custom links block preparation rather than silently changing settings.

A fresh portable version-2 recovery archive passes the ordinary backup checksum/schema/image-history validation before the review becomes available, then is included in the same transaction as the reset. It contains the current canonical notebook and private revision/Trash/image history, using ordinary backup bounds and exclusions. Credentials, generated builds and previous backup archives are not inside it. The copy lives in `.studio/reset-recovery/{uuid}.json.gz`, with version-1 checksum metadata beside it. The Local Studio section exposes its download after reload/restart. Restore it through the ordinary Backups review. Each reset replaces earlier reset copies with one fresh copy; old archive removal is stated in the review. Reset recovery data stays outside portable/public output.

Private interfaces:

- `GET /api/notebook/reset`: lists retained recovery downloads.
- `POST /api/notebook/reset/review`: returns the counts, kept files, 20-minute review ID, source revision and recovery-download URL. It does not change canonical files.
- `GET /api/notebook/reset/:id/backup`: downloads a prepared or retained recovery archive. Validate identity, paths and checksums.
- `POST /api/notebook/reset/:id/commit`: accepts `{sourceRevision, confirmation: 'RESET'}` and returns the retained recovery and cleared counts.

Reviews are bound to the selected notebook and complete source/history/artifact/settings file graph, including bytes and new files. Keep at most two in memory. Any changed review requires preparation again. Reject active jobs, scheduling, automatic backups and notebook restore. Store maintenance gates newly queued work; reset mutations use the existing local origin/session-token checks. Clear process-owned jobs, previews, import/backup/cleanup reviews and export tickets only after a successful commit, then emit ordinary history/filesystem updates.

The common transaction installer uses a version-2 reset journal bounded to 50,000 source/history/artifact files, so a large retained build history can be cleared together. Ordinary version-1 batches keep their 10,000-file bound; portable backup limits remain unchanged. Failed installation rolls back; an interrupted applying journal is recovered before the next queued snapshot/startup. Unexpected external edits stop recovery rather than being overwritten. Reject symbolic links. Keep path extensions constrained to the explicit reset-owned directories and never include connection/launcher files in deletion changes. Browser tests use a temporary notebook and restore its recovery copy afterwards.
