# Photo journal albums

`library.albums` defaults to `[]`; existing notebook JSON loads without rewriting files. Each explicit album has a stable `id`, `name`, public `slug`, optional `description`, optional canonical media `cover`, and retained `aliases`. Photos keep their existing string `album` membership for compatibility. Metadata and membership are saved atomically through the ordinary whole-library revision contract.

Albums that exist only as photo membership are derived on read. Their routes retain the previous heading-slug convention. Editing one creates explicit metadata. New empty albums are visible in Studio but do not generate empty public pages. Life derives its count, covers and date ranges from actual photos.

Renaming an album updates its photos in the same save. Changing its public path retains the old slug as a native Pages 301 redirect; aliases cannot collide with another explicit or derived album. Album routes use `/{collections.life.path}/{slug}/` (default `/life/{slug}/`). See [collection settings](site-settings.md#content-names-and-paths) for the configurable Life name/prefix and retained prefix/album aliases. Renaming the display name can keep the existing slug. A cover must belong to the album to be effective; if its photo is later moved/removed, the newest remaining photo becomes the automatic cover.

Deleting an album requires a destination name when it contains photos. Missing or unchanged destinations keep the dialog usable and explain the problem. The operation moves membership and removes metadata while preserving all photo/media records. Album dialogs capture the library revision when opened and preserve edits on an external-change conflict; they cannot overwrite a newer library through a refreshed UI. The existing Undo last change restores the preceding library, including metadata. Removing a photo keeps its media in the library; media cleanup includes active/retained album-cover references.

Photo dialogs keep screen-reader descriptions nonempty. Saving trims an explicit description or falls back to a nonempty caption. If both are absent, the dialog retains input, focuses the description and explains what is missing. Album/date/media validation uses readable field names rather than raw schema error JSON.

Studio uses the same shared controls/materials for album editing, cover selection, selection/batch moves and photo dialogs. Keep a 32px gap below the photo grid before pagination. Public album cards link directly to their pages and use fixed-aspect covers, quiet metadata and bounded hover motion. Photos retain the shared image viewer and its existing download/EXIF behavior.

## Public album browsing

The collection index provides Albums and All photos links. JavaScript adds keyboard tabs and shareable `?view=albums|photos` state, including back/forward restoration; without it, both sections and native links remain readable. Album cards use fixed-aspect covers. Photograph grids use source-order CSS columns with natural image ratios, captions below images and the shared viewer. Album detail keeps breadcrumbs and previous/next albums.

## Photo Trash

Photo journal's **Photo Trash** button opens the shared Studio Trash with the Photos filter selected. The sidebar Trash also includes photos alongside Writing and Lab. Search includes captions, descriptions and album names. Rows show a viewer-enabled thumbnail, original album, taken date and deletion date; selection, sorting and pagination reuse the shared management controls. Restore and permanent deletion use a captured, named review, with stale selections and errors retained.

Removing a photo individually, in a batch or through an ordinary library save retains its complete photo record and former array position in private `.studio/trash/photos/photo-{uuid}.json`. Version-1 receipts contain `id`, `kind: photos`, `photo`, `position` and `deletedAt`; the SHA-256 of the exact file is their selection revision. Canonical `library.json` contains active photos only. Removing an album still moves membership and does not trash photos. Image files, private originals and EXIF publication preferences remain intact.

`POST /api/photos/batch` keeps its `remove|album` actions with unique IDs and the whole-library revision. Validation and receipt/history/library writes run together on the Store queue and journal. `GET /api/trash` returns entry and photo receipts. `POST /api/trash/batch` accepts a mixed selection and `restore|purge`; restoring photos additionally requires the reviewed `libraryRevision`. It restores selected photos into the current collection rather than replacing later edits, preserves their original albums/metadata, and refuses occupied photo IDs or invalid album routes. Mixed entry/photo operations succeed together or leave the complete selection unchanged.

Undo reconciles matching photo receipts with the restored collection; undoing an addition or a Trash restore moves the newly removed photos into Trash. Permanent deletion removes selected receipts only. Existing collection history, notebook backups and media files stay available; unused media cleanup is a separately reviewed operation. There is no automatic Trash expiry.

Portable version-2 backups include these receipts under `history/trash/photos/`, validate their schema/identity and restore them with the notebook. Older backups without photo Trash remain importable. Media maintenance treats retained photo sources as protected history; malformed receipts block cleanup. Photo Trash stays private and never participates in public Life pages, feeds, search or media delivery manifests.
