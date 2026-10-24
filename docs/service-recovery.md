# Independent service recovery

Pages, ACA, its D1 database and the private Vinext prototype have independent deployment histories. A Pages rollback does not roll back ACA. Worker rollback changes code/configuration and does not rewind D1 data.

## ACA Worker

Studio → Site settings → Advanced analytics → **Service recovery** lists Worker versions. Choose one, review compatibility, then confirm. The server captures the account, Worker, credentials and database. It permits only protocol-3 versions declaring `ACA_PROTOCOL=3`, matching site/origin, identity policy and D1 binding. Target or credential changes expire the review. The ordinary ACA process lock prevents concurrent CLI/Studio deployment or recovery. After upload, Studio verifies the expected deployment ID through authenticated live status. A failed post-upload verification keeps an `uploaded` recovery journal; inspect that service before retrying.

Older versions without this compatibility declaration require a matched-build procedure: identify the corresponding public Pages artifact and database schema; restore the compatible reader first while the current Worker still accepts its older batch format; then restore the Worker deliberately. Existing open tabs can still hold newer clients, so distinguish successful page delivery from telemetry compatibility. Never automatically retry an uncertain upload.

## D1

Before a migration, record the database identifier, migration list, current Worker version and a provider Time Travel bookmark. Cloudflare's current free-tier recovery window is seven days; check the actual database and provider documentation rather than assuming a paid retention window. See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

Database restoration is deliberately separate from the Worker rollback button. Pause collection, inspect the intended recovery point and its expected loss of subsequent observations, and use the provider's reviewed restore procedure. Preserve/reapply later withdrawal tombstones before accepting linked events again; restoring an older database must not silently revive withdrawn identities. Recheck migrations, protocol/site/origin, private report authorization, ingestion CORS and a real report. Resume collection only after those checks.

Current audience migrations are additive. An interrupted summary keeps its preceding committed generation, and bounded maintenance resumes from its cursor. A stuck generation, quota pause or missing cron should first be diagnosed through Service health and Quality; database restoration is not a routine fix for an empty graph.

## R2 and Pages

Retained build/transfer manifests protect CDN objects. Never delete objects to fix a deployment authentication error. Inspect Cloud storage for ownership and retained-deployment blockers before reviewed cleanup. A Pages artifact keeps same-origin image fallback bytes. Restoring a previously accepted Pages artifact must retain its referenced R2 versions. CDN cache purge does not restore an object removed from storage.

Private journals live under `.studio/services/rollback`, `.studio/cloud-media/operations` and `.studio/health`; keep them out of public artifacts. None of these actions deletes statistical data or upgrades a Cloudflare plan automatically.
