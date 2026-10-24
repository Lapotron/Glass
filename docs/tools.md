# Browser-local Tools

`/tools/` is a public utility page, opened through a header icon or the mobile navigation's separate utility row. It does not add a sixth main navigation role. `site.navigationTools.tools` defaults to `true`; hiding the shortcut leaves the route available. Static tool descriptions enter Pagefind and the sitemap. User inputs never enter either.

## Workspaces and extension points

The directory uses a stationary glass shell and a separate `.tools-directory-scroll` body. Keep overflow on that body so the shared decorative rim cannot scroll through the list. Desktop height remains bounded and sticky; mobile retains the horizontal tool rail. Tools shortcuts share the Wrench icon in desktop and mobile navigation.

Developer toolbox contains 15 tools: JSON/JSONC, YAML/JSON, CSV/JSON, URL, Base64, JWT inspection, SHA checksums, password encryption, regex, text comparison, text utilities, UUIDs, timestamps, integer bases and colors/contrast. `src/shared/tools-catalog.ts` owns IDs, descriptions, examples, groups and input limits. IDs are bookmark fragments, draft keys and search identities; preserve them across label changes. A new tool needs a catalog item, processing handler, matching controls, translations and executable examples.

Editable inputs are limited to 1 MiB; local files to 25 MiB. CSV has up to 100 columns and 10,000 rows and preserves quoted multiline cells. YAML uses the core schema, duplicate-key checks and bounded aliases; custom tags and remote loading are unavailable. Integers use BigInt. JWT output is explicitly unverified. Hashes use SHA-256/384/512. Regex runs in a terminable worker with a one-second deadline and a maximum of 1,000 returned matches. Inputs and output are plain text, not executable HTML.

The Equation editor uses a separate CodeMirror/MathJax 4 browser graph. Its shared command catalog and macro parser provide package-aware completion, templates, rendered selected examples and hover information. Source is bounded to 32 KiB, macro expansion to 1,000, and SVG output to 2 MiB. Core TeX/AMS/local macros are available; extensions use the established allowlist and Physics remains opt-in. This is the supported MathJax subset, not an arbitrary LaTeX installation. Each render has isolated document state.

SVG and MathML are derived from the same expression/package configuration. Preview follows reader theme; exported drawings default to black on transparent, with size, background, padding and PNG scale controls. SVG glyph paths and locally loaded font parts work without third-party font requests. Export dimensions are bounded to 4,096 pixels. Markdown copying selects inline or display delimiters. An invalid or pending preview disables image exports.

## Asset and privacy boundary

Normal articles still receive build-time math and syntax highlighting. They never import the Tools editor, compiler or worker. A separate Vite entry emits `tools.js`, `tools.css` and its intent-loaded modules/workers under the fingerprinted bundle. The version-1 reader asset manifest adds optional `toolsScript` and `toolsStyle`; only `/tools/` links them. The ordinary reader boundary stays strict. The Tools graph separately rejects private engine, Studio, server, edge, credentials and Node-only dependencies. Self-hosted font shards are emitted by an explicit Vite glob and loaded only when needed.

Processing uses browser workers, Web Crypto and file APIs. There are no new public processing APIs. Studio's bounded math-preview endpoint stays private. Generated downloads are local blob URLs and are revoked after use. ACA may collect ordinary page views but skips workspace interactions and generated downloads, keeping inputs, filenames, outputs and passwords out of events. Tool links contain identifiers only.

The MathJax worker has a small bootstrap and an ordinary compiler dependency chunk. Lazy font parts import that dependency rather than the worker entry, avoiding [WebKit's duplicate worker-entry evaluation](https://bugs.webkit.org/show_bug.cgi?id=324459). Keep a rare-font regression in both browser engines; basic equations alone do not exercise this boundary.

`glass-tools-preferences-v1` stores favorites; `glass-tools-equation-preferences-v1` stores package/layout choices. Optional per-tool autosaving uses IndexedDB `glass-tools-v1`, object store `drafts`. Saving is initially off and includes authored source/options only after explicit opt-in. JWT and encryption are ineligible; file buffers, passwords and outputs are never written. Clear-drafts affects this store only and retains current in-memory work, favorites and reader preferences. Storage failure leaves the tools usable.

## Portable encryption v1

Encryption uses browser-native AES-256-GCM, a 128-bit authentication tag, PBKDF2-HMAC-SHA-256 with exactly 600,000 iterations, a fresh 16-byte salt and a fresh 12-byte IV for every operation. Passwords are exact UTF-8 (1–1,024 bytes), not normalized or trimmed. Derived keys are nonextractable. The UI clears password fields after operations. Encrypted content cannot be recovered without its password.

Binary `.glassenc` files contain these concatenated bytes:

1. UTF-8 magic `GLASSENC\n` (9 bytes).
2. Unsigned big-endian 32-bit header byte length, at most 1,024.
3. UTF-8 JSON header: `{version:1,cipher:"AES-256-GCM",kdf:"PBKDF2-SHA256",iterations:600000,salt,iv}`. `salt` and `iv` are unpadded Base64URL strings. The stored header bytes, magic and length are GCM additional authenticated data.
4. GCM ciphertext, including the 16-byte authentication tag appended by Web Crypto.

Before encryption, the payload is an unsigned big-endian 32-bit metadata length, UTF-8 metadata JSON `{kind:"text"|"file",name,mime}`, then the original raw bytes. Metadata is encrypted, never a cleartext filename header. Decoding caps metadata at 2,048 bytes and sanitizes recovered filenames. A copied text message is `glassenc:v1:` followed by unpadded Base64URL of the complete binary envelope.

Reject unsupported versions, algorithms, KDF work factors and invalid salt/IV sizes before deriving keys. Wrong passwords and authenticated corruption share one failure message. Do not add automatic legacy fallbacks or silently change v1 parameters. This format is Glass-specific; it is not an OpenSSL or CryptoJS envelope. [Web Crypto derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey), [AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams).

## Local development

`npm run dev` uses `tsx watch` for imported backend dependencies and explicit public/shared/localization source globs, including CSS. Studio modules retain Vite HMR. Development builds published content into `.studio/development/`, independent of accepted `dist/`, build history and Cloudflare publication. Content changes queue a debounced rebuild. Public pages and private previews receive a development-only local reload script/SSE connection; successful new generations reload automatically. Failed builds retain the last valid preview and display an actionable development error. All development endpoints retain the Studio local-host/origin checks and are absent from generated public artifacts.

Source restarts release the runtime lease and close live connections. Cached public assets must contain expected Tools entries before a completion marker is trusted. A browser-verified source CSS change appeared automatically in about four seconds on the development machine; this is an observation, not a device-independent timing guarantee.
