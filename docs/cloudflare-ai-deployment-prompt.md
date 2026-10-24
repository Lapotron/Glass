# Cloudflare AI deployment prompt

Copy the complete text block into Cloudflare AI. It contains the project-specific configuration and deployment sequence, so the receiving AI does not need to browse GitHub or external documentation. This copy is prepared for a first or recreated installation. Review the domain, owner email and resource names before reusing it for another installation. Replace identifier placeholders with actual account values and enter credentials through secure fields.

```text
Help me deploy Glass through the Cloudflare dashboard using GitHub-connected Workers Builds.

You cannot browse external websites or inspect GitHub directly. Use the project information below and your available Cloudflare account tools. The Cloudflare GitHub integration and build environment will retrieve the repository and dependencies.

Perform supported configuration actions in the order below. If an action requires a tool you do not have, give me precise dashboard instructions and mark it as pending. Never claim that an action or verification succeeded without evidence.

DEPLOYMENT TARGET

- GitHub repository: Lapotron/Glass
- Production branch: main
- Private Studio URL: https://console.example.com/
- Public website URL: https://example.com/
- Sole Studio owner: admin@example.com
- Installation status: first deployment / recreated Studio

Use these resource names unless existing configuration shows that I have deliberately chosen different names:

- Studio Worker: glass-studio
- Reader Worker: glass-site
- D1 database: glass-studio
- Private R2 bucket: glass-private

Discover the Cloudflare account ID, example.com zone ID, workers.dev subdomain, D1 UUID, Access team prefix and Access application audience through available account tools. Ask me only for values you cannot obtain. Never invent identifiers.

PROJECT ARCHITECTURE

Glass already implements its application and deployment scripts. Configure and deploy that application.

- Studio is a private Worker protected by Cloudflare Access.
- Studio opens at / on its own hostname, without /studio/.
- Studio stores notebook metadata in D1 and private notebook objects in R2.
- The public reader is a separate Worker serving generated static pages.
- Heavy compilation runs inside Workers Builds.
- Saving content in Studio keeps it private.
- Publishing in Studio approves a captured release for public deployment.
- Git pushes rebuild application code and the last approved cloud release.
- Repository content does not automatically initialize the hosted notebook.

Keep the public reader separate from private Studio storage and credentials.

Do not replace the application with a generic Worker, Next.js app, or a new template. Do not change its deployment commands.

RESOURCE AND DATA PROTECTION

Inspect existing resources before creating anything. Reuse the intended resources when they exist. Do not delete databases, buckets, Workers, Access applications, DNS records or existing Pages projects.

Keep the private R2 bucket private: no public development URL or public custom domain.

Preserve existing runtime secrets when reusing an installation, especially STUDIO_SECRET, which encrypts saved settings.

Keep the current example.com deployment running until the new reader has passed staging checks.

Do not display credentials, service-token secrets or Deploy Hook URLs in chat. Use secure secret-entry fields. If secure entry is unavailable, tell me exactly where to enter them.

1. PREPARE RESOURCES

Confirm that the example.com zone exists in the selected Cloudflare account.

Create missing resources:
- glass-studio Worker
- glass-site Worker
- glass-studio D1 database
- glass-private R2 bucket

Record the actual D1 UUID and bucket name. Explicitly select these resources in the build configuration below so subsequent deployments keep using them.

The application binding names are fixed:
- DB: private Studio D1 database
- BUCKET: private Studio R2 bucket
- ASSETS: generated static assets

Do not rename those bindings.

Add console.example.com as the Studio Worker's custom domain. Leave the reader on its workers.dev staging hostname initially.

2. CONFIGURE CLOUDFLARE ACCESS

Protect the entire console.example.com hostname, including its root, APIs, media and assets.

Create or reuse a self-hosted Access application with:
- An Allow policy for admin@example.com.
- An available owner login method, such as email one-time PIN.
- A separate Service Auth policy including the build service token.

Create or reuse a build service token. Its Client ID and Client Secret must belong to the same token.

The machine policy action must be Service Auth. An ordinary Allow policy can send build requests to an interactive login page.

Record:
- ACCESS_TEAM: only the team prefix, not the full cloudflareaccess.com URL.
- ACCESS_AUD: this application's audience tag.
- Service token Client ID and Client Secret, stored securely.

Do not bypass Access to make builds work.

3. CONFIGURE STUDIO RUNTIME SECRETS

In glass-studio → Settings → Variables and Secrets, configure two independent, cryptographically random secrets, each at least 32 characters:

- STUDIO_SECRET
- CI_TOKEN

These are Worker runtime secrets.

Preserve their existing values if they already belong to the intended installation.

The later build variable GLASS_CI_TOKEN must equal runtime CI_TOKEN. STUDIO_SECRET must remain a runtime secret and must not be included in GLASS_CI_SECRETS.

4. PREPARE DEPLOYMENT PERMISSIONS

Use a Cloudflare deployment API token scoped to the intended account and zone, with:

Account:
- Workers Scripts Edit
- D1 Edit
- Workers R2 Storage Edit

For example.com:
- Zone Read
- DNS Edit
- Workers Routes Edit

Manual Access configuration through the dashboard does not require adding Access API permissions to this deployment token.

Use a reader Deploy Hook later rather than requiring a separate Workers Builds API token.

If I need to create or update the deployment token manually, give me the exact permissions and secure entry location. Do not request that I paste it into chat.

5. CONFIGURE PUBLIC BUILD VARIABLES

Set NODE_VERSION to 22.17.0 in the build environments. This version satisfies the repository's Node requirement.

Create a plain-text build variable named GLASS_CLOUD_CONFIG containing the following JSON, replacing placeholders with actual discovered values.

Use this base configuration for both pipelines:

{
  "CLOUDFLARE_ACCOUNT_ID": "<account-id>",
  "GLASS_STUDIO_WORKER": "glass-studio",
  "GLASS_SITE_WORKER": "glass-site",
  "GLASS_STUDIO_ORIGIN": "https://console.example.com",
  "GLASS_SITE_ORIGIN": "https://example.com",
  "GLASS_SITE_STAGING_ORIGIN": "https://glass-site.<workers-subdomain>.workers.dev",
  "GLASS_D1_ID": "<actual-database-uuid>",
  "GLASS_D1_NAME": "glass-studio",
  "GLASS_PRIVATE_BUCKET": "glass-private",
  "GLASS_PRODUCTION_BRANCH": "main",
  "ACCESS_TEAM": "<team-prefix>",
  "ACCESS_AUD": "<studio-application-audience>",
  "ACCESS_ADMINS": "admin@example.com",
  "GLASS_ENABLE_CUSTOM_DOMAIN": "true",
  "GLASS_ENABLE_SITE_DOMAIN": "false"
}

All values must be strings, including "true" and "false".

Keep credentials out of this public JSON.

GLASS_STUDIO_ORIGIN must be the exact HTTPS origin, without /studio/, query strings or fragments.

Check for stale individual build variables that override GLASS_CLOUD_CONFIG.

6. BOOTSTRAP STUDIO FIRST

Connect glass-studio to Lapotron/Glass, production branch main.

Use exactly:

Root directory:
infrastructure/cloud/studio

Build command:
npm --prefix ../../.. ci && npm --prefix ../../.. run cloud:build:studio

Deploy command:
npm --prefix ../../.. run cloud:deploy:studio

Keep non-production branch builds disabled during bootstrap.

For this FIRST deployment, create an encrypted BUILD secret named GLASS_CI_SECRETS containing ONLY:

{
  "CLOUDFLARE_API_TOKEN": "<deployment-api-token>"
}

CURRENT BOOTSTRAP BEHAVIOR:
The deploy script uses an available build deployment API token directly; it does not contact an unavailable coordinator first. It deploys build-supplied connection defaults as encrypted runtime secrets using a private, temporary Wrangler secrets file. The optional GLASS_CI_TOKEN maps to runtime CI_TOKEN. Never regenerate or replace STUDIO_SECRET.

For older releases that always contact Studio whenever GLASS_CI_TOKEN is present, use the token-only bootstrap JSON above and remove any premature standalone build GLASS_CI_TOKEN. Update the source before relying on automatic connection defaults.

Start the Studio deployment. The custom deploy script handles missing D1 migrations and Worker deployment.

Do not substitute a bare npx wrangler deploy command. The repository root wrangler.toml belongs to a separate local Pages workflow.

After deployment, have me:
- Open https://console.example.com/
- Sign in as admin@example.com.
- Confirm that the Studio interface loads.
- Verify Studio → Site settings → Credentials reports its Cloudflare token as provided by the deployment; a second token entry is not needed. Explicit saved Studio credentials override defaults for Studio operations.

Do not move to the complete CI configuration until these steps are finished.

7. ENABLE NORMAL CI AND THE READER PIPELINE

After Studio works, replace the Studio's bootstrap GLASS_CI_SECRETS with:

{
  "CLOUDFLARE_API_TOKEN": "<deployment-api-token>",
  "GLASS_CI_TOKEN": "<exact-runtime-CI_TOKEN-value>",
  "CF_ACCESS_CLIENT_ID": "<service-token-client-id>",
  "CF_ACCESS_CLIENT_SECRET": "<matching-service-token-client-secret>"
}

Configure the reader with the same complete build secrets and base public configuration.

Connect glass-site to Lapotron/Glass, production branch main.

Use exactly:

Root directory:
infrastructure/cloud/site

Build command:
npm --prefix ../../.. ci && npm --prefix ../../.. run cloud:build:site

Deploy command:
npm --prefix ../../.. run cloud:deploy:site

Create a production-branch Deploy Hook under the reader Worker's Builds settings.

Have me securely save that hook URL in:
Studio → Site settings → Credentials → Workers Builds Deploy Hook

The Studio runtime secret BUILDS_DEPLOY_HOOK is an alternative when managing the hook directly through runtime secrets. Do not expose the hook URL.

The first automatic reader build may stop because no approved release exists. Do not repeatedly retry it. The next step creates the required approval.

8. CREATE THE FIRST APPROVED RELEASE

Have me import my portable notebook through:
Studio → Backups → Import a notebook

Alternatively, I can configure fresh content in Studio.

Do not assume Git repository content has been imported.

Verify that:
- The notebook's canonical site URL is https://example.com.
- Its configured account matches the deployment account.
- Referenced media exists.
- Any unused starter portrait reference is cleared.

Have me click Build & Publish in Studio.

Keep GLASS_ENABLE_SITE_DOMAIN set to "false". This first publication must target the configured workers.dev staging origin.

Verify, or ask me to verify in a browser if your tools cannot access URLs:
- Homepage loads.
- An article loads.
- Images load.
- Search works.
- The deployed release marker matches the build.
- Studio APIs are unavailable on the public reader.
- Private Studio remains protected by Access.

A successful build or uploaded artifact alone is not proof of a working public deployment.

9. ENABLE THE PUBLIC DOMAIN

Only after staging checks pass, change GLASS_ENABLE_SITE_DOMAIN to "true" in the READER build configuration, then publish a new approved release from Studio.

First inspect whether example.com is already served by Pages or another deployment.

If preserving an existing Pages site:
- Add GLASS_SITE_ZONE_ID with the actual example.com zone ID.
- The project uses the exact example.com/* Worker route.
- Preserve existing Pages DNS and the Pages project as fallback.
- Do not overwrite a conflicting Worker route.

If no existing product owns the hostname's DNS:
- The generated configuration can use a Worker Custom Domain without GLASS_SITE_ZONE_ID.

Verify the public URL and matching release marker before retiring any previous deployment.

10. TROUBLESHOOTING AND COMPLETION

If compilation succeeds but deployment fails:
- Separate the build result from the deploy result.
- Read the complete error after triggerUncaughtException.
- Large compiler chunks and Lucide "use client" warnings do not explain an Access redirect.

If CI reaches an Access login redirect:
- On older releases, bootstrap with token-only secrets. Current code uses the provided deployment token directly.
- During normal updates, check the Access service-token pair, expiration and Service Auth policy.
- Check the exact Studio origin.
- Never enable redirect following or forward credentials to a login page.

If Studio returns "Build authentication required":
- Check build GLASS_CI_TOKEN against runtime CI_TOKEN.

If Studio says to save the deployment token:
- Redeploy current source with the deployment token available in Builds, or explicitly save a Studio override. Automatic synchronization cannot grant missing token permissions.

If the reader says no approved release exists:
- Publish from Studio; a dashboard retry cannot create approval.

Keep branch previews disabled until production works. If enabled later, use:
- Studio: npm --prefix ../../.. run cloud:preview:studio
- Reader: npm --prefix ../../.. run cloud:preview:site

Studio previews require extra Access application/policy permissions and isolated resources. Never bind preview Studio to production notebook storage.

Finish with a concise status report listing:
- Actual resource names and identifiers.
- Studio and reader addresses.
- Build roots, commands and production branch.
- Bootstrap or normal-CI credential mode.
- Successful deployment IDs or source commits, when available.
- Checks actually completed.
- Remaining manual steps and exact errors.

If your tools cannot make external HTTP requests, mark browser verification as pending and give me the exact checks. Do not fabricate successful URL tests.
```
