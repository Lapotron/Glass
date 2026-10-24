export type MathPreviewExpression = { source: string; display: boolean };
export type MathPreviewResult = { html: string; error?: never } | { error: string; html?: never };
export const mathPreviewLimits = {
  count: 200,
  expression: 16_384,
  inputBytes: 128 * 1024,
  outputBytes: 2 * 1024 * 1024,
} as const;
