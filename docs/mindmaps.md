# Mindmaps

Mindmaps use an ordinary nested Markdown list. The list remains the complete text alternative and canonical editing format; readers navigate the visualization without editing it.

```markdown
:::mindmap[Learning by making]{layout="map"}
- Curiosity
  - Observe
    - Ask a question
    - Notice a pattern
  - Test
    - Build a model
    - Compare the result
  - Explain
    - State assumptions
    - Share the evidence
:::
```

`layout="map"` balances top-level branches on either side of the root and is the default. `layout="tree"` puts branches to the right. Multiple top-level list items use the component title as a synthetic root. Nodes retain source order and stable path-derived identities within that instance. A changed list can change those identities; reader navigation state is temporary and is not an annotation or document identifier.

The existing limits are 200 authored nodes and 10 nested list levels. Labels must contain text. Rich list labels remain in the readable outline; SVG labels use their plain text. Long SVG labels wrap to four lines, with the complete label available through the node's accessible name, title, search and text outline. Arbitrary node scripts, HTML options and callbacks are unsupported.

## Reader controls

Map/Tree switches the layout. Select nodes to inspect their labels. The small branch control or Space/Enter collapses or expands descendants; selection and search reveal hidden ancestors. Arrow Up/Down traverses visible nodes, Right expands/enters children, Left collapses/returns to the parent, and Home/End selects the first/last visible node.

Find searches the complete tree, including collapsed branches. Enter/Shift+Enter and the adjacent controls cycle matches. Cmd/Ctrl+F inside the canvas focuses node search. Matches and selection use shared accent ink and remain distinct from branch colors.

- Zoom buttons and `+`/`−` adjust scale around the viewport center. Fit (`0`) shows the current visible geometry; 100% (`1`) restores actual scale.
- Mouse dragging pans. Ordinary scrolling passes to the page. Ctrl/Cmd+wheel zooms around the pointer.
- Touch initially scrolls the page. **Explore map** enables one-finger panning and two-finger pinch navigation. Escape exits Explore in the embedded view.
- **Expand mindmap** moves the same stage into a native glass dialog; it retains selection/layout and restores focus to its opener on close. Escape closes the dialog.
- **More** includes Collapse branches, Expand all, a depth selector, SVG/PNG downloads and Copy Markdown outline.

SVG/PNG exports use the current layout and collapsed branches with current theme colors. PNG output is bounded to 4096px per dimension and 2× scale. Copy outline includes the complete tree. Export/clipboard failures leave the map and text outline intact.

## Static engine and payload

`src/shared/mindmap.ts` provides bounded document validation, deterministic geometry and safe native SVG. Compilation emits both light and dark variants, namespaced by document/instance/theme, plus a native **Read text outline** disclosure. It does not invoke Mermaid for `:::mindmap`; explicit Mermaid fences retain the existing cached Mermaid renderer.

The private generated payload is `{version:1,title,layout,root}` with nodes `{id,label,children}`. It is escaped data in the generated HTML, not a new canonical frontmatter format or an externally writable API. The authoring catalog exposes only the supported `layout` attribute.

Without JavaScript or after an enhancement-module failure the full diagram fits its canvas, the outline works, and unavailable controls remain disabled. The lightweight navigation module loads on pointer/focus intent. No public Mermaid runtime, schema interpreter or Studio code is required. Print removes controls and restores a fitting diagram.

When changing this component, update the catalog, generated [reference](markdown-reference.md), authoring pack, showcase and isolated fixtures. Verify layouts, collapse/search through hidden branches, keyboard/touch behavior, long bilingual labels, unique IDs, native-dialog focus, exports, theme changes, no-JavaScript output, failed enhancement and asset budgets in both browser engines.
