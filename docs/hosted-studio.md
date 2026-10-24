# Hosted Studio

Glass can run as a private Cloudflare Studio while the reader remains a generated static website. The original local Studio and Pages Direct Upload commands remain available. Hosted authoring needs a browser, not a local server. Studio opens at the root of its private hostname, for example `https://console.example.com/`. Workspace sections use fragments such as `/#homepage`. Local Studio remains at `/studio/`. Legacy hosted `/studio/` links redirect to root without losing their section.

## Boundaries

- **Studio Worker**: owner-only Cloudflare Access, CSRF-protected APIs, private static assets and remote MCP. Access JWTs must match the configured team, application audience and owner email. A legitimate Access return is a top-level GET navigation; cross-site API reads and mutations remain rejected.
- **D1**: versioned file manifest, actor and job records, immutable release pointers and transactional compare-and-swap commits. Stale writes retain the author's draft.
- **Private R2**: notebook bytes, originals, revisions, recovery copies and captured job results. Connection and service settings are encrypted with a separate Studio key. Never enable public access on this bucket.
- **Reader Worker**: public static assets and the existing annotation adapter only. It has no D1 or private R2 bindings and no Studio secrets.
- **Workers Builds**: Node compilation, native image processing, production MathJax/Mermaid, Pagefind, backups and other heavy operations. The request Worker does not spawn processes or render production Markdown.

Autosave changes private content only. **Publish** captures an immutable release and starts the reader pipeline. Main-branch code pushes rebuild the approved release, rather than taking notebook content from Git. A build-only or maintenance operation never uploads the public reader. Failed deployment verification retains the URL and previous error for inspection.

Hosted live previews load canonical private `/media/` files. Resized image candidates belong to generated public artifacts, so previews omit their `srcset` and responsive preload candidates. Published pages retain their optimized responsive images.

Studio's topbar shows its package version and short source commit. Select it for the full commit, build timestamp and development/production mode. This identifies the interface loaded in the current tab, independently of the approved public reader release. Reload after deploying new code. Vite captures this metadata when it starts or builds; a star marks uncommitted application-source changes, while ordinary notebook edits do not change the label. Workers Builds uses its commit metadata, with checkout Git metadata as the local fallback; source archives without Git still show the package version and an unavailable commit.

## Dashboard-only deployment

This is the browser-based setup for a repository such as `Lapotron/Glass`. Cloudflare runs the build and deploy commands in Workers Builds; you do not run them in a local terminal. Content is then managed in hosted Studio. This is a manual setup sequence, not a one-click installer.

For Cloudflare AI without external browsing, copy the [self-contained deployment prompt](cloudflare-ai-deployment-prompt.md). It includes the application boundaries, exact commands, bootstrap and normal CI credentials, staging sequence and verification checks.

### Existing installations

After updating to root-hosted Studio, keep the existing configured hostname if desired. To change it to `console.example.com`, update `GLASS_STUDIO_ORIGIN` in both build configurations, the Worker domain and the whole-hostname Access application together. The path change does not require a new domain, database or bucket. Do not append `/studio/` to the configured origin.

When moving an existing installation to another GitHub repository, reconnect its existing Studio and reader Workers under **Settings → Builds**. Preserve their D1 database, private R2 bucket, runtime secrets and configuration. Keep `STUDIO_SECRET` unchanged: it encrypts the saved private settings. Recheck the reader Deploy Hook after reconnecting and update the saved hook if Cloudflare issues a new URL.

