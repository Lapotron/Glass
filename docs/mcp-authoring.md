# Local MCP authoring contract

Status: **implemented local stdio bridge**. Copy configuration from Overview → Studio guide → AI authoring. Start Studio for the selected notebook before connecting. The bridge verifies the notebook identity on every request, obtains the session token privately and uses fixed loopback endpoints. It does not start a public HTTP MCP service or expose credentials. `npm run --silent mcp -- --root /absolute/notebook --port 4310` is the command-line equivalent; the generated client configuration invokes Node directly so npm banners cannot corrupt stdio.

## Existing local interfaces

- `GET /api/authoring/connection` returns a client configuration with paths and port only.
- `POST /api/authoring/draft` validates then atomically creates a complete draft, or revises a draft using its current revision. Published entries cannot race past the Store-level draft-only guard.
- `POST /api/preview` also accepts a temporary `draft:{kind,metadata,body}` projection, without writing canonical source.

- `GET /api/authoring/capabilities` returns the `fieldnotes-markdown/1` catalog, JSON schemas, examples and supported math packages.
- `POST /api/authoring/validate` accepts `{source,full:false}`. `full:true` also checks frontmatter and performs the production render. Both return `{version,ok,diagnostics,labels}`.
- A diagnostic contains `severity`, stable `code`, `message`, zero-based UTF-16 `from`/`to` offsets, one-based `line`/`column`, and an optional configuration `path`. Ranges refer to the submitted source, including frontmatter for a full check.
- Studio's existing preview endpoint renders unsaved content; canonical writes retain their existing revision and token contracts. These endpoints are loopback-only, origin checked, no-store and absent from Pages artifacts.
- `npm run markdown:check` provides the same validation without a running Studio; `npm run authoring:pack` exports capabilities and templates.

## MCP resources

| URI                                  | Contents                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `glass://authoring/capabilities`     | Current versioned catalog and JSON schemas.                                          |
| `glass://authoring/reference`        | Maintained syntax, nesting and rendering rules.                                      |
| `glass://authoring/templates/{name}` | Research note, tutorial, visual explainer or chart examples.                         |
| `glass://workspace/links`            | Configured public paths and published/draft state, scoped to the connected notebook. |
| `glass://workspace/media`            | Canonical local media URLs and safe descriptive metadata.                            |

Do not turn these URI examples into filesystem access. The adapter maps known resources explicitly. Capabilities are served from the executable catalog, with the language version included in each response. Consumers should reject an unsupported major dialect version rather than guessing syntax.

## Tools

| Tool                | Minimum input                                                                | Output / behavior                                                                  |
| ------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `validate_markdown` | `source`, optional `full`                                                    | Existing diagnostics/labels response; no source mutation.                          |
| `render_preview`    | `kind`, `title`, `body`                                                      | Temporary noindex Studio preview URL; no publication.                              |
| `prepare_draft`     | `kind`, `title`, `slug`, `body`, optional `metadata`, `targetId`, `revision` | Validate and prepare an ordinary draft through Store's existing conflict-safe API. |
| `list_templates`    | No input                                                                     | Template names, descriptions and dialect version.                                  |

There is no implicit publish tool. Reuse Store rather than exposing raw writes, shell execution, arbitrary paths, credentials, backup internals or remote rendering. Reading capabilities does not authorize changing the notebook. Existing user instructions determine which draft work is authorized.

New draft creation must keep stable entry IDs and use draft status. Updating an existing draft requires its current revision; published/scheduled entries are read-only through MCP; return the existing 409 conflict behavior and retain the proposed Markdown for review. Reuse preview isolation, published-link rules, local image preparation and private original retention.

Return plain Markdown and diagnostics through machine-readable responses; do not replace the canonical document with opaque application blocks. Tool descriptions should state supported data-only syntax and reference the capability resource. LLM-supplied option strings never become executable callbacks.

## Validation and further extension

Use isolated notebook fixtures to verify resource versioning, schema/examples matching the renderer, multiline source ranges, unknown directives, missing references, valid math, failed diagrams, local media handling, concurrent edits, wrong notebook identity and draft/public separation. Exercise a real client read → template → validate → preview → draft flow when extending MCP support.

## Local-link and citation conversion

Use the existing `:cite[key]` and `references`/`reference` catalog forms for local scholarly citations as well as external works. The Studio composer uses a stable `entry-{id}` key (not a mutable slug), an absolute canonical URL and available public author/title/date fields. Reuse an existing reference by stable key or matching source URL; preserve manually authored bibliography text. Ordinary links can use root-relative configured collection paths and the engine's Unicode heading IDs. A draft destination still needs publication before its link can pass production validation. See [editor workspace](editor-workspace.md) for the author-facing insertion contract.

Core validation diagnostics retain their existing severity/code/range fields. Optional Studio `category` and `fix` data describe editorial assistance; a fix contains a label and exact `{from,to,insert}` changes. Workspace-inventory warnings (missing images or unpublished destinations) are editor context, not an expansion of the versioned component catalog or a reason to invent metadata. Conversion tools should continue to run canonical validation and report unsupported syntax explicitly.

For image-size conversion, use the catalog figure attributes `width`, `max-height` and `align`, rather than generating arbitrary inline styles. Preserve captions, alt text, stable labels, canonical media paths and aspect ratio. See [single-image display size](authoring.md#single-image-display-size) for numeric/percentage bounds. This is an additive version-1 authoring capability.

## Portable STEM authoring

`glass://authoring/skill` provides the maintained composition workflow. Fixed guide resources are available at `glass://authoring/guides/{name}` for `math-authoring`, `pseudocode`, `latex-conversion` and `markdown-ide`. Template resources additionally include `stem-algorithms` and `code-projects`. Capabilities expose package defaults/allowlists, command descriptions and arguments, environments, pseudocode vocabulary/styles, and JS/TS project metadata. `authoring:pack` bundles a self-contained `skills/glass-markdown-authoring/SKILL.md` with generated references. No additional filesystem or publish authority is granted.

This product workflow is generated independently of local development-agent files. A fresh checkout can build, serve MCP resources and export an authoring pack without installing private assistant instructions. MCP responses use resource URIs, portable exports use bundled relative references, and hosted downloads link to their sibling guides.
