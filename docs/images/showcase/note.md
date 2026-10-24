## Start with a question

What changes when a wave begins to fade? Keep the question, the model and a small calculation together so the explanation is easy to revisit.

## Give it a model

Let $A$ set the initial amplitude, $\lambda$ control the decay and $\omega$ set the angular frequency:

$$
y(t) = A e^{-\lambda t}\sin(\omega t).
$$

A useful notebook keeps mathematical notation beside the code that explores it.

## Keep the calculation small

```typescript title="wave.ts" {2}
function wave(t: number, decay = 0.2): number {
  const envelope = Math.exp(-decay * t);
  return envelope * Math.sin(2 * Math.PI * t);
}
```

The function uses $A=1$ and $\omega=2\pi$. A few rounded values make the result easier to check:

| Time $t$ | Amplitude $y(t)$ |
| -------: | ---------------: |
|     0.25 |            0.951 |
|     0.75 |           -0.861 |
|     1.25 |            0.779 |

## Leave a trail

- [x] State the assumptions.
- [x] Keep the calculation reproducible.
- [ ] Compare a second decay rate.

A clear next question gives the next writing session somewhere to begin.
