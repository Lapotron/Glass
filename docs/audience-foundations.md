# Audience insights and everyday use

The public blog remains static. Studio, its MCP bridge, imported Search Console data, cloud-maintenance journals and service-health reports are private local tools. ACA is an independently deployed Worker and D1 database. Public reader accounts and cross-device synchronization are outside this release.

## Getting started

Run `npm ci`, then `npm run dev`. Open the loopback address printed by Studio. Overview → **Studio guide** links the ordinary Write → Preview → Build → Publish workflow, backups and optional services. Service health refreshes at most once a minute while Studio is open; no email/webhook delivery is configured. The guide distinguishes configured services from verified observations. `npm run doctor` checks local configuration and a running Studio without changing settings. Use `-- --root /absolute/notebook --port 4310` for another notebook or port.

## Audience data

ACA accepts old version-1 batches and new version-2 batches. Protocol-3 status advertises capabilities; Studio can still inspect a protocol-2 service, but publishing the new collector requires a matching protocol-3 service. Deploy ACA before publishing the website. New metadata never invents historical geography. Current published settings and service controls are independent, so use **Use this ACA service**, save, then Build & Publish.

The trusted edge supplies country, continent, region, city, timezone, approximate latitude/longitude, ASN/network organization, edge location, HTTP protocol and TLS version when available. Software reports normalize browser/major version, engine, operating system and device category. Optional client observations are coarse viewport/screen, pixel-density, orientation, theme, reduced-motion and supported CPU/RAM buckets. Unsupported values remain unknown. These are observations, not verified hardware specifications. No raw user-agent strings, raw IP addresses, GPS, canvas fingerprints, search text or comment/form contents are stored.

Studio → Analytics → Audience provides History, Geography, Devices and Visits. OpenStreetMap is the default in private geography/visit views. Its Leaflet runtime loads only on intent, clusters dense markers by the current zoom, keeps visible attribution and supports keyboard pan/zoom. Tile requests go directly from the author’s Studio to OSM with an origin referrer and normal browser caching; no private report tokens or visit records are sent. Zoom stops at level 8 because city-level network estimates are not street addresses. OSM tiles have no offline download or prefetch feature. An offline vector map and exact tables remain available.

The optional textured 3D Earth uses local day/night/relief imagery, directional light, a thin atmosphere and a restrained selection ring. City-light emission supports dark mode. Its rendering dependencies load only when selected. Drag or use arrow keys to rotate; +/- zoom; Reset restores the overview. Rotation is optional and reduced motion prevents it. Rendering pauses when hidden or outside the viewport. OpenStreetMap, the offline map and exact-value tables remain usable without WebGL. Country/region/city markers use approximate network coordinates; a point or cluster is not a named person. Visits are paginated, and loaded points describe only the loaded rows.

Daily network estimates use the existing short-lived site/day address hashes. Anonymous visits remain unlinked across days. Optional history requires both service **Optional cross-day history** and website **Offer optional cross-day history**. The privacy dialog at `/settings/#privacy` lets readers explicitly opt in, withdraw/delete retained linked data, or disable ACA. The footer Privacy button is hidden. There is no first-visit banner or extra Reader Settings panel. DNT/GPC overrides opt-in. Withdrawal stops linked collection immediately; a failed deletion keeps the identifier only for retry. Anonymous aggregates remain. Browser identities rotate after twelve months; losing local storage prevents presenting the old identifier for deletion.

Anonymous and consented measurements remain separate: estimated daily networks are not range unique visitors, and consented unique browsers are not people. Consented returning-browser rates and cohorts can coexist with daily network estimates. Raw observations expire after 90 days, committed aggregates after 730 days, and inactive consented activity after 366 days. Retention curves keep their minimum sample requirements.

Quality reports retain averages and add explicitly approximate p50/p75/p95 from bounded, mergeable logarithmic histograms. The displayed percentile is a bin upper bound, not an exact raw-event percentile. Counts show how many observations support it. Historical events without bins remain unavailable. Summaries publish only after all views, audience groups, events and histograms commit as one generation.

## Search Console imports

Analytics → Reach → **Search performance** accepts one exported Google performance CSV table at a time. Choose its actual date range, review the detected dimension and rows, then confirm. English and Chinese header aliases are supported. A matching property/dimension/range replaces its earlier import only after review; concurrent changes invalidate the review. Dates retain `America/Los_Angeles` reporting boundaries, separate from ACA's UTC dates. Exported dimension tables are labeled partial; table totals describe imported rows. CTR is calculated from clicks/impressions, never by averaging percentages. Missing metrics stay unavailable. Imported data lives privately under `.studio/search-console`, supports reviewed removal, and is excluded from public builds and ordinary portable notebook backups.

## Saved reading

Use **Save to reading list** in an article footer and **Reading list** in the site footer. Bookmarks and reading positions stay in the current browser, independently of ACA consent. On return, Resume offers the saved passage without overriding an explicit URL fragment. Stable entry IDs and the published reading catalog reconcile renamed routes. Changed text falls back to an approximate position. Removed entries remain visible as unavailable. Import/export moves a bounded reading list between browsers; imported destinations and anchors are validated. Clear explicitly removes bookmarks and positions. Storage failures never interrupt reading.

## Cloud media

Media library → **Cloud storage** scans the configured R2 prefix and shows matching hashes, bytes, ownership and protection. New publication keys use `<prefix>/v2/<sha256>.<canonical-extension>`; different local filenames with identical published bytes and MIME share one upload and verification. Distinct responsive pixels, encodings and private originals remain distinct. Canonical Markdown and same-origin viewer fallback files are unchanged.

Existing CDN URLs remain valid. A private ownership ledger survives build-history removal. Every retained artifact is protected, and untracked remote Pages deployments block cleanup. Unknown ownership is never inferred from a filename. Only owned, unreferenced objects outside a seven-day recovery window can enter a 1–100-object review. The review expires after ten minutes or an inventory/target/credential change. Cleanup verifies metadata and actual bytes, rechecks references before deletion, and records partial or complete results privately. It is serialized against publication and never runs automatically. Storage deletion and cached CDN availability are different states. **Check CDN delivery** verifies a sample's bytes/cache and GET/HEAD CORS.

## Local AI authoring

Overview → Studio guide → **AI authoring** copies a ready-to-use MCP stdio configuration containing absolute executable/loader paths, the notebook root and local port. It contains no credentials. Start Studio for that notebook before connecting. See [the implemented MCP contract](mcp-authoring.md). MCP can read capabilities/templates and scoped links/media, validate, preview and create/revise drafts. Published entries remain read-only; publication is an ordinary reviewed Studio operation.

## Operations and recovery

Service health retains issue first/last observation and resolution state, distinguishes quiet traffic from stalled work, and reports soft-budget pressure. Cloudflare CPU quantiles are actual provider measurements in milliseconds, converted from the provider's microseconds; missing Account Analytics Read permission or unavailable provider data remains explicit. These figures are not billing guarantees or proof of capacity under another workload. Export diagnostics contains statuses and measurements, not credentials or raw audience records. See [service recovery](service-recovery.md) for Worker and database recovery.

Map implementation references: [Leaflet reference](https://leafletjs.com/reference.html), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/). Automated browser tests intercept tile requests and never scrape OSM tiles. `src/console/AudienceMap.tsx` owns the provider boundary for future replacement.
