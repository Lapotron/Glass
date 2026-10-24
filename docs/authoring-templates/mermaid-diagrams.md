---
id: mermaid-diagrams-template
slug: mermaid-diagrams-template
title: Mermaid diagrams with transparent presentation
publishedAt: 2026-10-23
status: draft
---

Mermaid 12.2.0 compiles these self-contained examples to transparent light/dark SVG. Add accessible titles/descriptions when adapting them. The default node treatment stays quiet; authored colors and data encodings are retained. Read diagrams.md in the authoring pack for the viewing and export contract.

## Flowchart

```mermaid
flowchart LR
  accTitle: Reading flow
  Draft[Write] --> Review[Review]
  Review --> Published[Publish]
```

## Kanban

```mermaid
kanban
  planned[Planned]
    docs[Write documentation]
  shipped[Shipped]
    viewer[Diagram viewer]
```

## Packet

```mermaid
packet-beta
  0-7: "Version"
  8-15: "Flags"
  16-31: "Payload length"
```

## Radar

```mermaid
radar-beta
  axis Clarity, Speed, Coverage
  curve Current{4,3,5}
  curve Target{5,5,5}
```

## Treemap

```mermaid
treemap-beta
  "Writing"
    "Posts": 12
    "Articles": 8
  "Projects"
    "Tools": 6
```

## Architecture

```mermaid
architecture-beta
  group blog(cloud)[Blog]
  service pages(server)[Pages] in blog
  service files(disk)[Media] in blog
  pages:R -- L:files
```

## Block diagram

```mermaid
block-beta
  columns 3
  Source["Markdown"] Renderer["Renderer"] Site["Website"]
  Source --> Renderer
  Renderer --> Site
```

## XY chart

```mermaid
xychart-beta
  title "Reading sessions"
  x-axis [Mon, Tue, Wed, Thu]
  y-axis "Sessions" 0 --> 50
  bar [18, 32, 27, 41]
```

## Swimlanes

```mermaid
swimlane-beta LR
  subgraph Author
    Write[Write draft]
  end
  subgraph Reader
    Read[Read article]
  end
  Write --> Read
```

## Use case

```mermaid
usecase-beta
direction LR
actor Reader
systemBoundary Blog
  Read("Read an article")
end
Reader --> Read
```

## Tree view

```mermaid
treeView-beta
  Notebook/
    Writing/
      Articles
      Posts
    Projects/
```

## Event modeling

```mermaid
eventmodeling

tf 01 ui WritingDesk
tf 02 cmd PublishDraft
tf 03 evt ArticlePublished
```