The following steps describe a fresh installation. The example names are defaults; see [custom names and settings](#custom-names-and-settings) before creating resources if you want different names.

### 1. Create the resources

Your domain's zone must already exist in the same Cloudflare account, with its nameservers configured. Authorize the Cloudflare GitHub integration to read `Lapotron/Glass`, including private-repository access when applicable.

Create these resources through the dashboard:

| Resource                    | Example name    | Role                                          |
| --------------------------- | --------------- | --------------------------------------------- |
| Worker                      | `glass-studio`  | Private authoring application                 |
| Worker                      | `glass-site`    | Public generated website                      |
| D1 database                 | `glass-studio`  | Active notebook manifest and job records      |
| R2 bucket, Standard storage | `glass-private` | Private notebook bytes, history and originals |

You can create the two Workers with the Hello World template before connecting GitHub. Record the account ID, D1 database UUID and account's `workers.dev` subdomain. Leave R2 public access disabled. An optional public-media CDN bucket or separate recovery bucket is a different resource from `glass-private`.

Add the Studio hostname, for example `console.example.com`, under the Studio Worker's **Domains & Routes**. Keep the reader on its `workers.dev` staging address until publication has been verified.

### 2. Configure Cloudflare Access

In **Zero Trust → Access controls → Applications**, add a self-hosted application for the whole Studio hostname. Protect `/` and all APIs, media, compiler files and assets; do not restrict the Access application to `/studio/`.

1. Add an **Allow** policy including the owner email. Enable a login method such as email one-time PIN.
2. Under **Access controls → Service credentials → Service Tokens**, create a build service token. Retain its Client ID and Client Secret privately.
3. Add a separate **Service Auth** policy to the Studio application, including that service token. Machine builds need this action; an ordinary email Allow policy does not authorize them.
4. Record the team's domain prefix and the application's Audience (AUD) tag. These are different from the Cloudflare account ID.

Studio checks the Access JWT and owner allowlist itself. The build coordinator additionally checks its own CI secret. Keep both boundaries in place. See Cloudflare's [self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) and [service-token](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) documentation.

### 3. Set runtime secrets and deployment permissions

Under the Studio Worker's **Settings → Variables & Secrets**, create two different random secrets of at least 32 characters:

| Runtime secret  | Purpose                                                     |
| --------------- | ----------------------------------------------------------- |
| `STUDIO_SECRET` | Encryption of private settings and owner-session protection |
| `CI_TOKEN`      | Authentication of trusted build clients                     |

Preserve these values for later configuration. Use fresh values only for a new installation; changing the encryption key on an existing notebook makes its encrypted settings unreadable.

Create a deployment API token scoped to this account with **Workers Scripts Edit**, **D1 Edit** and **Workers R2 Storage Edit**. For the configured domains, add **Zone Read**, **DNS Edit** and **Workers Routes Edit**. Manual dashboard Access setup does not require Access API permissions on this token. Automated private branch previews need additional Access application/policy permissions; configure those later.

Build variables and runtime secrets are separate Cloudflare settings. `GLASS_CLOUD_CONFIG` and `GLASS_CI_SECRETS` below belong to **Builds → Build variables/secrets**. `STUDIO_SECRET` and `CI_TOKEN` belong to the running Studio Worker. See [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

### 4. Add the public build configuration

Add a build variable named `GLASS_CLOUD_CONFIG`. Use the same configuration for both pipelines, replacing every angle-bracket placeholder and both example domains:

```json
{
  "CLOUDFLARE_ACCOUNT_ID": "<account-id>",
  "GLASS_STUDIO_WORKER": "glass-studio",
  "GLASS_SITE_WORKER": "glass-site",
  "GLASS_STUDIO_ORIGIN": "https://console.example.com",
  "GLASS_SITE_ORIGIN": "https://example.com",
  "GLASS_SITE_STAGING_ORIGIN": "https://glass-site.<workers-subdomain>.workers.dev",
  "GLASS_D1_ID": "<database-uuid>",
  "GLASS_D1_NAME": "glass-studio",
  "GLASS_PRIVATE_BUCKET": "glass-private",
  "GLASS_PRODUCTION_BRANCH": "main",
  "ACCESS_TEAM": "<team-prefix>",
  "ACCESS_AUD": "<application-audience-tag>",
  "ACCESS_ADMINS": "owner@example.com",
  "GLASS_ENABLE_CUSTOM_DOMAIN": "true",
  "GLASS_ENABLE_SITE_DOMAIN": "false"
}
```

All values in this JSON must be strings, including `"true"`, `"false"` and numeric limits. Store no credentials here. `ACCESS_TEAM` is the prefix of `https://<team-prefix>.cloudflareaccess.com`, not the entire URL. `ACCESS_ADMINS` must match the email allowed by the Access application.

The build script generates bindings named `DB`, `BUCKET` and `ASSETS`. The selected database UUID and bucket name must be in this configuration so future deployments bind the same resources; editing dashboard bindings alone is insufficient.

### 5. Connect and bootstrap Studio first

Select the Studio Worker, then **Settings → Builds → Connect**. Choose `Lapotron/Glass` and production branch `main`. Leave non-production branch builds off during bootstrap. Use the Studio row now and the reader row in step 7:

| Pipeline | Root directory                | Build command                                                              | Deploy command                                  |
| -------- | ----------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| Studio   | `infrastructure/cloud/studio` | `npm --prefix ../../.. ci && npm --prefix ../../.. run cloud:build:studio` | `npm --prefix ../../.. run cloud:deploy:studio` |
| Reader   | `infrastructure/cloud/site`   | `npm --prefix ../../.. ci && npm --prefix ../../.. run cloud:build:site`   | `npm --prefix ../../.. run cloud:deploy:site`   |

These commands are entered into the dashboard and executed by Cloudflare. Keep the explicit root directories and deploy scripts. The repository root's `wrangler.toml` belongs to local Pages Direct Upload; it is not the hosted Studio configuration.

For **the first Studio deployment only**, set an encrypted build secret named `GLASS_CI_SECRETS` containing just the deployment API token:

```json
{
  "CLOUDFLARE_API_TOKEN": "<deployment-api-token>"
}
```

**Omit `GLASS_CI_TOKEN` at this stage.** When that value is present, `cloud:deploy:studio` first fetches fresh credentials from the running Studio. A new installation has neither a running coordinator nor saved credentials yet.

Deploy Studio. The deploy script applies missing D1 migrations and uploads the application. Open `https://console.example.com/`, sign in as the owner, and save the deployment API token in **Site settings → Credentials** before completing the CI configuration.

### 6. Complete the build credentials

After Studio is reachable and its deployment token is saved, replace the bootstrap `GLASS_CI_SECRETS` with this encrypted JSON. Add it to the reader's build secrets when connecting that pipeline:

```json
{
  "CLOUDFLARE_API_TOKEN": "<deployment-api-token>",
  "GLASS_CI_TOKEN": "<same-value-as-runtime-CI_TOKEN>",
  "CF_ACCESS_CLIENT_ID": "<service-token-client-id>",
  "CF_ACCESS_CLIENT_SECRET": "<service-token-client-secret>"
}
```

`GLASS_CI_TOKEN` must exactly match the Studio runtime's `CI_TOKEN`. The Access service token must be included in the application's Service Auth policy. `STUDIO_SECRET` stays a runtime secret and is not a supported field in this build JSON. The saved Studio token is the source used for later Studio deployments; updating only a build's backup token does not replace the saved connection value.

### 7. Connect the reader and its Deploy Hook

Connect the reader Worker to the same repository using the reader row in the build table, the same production branch, `GLASS_CLOUD_CONFIG` and the completed `GLASS_CI_SECRETS`.

Under **reader Worker → Settings → Builds → Deploy Hooks**, create a hook for the production branch. Save its URL in **Studio → Site settings → Credentials → Workers Builds Deploy Hook**. The runtime secret `BUILDS_DEPLOY_HOOK` is an alternative for operators managing secrets directly. Hook URLs are credentials; keep them out of Git, public configuration and screenshots. See [Deploy Hooks](https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/).

A hook avoids requiring a separate user-scoped Builds API token. An account-scoped Pages token cannot call the Builds API, even when it has permission to deploy Workers. It can still serve as the deployment token when its Workers/D1/R2/domain permissions are sufficient.

### 8. Import or create content, then publish staging

In hosted Studio, import a portable notebook through **Backups → Import a notebook**, or configure a new notebook. If starting empty, upload a profile portrait or clear the starter portrait reference before the first build. Media preparation and other heavy operations use the configured build queue.

The hosted notebook is independent of repository `content/`: Git code pushes rebuild an approved cloud snapshot. They do not initialize or overwrite cloud content from Git.

Click **Build & Publish** in Studio to approve the first release. A production reader build started before an approved release exists stops with an instruction to publish from Studio; repeated dashboard retries alone cannot create that approval.

Open the exact `GLASS_SITE_STAGING_ORIGIN` and verify the homepage, an article, media and search. Inspect the matching successful deployment in Studio and Cloudflare. Studio APIs must remain unavailable on the reader hostname. A queued job or uploaded artifact alone is not a verified publication.

### 9. Enable the public domain

Keep `GLASS_ENABLE_SITE_DOMAIN` set to `"false"` until staging is verified. Then change it to `"true"` in the reader's build configuration and start a new approved publication from Studio.

For an existing Pages hostname, also set `GLASS_SITE_ZONE_ID` to the domain's zone ID. The reader uses the exact `hostname/*` route in that zone, preserving Pages DNS/project as a fallback. Deployment refuses conflicting routes and removes only its newly created first-cutover route if verification fails. Without a zone ID, the flag uses a Worker Custom Domain; use that mode when another product does not own the hostname's DNS record.

Verify the public URL and matching deployment marker before retiring any previous site. Future pushes to the configured production branch rebuild the last approved release. Studio saves remain private; **Publish** approves new public content.

### Optional isolated previews

After production works, enable non-production branch builds if needed. The preview commands are:

| Pipeline | Preview command                                  |
| -------- | ------------------------------------------------ |
| Studio   | `npm --prefix ../../.. run cloud:preview:studio` |
| Reader   | `npm --prefix ../../.. run cloud:preview:site`   |

Studio preview provisioning also needs Access application/policy write permission on the deployment token. Previews use isolated D1/R2 resources, their own encryption key and an owner-only Access application. The reader preview uses synthetic content. The production CI token and private Deploy Hook are not bound to private previews. Resource cleanup is manual; see [operation and recovery](#operation-and-recovery).

## Custom names and settings

Names in the walkthrough are examples. Choose resource names when creating them; copy account IDs, database UUIDs, Access AUD tags and zone IDs from Cloudflare rather than inventing them. R2 bucket names use 3–63 lowercase letters, digits and hyphens, without a leading or trailing hyphen; see [R2 naming requirements](https://developers.cloudflare.com/r2/buckets/create-buckets/).

The public settings accepted by `GLASS_CLOUD_CONFIG` are:

| Setting                      | Default or requirement                               | Customization and matching values                                                                                                                 |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GLASS_STUDIO_WORKER`        | `glass-studio`                                       | Studio Worker name; match the dashboard Worker and `name` in `infrastructure/cloud/studio/wrangler.jsonc`.                                        |
| `GLASS_SITE_WORKER`          | `glass-site`                                         | Reader Worker name; match the dashboard Worker and `name` in `infrastructure/cloud/site/wrangler.jsonc`. Update the staging hostname accordingly. |
| `GLASS_D1_NAME`              | `glass-studio`                                       | Chosen database's name.                                                                                                                           |
| `GLASS_D1_ID`                | Explicit UUID for dashboard setup                    | Identifies the existing database containing the notebook. A name alone is not a substitute for this UUID.                                         |
| `GLASS_PRIVATE_BUCKET`       | Explicit existing bucket for dashboard setup         | Chosen private R2 bucket containing notebook objects.                                                                                             |
| `GLASS_STUDIO_ORIGIN`        | Example code default: `https://console.example.com` | Exact HTTPS Studio origin; match its Worker domain and Access application.                                                                        |
| `GLASS_SITE_ORIGIN`          | Example code default: `https://example.com`         | Intended public website origin; match the notebook's public URL and deployment target.                                                            |
| `GLASS_SITE_STAGING_ORIGIN`  | Required for staging                                 | Exact `https://<reader-worker>.<workers-subdomain>.workers.dev` address.                                                                          |
| `GLASS_ENABLE_CUSTOM_DOMAIN` | Off unless `"true"`                                  | Enables the Studio custom-domain route; use `"true"` for the protected hostname in the walkthrough.                                               |
| `GLASS_ENABLE_SITE_DOMAIN`   | Off unless `"true"`                                  | Enables reader domain deployment after staging succeeds.                                                                                          |
| `GLASS_SITE_ZONE_ID`         | Optional                                             | Existing zone UUID for a reader route, particularly when retaining a Pages hostname.                                                              |
| `GLASS_PRODUCTION_BRANCH`    | `main`                                               | Match the production branch in both Builds pipelines and the reader Deploy Hook.                                                                  |
| `GLASS_WORKSPACE_ID`         | `glass`                                              | Stable workspace identity used by Studio/browser preferences. It does not create a separate database or namespace existing data.                  |
| `STORAGE_BUDGET_BYTES`       | `5368709120` (5 GiB)                                 | Private storage safety budget in bytes; current code accepts a positive safe integer up to 8 GiB. This does not change Cloudflare billing limits. |
| `CLOUDFLARE_ACCOUNT_ID`      | Required                                             | Account owning the selected Workers, D1 and R2 resources.                                                                                         |
| `ACCESS_TEAM`                | Required                                             | Access team domain prefix.                                                                                                                        |
| `ACCESS_AUD`                 | Required                                             | Studio Access application's AUD tag.                                                                                                              |
| `ACCESS_ADMINS`              | Required                                             | Owner email allowlist, comma-separated when intentionally allowing several owners; match the Access policies.                                     |

For example, a new deployment can use `notes-admin` and `notes-reader` Workers, a `notes-data` database, a `notes-private` bucket and production branch `production`. Set the corresponding variables, use the selected database's UUID, update both checked-in Wrangler `name` values with GitHub's web editor, and choose matching Worker/branch names in Cloudflare. Keep the build root directories and command names unchanged. Cloudflare requires the Worker name in its linked root configuration to match the dashboard Worker; see [Workers name requirements](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/#workers-name-requirement).

The code-level binding names `DB`, `BUCKET` and `ASSETS`, along with the documented variable/secret keys, stay fixed. Customize the resource names they point to rather than renaming those bindings. Renaming bindings requires coordinated code changes.

For an established installation, changing a setting is not a data migration. Selecting another database or bucket does not copy existing data. Copy and verify data before switching bindings, retain the old resources until verification, preserve the encryption key, and update origins, Access configuration, staging addresses and hooks together when changing Worker names or domains. Explicit individual build environment variables take precedence over values in `GLASS_CLOUD_CONFIG`; remove stale overrides when editing the JSON.

Optional public-media R2 destinations and ACA Worker/database names are configured independently through their Studio settings; see [publishing](publishing.md) and [ACA](aca.md). The separate [dynamic prototype](dynamic-prototype.md) also owns its own deployment target. A separate private recovery bucket can have its own valid name and is not selected through `GLASS_PRIVATE_BUCKET`.

## Dashboard troubleshooting

| Symptom                                                       | Check                                                                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| First Studio deployment tries to fetch deployment credentials | Omit `GLASS_CI_TOKEN` from the bootstrap build secret. Add it after Studio is reachable and its token is saved.                           |
| `Save the deployment token in Studio Credentials first`       | Sign in and save the token in Studio before enabling the complete CI secret configuration.                                                |
| Worker name mismatch or automatic name-fix PR                 | Match the linked dashboard Worker and its checked-in root Wrangler `name`; keep the retained root Pages config intact.                    |
| Missing entry point or assets directory                       | Use the explicit infrastructure root and custom build/deploy commands in the table. Generated artifacts are created by the build stage.   |
| Build gets an Access login page or authentication denial      | Check service token values, expiration and the Service Auth policy, then the separate CI token match.                                     |
| Deploy stops with `fetch failed` / `unexpected redirect`      | The CI request reached a redirect before Wrangler ran. Follow the Access/build credential checks below; do not enable redirect following. |
| Owner sign-in is rejected                                     | Match `ACCESS_TEAM`, application AUD and owner email to the Access application protecting the exact Studio origin.                        |
| Reader says there is no approved release                      | Configure the reader Hook and publish from Studio once.                                                                                   |
| Build still uses old credentials                              | Update the saved Studio token; later deployments fetch it from the private coordinator.                                                   |
| Public deployment verification fails                          | Check exact origins and deployment marker; retain and inspect the returned URL before another upload.                                     |
| D1 free daily write quota reached                             | Preserve unsaved drafts and wait for reset at 00:00 UTC; see recovery below. Repeated writes do not lift the limit.                       |

### CI redirects during Studio deployment

If the build ends with `Hosted Studio artifact` and `Success: Build command completed`, but `cloud:deploy:studio` then fails with `TypeError: fetch failed` and `unexpected redirect`, compilation succeeded. With `GLASS_CI_TOKEN` present, the deploy script first requests `/__ci/deployment-credentials` from `GLASS_STUDIO_ORIGIN`. An Access login redirect prevents this request from reaching Studio; an origin redirect can also cause the failure. Lucide's `use client` warnings are unrelated to this deploy-stage error.

For a **first deployment or a recreated Studio**, use the bootstrap secret from step 5: only `CLOUDFLARE_API_TOKEN` in `GLASS_CI_SECRETS`. Remove any individually configured `GLASS_CI_TOKEN` too, since individual variables take precedence. Deploy Studio, save the deployment token in Studio Credentials, then add the complete CI secrets from step 6.

For an **existing Studio**, check these settings before retrying:

1. Set `GLASS_STUDIO_ORIGIN` to the exact active HTTPS hostname, such as `https://console.example.com`, in both pipelines. Remove `/studio/`, query strings and stale individual overrides. The `/__ci/` request must reach this hostname directly.
2. In **Workers & Pages → Studio Worker → Settings → Builds → Variables and secrets**, verify that `GLASS_CI_SECRETS` includes both `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` from the same unexpired Access service token. These are build credentials; adding them only to Worker runtime secrets does not supply them to Builds.
3. In **Zero Trust → Access controls → Applications → your Studio application → Policies**, authorize that service token with action **Service Auth** and an **Include → Service Token** rule. Protect the whole active Studio hostname. The owner's email Allow policy remains separate. An ordinary Allow policy does not perform machine authentication; see Cloudflare's [service-token documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).
4. Make sure build `GLASS_CI_TOKEN` equals runtime `CI_TOKEN`. An incorrect CI token produces Studio's `Build authentication required` response after Access has allowed the request; it does not fix an Access login redirect.

The CI client refuses all redirects and reports Access login redirects, other redirects and authentication failures separately. It never follows a redirect with build credentials or logs its login URL/query. Strict Access service-token authentication may return `401` or `403` instead of a redirect; check the same service-token pair and Service Auth policy. Fix the configuration before starting another deploy; do not bypass Access or fall back silently to a different deployment credential.

## Scripted setup alternative

The one-time `scripts/cloud-setup.ts` command can provision owned private D1/R2 resources, Access owner policy, machine service token and Studio Worker instead of manual dashboard setup. Its private `.studio/cloud/setup.json` supports safe resumption; keep it outside Git and backups intended for sharing. Do not regenerate the encryption key on subsequent deployments. This operator workflow is separate from the dashboard-only walkthrough above.

## Notebook migration

Finish saves and local jobs first. Export the explicitly selected root:

```sh
npm run cloud:export -- --root /absolute/notebook --out /private/export-folder
```

`--include-private-settings` creates a restricted export that also includes connection and service settings. It contains credentials and must never be committed or uploaded to a public bucket. The export includes canonical content, revisions, Trash, collection histories, originals, backups, build artifacts, job history and supported private reports. It excludes generated caches, process leases and machine setup secrets. A second checksum pass rejects a notebook that changed during export.

In hosted Studio → Hosting, choose the export folder, review the file count and private-settings notice, then import. Uploads are staged and checksum-checked before one transaction replaces the notebook. A newer cloud edit invalidates the reviewed version. Keep an independent recovery copy before replacing an established cloud notebook.

The one-time CI importer additionally saves the current cloud notebook privately, refuses to overwrite newly authored cloud content, and preserves newer private cloud settings. It is disabled after the initial migration succeeds. Verify file checksums and open real entries/media after import; a successful upload alone does not establish a usable migration.

## Operation and recovery

Heavy operations wait in one build queue and may take minutes. Hosting shows their status; Build history retains public build/deployment records. Heartbeats prevent long-running work appearing idle. A running job fails after 25 minutes without a heartbeat; a queued job has a two-hour allowance. Inspect Cloudflare's build log before retrying an uncertain deployment. There is no automatic retry of an uncertain upload.

Hosting can cancel an unclaimed queued request. This prevents a later build from claiming it; it does not pretend to stop a running Cloudflare build. Review its Cloudflare status before submitting another heavy operation. Hosted Media loads its file list immediately; **Check usage** explicitly queues the full reference audit.

Automatic scheduling performs a small settings/cache read while idle. Due entry promotion is captured in the build queue before the configured build/publication follows. A scheduler failure is held until the notebook changes or the author runs it manually. Automatic backup errors require review.

Private storage reservations include staged and failed-job objects, with a default 5 GiB safety budget. Removing a manifest file does not immediately reclaim immutable objects. The coordinator also limits registered heavy jobs to 100 per UTC month. These are safety limits, not Cloudflare billing measurements; check actual resource usage in the dashboard. Free Workers Builds has bounded concurrency and run time. Avoid unbounded preview resource creation and preserve D1 slots for isolated previews.

D1 Free has an account-wide daily allowance of 100,000 row writes, including index writes. Its reset is 00:00 UTC. Large imports can use much of that allowance and temporarily stop Studio saves/publication and ACA collection. Read-only Studio pages do not register actors or perform no-op writes. Already-reserved objects avoid repeated storage-reservation writes. Routine captures omit old public artifact bodies from both their manifest and authorization index, retaining source/transfer metadata for recovery and asset protection. Artifact export captures the selected artifact; a full notebook reset remains an explicitly large operation.

When quota stops a rollout before upload, the private coordinator can arm `/__ci/deferred-build`. It records one bounded operational R2 item for 00:05 UTC after the reset and rebuilds only the last approved release. Cron holds routine scheduled jobs during this recovery window. An R2 conditional lease prevents duplicate triggers; a superseding approval cancels the old recovery. An uncertain trigger is retained for manual Cloudflare inspection and is never repeated automatically. Hosting shows the deferred state. This record does not bypass D1 limits or make fresh edits public; saves still wait for the quota reset.

Studio code deploys first read the migration journal. They apply SQL only when a migration is missing, allowing an unchanged schema deployment while the daily write allowance is exhausted. A read-only journal check is not proof that new migrations can run.

The preview helper permits two owned isolated preview databases, reserving account slots for production. Preview resources use the `glass-preview-` prefix and a stable branch hash. Remove obsolete owned previews and their resources through Cloudflare when those slots are no longer needed; deleting a Git branch alone does not reclaim D1/R2 resources.

Individual generated result uploads currently have a 90 MiB limit. The import format can contain many files, but larger single archives need splitting or a future streaming upload path. Private immutable objects do not yet have automatic garbage collection; retained storage can exceed the visible notebook size.

Remote MCP uses `/mcp`, a scoped authoring key, and Cloudflare Access machine credentials. Tools can inspect syntax/reference/media, prepare ordinary drafts and queue private full validation or previews. `job_status` reads only the owner's authoring jobs. Published entries and publication are outside the authoring scope. Keep tokens in the MCP client's private configuration; revoke unused keys in Hosting.

## Verification

Run repository typecheck, lint, unit tests, static build, console build, skills check and browser tests. `playwright.cloud.config.ts` exercises an isolated D1/R2 workspace and the real Node job bridge in Chromium/WebKit; it never mutates the author's notebook. `cloud-runtime.test.ts` boots the production bundle in workerd and tests auth boundaries independently from the browser seam.

Verify separately on Cloudflare: unauthenticated private URLs require Access; owner login works; imported entries, media and revisions round-trip; a real GitHub build succeeds on Linux; staging serves the exact deployment marker, expected CSP and private-API 404s. Local harness success does not prove live publication or preview isolation.

Linux Builds uses the packaged Chromium executable for static diagrams, with normal multiple-process operation. Retaining its Lambda `--single-process` flag can close Chromium when the first page context is disposed and fail later diagrams. CI verifies the canonical reader URL; the coordinator probes the configured reader `workers.dev` URL independently because same-zone Worker routes cannot be fetched as ordinary cross-Worker origins.
