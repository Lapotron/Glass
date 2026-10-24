# Fresh Cloudflare deployment

Deploy `Lapotron/Glass` using the Cloudflare dashboard and hosted Studio. No local server or local deployment commands are required. Commands below belong in **Workers Builds configuration fields**.

The result is one private Studio Worker, one D1 database, one private R2 bucket and one public Pages Direct Upload project. Daily editing, uploads, previews, backups and history run directly in Studio. **Publish** runs Node SSG through the Studio pipeline and uploads the generated website to Pages. Git pushes update Studio.

## Before deleting an existing installation

In the existing Studio, open **Backups**, create a backup and download its portable `.tar.gz` archive. Finish downloading every part if the browser offers split files; join them in the displayed order. Keep this download outside Cloudflare.

A saved cloud snapshot alone is not an independent backup: its manifest and shared media are in the private bucket. Deleting that bucket also deletes those recovery files. GitHub contains the application, not your hosted notebook.

If you keep the database and bucket, retain their IDs/names and the exact `STUDIO_SECRET`. If you deliberately delete both, use fresh resources and secrets, then import the portable backup. Connection credentials are excluded from portable backups and need configuring again. Export ACA separately if you also intend to remove its independent database.

The existing domain zone can stay. Access applications, service tokens and API tokens can also stay when their hostname, policies and credentials are still correct. If you recreate them, use their new values rather than copying old IDs.

## 1. Choose names and create private storage

These are examples; the names can be customized.

| Resource          | Example               | Where Glass uses it                            |
| ----------------- | --------------------- | ---------------------------------------------- |
| Studio Worker     | `glass-studio`        | `GLASS_STUDIO_WORKER` and the connected Worker |
| D1 database       | `glass-studio`        | `GLASS_D1_NAME` and its actual `GLASS_D1_ID`   |
| Private R2 bucket | `glass-private`       | `GLASS_PRIVATE_BUCKET`                         |
| Pages project     | `glass-blog`          | Choose later in Studio → Hosting               |
| Studio hostname   | `console.example.com` | `GLASS_STUDIO_ORIGIN` and Access               |
| Public hostname   | `example.com`         | `GLASS_SITE_ORIGIN` and the canonical site URL |

In **Storage & databases → D1**, create the database and copy its database UUID. In **R2**, create the private bucket. Keep its public domains and `r2.dev` access disabled. Glass generates the bindings named `DB` and `BUCKET` using the configuration below and applies its D1 migrations during deployment.

Keep public media in Pages initially. A separate public R2 media bucket is optional; the private notebook bucket must remain private.

## 2. Set up owner login and CI access

In Cloudflare Zero Trust:

1. Create or reuse a **Self-hosted Access application** covering the entire Studio hostname, with no path restriction.
2. Add an owner **Allow** policy for your login email. This address is a login allowlist, independent of the public contact email.
3. Create or reuse an Access service token for the build coordinator. Keep its client ID and client secret together.
4. Add a **Service Auth** policy authorizing that exact service token on the same application. Keep the owner Allow policy too.
5. Copy the Access team prefix and this application's audience tag (`AUD`).

Protect the entire hostname, including root assets, APIs, media and compiler files. Do not add a public bypass for CI; the build uses the service-token headers plus Glass's CI token.

## 3. Connect GitHub to the Studio Worker

In **Workers & Pages**, create a **Worker** connected to `Lapotron/Glass` (or your fork), production branch `main`. Use the Studio Worker name chosen above.

| Build field    | Value                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| Root directory | `infrastructure/cloud/studio`                                              |
| Build command  | `npm --prefix ../../.. ci && npm --prefix ../../.. run cloud:build:studio` |
| Deploy command | `npm --prefix ../../.. run cloud:deploy:studio`                            |

Keep the initial setup on the production branch. Private branch previews have additional Access provisioning requirements described in the [full hosting guide](hosted-studio.md#names-previews-and-optional-services).

There is no second Git-connected reader Worker to create. The public Pages project will receive output from this same Studio pipeline.

## 4. Set public configuration

Under the Studio Worker's **Settings → Builds → Variables and secrets**, add a **Variable** named `GLASS_CLOUD_CONFIG` containing this JSON. Replace every placeholder and example hostname.

```json
{
  "CLOUDFLARE_ACCOUNT_ID": "<your account ID>",
  "GLASS_STUDIO_WORKER": "glass-studio",
  "GLASS_STUDIO_ORIGIN": "https://console.example.com",
  "GLASS_SITE_ORIGIN": "https://example.com",
  "GLASS_D1_ID": "<actual D1 database UUID>",
  "GLASS_D1_NAME": "glass-studio",
  "GLASS_PRIVATE_BUCKET": "glass-private",
  "GLASS_PRODUCTION_BRANCH": "main",
  "GLASS_ENABLE_CUSTOM_DOMAIN": "true",
  "ACCESS_TEAM": "<your Access team prefix>",
  "ACCESS_AUD": "<this Access application's audience tag>",
  "ACCESS_ADMINS": "<your owner login email>",
  "STORAGE_BUDGET_BYTES": "5368709120"
}
```

The domain must already belong to an active Cloudflare zone. The Studio deploy attaches its custom domain; the public domain is attached to Pages later. Do not include tokens, passwords or service secrets in this public JSON. `GLASS_PAGES_PROJECT` is optional: leave it out to choose the target inside Studio.

## 5. Set secrets and deploy Studio

Use a password manager to generate two different cryptographically random values of at least 32 characters. Under **Runtime variables and secrets**, add them as **Secrets**, not plain variables:

| Runtime secret  | Purpose                                                                |
| --------------- | ---------------------------------------------------------------------- |
| `STUDIO_SECRET` | Encrypts private connection settings; preserve it when reusing storage |
| `CI_TOKEN`      | Authenticates Glass's build coordinator                                |

The deployment API token needs these account permissions for the selected account:

- Workers Scripts → Edit
- D1 → Edit
- Workers R2 Storage → Edit
- Cloudflare Pages → Edit

Custom-domain management additionally needs Zone → Read, DNS → Edit and Workers Routes → Edit for your zone. Access API permissions are needed for automated Access provisioning/private branch previews; manually configured production Access does not require them.

Cloudflare's automatically created Workers Builds token can lack Pages permission. Check the selected build token under **My Profile → API Tokens** and add the required permission, or select a suitable existing user token. Permissions are not granted automatically by saving a Studio setting. See [Cloudflare's build token documentation](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token).

