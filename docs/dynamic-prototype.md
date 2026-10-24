# Separate Vinext / Cloudflare prototype

`apps/dynamic` is an isolated App Router application. It does not replace Glass's renderer, Studio, `dist/`, Wrangler Pages configuration, R2 publication, or ACA. Production remains on the existing Cloudflare Pages Direct Upload workflow.

## Build and run

```sh
npm ci --prefix apps/dynamic
npm run dynamic:build
npm run dynamic:check
npm run dynamic:security
npm run dynamic:test
```

The prototype pins Vinext 1.3.0, `@vinext/cloudflare` 1.2.0 and Cloudflare Vite plugin `2.0.0-beta.v.4` in its own lockfile. The current native integration requires Node 22.23 or a supported newer runtime; its development dependencies include a checkout-local Node 22.23 binary used by npm scripts. The root static blog still supports its existing Node runtime.

The ordinary root `npm test` suite needs only the root install. The optional prototype's dependency guard tests run separately with `dynamic:security` after its own installation; `dynamic:test` also requires them before its workerd smoke test. Missing prototype dependencies are an error for these explicit commands, not a reason to skip security checks.

`dynamic:build` creates a published-only compiled snapshot, then builds the prototype. Snapshot source is private `.generated/published.json`, not a copy of the notebook. It contains public IDs, titles, summaries, dates, revisions, canonical production URLs and sanitized rendered HTML. Drafts, raw Markdown, local paths, Studio data and credentials are excluded. Math/diagrams/images remain build-time work in the Node engine; they are not regenerated in Workers. The prototype can read `/published/` and `/published/<id>/` as a static-content compatibility demonstration; the production site retains the complete reader enhancements.

The app reuses Glass's tokens, forms and glass materials. Overview introduces the independent architecture; Admin notes demonstrates a small client component over a D1 API. Its local notes are separate from notebook content and ACA data. Notes support create, read, edit and reviewed removal, with bound SQL, bounded input/list size and optimistic version checks. Dirty text survives errors. The prototype does not collect reader analytics or offer reader registration.

Generated `.cloudflare/`, `.next/`, `.generated/`, Node binaries and `.dev.vars` stay untracked. Production bundles go to the native Cloudflare Build Output inside this app, never the Pages artifact.

## Cloud deployment and Access

1. Configure the intended account and a **separate** prototype D1 database in `apps/dynamic/cloudflare.config.ts`; apply `apps/dynamic/migrations/0001_notes.sql` to that database through the Cloudflare dashboard or the current `cf` CLI. Do not bind the ACA database.
2. Create a Cloudflare Access self-hosted application for the prototype hostname. Restrict its policy to the intended administrators. Set `ACCESS_TEAM` to the team's subdomain, `ACCESS_AUD` to that application's AUD, and `ACCESS_ADMINS` to the explicit comma-separated email allowlist. Empty configuration fails closed. These identifiers are not a substitute for the Access application/policy itself.
3. The Worker entry verifies an RS256 JWT against the fixed team's public JWKS, issuer, audience, required subject/email/issued/expiry claims and the admin allowlist. It does not trust a supplied email header or the mere presence of the Access header. The internal `X-Glass-Admin` header is removed and replaced only after verification.
4. Keep `assets.runWorkerFirst: true`. Every route, API and static asset passes through the auth boundary; unprotected direct Workers URLs fail closed. Private responses use `private, no-store`, `noindex, nofollow` and `nosniff`. Mutations also require the exact Origin. No development-auth bypass is shipped.
5. Deploy deliberately from `apps/dynamic` using its own `npm run deploy` after configuring the account/bindings/Access policy. This does not run the root Pages or ACA deployment scripts.

A local preview with empty Access config correctly rejects every request. Native `vite preview` checks cover HTML, the notes API and an existing static JavaScript asset, all returning 401 with private no-store caching. The smoke script supplies locally generated signed fixtures and a controlled JWKS response; it never changes deployed auth settings. It tests real workerd rendering and D1 operations, not a browser-injected login. Use real Access authentication on an HTTPS staging hostname before considering live use.

## Compatibility assessment

