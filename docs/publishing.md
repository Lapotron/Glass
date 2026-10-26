# Build and publish

For repository-based, push-to-publish hosting without Cloudflare, follow [GitHub Pages deployment](github-pages.md). That build profile supports repository subpaths and produces a plain static artifact. The Cloudflare workflows below remain separate.

`npm run build` generates the public site in `dist/`. `npm run preview` serves it through Wrangler's Pages emulator at port 4173. `npm run build:console` compiles the local console separately; it is never part of `dist/`.

Studio's Build button saves the active editor/settings, captures source, renders the entire public site, validates the result, and records a job. Build & Publish first checks that the configured Pages project exists in the selected account, then performs that process and uploads the exact accepted artifact. Missing projects stop before compilation, R2 synchronization or Pages upload.

History uses compact rows with captured canonical/deployment links, target, dates, duration, page/file counts and recorded artifact size. Every card retains a visible Deployment row when collapsed: a recorded URL can be opened or copied; build-only runs say Not published, active publications say Pending upload, and older runs without a URL say URL not recorded. An uploaded but unverified URL is explicitly marked Unverified upload. These addresses come from that run, never from today's settings. Search by run ID, canonical or deployment URL, project, revision or error; filter status/action, sort and page through the complete history. The latest run, active runs and expanded rows show their stage and glass progress track. Build-only jobs show Build → Validate. Publication shows Build → Publish → Verify, adding Media when R2 is selected. Image synchronization and verification have separate, measured counts; the other phases are indeterminate. A stopped job keeps its failure stage and completed work visible. Only successful live verification completes a publication.

## Manage build history

Expanded runs expose IDs, source revision, completion time, published-content counts, diagnostics, generated files and a keyboard-scrollable log. Download the redacted log, export a JSON report, or download the accepted public artifact as `.tar.gz`. Artifact exports validate the captured revision and every manifest path, reject missing files and symbolic links, and support up to 512 MiB. R2 jobs export their accepted `delivery-public` output; ordinary builds export `public`. Source snapshots, Studio and private journals are excluded. The “Current local site” link opens the current notebook renderer, not a historical preview.

Run again starts a fresh build from saved content and current settings through the existing save/build flow. It does not republish an old artifact. An uploaded deployment that failed live verification remains explicitly unverified. **Recheck deployment** probes its recorded URL and captured canonical domain again without building or uploading files. It requires the current history revision, preserves the preceding failure in its log and marks the run successful only when the exact build marker and all route/security probes pass. A failed recheck retains the upload URL. This handles a deployment that became available after its first verification; a different or stale build remains unverified.

Native selection supports report export and reviewed removal of up to 500 completed runs. Active jobs cannot be removed or included in a stable report export. Every selected revision and disk record is checked before the whole group commits. Removal deletes only local job records; artifacts, source snapshots, `dist`, notebook data and Cloudflare deployments remain available. Undo restores the group without overwriting another job, including after server restart while its private receipt is retained. The visible undo action lasts for the current history view.

`GET /api/jobs` and bootstrap include the complete history with a derived `revision`. `POST /api/jobs/history/remove` and `/api/jobs/history/export` accept `{items:[{id,revision}]}`. Removal returns `{undoId,removed}`; `POST /api/jobs/history/:id/restore` restores that receipt. `POST /api/jobs/:id/artifact` accepts `{revision}` and returns a short-lived `/api/exports/:id` download. `GET /api/jobs/:id/log` downloads the redacted text log. These remain loopback-only Studio APIs with normal origin/session checks. Receipts live in `.studio/job-history`, outside notebook backups and public output. SSE `job-history` messages carry `{removed,restored}` so all open Studios update; delayed bootstrap responses must not resurrect removed runs.

New runs retain `target: {canonicalUrl,project,branch}` from their captured configuration. Legacy targets are recovered only from that build's own `source.json`; missing snapshots show an unknown historical target rather than today's URL. `BuildResult.totalBytes` and `contentCounts: {posts,lab,media}` are optional for old artifacts. Unrecorded counts and size remain explicitly unknown.

When Giscus is enabled, generated `_worker.js` provides the credential-free, read-only annotation index through `/api/annotations/*`. `_routes.json` limits function invocations to that path; the remaining site stays static. The worker forwards other requests to the ASSETS binding and exposes no Studio APIs. Its public configuration contains only the configured repository/category and published, comment-enabled article IDs. Disabled integrations omit the worker, route configuration and annotation metadata. Keep `_worker.js` outside the browser asset directory, exclude source maps, and test this packaged worker in the Pages emulator. [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) supports this worker through the existing Wrangler upload command; no secret or custom binding is needed.

## Connect Cloudflare Pages