Add a **Build secret** named `GLASS_CI_SECRETS`. For the first deployment, it can contain only:

```json
{"CLOUDFLARE_API_TOKEN":"<deployment token with the permissions above>"}
```

Build secrets and runtime secrets are separate dashboard sections. Glass synchronizes supported build connection values into encrypted runtime secrets when it deploys Studio; the Access service-token pair stays build-only.

Run the first Studio build. Wait for deployment success, open the Studio hostname, sign in through Access, and check the version button in the top bar. Hosting should show the selected database/bucket connection and native storage controls.

If you supply the complete CI secret pack before this first deployment, also set `"GLASS_PIPELINE_BOOTSTRAP":"true"` in the public configuration for that first build. Remove this one-time flag once Studio is reachable. It must not remain enabled for ordinary Publish operations.

## 6. Finish the same pipeline

Update the same `GLASS_CI_SECRETS` Build secret to:

```json
{
  "CLOUDFLARE_API_TOKEN": "<deployment token>",
  "GLASS_CI_TOKEN": "<exact same value as runtime CI_TOKEN>",
  "CF_ACCESS_CLIENT_ID": "<Access service token client ID>",
  "CF_ACCESS_CLIENT_SECRET": "<matching Access service token secret>"
}
```

Under **Settings → Builds → Deploy Hooks**, create a hook named, for example, `Glass Publish`, targeting `main`. Save its URL in **hosted Studio → Hosting → Pages publishing setup → Studio pipeline Deploy Hook**, then click **Save private hook**. Use the hook from the Studio Worker, not an old reader Worker. A separate Workers Builds API token is unnecessary for this hook-based setup.

Leave Studio's Cloudflare API token input blank to inherit the deployment default. If it says **Saved privately in Cloudflare**, a saved override takes priority. To return to the deployment default, use **Remove saved token → Save credentials**; this removes the Studio override, not the API token itself.

## 7. Create the Pages target and restore content

In **Hosting → Pages publishing setup**:

1. Click **Check connection** and wait for Pages access verification.
2. Choose a project name, click **Create project**, then **Save target**. Use a **Direct Upload** project, not a Git-connected Pages project.
3. Check the canonical site URL in Site settings. Keep media delivery set to **Pages** for the initial deployment.
4. If retaining your notebook, import the downloaded archive through **Backups**, review the checksums/counts and confirm restoration. Recheck the Pages target, canonical URL and connection settings after import.
5. Click **Publish** once. The captured build runs SSG and uploads the generated output to Pages.

Verify the returned `*.pages.dev` staging release, including images, search, article rendering and `/assets/deployment.json`. Hosting records verified staging separately from the current live release. Git pushes do not copy a local notebook into hosted storage; a fresh installation starts with a fresh notebook until you import it.

Public assets larger than Pages' 25 MiB per-file limit need another delivery path, such as a separate public R2 media bucket. Large private backups/originals are a different concern from public Pages assets. See [Pages limits](https://developers.cloudflare.com/pages/platform/limits/#file-size).

## 8. Attach the public domain

After reviewing staging, open **Pages → your project → Custom domains** and attach the public hostname. If an old reader Worker owns it, remove that specific conflicting custom-domain binding/route when ready to cut over. Retain its deployment for rollback if desired; deleting the Studio, D1 or private bucket is not part of this step.

Verify the canonical homepage and `/assets/deployment.json`, then Publish once more so Glass records canonical verification. Disable automatic Git builds on the old reader Worker when migrating from the previous architecture.

## Final checks and common failures

- Save settings and upload an image: both should complete directly, without a Workers Build.
- Create/review a backup: it should be a reference snapshot, with portable download assembly in your browser.
- Publish: exactly the intended captured build should run SSG and upload Pages output. A Git code update should update Studio.
- **Pages 403:** check account scope, Pages Edit and whether a saved Studio token overrides the deployment default.
- **CI 302:** check the Access service-token pair and the Service Auth policy covering the whole hostname.
- **CI 401:** match `GLASS_CI_TOKEN` to runtime `CI_TOKEN`.
- **Publish keeps deploying Studio:** remove the one-time bootstrap flag and verify the saved hook belongs to this Studio pipeline.
- **Media CORS verification fails:** start with Pages media delivery. Do not expose the private bucket to fix a public CDN setting.
- **Fresh data is missing:** import your portable notebook; Git is not the hosted content database.

Daily backups and the cache/release retention controls are available in Studio. Start with the default storage budget and retention policy; review actual usage before increasing budgets. ACA, public R2 CDN delivery and the dynamic prototype are optional separate setups.
