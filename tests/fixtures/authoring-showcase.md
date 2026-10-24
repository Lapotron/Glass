---
id: authoring-showcase
slug: authoring-showcase
title: A richer language for ideas
publishedAt: 2026-10-20
status: published
summary: Academic structure, booktabs tables, mind maps and interactive charts.
tags: [components, research]
lang: en
---

## A result, with its reasoning

The same reading surface holds the argument, the evidence and the visual explanation. Compare :ref[showcase-equation], :ref[showcase-table] and :ref[showcase-algorithm].

:::theorem[A bounded square]{#showcase-theorem}
For $0\le x\le1$, $x^2\le x$.
:::

:::proof[Proof]
Multiply $x\le1$ by the nonnegative number $x$.
:::

:::lemma[A nonnegative difference]{#showcase-lemma}
The difference $x-x^2$ is nonnegative on this interval.
:::

:::proposition[A maximum]{#showcase-proposition}
The difference is greatest at $x=1/2$.
:::

:::corollary[A bound]{#showcase-corollary}
For $0\le x\le1$, $0\le x-x^2\le 1/4$.
:::

:::definition[Error]{#showcase-definition}
An error measures the difference between a model and a stated reference.
:::

:::example[An exact value]{#showcase-example}
At $x=0.5$, the difference is exactly $0.25$.
:::

:::equation[The shape of the error]{#showcase-equation}

$$
\begin{aligned}
e(x) &= x-x^2 \\
e'(x) &= 1-2x
\end{aligned}
$$

:::

:::table[Exact observations]{#showcase-table}

| $x$ | $e(x)$ | Interpretation |
| --: | -----: | :------------- |
|   0 |      0 | Lower boundary |
| 0.5 |   0.25 | Maximum        |
|   1 |      0 | Upper boundary |

Values are exact. The table shares the article's transparent surface.
:::

:::algorithm[A small learning loop]{#showcase-algorithm}

1. Observe the current result.
2. State a prediction.
3. Measure one change.
4. Compare and refine the explanation.
:::
## Give an idea a visual structure

:::mindmap[Learning by making]

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
::::comparison[Two complementary approaches]
:::option[Analytical]
Derive a consequence from a stated model. Make each assumption visible.
:::
:::option[Experimental]
Measure the system. Compare the observation with a precise prediction.
:::
::::

:::timeline[From question to explanation]

- **Observe** — Notice a pattern worth explaining.
- **Predict** — State what a model implies.
- **Test** — Compare evidence with that prediction.
- **Refine** — Improve the explanation and repeat.
:::
## Explore the data

Hover, focus or tap a chart to activate its controls. Use the legend, keyboard, range controls or downloads. Every chart includes its full data table.

### Line

```interactive
{
  "type": "chart",
  "style": "line",
  "title": "Line \u00b7 an illustrative dataset",
  "labels": [
    "Mon",
    "Tue",
    "Wed",
    "Thu"
  ],
  "series": [
    {
      "name": "Reading",
      "values": [
        12,
        18,
        null,
        28
      ]
    },
    {
      "name": "Making",
      "values": [
        8,
        12,
        23,
        20
      ]
    }
  ],
  "zoom": true,
  "syncGroup": "showcase-days",
  "annotations": [
    {
      "type": "line",
      "axis": "y",
      "value": 20,
      "label": "Target"
    }
  ],
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Area

```interactive
{
  "type": "chart",
  "style": "area",
  "title": "Area \u00b7 an illustrative dataset",
  "labels": [
    "Mon",
    "Tue",
    "Wed",
    "Thu"
  ],
  "series": [
    {
      "name": "Reading",
      "values": [
        12,
        18,
        15,
        28
      ]
    },
    {
      "name": "Making",
      "values": [
        8,
        12,
        23,
        20
      ]
    }
  ],
  "stacking": "normal",
  "zoom": true,
  "syncGroup": "showcase-days",
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Bar

```interactive
{
  "type": "chart",
  "style": "bar",
  "title": "Bar \u00b7 an illustrative dataset",
  "labels": [
    "Theory",
    "Practice",
    "Review"
  ],
  "series": [
    {
      "name": "Before",
      "values": [
        12,
        18,
        8
      ]
    },
    {
      "name": "After",
      "values": [
        14,
        24,
        12
      ]
    }
  ],
  "horizontal": true,
  "stacking": "percent",
  "zoom": true,
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Scatter

```interactive
{
  "type": "chart",
  "style": "scatter",
  "title": "Scatter \u00b7 an illustrative dataset",
  "series": [
    {
      "name": "Experiment",
      "points": [
        {
          "x": 1,
          "y": 2,
          "low": 1.5,
          "high": 2.5
        },
        {
          "x": 2,
          "y": 4,
          "low": 3,
          "high": 5
        },
        {
          "x": 3,
          "y": 3,
          "low": 2.5,
          "high": 3.5
        }
      ]
    }
  ],
  "zoom": true,
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Bubble

```interactive
{
  "type": "chart",
  "style": "bubble",
  "title": "Bubble \u00b7 an illustrative dataset",
  "series": [
    {
      "name": "Observations",
      "points": [
        {
          "x": 1,
          "y": 2,
          "r": 6
        },
        {
          "x": 2,
          "y": 4,
          "r": 12
        },
        {
          "x": 3,
          "y": 3,
          "r": 9
        }
      ]
    }
  ],
  "zoom": true,
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Pie

```interactive
{
  "type": "chart",
  "style": "pie",
  "title": "Pie \u00b7 an illustrative dataset",
  "labels": [
    "Read",
    "Make",
    "Reflect"
  ],
  "series": [
    {
      "name": "Time",
      "values": [
        12,
        18,
        8
      ]
    }
  ],
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Doughnut

```interactive
{
  "type": "chart",
  "style": "doughnut",
  "title": "Doughnut \u00b7 an illustrative dataset",
  "labels": [
    "Read",
    "Make",
    "Reflect"
  ],
  "series": [
    {
      "name": "Time",
      "values": [
        12,
        18,
        8
      ]
    }
  ],
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Radar

```interactive
{
  "type": "chart",
  "style": "radar",
  "title": "Radar \u00b7 an illustrative dataset",
  "labels": [
    "Read",
    "Make",
    "Reflect",
    "Explain"
  ],
  "series": [
    {
      "name": "Before",
      "values": [
        12,
        18,
        8,
        10
      ]
    },
    {
      "name": "After",
      "values": [
        14,
        24,
        12,
        16
      ]
    }
  ],
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Mixed

```interactive
{
  "type": "chart",
  "style": "mixed",
  "title": "Mixed \u00b7 an illustrative dataset",
  "labels": [
    "Week 1",
    "Week 2",
    "Week 3",
    "Week 4"
  ],
  "series": [
    {
      "name": "Practice",
      "style": "bar",
      "values": [
        8,
        16,
        22,
        26
      ]
    },
    {
      "name": "Progress",
      "style": "line",
      "values": [
        12,
        21,
        17,
        32
      ]
    }
  ],
  "zoom": true,
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Heatmap

```interactive
{
  "type": "chart",
  "style": "heatmap",
  "title": "Heatmap \u00b7 an illustrative dataset",
  "labels": [
    "Mon",
    "Tue",
    "Wed"
  ],
  "yLabels": [
    "Read",
    "Make"
  ],
  "cells": [
    [
      0,
      0,
      3
    ],
    [
      1,
      0,
      7
    ],
    [
      2,
      0,
      4
    ],
    [
      0,
      1,
      8
    ],
    [
      1,
      1,
      2
    ],
    [
      2,
      1,
      6
    ]
  ],
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Treemap

```interactive
{
  "type": "chart",
  "style": "treemap",
  "title": "Treemap \u00b7 an illustrative dataset",
  "tree": [
    {
      "name": "Learning",
      "children": [
        {
          "name": "Theory",
          "children": [
            {
              "name": "Read",
              "value": 12
            },
            {
              "name": "Notes",
              "value": 8
            }
          ]
        },
        {
          "name": "Practice",
          "children": [
            {
              "name": "Make",
              "value": 18
            },
            {
              "name": "Review",
              "value": 10
            }
          ]
        }
      ]
    }
  ],
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Sunburst

```interactive
{
  "type": "chart",
  "style": "sunburst",
  "title": "Sunburst \u00b7 an illustrative dataset",
  "tree": [
    {
      "name": "Learning",
      "children": [
        {
          "name": "Theory",
          "children": [
            {
              "name": "Read",
              "value": 12
            },
            {
              "name": "Notes",
              "value": 8
            }
          ]
        },
        {
          "name": "Practice",
          "children": [
            {
              "name": "Make",
              "value": 18
            },
            {
              "name": "Review",
              "value": 10
            }
          ]
        }
      ]
    }
  ],
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

### Sankey

```interactive
{
  "type": "chart",
  "style": "sankey",
  "title": "Sankey \u00b7 an illustrative dataset",
  "nodes": [
    {
      "id": "Read"
    },
    {
      "id": "Experiment"
    },
    {
      "id": "Notes"
    },
    {
      "id": "Understanding"
    }
  ],
  "links": [
    {
      "source": "Read",
      "target": "Notes",
      "value": 6
    },
    {
      "source": "Read",
      "target": "Experiment",
      "value": 4
    },
    {
      "source": "Notes",
      "target": "Understanding",
      "value": 6
    },
    {
      "source": "Experiment",
      "target": "Understanding",
      "value": 4
    }
  ],
  "caption": "Illustrative data for this component showcase. Inspect the table for exact values."
}
```

## Sources and context

A manually authored citation :cite[showcase-notes] stays connected to its bibliography entry.

::::references[References]
:::reference[Example notebook notes]{#showcase-notes}
Component showcase notes. All datasets on this page are illustrative and are not research findings.
:::
::::
