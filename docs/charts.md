# Charts for readers and authors

Charts use ECharts 6.1.0. The engine renders light and dark SVG at build time. A semantic table contains the exact source data even when JavaScript is disabled. Hover, focus or tap requests the interactive renderer and the relevant chart family. The SVG remains visible while it loads or if loading fails. No chart service or external script CDN is needed.

Use **Insert component → Data chart** in Studio. Select a chart type, edit its data, or import CSV/TSV. The Composer reports errors before insertion. The Markdown editor also completes keys and enum values inside `interactive` JSON fences. [Ready-to-use examples](authoring-templates/chart-examples.md) cover every chart type.

## Reader controls

- Hover to inspect a point, slice, region, node or link. Cartesian shared tooltips compare series at the same X position; item mode inspects one point. Reference marks and interval decorations stay out of the data tooltip.
- Focus the chart and use Left/Right to change the point, Up/Down to change series, and Home/End to jump. Escape dismisses the tooltip; Enter pins it. Touch readers can tap to pin or dismiss a tooltip without losing ordinary page scrolling.
- Click a legend to show/hide its series or category. Shift-click isolates it; Reset restores everything. An all-hidden chart explains how to recover.
- Charts with `zoom: true` have range sliders, Zoom in/out, Reset and a Pan checkbox. Ctrl + wheel zooms; ordinary wheel gestures scroll the page. Pan is an explicit mode.
- Treemaps and sunbursts support drilldown and return navigation. Heatmaps have a value-range filter. Sankey hover emphasizes connected flows.
- SVG and PNG download the current chart view; CSV downloads all source rows, including hidden series and points outside the zoom range. Hierarchies export path/value rows; Sankey exports source/target/value rows. CSV string cells that resemble spreadsheet formulas are protected.
- View data table is a native disclosure. It remains usable when the chart engine is unavailable.

## Common configuration

Use a fenced `interactive` block containing one JSON object. Do not pass ECharts options, functions, JavaScript expressions, remote URLs or formatter callbacks. The shared schemas are the executable contract; export them with `npm run authoring:pack`.

| Field              | Default and purpose                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `type`             | Always `"chart"`.                                                                                                              |
| `title`, `caption` | Plain-text heading and supporting context.                                                                                     |
| `style`            | `line`, `area`, `bar`, `scatter`, `bubble`, `pie`, `doughnut`, `radar`, `mixed`, `heatmap`, `treemap`, `sunburst`, `sankey`.   |
| `labels`           | Category labels; one per series value.                                                                                         |
| `series`           | Named series; use `values` or numeric/time `points`. Names should be unique.                                                   |
| `horizontal`       | `false`; reverses Cartesian orientation.                                                                                       |
| `stacking`         | `none`, `normal`, or `percent`. Category series on one Y axis only; percent requires nonnegative values.                       |
| `legend`           | `true`; HTML controls with keyboard focus and pressed state.                                                                   |
| `tooltip`          | `shared` or `item`; non-Cartesian types use item tooltips.                                                                     |
| `zoom`             | `false`; range/zoom controls for Cartesian charts.                                                                             |
| `format`           | `{precision:2,compact:false,prefix:"",suffix:""}`. Precision is 0–10; `compact` uses values such as 1.2K.                      |
| `colors`           | Optional array of 1–12 six-digit hex colors; otherwise the shared theme palette is used.                                       |
| `syncGroup`        | Optional stable group key. Activated charts with matching domains share a cursor; they keep independent zoom and legend state. |
| `annotations`      | Up to 30 reference lines, points or bands.                                                                                     |

## Category and mixed charts

```interactive
{
  "type": "chart",
  "style": "mixed",
  "title": "Practice and progress",
  "labels": ["Observe", "Try", "Reflect", "Refine"],
  "series": [
    {"name": "Practice", "style": "bar", "values": [8, 16, 22, 26]},
    {"name": "Progress", "style": "line", "values": [12, 21, null, 32]}
  ],
  "zoom": true,
  "annotations": [{"type":"line", "axis":"y", "value":20, "label":"Target"}]
}
```

`values` contains finite numbers or `null`. A null creates a gap; it is never silently converted to a measured zero in the table. Each series has one value per label. Use category values or XY points consistently across a chart; combining the two data shapes is rejected so every source value remains represented in the table. Line and area graphs use straight segments by default. `series.style` chooses line, area, bar or scatter for mixed charts. `series.dashed` distinguishes a line without relying on color. A series can set a `unit` and `axis: "right"`.

Pie and doughnut use exactly one nonnegative category series. Radar needs at least three labels and nonnegative values. Missing radial values have no plotted contribution; the table retains the missing marker.

## XY points, dates and intervals

```interactive
{
  "type": "chart", "style": "line", "title": "Measured response",
  "xAxis": {"type":"time", "title":"Date"},
  "yAxis": {"type":"value", "title":"Response"},
  "series": [{"name":"Experiment", "points":[
    {"x":"2026-01-01", "y":2, "low":1.5, "high":2.5},
    {"x":"2026-01-02", "y":4, "low":3, "high":5},
    {"x":"2026-01-03", "y":3, "low":2.5, "high":3.5}
  ]}], "zoom":true
}
```

Points use `x`, `y` and optional `label`, `r`, `low`, `high`. Bubble radius is bounded and scaled for display. Low/high produce error bars; line/area charts also show a confidence band. String X values require a time axis and valid ISO dates, with UTC timestamps when a time is included. A logarithmic axis requires strictly positive values.

Axes accept `type`, `title`, optional `min` and `max`. Supported types are category, value, time and log; Y axes support numeric scales. `rightAxis` configures a secondary Y scale. The maximum must exceed the minimum. Tick labels thin automatically and avoid overlap.

Reference marks use `type`, `axis`, `value` and optional `label`. Bands require `end`. Points may supply `x`; otherwise the first X category is used. Example: `{"type":"band","axis":"y","value":10,"end":20,"label":"Expected range"}`.

## Advanced data shapes

| Type               | Data contract                                                         | CSV/TSV columns                                         |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------- |
| Heatmap            | `labels`, `yLabels`, `cells: [[xIndex,yIndex,value]]`                 | `x,y,value`; labels are derived from the text columns.  |
| Treemap / sunburst | `tree: [{name,value?,children?}]`; leaves require a nonnegative value | `path,value`; slash separates hierarchy levels.         |
| Sankey             | `nodes: [{id,label?}]`, `links: [{source,target,value}]`              | `source,target,value`.                                  |
| Scatter / bubble   | `series: [{name,points:[{x,y,r?,low?,high?,label?}]}]`                | Required `x,y`; optional `r,low,high,label,series`.     |
| Category / radial  | `labels`, `series: [{name,values}]`                                   | First column labels; later headers name numeric series. |

Sankey identifiers must be unique, links must resolve, and cycles are rejected. Heatmap indices must be within their label arrays. Trees are limited to 1,000 nodes and depth 12. Charts allow 12 series, 5,000 points per series and 20,000 points overall; heatmaps allow 5,000 cells, Sankey 500 nodes and 2,000 links. Larger data should be summarized before authoring so the static page remains readable.

The first release provides these supported capabilities rather than every plugin or proprietary option of Chart.js, Recharts or ECharts. Geographic maps, arbitrary custom renderers, animation timelines and live network data are outside the authoring language.
