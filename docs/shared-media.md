# Shared-bucket media delivery

Glass can publish media through the existing Studio R2 binding and serve it on a separate media hostname using **the same Studio Worker**. The public site remains a Cloudflare Pages project. A separate media Worker and separate S3 credentials are not required. Requests for the media hostname are handled before Studio and CI routes; they cannot access those routes or the private workspace.

## New installations

1. Keep the private bucket's direct public domains and `r2.dev` disabled. Set `GLASS_PRIVATE_BUCKET` in the Studio build configuration to the actual existing bucket name and rebuild Studio.
2. Choose a separate HTTPS media origin and safe single-component prefix. Include `GLASS_MEDIA_ORIGIN`, `GLASS_MEDIA_PREFIX` and the Cloudflare zone ID as `GLASS_MEDIA_ZONE_ID` in the private Studio pipeline's public deployment configuration. The generated Wrangler configuration includes a Worker route for `<media-hostname>/*` in that zone; the hostname needs a proxied DNS record. Do not use the Studio hostname as the media hostname.
3. In Studio → Site settings → Media delivery, select **Studio bucket binding**, enter the same bucket, public hostname and prefix, and check the connection. This checks the private binding; it does not establish public delivery.
4. Publish a synthetic image from a disposable notebook. Verify public `GET`, `HEAD`, browser `Origin`, `Range`, bytes, MIME, and cache headers. Confirm an unmarked object and paths such as `/workspace/`, `/api/bootstrap` and `/__ci/` return 404 on the media hostname. The Worker supplies public read CORS. Publication stops before Pages upload if byte, MIME, cache or CORS verification fails.

The approved Publish job streams each media file to a private job staging key, verifies its SHA-256, and copies it to a public content-addressed key marked `glass-public`. The strict media handler serves only valid, marked keys. Published media still counts against the shared bucket budget and is retained for rollback. The old S3-based CDN inventory/cleanup workflow is not available for this binding; do not use it to delete shared-bucket objects.

## Existing R2 custom domain: compatibility transition

A direct public domain on the private Studio bucket can expose private notebook objects. If one already exists, keep an active Worker route on **every** request to that hostname before doing anything else. Never remove that route, enable `r2.dev`, or add another public domain as a workaround.

The Studio Worker supports `GLASS_MEDIA_LEGACY_COMPAT=true` for a reviewed transition: its media hostname accepts only recognized hashed media paths, proxies GET/HEAD and ranges to the existing R2 origin, strips reader credentials, and rejects workspace, job, backup, Studio and CI paths. This retains existing public URLs without a separate guard Worker. It does **not** enforce per-object publication markers, and the direct R2 origin remains public beneath the route. Keep the exact hostname and route in the build configuration so a later deployment cannot remove the protection.

Before switching an existing guard to the Studio Worker, deploy and verify the new handler while the old guard remains attached. Switch only the existing media route, then recheck the previously exposed private path, known public image bytes, GET/HEAD, CORS and range requests. Retain the old guard until verification passes and have its exact route available for immediate rollback. Remove the redundant guard only after these checks. A successful block now cannot establish whether private bytes were accessed before the route was added.

The strict handler rejects older unmarked objects. **Do not disable compatibility or the existing R2 custom domain until all current and retained rollback URLs have been inventoried and verified as approved public media.** A new Publish marks its own assets, not unrelated or old objects. The current tools do not migrate or mark older retained objects, or automate hostname promotion and rollback. Test a separate staging hostname before changing the production origin. Arrange a protected Worker hostname and DNS during cutover; disabling an R2 custom domain can also alter DNS. Never assume a successful local test proves the actual route and origin are safe.

## Troubleshooting

- A binding or bucket-name mismatch is a configuration error, not evidence that an S3 key is missing. Confirm `GLASS_PRIVATE_BUCKET` and the Studio setting agree, then rebuild Studio.
- `404` from strict delivery means the origin, allowed key, public marker, checksum metadata or content type did not match. Never make the private bucket public to work around it.
- If a later deployment drops the media route, restore its previous verified guard immediately. Add the exact `GLASS_MEDIA_ORIGIN`, `GLASS_MEDIA_PREFIX`, `GLASS_MEDIA_ZONE_ID` and, only for the existing transition, `GLASS_MEDIA_LEGACY_COMPAT` to the build configuration before redeploying.
- For live CORS failures, inspect `HEAD` and `GET` with the site `Origin`, including a repeated/range request. Purge only affected media URLs after correcting a cached response.
