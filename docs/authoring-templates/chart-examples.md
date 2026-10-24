# Chart examples

Generated from the validated chart examples by `npm run authoring:docs`. Each block is ready to paste into an article. See [chart options and interactions](../charts.md).

## line

```interactive
{
  "type": "chart",
  "style": "line",
  "title": "Line · a small experiment",
  "labels": [
    "Observe",
    "Try",
    "Reflect",
    "Refine"
  ],
  "series": [
    {
      "name": "Study",
      "values": [
        12,
        21,
        17,
        32
      ]
    },
    {
      "name": "Practice",
      "values": [
        8,
        16,
        22,
        26
      ]
    }
  ],
  "zoom": true
}
```

## area

```interactive
{
  "type": "chart",
  "style": "area",
  "title": "Area · a small experiment",
  "labels": [
    "Observe",
    "Try",
    "Reflect",
    "Refine"
  ],
  "series": [
    {
      "name": "Study",
      "values": [
        12,
        21,
        17,
        32
      ]
    },
    {
      "name": "Practice",
      "values": [
        8,
        16,
        22,
        26
      ]
    }
  ],
  "zoom": true
}
```

## bar

```interactive
{
  "type": "chart",
  "style": "bar",
  "title": "Bar · a small experiment",
  "labels": [
    "Observe",
    "Try",
    "Reflect",
    "Refine"
  ],
  "series": [
    {
      "name": "Study",
      "values": [
        12,
        21,
        17,
        32
      ]
    },
    {
      "name": "Practice",
      "values": [
        8,
        16,
        22,
        26
      ]
    }
  ],
  "zoom": true
}
```

## scatter

```interactive
{
  "type": "chart",
  "style": "scatter",
  "title": "Scatter · a small experiment",
  "series": [
    {
      "name": "Observations",
      "points": [
        {
          "x": 1,
          "y": 2,
          "r": 6,
          "low": 1.5,
          "high": 2.5
        },
        {
          "x": 2,
          "y": 4,
          "r": 12,
          "low": 3,
          "high": 5
        },
        {
          "x": 3,
          "y": 3,
          "r": 9,
          "low": 2.5,
          "high": 3.5
        }
      ]
    }
  ],
  "zoom": true
}
```

## bubble

```interactive
{
  "type": "chart",
  "style": "bubble",
  "title": "Bubble · a small experiment",
  "series": [
    {
      "name": "Observations",
      "points": [
        {
          "x": 1,
          "y": 2,
          "r": 6,
          "low": 1.5,
          "high": 2.5
        },
        {
          "x": 2,
          "y": 4,
          "r": 12,
          "low": 3,
          "high": 5
        },
        {
          "x": 3,
          "y": 3,
          "r": 9,
          "low": 2.5,
          "high": 3.5
        }
      ]
    }
  ],
  "zoom": true
}
```

## pie

```interactive
{
  "type": "chart",
  "style": "pie",
  "title": "Pie · a small experiment",
  "labels": [
    "Observe",
    "Try",
    "Reflect",
    "Refine"
  ],
  "series": [
    {
      "name": "Time",
      "values": [
        12,
        21,
        17,
        32
      ]
    }
  ]
}
```

## doughnut

```interactive
{
  "type": "chart",
  "style": "doughnut",
  "title": "Doughnut · a small experiment",
  "labels": [
    "Observe",
    "Try",
    "Reflect",
    "Refine"
  ],
  "series": [
    {
      "name": "Time",
      "values": [
        12,
        21,
        17,
        32
      ]
    }
  ]
}
```

## radar

```interactive
{
  "type": "chart",
  "style": "radar",
  "title": "Radar · a small experiment",
  "labels": [
    "Observe",
    "Try",
    "Reflect",
    "Refine"
  ],
  "series": [
    {
      "name": "Study",
      "values": [
        12,
        21,
        17,
        32
      ]
    },
    {
      "name": "Practice",
      "values": [
        8,
        16,
        22,
        26
      ]
    }
  ]
}
```

## mixed

```interactive
{
  "type": "chart",
  "style": "mixed",
  "title": "Mixed · a small experiment",
  "labels": [
    "Observe",
    "Try",
    "Reflect",
    "Refine"
  ],
  "series": [
    {
      "name": "Practice",
      "values": [
        8,
        16,
        22,
        26
      ],
      "style": "bar"
    },
    {
      "name": "Progress",
      "values": [
        12,
        21,
        17,
        32
      ],
      "style": "line"
    }
  ],
  "zoom": true
}
```

## heatmap

```interactive
{
  "type": "chart",
  "style": "heatmap",
  "title": "Heatmap · a small experiment",
  "labels": [
    "Mon",
    "Tue",
    "Wed"
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
  "yLabels": [
    "Read",
    "Make"
  ]
}
```

## treemap

```interactive
{
  "type": "chart",
  "style": "treemap",
  "title": "Treemap · a small experiment",
  "tree": [
    {
      "name": "Learning",
      "children": [
        {
          "name": "Theory",
          "children": [
            {
              "name": "Reading",
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
              "name": "Experiments",
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
  ]
}
```

## sunburst

```interactive
{
  "type": "chart",
  "style": "sunburst",
  "title": "Sunburst · a small experiment",
  "tree": [
    {
      "name": "Learning",
      "children": [
        {
          "name": "Theory",
          "children": [
            {
              "name": "Reading",
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
              "name": "Experiments",
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
  ]
}
```

## sankey

```interactive
{
  "type": "chart",
  "style": "sankey",
  "title": "Sankey · a small experiment",
  "nodes": [
    {
      "id": "Reading"
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
      "source": "Reading",
      "target": "Notes",
      "value": 6
    },
    {
      "source": "Reading",
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
  ]
}
```
