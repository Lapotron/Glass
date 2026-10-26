# Publish Glass with GitHub Pages

Write Markdown, push your changes, and GitHub Actions builds and publishes the public website. This path needs no Cloudflare account, API token, R2 bucket, D1 database or running Studio server.

## First deployment

1. Create your own repository from the reusable [Lapotron/Glass](https://github.com/Lapotron/Glass) base. A fork also works; enable GitHub Actions if GitHub asks you to do so.
2. Open your repository's **Settings → Pages → Build and deployment**. Select **GitHub Actions** as the source. Do not choose deployment from a branch folder.
3. Open **Actions → Publish Glass to GitHub Pages → Run workflow**, using the repository's default branch. The default branch starts as `main`.
4. Watch the build and deployment jobs. Open the website URL in the deployment environment or the workflow summary after deployment succeeds.

The workflow is included in the reusable base at `.github/workflows/github-pages.yml`. Its reviewed source lives in the development repository at `distribution/base/github-pages.yml`; the development repository does not activate it automatically.

Every later push to the default branch builds and publishes again. Other branches do not deploy. There is no `gh-pages` branch to maintain and no generated `dist/` directory to commit. A manual run on a non-default branch does not deploy either.

The workflow uses the repository-provided `GITHUB_TOKEN`; do not create a personal access token or copy any Cloudflare secrets into GitHub. It checks Pages configuration without changing settings or domains. If Pages is disabled or still uses branch publishing, the summary explains the setting to change and says deployment was skipped.

[GitHub's custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) describes the Pages permissions and artifact/deployment jobs used here.

## URLs and custom domains

These layouts are supported automatically:

| Repository or setting                   | Public URL example                 |
| --------------------------------------- | ---------------------------------- |
| An account site named `OWNER.github.io` | `https://OWNER.github.io/`         |
| A project repository named `my-blog`    | `https://OWNER.github.io/my-blog/` |
| A configured custom domain              | `https://blog.example.com/`        |

The workflow reads the actual URL from GitHub's `configure-pages` action. This also handles project sites inheriting an account site's custom domain. The URL is a build input; it does not rewrite the site's saved identity or require storing a repository prefix in every Markdown link.

For a custom domain, first verify your domain and configure it in **Settings → Pages → Custom domain**, then set the DNS records GitHub requests and enable HTTPS when available. Run the workflow again after the domain change. Adding a `CNAME` file alone does not configure a domain for an Actions deployment. Follow [GitHub's custom domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages).

## Writing and updating

Edit Markdown under `content/posts/` and `content/lab/`, settings in `content/site.json`, and public media under `content/media/`. You can use GitHub's editor, any local text editor, or the optional local Studio:

```sh
npm ci
npm run renderers:install
npm run dev
```

Local Studio opens at `http://127.0.0.1:4310/studio/`. Save your changes, commit them and push to GitHub. Studio's Cloudflare **Build & Publish** action is a different deployment workflow; it does not push Git commits or deploy GitHub Pages.

Use ordinary Glass paths in Markdown, such as `/blog/my-note/` or `/media/photo.webp`. The configured collection names and paths still apply. During a GitHub Pages build, the engine adds the repository prefix to actual link/image contexts. It leaves prose, code examples, fragments, equations and external URLs intact.

Only entries marked `status: published` enter the site, feeds and search. Drafts and scheduled entries stay out of the artifact. GitHub Pages publishing in this version runs on pushes or manual workflow runs; it does not add an automatic publication scheduler.

Repository visibility and website visibility are separate. The artifact excludes drafts and private Studio files, but anything committed to a public source repository can be read there, including drafts and media. Keep `.studio/`, credentials, backup archives and private originals outside Git. [GitHub documents repository-plan availability and public site behavior](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## Local static build

To build the exact static profile without publishing:

```sh
npm ci
npm run renderers:install
npm run build:github-pages -- --root . --base-url https://OWNER.github.io/my-blog/
```

For a custom domain, pass that domain as `--base-url` instead. The root defaults to the current directory, never a notebook remembered by the Studio launcher. `GLASS_PAGES_BASE_URL` is an alternative build input used by the supplied workflow.

The public output is `dist/`. A failed build keeps the previous accepted output. No source files or saved site settings are changed. When serving a project-site build locally, mount `dist/` at the same path, such as `/my-blog/`; serving it at `/` does not test repository-path behavior.

## Features on static hosting

| Feature                                                         | GitHub Pages behavior                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Posts, articles, archive, albums, Projects, About               | Complete static pages, including native pagination                              |
| Math, code, pseudocode, Mermaid and charts                      | Compiled before deployment; interactive enhancements load when needed           |
| Pagefind search and filters                                     | Self-hosted static indexes, including repository-path support                   |
| Reader settings, saved reading, image viewer and Tools          | Browser features; no Studio API required                                        |
| General Giscus discussions                                      | Available when the author configures Giscus                                     |
| Line annotations and automatic annotation discovery             | Omitted from this fully static profile                                          |
| ACA                                                             | Omitted; its collector and private dashboard require independent infrastructure |
| Cloudflare-managed injected analytics                           | Omitted; GitHub Pages does not inject that beacon                               |
| Explicit external analytics, such as GA4                        | Available when configured                                                       |
| Article/media short links and old collection/article/album URLs | Static redirect pages with an HTML refresh and a visible destination link       |
| Cloudflare custom headers, caching rules and asset protection   | Not applied by GitHub Pages                                                     |

HTML redirect pages are normal static responses, not HTTP 301/302 rules. They remain usable without JavaScript. Giscus and other configured third-party services retain their own availability, authentication and privacy behavior.

The artifact includes `.nojekyll` and omits `_worker.js`, `_routes.json`, `_headers` and `_redirects`. Applicable CSP and referrer restrictions are emitted as HTML metadata. HTTP-only protections cannot be reproduced by metadata, and GitHub controls response caching. Active SVG scripts, event handlers and embedded HTML are rejected for this profile; use static SVG or raster images.

## Build speed, media and recovery

The workflow uses Node 24, the lockfile and a Chromium renderer. It caches npm downloads and fingerprinted public rendering assets. It does not cache all of `.studio/`, notebook snapshots, history, connections or credentials. The build renders math/diagrams and validates public links before uploading `dist/`; the deploy job uses that exact artifact.

GitHub Pages has a **1 GB published-site limit**. This target checks that limit separately from Cloudflare's file/count limits. Keep large video libraries and backup archives outside the site; GitHub source repositories have their own large-file restrictions. See [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

To restore an earlier website version, revert the relevant source commit and push to the default branch, or rerun a successful workflow for the desired source revision if your environment policy permits it. No D1/R2 restoration is involved in this Git-based workflow.

## Troubleshooting

- **Deployment skipped:** choose GitHub Actions in Settings → Pages, check repository eligibility and rerun on the default branch.
- **Permission denied:** allow the supplied workflow's `pages: read` build permission and `pages: write` / `id-token: write` deployment permissions. Keep the `github-pages` environment's branch rule consistent with your default branch.
- **Missing CSS, images or search:** use the URL returned by the deployment, confirm `configure-pages` supplies its base URL, and rebuild after repository/domain changes. Do not remove the repository prefix manually.
- **Broken local link:** publish the destination or correct the source link. The build refuses incomplete public sites instead of deploying a broken artifact.
- **SVG rejected:** remove scripts, event handlers or embedded HTML, or export a raster/static SVG version.
- **Build succeeded but nothing is live:** inspect the separate deploy job and environment URL. Compilation and artifact upload are not deployment success.
- **No pull-request preview URL:** this workflow deploys one production site. It does not promise Cloudflare-style branch preview sites.

For browser verification of all three URL layouts on a plain static server:

```sh
npm run test:browser -- --config playwright.github.config.ts
```