1. In Studio → Site settings → Cloudflare Pages, save an API token with **Account → Cloudflare Pages → Edit**, scoped to the selected account, in Private connection credentials. Existing `npx wrangler login` authentication works when no API token takes precedence.
2. In Studio → Site settings → Cloudflare Pages, check the connection and select or enter the Cloudflare account ID.
3. Enter an existing Pages project name or use Create this Pages project to create a Direct Upload project. Set its production branch (default `main`). Studio checks for an existing project first, creates only when missing, and confirms it appears in the account's Pages list before showing it as ready.
4. In General, replace `https://example.com` with the real HTTPS site address. Save changes.
5. Build and inspect the local output. Use Build & Publish when ready to publish.

This uses Cloudflare Pages, not Workers Static Assets. Cloudflare documents Direct Upload at <https://developers.cloudflare.com/pages/get-started/direct-upload/>. A Direct Upload project cannot later be switched to Git integration; a separate project would be needed for that workflow.

The server invokes the project-local Wrangler with `pages deploy <accepted-artifact> --project-name <configured-name> --branch <production-branch> --commit-dirty=true`. It supplies the account ID through the child environment and never accepts arbitrary shell commands from the UI.

### Project creation delegates to Workers, or the project does not exist

Wrangler 4.151.1 can delegate creation of a new Pages project to Workers in an agent session. That can fail with “Missing entry-point to Worker script or to assets directory” and leave no Pages project. This repository intentionally uses Pages Direct Upload, including the optional Pages annotation worker. Its creation command explicitly bypasses that delegation:

```sh
npx wrangler pages project create <project-name> --production-branch <production-branch> --force
```

Studio supplies these arguments and its saved credentials automatically. The flag belongs to project creation; subsequent uploads use `pages deploy` against the verified existing project. Keep the existing Pages configuration and accepted artifact path. Do not add a Worker entry point or deploy the repository directory to work around this error.

If publishing reports that the project does not exist, open **Site settings → Cloudflare Pages**, verify the account and project name, and use **Create this Pages project** or choose an existing project from the checked account. Then run Build & Publish. A failed job links back to Pages settings. A successful token check or build does not create a project. Creation and its readiness checks use one credential snapshot, and repeating creation reuses an existing target. If a command exits successfully without a matching Pages project, Studio still reports failure rather than treating a Workers deployment as Pages readiness.

Studio saves tokens in private local storage. Environment `CLOUDFLARE_API_TOKEN` remains an automation fallback when no saved token exists. See [local configuration](local-configuration.md) for storage, write-only fields, redaction and startup options.

### Authentication error 10000

