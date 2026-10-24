---
id: quicksort-template
slug: quicksort-template
title: Quicksort with inclusive bounds
publishedAt: 2026-10-23
status: draft
---

## Contract

Use a zero-indexed array with inclusive `lo` and `hi` bounds. The base guard handles empty and single-element ranges. Lomuto partition places the final pivot and returns its index. This example is explanatory notation and is never executed by Glass.

:::algorithm[Quicksort]{#alg-quicksort}
```pseudocode title="Quicksort"
INPUT A (array of comparable values)
OUTPUT A sorted in ascending order

PROCEDURE QUICKSORT(A, lo, hi)
  IF lo < hi THEN
    p ← PARTITION(A, lo, hi)
    QUICKSORT(A, lo, p - 1)
    QUICKSORT(A, p + 1, hi)
  END IF
END PROCEDURE

FUNCTION PARTITION(A, lo, hi)
  pivot ← A[hi]
  i ← lo - 1
  FOR j ← lo TO hi - 1 DO
    IF A[j] ≤ pivot THEN
      i ← i + 1
      SWAP A[i], A[j]
    END IF
  END FOR
  SWAP A[i + 1], A[hi]
  RETURN i + 1
END FUNCTION

QUICKSORT(A, 0, length(A) - 1)
```
:::

The partition in :ref[alg-quicksort] keeps values no greater than the pivot on its left. The algorithm is in-place and is not stable; the final-element pivot can produce quadratic worst-case time. Rename the label when combining this template with another algorithm.
