---
id: stem-algorithms-template
slug: stem-algorithms-template
title: A small mechanics note
publishedAt: 2026-10-23
status: draft
math:
  packages: [physics, mathtools, units, mhchem, cancel]
---

## Model and notation

For a displacement $x(t)$, velocity is $\dv{x}{t}$ and acceleration is $\dv[2]{x}{t}$.

:::equation[Harmonic motion]{#eq-motion}
$$
\dv[2]{x}{t} + \omega^2 x = 0.
$$
:::

Let $\vb{F}=-kx\vu{x}$. A speed may be written as $\units[3]{m/s}$. Chemistry uses $\ce{H2O}$ rather than arbitrary LaTeX packages.

:::algorithm[A forward step]{#alg-step}
```pseudocode title="Euler step"
INPUT position, velocity, step
acceleration ← $-\omega^2 x$
position ← $x + v\Delta t$
velocity ← $v + a\Delta t$
RETURN position, velocity
```
:::

The update in :ref[alg-step] approximates :ref[eq-motion]. State its assumptions and numerical limits before using it for a real experiment.

| Symbol | Meaning | Unit |
| :--- | :--- | ---: |
| $x$ | Displacement | $\units{m}$ |
| $v$ | Velocity | $\units{m/s}$ |
| $\omega$ | Angular frequency | $\units{s^{-1}}$ |

## Source-oriented pseudocode

```pseudocode style="code" title="step.pseudo"
FUNCTION step(x, v, dt)
  a ← -omega * omega * x
  RETURN (x + v * dt, v + a * dt)
END FUNCTION
```
