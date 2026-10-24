# Scheduled publication

An entry may be `draft`, `scheduled`, or `published`. Scheduled entries require an ISO UTC `publishAt`. Studio's datetime field displays local time and converts it to UTC. `publishedAt` remains the article's displayed calendar date. Drafts and scheduled entries do not enter public routes, Archive, RSS, search, sitemap, or related articles. Explicit Studio previews may render them with noindex.

Choose Scheduled in Entry details, set a time, and save. In Site settings → Automation, enable automatic checks and choose a local build or a Cloudflare upload. The local server checks every minute while running. No remote timer is created on Cloudflare; a static deployment cannot wake the local engine.

For a computer running an external scheduler:

```sh
npm run schedule:run
```

The command checks due entries even when automatic local checks are disabled. `BLOG_ROOT` can select a notebook. If its Studio is running, the command verifies the workspace identity and forwards through the authenticated loopback API. Otherwise it owns an exclusive runtime lease while using the job journal. A second offline scheduler does not start duplicate work. Plain `npm run build` never promotes scheduled entries.

`Scheduler` persists intent in `.studio/scheduler.json`, promotes due entries through `Store.saveEntry` with a schedule revision, and waits for the existing `JobService`. Future entries remain untouched. Publication prerequisites are checked before promotion. Failed builds retain their pending entries so a manual check can rebuild them. Automatic checks stop after any failure; inspect the job before retrying an uncertain upload. Restart reconciles the last durable job.

Notebook restoration waits for active jobs and puts automatic scheduling on hold. Review restored entries, then use Check due entries to resume. Backups preserve author configuration and schedule dates, but exclude runtime job state and locks.

The implementation lives in `src/server/scheduler.ts`, `runtime.ts`, `publishing.ts`, `src/engine/store.ts`, and `src/console/ScheduleSettings.tsx`. GET `/api/schedule` returns state and upcoming entries; POST `/api/schedule/run` performs a manual check under the normal write-token contract.