| Area                              | Current static site                                         | Prototype / migration implication                                                                                         |
| --------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Public content                    | Canonical local Markdown/JSON, custom compiled HTML         | Reuse a published-only projection; a complete migration would require route and metadata adapters.                        |
| Markdown, MathJax, Mermaid, Sharp | Node build-time engines and private caches                  | Keep outside Workers; native filesystem, browser and image processing are not portable runtime dependencies.              |
| Reader experience                 | Small intent-loaded enhancements and static fallbacks       | React/RSC introduces framework client/runtime cost; it does not improve static-page speed merely by existing.             |
| Studio                            | Loopback authoring APIs, revisions, backups and credentials | Keep local. Importing the Studio server into a Worker would violate its trust and filesystem model.                       |
| Dynamic APIs / database           | Independent ACA and existing annotation adapter             | App Router handlers and D1 are useful for future authenticated features. Services need not share a framework.             |
| Identity                          | GitHub OAuth only for Giscus                                | Access currently protects administrators. Reader accounts would need a separate chosen auth/session/data-deletion design. |
| Caching                           | Static assets with native Pages caching                     | Private prototype pages use no-store. Future personalized responses must never enter public caches.                       |
| Deployment                        | Existing Pages Direct Upload                                | Independent native Build Output and Worker, database and Access policy. Independent rollback/removal.                     |

Vinext targets the Next.js 16 API surface on Vite, but this repository is a custom static application, not an existing Next.js app. Therefore there is no meaningful drop-in migration. Potential advantages are co-located server-rendered personalized pages, route handlers, server actions and Workers bindings. Costs include framework maintenance, a beta Cloudflare integration, another runtime/build toolchain, React client payload, dynamic request CPU and new cache/auth boundaries. Experimental/advanced cache features are not assumed compatible.

The isolated dependency audit still reports an upstream-unpatched `braces <=3.0.3` issue through Vinext's build-time CommonJS/glob tooling. The affected pattern parsing is not exposed as this prototype's HTTP API. A compatible `fflate` override removes its ZIP parsing advisory. A reproducible install-time guard bounds nesting in parsing and all three recursive AST walkers. Prebuild checks verify the guard; regression tests cover normal glob expansion, deeply nested braces/parentheses and supplied ASTs. Keep this mitigation explicit: npm audit still reports the upstream advisory, so do not claim a clean dependency audit. Review the pinned source before updating or removing the guard. Private staging remains an evaluation environment. The root blog dependency audit remains independent.

## Measurements and limits

The smoke command writes `.studio/reports/dynamic.json`. It measures a cold HTML request and twenty warm API reads in a local workerd emulator, with a synthetic Access JWKS and local D1. An initial run produced about **2.35 MB raw / 439 KB gzip of total Worker JS**, a **46 ms** first HTML response and **2 ms p50 / 4 ms p95** warm API responses. Reruns and the maintained report are authoritative for this checkout; these are not network, Cloudflare cold-start, production CPU or billing benchmarks. The first response includes local JWKS fetch/verification; warm tests reuse keys.

The public client includes React/RSC code that the production static reader does not require. Vinext's comparisons against Next.js do not establish an improvement over Glass. Measure deployed CPU, cold starts, regional D1 latency, cache hit rates and client payload before selecting an architecture for a real dynamic feature. No cloud deployment, paid provisioning or production migration is performed by the local tests.

For now, retain Pages for public reading, deploy ACA as a small independent service when configured, and keep this prototype for evaluating future administrator APIs and account-oriented work.

Primary references: [Vinext Cloudflare deployment](https://vinext.dev/docs/deploying/cloudflare), [compatibility differences](https://vinext.dev/docs/reference/differences), [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Prepared private staging rollout

The chosen destination is `staging.example.com`, with email one-time codes and the sole allowlisted address `me@example.com`. Public reader accounts and personalization remain future work. Run `npm run services:check` to verify read access using Studio's saved credential before provisioning. Configure the free Access organization, OTP provider, self-hosted application and allow policy before routing the Worker.

Keep deployment identifiers in the notebook's private `.studio/services/staging.json`:

```json
{
  "accessTeam": "your-team-name",
  "accessAudience": "your-access-application-audience",
  "adminEmails": ["me@example.com"]
}
```

Then use root `npm run dynamic:deploy`. It verifies the application's hostname/audience and passes the saved Studio token and Access configuration through the child environment; it excludes R2/report credentials and redacts output. Direct package deployment refuses missing configuration. Attach the Worker custom domain in Cloudflare and verify that the hostname, routes, API, existing assets and direct Worker URL all retain the Access boundary. The local Studio and Pages deployment remain independent.

The free-tier target requires actual Worker CPU measurements, not local wall time: 10 ms CPU per invocation and 50 D1 queries. Keep the app private and unapproved for promotion if it cannot fit; do not purchase a plan automatically. Record deployed versions, database/migrations, Access application and verification result privately. A preflight permission failure must stop provisioning and upload; it does not invalidate the local artifact.
