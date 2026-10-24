# Liquid Glass research and implementation

Reviewed 2026-10-19 against [Apple's Materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials), [Meet Liquid Glass, WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/), and [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react), including its optical filter and container source.

## What the references establish

Apple separates the navigation layer from reading content. Liquid Glass combines lensing, highlights, shadows, responsive motion, and environmental color. Regular material supports controls and navigation; clear material belongs over rich media with enough local dimming to support its foreground. Large text surfaces need a quieter material. See [Apple's overview](https://developer.apple.com/videos/play/wwdc2025/219/) and [material hierarchy](https://developer.apple.com/design/human-interface-guidelines/materials).

The React reference creates a displaced optical layer beneath sharp foreground content. Its SVG pipeline offsets color channels, and the container adds backdrop blur and interaction feedback. Its documentation explicitly limits edge refraction on Safari and Firefox. The transferable technique is the isolated lens layer, rather than copying an entire interface or adding blur to every card. [Reference source](https://github.com/rdev/liquid-glass-react/blob/master/src/index.tsx).

## The shared implementation

`src/shared/liquid-glass.ts` enhances the static blog and React Studio with the same DOM runtime. It generates a rounded-rectangle displacement map from each control's measured width, height, and corner radius. Neutral map values preserve the middle; edge normals produce the lens. Three SVG displacement passes introduce small color separation at the perimeter. An isolated pseudo-element holds this optical layer; text and controls remain above it.

`src/shared/liquid-glass.css` owns luminous rims, a moving highlight, depth shadows, tints, and elastic press feedback. Navigation, the floating outline, profile card, and Studio sidebar receive lensing. Content panels use stable standard material; nested controls use thin fills. A clear specimen over an original coastline illustration makes the optical behavior easy to inspect in `/__components/` and the component showcase.

Apply the SVG displacement in the pseudo-element's **backdrop-filter** pipeline. A continuous translucent, atmosphere-derived tint covers the lens, with a thin highlight at its edge. Do not inset the fill behind a thick transparent border: that creates a visible rim-to-center split and a separate inner panel. Do not override every card with the denser reading material. Filtering a translucent color fill through three channel blends can accumulate opacity and turn the center into a dark slab. The screenshot comparison must therefore prove visible background refraction while retaining a translucent center and sharp text.

Texture generation happens after visibility or geometry changes, with a capped resolution and bounded cache. Pointer updates change only highlight variables inside one animation frame. There is no continuous rendering loop, screenshot capture, page duplication, or React hydration on public pages.

Optical cache keys include blur and saturation as well as geometry and strength. Appearance exposes those parameters, material tint opacity, Article background tint, corner radius, wallpaper treatment, and ambient intensity. Article and About prose share the regular `glass-panel` material; their translucent tint scales with the existing `readingOpacity` setting. Article tint and wallpaper wash both reach zero without hidden minimums. Functional glass retains separate readability protection, while `.about-introduction` stays transparent. Reduced transparency retains the solid fallback. New values affect unsaved previews and generated pages without rewriting old notebooks. Native form controls share inset tints and specular edges; switches move a glass thumb inside a quieter track rather than using a flat colored pill.

Dialogs are special top-layer surfaces: they receive the optical material even if their DOM ancestor is another panel. Chromium uses real displacement beneath sharp modal content. WebKit uses host blur with a translucent tint and rim. Keep modal scrolling inside its stable rim. Reduced transparency uses the same solid fallback as navigation and cards.

The public navigation adds a tinted capsule that moves and reshapes around hovered or focused links, with bounded magnetic movement and a moving specular highlight. It shares the header's optical layer instead of nesting another strong blur. `src/site/navigation.ts` measures real link geometry and keeps ordinary anchor navigation. `navigation.css` adds [cross-document View Transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@view-transition), preserves the header as a named layer, and provides a first-load fade and reduced-motion fallback. A delayed progress shimmer covers slower navigations without delaying or intercepting the browser.

## Browser and accessibility contract

- Chromium receives the SVG refraction path. WebKit and Firefox retain layered blur, highlights, depth, and tint; accepting a CSS URL filter does not prove that a browser renders the displacement.
- Reduced transparency and increased contrast disable optical layers and use solid materials. Reduced motion disables pointer motion and elastic press feedback.
- Write WebKit-prefixed properties before the standard property so CSS minification retains the canonical declaration.
- Local background pictures use `/media/` references. They are validated, copied into the static artifact, and supported by contrast-preserving reading surfaces.
- A custom photograph must never make a paragraph depend on image brightness for legibility.

## Review protocol

Review the specimen over its visible grid, then the real navigation over scrolling content. Compare a screenshot with and without displacement in Chromium; a nonzero CSS filter string alone is insufficient evidence. Review Safari's fallback, both themes, a 390px viewport, live appearance preview, and reduced transparency/motion. Check optical geometry after resizing and after a disclosure opens. Audit active and inactive controls, not only initial states.

Maintain the showcase when adding a component or material. Keep the optical layer below content and preserve static fallbacks. The project does not claim to reproduce Apple's private native renderer.

The automated WebKit renderer on this machine omitted backdrop blur in both a standalone specimen and a dialog, despite accepting the property. Its checks establish usable fallback tint, layout, focus, and motion behavior; they do not prove a Safari optical match. Chromium screenshot differences establish actual displacement. Consult [WebKit's backdrop-filter demonstration](https://webkit.org/demos/backdrop-filter/) when reviewing a native Safari installation.
