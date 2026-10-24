# Next development stages

The reader-settings, viewer-information, editor-alignment and optional R2 publication stages are implemented in the source. Live Cloudflare publication remains a separately verified action using configured account, project, domain, bucket and server credentials.

Routine Studio management is implemented: selection and batch operations, import/export, Trash, backup labels/retention, reviewed local media cleanup, maintenance cards, keyboard commands, stable short links and protected email contacts. Maintained contracts and limits are in [Studio operations](studio-operations.md). This does not add a personal task-list app.

The current reader and Studio also include [Projects, Pagefind search, compiled Expressive Code and dedicated Giscus themes](reader-upgrades.md), plus English, Simplified Chinese and Traditional Chinese interface catalogs. Search supports complete published text, excerpts, language/topic/content filters and keyboard navigation. Authored content and public routes retain their own language and identity.

[ACA](aca.md) supports anonymous document observations, optional daily network estimates, bounded resumable aggregation, private reports and interactive charts. Daily network estimates do not provide named readers or cross-day histories; separately opted-in browser histories can provide returning/cohort reports. The [separate Vinext prototype](dynamic-prototype.md) demonstrates a private Access boundary, server rendering and optimistic D1 note operations. Neither source implementation nor local emulator checks establish a live deployment.

The audience-foundations release implements browser-local saved reading, the local MCP authoring bridge, city-level approximate geography and a private 3D Earth, normalized device observations, optional consented history, performance percentiles, private Search Console CSV imports, Studio health issues, compatible Worker recovery, content-addressed R2 deduplication and reviewed cloud maintenance. See [audience foundations](audience-foundations.md) for operation and [service recovery](service-recovery.md) for independent rollback.

Live rollout remains separately verified: deploy/migrate ACA first, confirm protocol capabilities, then publish the reader. Cloud storage cleanup is never automatic; current duplicates may be required by retained deployments. Missing token scopes or unavailable cloud metrics must remain explicit rather than inferred from a local emulator. No plan upgrade is automatic.

Remaining deliberate extensions:

1. A concrete authenticated reader feature and account/session/deletion/cache design before promoting Vinext. The current Access administrator prototype is not a public account system.
2. Optional email/webhook service alerts when Studio is closed; this release checks while Studio is open.
3. Live Search Console OAuth/API synchronization; current private imports are reviewed CSV snapshots.
4. Cross-device bookmark synchronization and additional locale/content translation, each requiring a separate requirement.

Keep the static Pages workflow, canonical notebook ownership, focused skills, exact tables and keyboard/narrow-layout fallbacks. Validate visible behavior in Chromium/WebKit and measure actual public asset graphs. Local tests do not establish live deployment or free-tier capacity.

The segmentation/media-management stage adds combined ACA filters and private saved segments, durable joint summaries with explicit backfill coverage, readable media names, native media short links, standalone sharing and scoped asset-indexing/embed controls. See the maintained ACA/media contracts. Database migration, verified cloud rules and Pages publication remain independent rollout results. Reader language choices now use native names only, and the footer Privacy button is hidden while `/settings/#privacy` retains consent/deletion access.
