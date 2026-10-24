# Routine Studio operations

Studio manages author-owned files. These tools never publish automatically or remove objects from R2. Writing and Lab retain canonical Markdown; the public notebook remains a static build.

## Selection and lists

`Selection.tsx` supplies native checkboxes, mixed select-visible state, a shared selection toolbar, pagination and review dialogs. Lists show 25 items per page. Selection captures IDs and revisions, survives pagination and sorting, and clears when the collection, search or filter changes. Select all matching is explicit, bounded to 500 items. A filesystem refresh marks changed selections stale rather than silently replacing their revision tokens. Refresh selection adopts current versions; stale items removed elsewhere fall out of the selection.

Review dialogs name the affected items, expose failures without clearing selection, and prevent duplicate submission. Writing/Lab support search through Markdown, status/tag filters, date/title ordering, grouped Trash, duplication, status/scheduling, tag addition/removal, discussion flags and export. The retired featured controls are hidden; legacy frontmatter/API values remain compatible. Duplicates receive new IDs, routes and short codes and start as drafts without aliases or a publication schedule. The editor toolbar also reviews duplication before creating a copy; see [editor workspace](editor-workspace.md#duplicate-an-entry) for confirmation, save and failure handling. Batch metadata edits retain exact previous bytes as revisions with reason `batch`.

Build history reuses the same selection and review primitives with 10 runs per page. Read [history management](publishing.md#manage-build-history) for captured destinations, report/artifact exports and grouped local removal/undo.

Trash supports grouped restore and permanent deletion, including entry revision history and retained photo records. Empty Trash reviews the full current list, independently of filters; use batches if it exceeds 500 items. Photo Journal album moves/removals compare the whole library revision and create one undo record for the group. Photo removals additionally retain persistent receipts with individual/batch restore; see [Photo Trash](photo-albums.md#photo-trash) for the shared interfaces, Undo and backup contract. Referenced media is not removed when an entry or photo is deleted.

## Transactions and read consistency

`Operations`, backup batch changes and media cleanup run on the Store queue. Validate every selected revision and resulting schema/route before installing any changes. `commitFiles` stages before/after bytes and a version 1 journal under private `.studio/operations/{uuid}/`. Each step records a constrained relative destination and SHA-256 before/after values. Journals move from `prepared` through `applying` to `committed`; installation uses per-file rename. Multi-file operations have a 10,000-file ceiling.

Failure rolls back the whole group. Queued snapshots and Studio startup recover interrupted operations before returning notebook data. Recovery validates all rollback checksums and current bytes first. An unexpected external edit stops recovery and retains the journal for inspection instead of overwriting the edit. Do not remove such a journal as an automatic retry. Use `Store.snapshot()` for read-only consumers; code already holding `Store.exclusive` uses `read()` to avoid nesting the queue. Recovery supplies application-level consistency, not a promise that an unrelated external editor cannot observe individual filesystem renames.

## Markdown import and exports

Import reviews up to 100 UTF-8 `.md` files, at most 1 MB per file and 20 MiB total. Plain Markdown and YAML-frontmatter documents are accepted. Review reports the chosen titles, routes and ignored metadata. Commit checks its whole-notebook revision and expires after 20 minutes; at most three reviews are retained. Every import creates new drafts with unique IDs/routes, preserving body text. It never overwrites existing entries or restores old publication status. Referenced images must already exist or be uploaded separately.

A single entry downloads its canonical `.md` bytes. Multi-entry Markdown, backup and media exports stream a Unicode-safe PAX `.tar.gz`, preserving canonical filenames. Exports are prepared locally with selection/revision checks, bounded to 512 MiB total and five pending downloads. Download tickets expire after five minutes; completed streams remove their temporary files. `.studio/exports` is disposable private state, cleared at startup. Portable backup export remains a different format, suitable for complete notebook restoration.

## Backups and media maintenance

Saved backups have immutable archive identity, a user label, date, size, reason, checksum and selection revision. Rename changes the label only. Combined download/deletion validates the complete selection. Permanent-deletion review explicitly warns when the selection includes the last saved backup. Notebook restoration remains single-backup, separately reviewed and protected by a full safety backup.

Daily backups default off and run only while Studio is open. On startup, overdue enabled work is checked; subsequent checks run once a minute. Successful automatic backups are at least 24 hours apart. Keep 14 automatic backups by default (configurable 1–100); retention never deletes manual or safety backups. Build/publication, scheduling and restore work defer automatic backups. Errors hold automatic attempts until the author retries or saves preferences. Private `.studio/backup-settings.json` uses an independent revision and is excluded from portable/public output.

The media usage graph includes all entries, their covers, About, settings, collections, entry revisions, Trash, photo undo and About history. Markdown media references include links, images, reference definitions, supported directive attributes and raw HTML; ordinary code examples are ignored. Missing files are reported. Current references and retained-history references block deletion; parse failures block cleanup rather than declaring unknown files unused.

Cards and the inspector expose exact private usage locations, article status, body lines, settings fields and album details; see [media usage](media-usage.md). Local Studio offers the separately reviewed [notebook reset](notebook-reset.md), retaining site settings and one fresh recovery copy while clearing notebook data.

Unused deletion requires a review token and a fresh graph revision. Studio creates a complete `before-cleanup` backup, rechecks the graph and idle runtime, and then removes only the reviewed files. Original-source records drop deleted variants; private originals are removed only after their last derivative is removed. EXIF publication flags for removed files are cleaned up. R2 objects and accepted deployment artifacts are retained.

The Overview maintenance cards show local backup storage, missing/unused media and whether saved source differs from the latest successful job build. Cmd/Ctrl+K opens searchable commands and entries; navigation and build actions still flush the active editor and surface conflicts. Command search and new-draft title use the shared Modal's explicit `data-modal-focus` marker, applied after native `showModal`, so typing works immediately.

## Static short links

Writing/Lab metadata adds optional `shortCode` and `shortAliases` (up to 10). Codes use 3–32 lowercase letters, digits, hyphens or underscores, beginning with a letter or digit. A legacy entry's effective code is the first 12 hexadecimal SHA-256 characters of its stable ID; loading or building does not rewrite its Markdown. A normal save persists that effective code. A custom primary value is accepted in source; Studio exposes it read-only and edits aliases separately. All primary codes and aliases must be unique across the notebook, including drafts.

Published entries generate `/s/{code}` 302 rules in the Pages `_redirects` file. They resolve to the current canonical route and follow slug changes. Draft/scheduled/trashed entries produce no public rules. A dynamic rule normalizes a trailing slash. The builder reserves the existing Archive redirects and checks Pages' static-rule ceiling, following [Cloudflare's redirect contract](https://developers.cloudflare.com/pages/configuration/redirects/). Studio's local preview serves the same eligible redirects. Copy controls exist in lists and entry details; Short links supports alias editing, selected-URL copying, CSV export and batch alias clearing. No external redirect targets, click tracking or client redirect script are involved. Build & Publish activates changes on the deployed site.

## Protected email contacts

About → Profile adds an optional contact email and `protectEmailLinks` (default true). Existing profile `mailto:` links continue to work. Protected profile/footer controls and explicit Markdown/HTML mail links emit an encoded token and a neutral label; clear-text addresses and mailto destinations are absent from those initial controls. Search text comes from visible rendered content rather than Markdown link destinations. Ordinary prose and code examples are intentionally unchanged.

The self-hosted, lazy email dialog reveals an address only on activation, with Send email, Copy address, Escape/outside dismissal and focus return. Clipboard failure leaves selectable text and an explanation. With JavaScript disabled, a clear fallback explains how to reveal the address. Turning protection off retains ordinary mail links. This reduces casual harvesting; an executable client can decode the token. No third-party service, reader account or email network request is required.

## Local interfaces

All mutations retain Studio token/origin checks. Selection mutations accept `{items: [{id, revision}], action, ...}` unless specified below. Conflicts return HTTP 409 with an actionable message and optional per-item `issues`.

| Interface                                                              | Contract                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /api/content/batch`                                              | Trash, duplicate, status, tags, featured, comments, clearAliases |
| `POST /api/trash/batch`                                                | Restore or purge a selected group                                |
| `POST /api/photos/batch`                                               | `{ids, revision, action: remove/album, album?}`                  |
| `POST /api/backups/batch`                                              | Delete archives or rename a single label                         |
| `GET /api/content/:id/download`                                        | Canonical Markdown download                                      |
| `POST /api/content/import/review`                                      | Multipart `files` and `kind`                                     |
| `POST /api/content/import/:id/commit`                                  | `{sourceRevision}`                                               |
| `POST /api/content/export`, `/api/backups/export`, `/api/media/export` | Prepare a selection download                                     |
| `GET /api/exports/:id`                                                 | Stream the prepared archive                                      |
| `GET/PUT /api/backup-settings`                                         | Independent daily-backup preferences and revision                |
| `POST /api/backup-settings/run`                                        | Explicit automatic-class backup/retry                            |
| `GET /api/media/usage`                                                 | Usage graph, issues and graph revision                           |
| `POST /api/media/cleanup/review`                                       | Review `{urls}`                                                  |
| `POST /api/media/cleanup/:id/commit`                                   | Apply `{revision}` after safety backup                           |
| `GET /api/maintenance`                                                 | Local notebook status cards                                      |

Validate changes in isolated notebooks. Backend checks cover stale groups, rollback/restart recovery, imports, Unicode exports, history retention, safe cleanup and backup scheduling. Browser checks exercise real selection, downloads, undo, aliases, native Pages redirects, email reveal and keyboard commands in Chromium/WebKit. Keep public payload budgets and no-JavaScript reading intact.
