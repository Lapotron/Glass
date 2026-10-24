/** Valid, executable-free notation shared by Studio, reference docs and authoring packs. */
export const quicksortSource = `INPUT A (array of comparable values)
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

QUICKSORT(A, 0, length(A) - 1)`;

export const quicksortAlgorithm =
  ':::algorithm[Quicksort]{#alg-quicksort}\n```pseudocode title="Quicksort"\n' +
  quicksortSource +
  '\n```\n:::\n';

export const pseudocodeBuiltins = ['length', 'min', 'max', 'abs', 'floor', 'ceil', 'sqrt', 'SWAP'];
export const pseudocodeOperators = [
  '←',
  '→',
  '↔',
  '⇒',
  '⇔',
  ':=',
  '≤',
  '≥',
  '≠',
  '∈',
  '∉',
  '∧',
  '∨',
  '¬',
];
export const pseudocodeSnippets = [
  {
    name: 'procedure',
    description: 'Procedure with matching END',
    source: 'PROCEDURE name(parameters)\n\taction\nEND PROCEDURE',
    fields: ['name', 'parameters', 'action'],
  },
  {
    name: 'function',
    description: 'Function with return and matching END',
    source: 'FUNCTION name(parameters)\n\tRETURN result\nEND FUNCTION',
    fields: ['name', 'parameters', 'result'],
  },
  {
    name: 'if',
    description: 'Conditional block',
    source: 'IF condition THEN\n\taction\nEND IF',
    fields: ['condition', 'action'],
  },
  {
    name: 'ifelse',
    description: 'Conditional with an alternative',
    source: 'IF condition THEN\n\taction\nELSE\n\talternative\nEND IF',
    fields: ['condition', 'action', 'alternative'],
  },
  {
    name: 'for',
    description: 'Inclusive counted loop',
    source: 'FOR i ← start TO finish DO\n\taction\nEND FOR',
    fields: ['i', 'start', 'finish', 'action'],
  },
  {
    name: 'foreach',
    description: 'Loop over a collection',
    source: 'FOR EACH item IN values DO\n\taction\nEND FOR',
    fields: ['item', 'values', 'action'],
  },
  {
    name: 'while',
    description: 'Precondition loop',
    source: 'WHILE condition DO\n\taction\nEND WHILE',
    fields: ['condition', 'action'],
  },
  {
    name: 'repeat',
    description: 'Postcondition loop',
    source: 'REPEAT\n\taction\nUNTIL condition',
    fields: ['action', 'condition'],
  },
  {
    name: 'assign',
    description: 'Assignment',
    source: 'target ← expression',
    fields: ['target', 'expression'],
  },
  {
    name: 'swap',
    description: 'Exchange two values',
    source: 'SWAP left, right',
    fields: ['left', 'right'],
  },
  {
    name: 'quicksort',
    description: 'Zero-indexed Quicksort with Lomuto partition',
    source: quicksortSource,
    fields: ['A', 'lo', 'hi'],
  },
];