An active token or successful `wrangler whoami` does not establish Pages access. R2 permissions and S3 credentials are independent. Check the token's **Cloudflare Pages → Edit** permission, account scope, expiry and IP restrictions, then save the replacement in Studio and check again. Saved tokens override Wrangler login. [Cloudflare's token setup](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/#generate-an-api-token) documents the Pages permission.

Studio checks the selected account with a read-only Pages project listing. It reports identity and Pages authorization separately, returns project names only, and clears old results when credentials or the account change. A successful listing verifies read access; deployment still requires Edit permission. It does not create a project or publish as a connection test, and it does not require unrelated user-profile permissions from an account-scoped token.

Wrangler's proxy-detection warning reports the inherited network route. An actual Cloudflare authentication response is handled separately from connection/DNS/TLS failures. Studio preserves proxy settings. When a saved token is supplied, unrelated legacy API-key/email variables are excluded from the Wrangler child so they cannot override that token.

## Verify the result

A local build is not evidence of a live deployment. A successful publish job records the URL returned by Wrangler. Open that URL and check Home, a direct article route, equations, an interactive Lab page, media, and a missing path. Confirm the canonical address and use the Pages dashboard for custom-domain setup.

Builds include a small, uncached `/assets/deployment.json` with the public build ID only. Verification checks that ID as well as public routes and security boundaries. When the returned preview URL requires Cloudflare Access, Studio leaves Access enabled and checks the captured HTTPS canonical domain instead. That domain must serve the exact new build ID; an older production deployment or a different branch cannot pass. The log identifies this alternate verification origin while retaining the original Pages deployment URL. Unexpected redirects, missing markers and older artifacts do not receive this fallback.

An upload failure leaves the accepted local artifact available and records the error. If Wrangler reports no URL after a successful exit, check the Cloudflare dashboard before retrying to avoid an uncertain duplicate publication. Unauthenticated or unconfigured environments can still build and preview locally; record the missing prerequisite explicitly.

The test suite uses a controlled command runner for failure and upload-order tests. Browser tests use a temporary source workspace. Real publication is only verified after authenticated upload and checking the returned address.

Scheduled build/upload uses the same accepted-artifact job path; see [scheduling](scheduling.md). Optional [integrations](integrations.md) add only their configured provider permissions to CSP. Backups and revision history stay private and are excluded from deployment.

## Optional R2 image delivery

Studio → Site settings → R2 media delivery selects Pages or R2. Existing notebooks default to Pages. Configure an R2 bucket, object prefix (default `media`) and an HTTPS custom media origin. A production R2 domain must be connected to the bucket; the rate-limited `r2.dev` development endpoint is not a production CDN. Pages already serves static assets globally; R2 separates media storage and caching rather than guaranteeing a speed increase by itself. See [R2 caching](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/).

Save the R2 access key and secret in Studio’s Private connection credentials, using bucket-scoped read/write credentials. Environment keys remain a compatibility fallback. The S3 endpoint derives from the selected Cloudflare account. Saved credentials are never returned to the browser. Both “Check R2 configuration” and “Test saved R2 connection” report missing prerequisites and verify read access when configured, directly in local or hosted Studio without a build. Upload and CDN delivery are verified during publication. Configure public GET/HEAD CORS (wildcard origin is suitable for these public images), without credentials, and expose headers needed for browser downloads. [Cloudflare CORS guidance](https://developers.cloudflare.com/r2/buckets/cors/).

The authenticated bucket listing cannot verify Object Write permissions or public delivery by reading a bucket alone. Transport errors expose only a safe HTTP status and recognized S3 error code: a missing bucket, denied write and mismatched signing key need different corrections. SDK messages, signed requests and raw responses are excluded. A successful compiler log does not imply that R2 synchronization or Pages upload happened; failed CI builds do not promise retained local artifacts after the temporary runner exits.

### Recover a media CORS failure

In the Cloudflare dashboard, open the configured **R2 bucket → Settings → CORS Policy**. For this blog's already-public image bucket, the dashboard policy can be:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "ExposeHeaders": ["Content-Length", "Content-Type", "ETag", "Cache-Control"],
    "MaxAgeSeconds": 3600
  }
]
```

This permits browser reads without credentials. It does not grant upload/delete access. A specific site origin may replace `*` when only that origin should read the images. Bucket-scoped object credentials do not need administrative permission to edit CORS; configure the policy in the dashboard separately.

If existing image URLs still lack CORS headers after saving, use **Caching → Configuration → Purge Cache → Custom Purge** for the media hostname. Cached responses can predate the policy. Verify the existing custom-domain image URLs with an `Origin` header matching the site; both GET and HEAD should return `Access-Control-Allow-Origin: *` or that origin. A successful request without an `Origin` header is not a CORS check. Retry Build & Publish after verification. [Cloudflare documents the cache purge requirement](https://developers.cloudflare.com/r2/buckets/cors/#purge-cache).

An immutable response already stored by a reader's browser may also predate CORS, even when a fresh GET passes. The viewer retries that read with browser-cache reload, then uses the manifest-matched same-origin image if necessary. Blob URLs do not bypass CORS. Keep the original published `/media/` files in the Pages artifact for this fallback; R2 remains the primary public image destination.

### Frozen media artifacts

The ordinary Build action keeps `/media/...` references and a complete local artifact. Publish captures one saved model, validates a normal build, then creates a separate `delivery-public` artifact. Its media resolver rewrites URL-bearing attributes, responsive/preload sources, CSS wallpaper URLs and structured photo/widget/default-theme data. It leaves canonical Markdown and visible prose unchanged. The public metadata manifest keeps canonical keys and maps its image destinations to the CDN.

Referenced rasters, their generated variants and supported document/audio/video attachments can use R2; SVGs keep their Pages security boundary. New keys use `<prefix>/v2/<sha256>.<canonical-extension>`, independent of original filenames. Identical bytes of the same validated MIME share one synchronized object, while canonical same-origin fallback files remain in Pages. Legacy filename-bearing keys remain valid. Uploads set the matching MIME type, a Content-MD5, a SHA-256 metadata field, and `public, max-age=31536000, immutable`. Four bounded workers skip matching objects, finish all uploads, then verify actual delivered bytes, MIME, immutable caching and CORS from the public media domain. An ETag is not treated as a SHA-256. Failures settle active work before disposing the transport and prevent Pages upload.

A private transfer manifest records the exact accepted files. Media progress and synchronization/verification stages are visible in jobs. Pages deployment follows successful media verification and uses the frozen delivery artifact; ordinary local `dist` remains self-contained. Existing R2 versions are retained for rollback, and no automatic cleanup runs. The separate reviewed Cloud storage workflow is documented in [audience foundations](audience-foundations.md#cloud-media). Originals, drafts, Studio, source snapshots and credentials never enter the R2 upload set.

The returned Pages deployment is checked for Home, an article, a genuine missing route, blocked Studio bootstrap and the annotation worker's JSON boundary when enabled. If upload succeeded but verification failed, the job retains the returned deployment URL and says to inspect it before retrying. A controlled test runner and verifier are test seams, not evidence of real publication.

## Production reader checks

Install the local diagram renderer with `npm run renderers:install` when setting up a new authoring machine. Run `npm run quality:report` after a build to enforce reader payload budgets. Inspect actual Pages output with JavaScript disabled and verify fingerprinted bundle caching; diagram caches, Chromium and rendering libraries stay off the deployment. For repeatable mobile measurements, see [production performance](production-performance.md).
