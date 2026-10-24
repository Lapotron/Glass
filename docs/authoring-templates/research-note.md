---
id: research-note-template
slug: research-note-template
title: A bounded error
publishedAt: 2026-01-01
status: draft
summary: A short statement, derivation and measured comparison.
tags: [research]
lang: en
---

## Question

What can we infer from this model, and what does it leave uncertain?

:::theorem[A bounded square]{#thm-bound}
For $0\le x\le1$, $x^2\le x$.
:::

:::proof[Proof]
Multiply $x\le1$ by the nonnegative value $x$.
:::

:::equation[Error]{#eq-error}

$$
e(x) = x-x^2
$$

:::

:::table[Exact values]{#tab-values}

| $x$ | $e(x)$ |
| --: | -----: |
|   0 |      0 |
| 0.5 |   0.25 |
|   1 |      0 |
:::
## Interpretation

:ref[thm-bound] explains the sign of :ref[eq-error]; :ref[tab-values] gives exact examples. State limitations and supporting sources here.
