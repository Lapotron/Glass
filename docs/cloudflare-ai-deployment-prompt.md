# Cloudflare dashboard deployment prompt

Copy the prompt below into Cloudflare’s assistant. It is self-contained; the assistant does not need internet access. Keep actual credentials in secure dashboard fields.

```text
Deploy the existing Glass application from GitHub, using only your available Cloudflare account tools. Do not replace it with a starter app. If a tool is unavailable, give precise dashboard steps and mark that action pending. Never claim a deployment or verification without evidence.

TARGET
- Repository: Lapotron/Glass (or the fork I explicitly choose).
- Production branch: main.
- Private Studio: https://console.example.com/ . It opens at /, without /studio/.
- Public site: https://example.com/ .
- Sole Studio owner: admin@example.com .
- Proposed names: Studio Worker glass-studio; private D1 glass-studio; private R2 glass-private; public Direct Upload Pages project glass-blog.
- Inspect existing configuration first. Reuse deliberately chosen names and real IDs; never invent an account ID, database UUID, zone ID, Access AUD or team prefix.

ARCHITECTURE
There is ONE Git-connected Studio Worker pipeline. The Worker is a private platform using native D1/R2 APIs. Saving values, uploading media, browser crop/resize, previews, history, backups and imports do not start CI. Only explicit Publish captures a notebook release for Node SSG and Pages Direct Upload. The exact captured build UUID selects publication. Ordinary Git pushes build/deploy Studio only; publication does not redeploy Studio. Optional ACA setup/rollback and explicit public-CDN scans, protection changes and reviewed cleanup use captured maintenance mode; this runs no SSG and deploys neither Studio nor the site. Never create a reader Worker for a new installation. Existing reader Workers may remain as rollback infrastructure while Pages is staged.

DATA AND ACCESS PROTECTION
Never delete existing Workers, D1, R2, Pages, Access applications/policies, DNS records or routes as a setup shortcut. Preserve the current public site during staging. Never import the repository’s author notebook into hosted Studio automatically; a fresh cloud notebook stays fresh until an explicit import.
Keep the private R2 bucket completely private: no public custom domain and no r2.dev. The optional public-media CDN bucket is a different bucket. No S3 access-key pair is needed for the private binding.
Preserve existing STUDIO_SECRET, CI_TOKEN, D1/bucket identities and Access configuration on upgrade. STUDIO_SECRET encrypts saved private settings and must never rotate as a deployment side effect. Never display credentials, service-token secrets or Deploy Hook URLs in chat or logs. Ask me to enter secrets in secure dashboard fields if needed.

1. PRIVATE RESOURCES
Verify example.com is an existing zone in the selected account. Discover account ID, zone ID, D1 UUID, bucket name and Access team configuration using available tools. Create only missing, intended private Studio Worker, D1 and R2 resources. Record actual names/IDs for explicit binding selection.

2. ACCESS
Protect the entire console.example.com hostname with a self-hosted Cloudflare Access application; no /studio/ path restriction. Owner browser login allows only admin@example.com. Preserve its existing login policy. Record the app AUD and team prefix.
Create/reuse a CI service token. Add a Service Auth policy for that exact service token across the whole hostname, alongside the owner login policy. Do not create an Access bypass rule. New machine-access policy changes require my review/confirmation before application.
Glass also verifies Access JWT signature, issuer, audience and owner email inside the Worker. API mutations require same-origin CSRF. Do not weaken either layer.

3. GITHUB BUILD CONFIGURATION
Connect the repository to the Studio Worker only. Use:
- Root directory: infrastructure/cloud/studio
- Build: npm --prefix ../../.. ci && npm --prefix ../../.. run cloud:build:studio
- Deploy: npm --prefix ../../.. run cloud:deploy:studio
- Production branch: main
The application’s dispatcher decides whether this exact build updates Studio or publishes a captured release. Do not replace the commands with a generic wrangler deploy, and do not configure an independent glass-site pipeline for daily operations.

4. PUBLIC BUILD VARIABLES
Set GLASS_CLOUD_CONFIG to a JSON object whose values are all strings. Substitute discovered values:
{
  "GLASS_STUDIO_WORKER":"<actual Studio Worker name>",
  "GLASS_STUDIO_ORIGIN":"https://console.example.com",
  "GLASS_SITE_ORIGIN":"https://example.com",
  "GLASS_WORKSPACE_ID":"glass",
  "GLASS_D1_ID":"<actual database UUID>",
  "GLASS_D1_NAME":"<actual database name>",
  "GLASS_PRIVATE_BUCKET":"<actual private bucket>",
  "GLASS_PRODUCTION_BRANCH":"main",
  "GLASS_ENABLE_CUSTOM_DOMAIN":"true",
  "CLOUDFLARE_ACCOUNT_ID":"<actual account ID>",
  "ACCESS_TEAM":"<actual Access team prefix>",
  "ACCESS_AUD":"<actual Access application audience>",
  "ACCESS_ADMINS":"admin@example.com",
  "STORAGE_BUDGET_BYTES":"5368709120"
}
GLASS_PAGES_PROJECT is optional; the owner can choose the Pages target inside Hosting. Never put secrets in this public JSON.

5. BOOTSTRAP SECRETS
Generate strong random STUDIO_SECRET and CI_TOKEN once for a new installation; save as runtime Worker secrets using secure tools. Keep them unchanged on upgrades. For the first Studio build, supply an encrypted GLASS_CI_SECRETS build secret with only CLOUDFLARE_API_TOKEN. The token requires account Workers Scripts Edit, D1 Edit, R2 Storage Edit and Cloudflare Pages Edit. Domain operations additionally require Zone Read, DNS Edit and Workers Routes Edit for example.com. Manual Access setup does not require Access API permissions on this token; automated private previews do.
A deployment token does not automatically obtain extra API permissions. Glass synchronizes supported deployment connection defaults into runtime secrets; explicit saved notebook credentials take precedence. Access service secrets remain build-only.

For an upgrade from the older two-pipeline version, explicitly set GLASS_PIPELINE_BOOTSTRAP=true in GLASS_CLOUD_CONFIG for the single transition build, then remove it. This skips the new coordinator endpoint until the new Studio version exists. Never use bootstrap as an automatic fallback after an authentication failure.

6. COMPLETE THE SAME STUDIO PIPELINE
After Studio is reachable, set GLASS_CI_SECRETS to:
{
  "CLOUDFLARE_API_TOKEN":"<scoped deployment token>",
  "GLASS_CI_TOKEN":"<same value as runtime CI_TOKEN>",
  "CF_ACCESS_CLIENT_ID":"<CI service token client ID>",
  "CF_ACCESS_CLIENT_SECRET":"<matching service token secret>"
}
Create a private Deploy Hook on the Studio Worker’s Git build. Have me save its URL in Hosting → Pages publishing setup → Studio pipeline Deploy Hook. Do not expose it in chat. A hook avoids requiring a separate user-scoped Workers Builds API token.

A 302 to Access login means the machine token pair or Service Auth policy is wrong. A JSON 401 at /__ci/ means the Glass bearer differs. Check the exact origin and build environment. Never follow credential-bearing redirects, disable Access or retry an uncertain publication blindly.

7. PAGES STAGING
Create/reuse a separate Cloudflare Pages Direct Upload project. A Git-connected Pages project cannot accept this workflow. The owner can create/check/save the Pages target in Hosting using the same scoped connection. New hosted data starts fresh; ask before importing anything.
Publish ONCE from Studio. The runner captures private notebook data, builds production static output using Node (including Mermaid/MathJax/Pagefind/native image processing), and runs wrangler pages deploy against the saved project. It does not deploy a public Worker and does not redeploy Studio.
Inspect the returned Pages deployment URL and build marker at /assets/deployment.json. Verify homepage, articles, search, media, CSP/security headers, unknown-page 404 and /api/bootstrap 404. A staged release does not change the current live-release pointer. Record the actual build/deployment status and URL; queued or uploaded is not verified.

8. DOMAIN CUTOVER LAST
Only after successful staging and my review, add example.com in Pages → Custom domains. If an old reader Worker owns that hostname, show the exact conflicting Worker domain/route and proposed DNS changes for confirmation. Keep its code/deployment for rollback; do not delete the Worker, private resources or public media bucket. Routine Publish never changes DNS or deletes routes. Verify the canonical build marker after cutover, then Publish once more to record canonical verification.

UPGRADE AND STORAGE
Disable old reader Worker automatic Git builds only after the new Studio coordinator is ready and the Studio Publish hook is saved. Git pushes update Studio only. A different Dashboard retry UUID must not claim a queued Publish; cancel the unclaimed request in Hosting and start the intended action again.
Hosting → Storage and history exposes logical categories, physical reservations, recent artifact retention, shared-cache limits, history deletion/recovery and safe cleanup. Defaults keep the latest three successful downloadable artifacts plus active/approved/live releases, and 128 MiB/seven-day shared cache. Deleted history/backups recover for seven days. Never automatically delete author media, originals or history. Shared blobs stay protected by any live reference.

For migration, the owner exports:
npm run cloud:export -- --root /absolute/notebook --out /new/export-folder
Default version-2 exports include content/media/originals/history/Trash, deduplicate payloads by checksum, and exclude generated builds/caches/jobs/archives/machine state. Hosting reads version-1 folders too. Review and import explicitly; transfers resume with checksums for seven idle days, then activate atomically. Preserve omitted private settings and a visible safety snapshot. Never declare migration complete without reading restored content and exact media bytes.

FINAL REPORT
List completed vs pending actions, actual resource names/IDs, Studio URL, Pages staging URL, canonical status, exact build result and remaining secure-entry/dashboard steps. Do not print secrets. Do not describe configuration as a verified deployment.
```
