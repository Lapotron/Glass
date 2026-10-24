# Glass

A personal blog with an Apple-inspired Liquid Glass interface, a private Markdown Studio and a custom static publishing engine. Write locally or host Studio on Cloudflare; readers receive complete static pages with small, on-demand enhancements.

![Original landscape illustration included with the starter](content/media/coast-dawn.svg)

## Start locally

Requires **Node.js 22.17 or newer** and npm.

```sh
git clone https://github.com/Lapotron/Glass.git
cd Glass
npm ci
npm run renderers:install
npm run dev
```

Open the [blog](http://127.0.0.1:4310/) or [Studio](http://127.0.0.1:4310/studio/). The starter includes generic sample articles, interactive experiments and original illustrations. Edit **About**, **Homepage** and **Appearance** to make it yours. Your source stays in `content/`; you can also edit it with ordinary text tools.

## Deploy from the Cloudflare dashboard

The [dashboard deployment guide](docs/hosted-studio.md#dashboard-only-deployment) covers GitHub-connected Workers Builds, custom domains, private D1/R2 storage and Cloudflare Access. Use your own repository and configure separate Studio and reader Workers. Hosted Studio opens at the root of its private hostname and needs no local server.

Worker names, bucket/database names, domains and branches are customizable. All example domains and identifiers are placeholders. Integrations and automatic publishing start disabled. Keep the Studio encryption key and existing cloud resources when updating an installation. Git pushes update application code; public notebook publication remains an explicit Studio operation.

Local Studio also supports [Cloudflare Pages Direct Upload](docs/publishing.md):

```sh
npm run build
npm run preview
```

Only published content enters `dist/`. Private Studio code, credentials, drafts, revision history and backups do not belong in the public reader artifact.

## Included

- Responsive homepage, archive, Projects, albums, About, reader settings and full-text Pagefind search.
- CodeMirror Markdown editing with completion, formatting, diagnostics, previews, revisions and comparisons.
- Build-time MathJax, Mermaid, Expressive Code, pseudocode, tables, tabs, mindmaps, charts and image comparisons.
- Media uploads, crop/resize, downloads, EXIF display, usage checks, aliases and optional R2 delivery.
- Giscus discussions and line annotations with matched light/dark themes.
- Portable backups, Trash, batch operations, collection conversion and optional scheduling.
- Optional private ACA analytics with an independent Worker/D1 service; disabled until configured.
- English, Simplified Chinese and Traditional Chinese interfaces.

## Documentation

- [Markdown reference](docs/markdown-reference.md), [math](docs/math-authoring.md), [pseudocode](docs/pseudocode.md) and [diagrams](docs/diagrams.md).
- [Editor workspace](docs/editor-workspace.md), [Studio operations](docs/studio-operations.md) and [recovery](docs/recovery.md).
- [Authoring pack and MCP](docs/mcp-authoring.md) for supported external writing/conversion workflows. The application generates these product guides without any development-agent files.
- [Hosted Studio](docs/hosted-studio.md), [site settings](docs/site-settings.md), [media](docs/media.md) and [ACA](docs/aca.md).
- [Project contracts](docs/contracts.md), [design system](docs/design-system.md) and [production performance](docs/production-performance.md).
- [Isolated Vinext prototype](docs/dynamic-prototype.md), an optional evaluation app rather than the production reader.

## Development checks

```sh
npm run check
npm run lint
npm test
npm run build
npm run build:console
npm run test:browser
```

Browser tests use temporary starter workspaces and do not alter your notebook. Install their engines once with `npx playwright install chromium webkit`. Hosted runtime checks use `npx playwright test --config playwright.cloud.config.ts`. Dependencies and generated/private state are excluded from Git.

Glass uses the retained `fieldnotes-markdown/1` dialect and portable notebook formats for compatibility. This repository contains a reusable starter, not another author's live notebook or private connection settings.

## License

[MIT](LICENSE), copyright Lapotron. See [third-party notices](NOTICE.md) for included asset provenance and dependency licenses.
