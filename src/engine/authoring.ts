import { parse } from 'yaml';
import { entrySchema } from '../shared/contracts.js';
import { authoringVersion } from '../shared/markdown-catalog.js';
import {
  inspectMarkdown,
  MarkdownValidationError,
  type MarkdownDiagnostic,
} from '../shared/markdown-analysis.js';
import { renderMarkdown } from './markdown.js';
export async function checkMarkdownDocument(source: string, full = true) {
  const diagnostics: MarkdownDiagnostic[] = [];
  let body = source,
    offset = 0,
    lineOffset = 0;
  let math: import('../shared/math-authoring.js').MathSettings | undefined;
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatter) {
    offset = frontmatter[0].length;
    lineOffset = (frontmatter[0].match(/\n/g) || []).length;
    body = source.slice(offset);
    try {
      const result = entrySchema.safeParse(parse(frontmatter[1]));
      if (result.success) math = result.data.math;
      if (!result.success)
        for (const issue of result.error.issues)
          diagnostics.push({
            severity: 'error',
            code: 'frontmatter',
            message: issue.message,
            path: issue.path.join('.'),
            from: 0,
            to: offset,
            line: 1,
            column: 1,
          });
    } catch (e) {
      diagnostics.push({
        severity: 'error',
        code: 'frontmatter-yaml',
        message: (e as Error).message,
        from: 0,
        to: offset,
        line: 1,
        column: 1,
      });
    }
  }
  const analysis = inspectMarkdown(body);
  diagnostics.push(
    ...analysis.diagnostics.map((d) => ({
      ...d,
      from: d.from + offset,
      to: d.to + offset,
      line: d.line + lineOffset,
    })),
  );
  if (full && !diagnostics.some((d) => d.severity === 'error')) {
    try {
      await renderMarkdown(body, {math});
    } catch (e) {
      if (e instanceof MarkdownValidationError)
        diagnostics.push(
          ...e.diagnostics.map((d) => ({
            ...d,
            from: d.from + offset,
            to: d.to + offset,
            line: d.line + lineOffset,
          })),
        );
      else {
        const position = (e as any).sourcePosition;
        diagnostics.push({
          severity: 'error',
          code: 'render-error',
          message: (e as Error).message,
          from: (position?.start.offset || 0) + offset,
          to: (position?.end.offset || 0) + offset,
          line: (position?.start.line || 1) + lineOffset,
          column: position?.start.column || 1,
        });
      }
    }
  }
  return {
    version: authoringVersion,
    ok: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
    labels: analysis.labels,
  };
}
