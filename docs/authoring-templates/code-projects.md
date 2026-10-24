---
id: code-projects-template
slug: code-projects-template
title: Explain a small typed module
publishedAt: 2026-10-23
status: draft
---

## A reusable function

Named fences in one project share virtual files and relative imports. Glass highlights and checks the examples without running them.

```typescript title="geometry.ts" project="geometry-example"
export function square(value: number): number {
  return value * value;
}
```

## A caller

```typescript title="main.ts" project="geometry-example"
import { square } from './geometry';
const result = square(3);
console.log(result);
```

## An intentionally incomplete exercise

```typescript title="exercise.ts" check="off"
// Complete the implementation as an exercise.
const missing = completeThisExample();
```
