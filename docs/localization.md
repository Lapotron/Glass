# Interface localization

Glass has English, Simplified Chinese (`zh-Hans`) and Traditional Chinese (`zh-Hant`) interfaces. English is the initial default. Reader and Studio choices are independent browser-local preferences, under `glass-reader-language-v1` and `glass-studio-language-v1`. Choosing a language does not translate authored Markdown, titles, project descriptions, photo captions, URLs or imported repository metadata.

## Source and catalogs

`src/shared/i18n.ts` owns locale state, interpolation, UTC date/number formatting and subscriptions. `src/shared/ui-locale.ts` owns browser loading, bounded optional catalog caches, storage events and explicit DOM markers. Public and Studio Chinese catalogs load on demand; public pages must not import the Studio catalog or React just to translate their controls.

English phrases are keys. Use `t('Phrase', {name: value})` for React props and `UiText` for generated public UI leaves. Use `setUiText(element, key, params)` for changing public status/label leaves so a later language change preserves their current state rather than restoring the initial loading message. Keep interpolated values in named parameters; avoid splitting sentences around author-controlled values. Unknown diagnostic strings retain their original English fallback. CodeMirror uses the same catalogs through its phrase facet, reconfigured on the existing editor rather than remounting it.

For static HTML, `data-ui` names a translatable **text-only leaf**, `data-ui-params` contains interpolation values, and `data-ui-attrs` maps allowed text attributes to keys. Never place a text marker on an ancestor containing icons, inputs, links or authored prose: replacing its text would destroy those children. Public cached-language prepaint changes only deliberate markers as parsing proceeds. The complete document remains readable without JavaScript or storage.

`npm run i18n:extract` updates `en.json` and the per-surface catalogs from source usage. Translate additions in both full dictionaries, `zh-Hans.json` and `zh-Hant.json`, then extract again. `npm run i18n:check` validates coverage, interpolation placeholders and generated catalog freshness. Keep proper names, source syntax, paths, units and machine identifiers intact. Traditional Chinese has its own maintained catalog; do not convert strings at runtime.

## Content and controls

`site.language` describes default authored content, metadata and feeds. It is separate from the interface locale. Entry `lang` continues to identify its prose. Optional `localization.labels` overrides Chinese collection names/singular labels only; blank values fall back to existing names. Label customization cannot rename routes or titles.

Site Settings → Languages → **Public language controls** saves `localization.enabled` (default `true` for compatibility). Turning it off removes the public header chooser, Reader Settings chooser, collection-label payload and Chinese specimen templates. Public startup and cached-language prepaint stay in English and do not request Chinese catalogs. Saved reader language preferences remain untouched and become usable again after re-enabling and publishing a build. Studio language remains independent. The switch affects unsaved site previews as well as saved static output; saving alone does not publish.

Studio uses a native popover language menu beside the topbar appearance control and public-site link. Preserve menuitemradio semantics, arrow/Home/End selection, Escape, outside dismissal and focus return. Public navigation uses a native disclosure with language choices, and Reader Settings provides the same preference. Private previews ignore reader-local overrides. Keep source selection, undo, scroll position and unsaved drafts through Studio language changes.

The reader specimen compiles coherent sample Markdown in all three languages through the real production renderer. Its materials and code frames use article CSS. Change the sample template, not arbitrary authored DOM, when switching languages; preserve the scene and its internal scroll position.

## Verification and future extensions

Verify both Chinese scripts, English reset, reload, independent reader/Studio choices, blocked storage/catalog loads, public no-JavaScript output and narrow layouts. Check keyboard menus, dialog labels, dynamic statuses and CodeMirror commands as well as initial headings. Translation must not change authored text or persisted content.

Provider-specific language codes, localized diagnostics and new dynamic widgets should be added at their presentation boundary. Avoid expanding localization into route duplication, content translation, remote translation services or user accounts without a separate requirement. Future locale additions need a catalog, native display name, schema allowlist update, loader branch and coverage checks.

Dynamic search controls, result counts, retry states and conversation statuses use current UI markers, including their parameters. Accessible diff blocks rebuild on language change while preserving active change/focus. Catalog extraction recognizes deliberate discussion states, filter/count labels and analytics methodology at their presentation boundaries; provider error details and authored search results remain untouched.

Language choices display **native language names only**, independently of the active interface language: `Español`, `简体中文`, `繁體中文`, and `English`. Do not append English definitions. Shared `content-languages.ts` supplies content/provider names; interface menus retain their stable locale codes. This format applies to public search filters, reader/Studio switchers, discussion language choices and the default-content-language selector. Existing uncommon content codes remain selectable rather than being silently replaced. Presentation labels never become persisted filter or setting values.
