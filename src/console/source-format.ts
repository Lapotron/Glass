import { t } from '../shared/i18n.js';
import { parseMarkdown } from '../shared/markdown-analysis.js';
import { diff } from '@codemirror/merge';
export type SourceEdit = { from: number; to: number; insert: string };
export type FormatResult = { source: string; edits: SourceEdit[] };
// Position-only differences are allowed. Code, math, directives, links, raw HTML,
// hard breaks, and reference identifiers must retain the same parsed meaning.
function semantic(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(semantic);
  if (node && typeof node === 'object')
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== 'position')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, semantic(value)]),
    );
  return node;
}
export const markdownMeaning = (source: string) => JSON.stringify(semantic(parseMarkdown(source)));
export async function formatMarkdown(
  source: string,
  selection?: { from: number; to: number },
): Promise<FormatResult> {
  if (new TextEncoder().encode(source).length > 2 * 1024 * 1024)
    throw new Error(t("Formatting is limited to 2 MiB. Format a smaller document instead."));
  let from = 0,
    to = source.length;
  if (selection) {
    const blocks = parseMarkdown(source).children.filter(
      (node) =>
        node.position!.end.offset! > selection.from && node.position!.start.offset! < selection.to,
    );
    if (
      !blocks.length ||
      blocks[0].position!.start.offset! < selection.from ||
      blocks.at(-1)!.position!.end.offset! > selection.to
    )
      throw new Error(
        t("Select complete Markdown blocks, including the full paragraph, table, list, or component."),
      );
    from = blocks[0].position!.start.offset!;
    to = blocks.at(-1)!.position!.end.offset!;
  }
  const [{ format }, markdown] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/markdown'),
  ]);
  let formatted = await format(source.slice(from, to), {
    parser: 'markdown',
    plugins: [markdown],
    proseWrap: 'preserve',
    printWidth: 100,
    tabWidth: 2,
    embeddedLanguageFormatting: 'off',
    endOfLine: 'lf',
  });
  if (selection && !source.slice(from, to).endsWith('\n')) formatted = formatted.replace(/\n$/, '');
  const result = source.slice(0, from) + formatted + source.slice(to);
  if (markdownMeaning(source) !== markdownMeaning(result))
    throw new Error(
      t("Formatting would change Markdown meaning. The original text has been kept; review custom syntax manually."),
    );
  return {
    source: result,
    edits: diff(source, result, { timeout: 1000, scanLimit: 5000 }).map((change) => ({
      from: change.fromA,
      to: change.toA,
      insert: result.slice(change.fromB, change.toB),
    })),
  };
}
