# Studio-managed local configuration

Normal local use needs no `.env` file. Studio → Site settings → Connections manages the Cloudflare API token, private ACA report token and R2 access-key pair. Cloudflare Pages owns the account/project settings; media delivery owns the bucket/domain settings. Existing Wrangler login also works for Pages when no token is configured.

Credential inputs are write-only. Empty inputs preserve saved values; paste a replacement or explicitly remove a saved value. The R2 pair must remain complete. Reload credential status after a revision conflict; the typed draft stays in memory. Save/build/navigation flush active settings. Inputs clear after successful saves and never enter browser preferences.

Credentials live per notebook in `.studio/connections.json`, with mode `0600`, atomic writes and optimistic revisions. GET APIs return presence/source metadata. This is private local file storage, not an encrypted vault. Keep the file outside canonical content, revision history, portable backups, source snapshots and public artifacts.

Import from environment copies available `CLOUDFLARE_API_TOKEN`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` values without returning them to the browser. Saved values take precedence. Removing a saved value can reveal an inherited environment value; the status shows its source. Cloudflare checks and R2 bucket-list checks are read-only. Upload permission and CDN delivery are verified during publication.

Cloudflare checks capture one credential snapshot for identity and the selected account's Pages project listing. `pagesAccess` is `unchecked`, `verified`, `denied` or `unavailable`; identity alone does not show a connected Pages state. Project responses expose names only. See [Pages authentication troubleshooting](publishing.md#authentication-error-10000).

Wrangler receives the selected token through its child environment. R2 keys go directly to the S3 client. A publication captures credentials before building, so rotation affects subsequent jobs. Redact known credentials from complete output lines and errors before storing logs, including output split across chunks.

## Startup

Studio → Site settings → Local Studio manages the next-launch port and absolute notebook-folder path. The current session remains open. The folder must already contain valid `content/site.json` and `content/library.json`; selecting it does not move content.

Startup preferences live in the installation's `.studio/launcher.json`, also mode `0600`. Server and build/new/schedule CLI share this order: explicit `--port` / `--root`, saved settings, legacy `PORT` / `BLOG_ROOT`, then port 4310 and the installation folder. Ports are 1024–65535; binding stays loopback-only. Use explicit launch options to recover from an unavailable folder or occupied port.

Application code, compiled Studio assets and Wrangler stay in the installation. Content, media, credentials, lease, jobs, previews and output follow the selected notebook. Tests inject temporary installation/notebook roots and never alter real launcher settings.

The Local Studio section also provides [Reset notebook data](notebook-reset.md). It preserves saved site/connection/launcher settings and site artwork, reviews the complete affected data, and retains one recovery download. It does not reset remote deployments or browser preferences.

## Private API

- `GET /api/connections`: revision and per-field configured/source status.
- `PUT /api/connections`: `{revision,set?,remove?}`.
- `POST /api/connections/import-environment`: `{revision}`.
- `POST /api/connections/test`: `{provider:'cloudflare'|'r2'}`.
- `GET /api/services/readiness`: metadata-only read checks for independent service scopes.
- `GET /api/runtime-settings`: revision, saved and active settings, restart status.
- `PUT /api/runtime-settings`: `{revision,value:{port,notebookRoot}}`.

Routes retain loopback/origin checks, mutation session tokens and `no-store` responses. They are absent from the public Pages worker.

## Independent service readiness

Connections includes a read-only check for Workers, D1, Access organization and the site zone. The command-line equivalent is `npm run services:check`, which writes only a private readiness report. Authentication error 10000 on D1/Access needs the corresponding account permissions; an invisible zone needs the selected zone scope. Preserve Pages permissions while updating a token. Deployment additionally needs write privileges, DNS/Workers Routes permissions and correctly configured bindings/secrets.

For the selected ACA and private staging rollout, scope account permissions to the intended account and zone permissions to `example.com`:

| Scope | Permission |
| --- | --- |
| Account | D1 Edit; Workers Scripts Edit |
| Account | Access: Apps and Policies Edit |
| Account | Access: Organizations, Identity Providers, and Groups Edit |
| Zone | Zone Read; DNS Edit; Workers Routes Edit |

Cloudflare also labels equivalent permissions **Write** in its newer interfaces. Keep the existing Pages permission and R2 object credentials. The [official permission reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) distinguishes account scopes from zone scopes; a dashboard session or successful Pages upload does not confer these additional token permissions.

ACA deployment and root `dynamic:deploy` use saved Studio credentials. Staging's non-secret Access identifiers follow [the private configuration](dynamic-prototype.md#prepared-private-staging-rollout). A checked account and an uploaded application are separate states; report actual HTTPS verification independently.
