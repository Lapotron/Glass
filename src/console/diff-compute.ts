import { t } from '../shared/i18n.js';
import { Text } from '@codemirror/state';
import { Chunk, Change } from '@codemirror/merge';
import type { DiffRegion } from './diff-model.js';

export type ComputedDiff = {
  changes: { fromA: number; toA: number; fromB: number; toB: number }[];
  regions: DiffRegion[];
  precise: boolean;
  lineEndings: boolean;
  whitespaceOnly: boolean;
};
export const diffLimit = 8 * 1024 * 1024;
export function computeDiff(
  earlier: string,
  current: string,
  ignoreWhitespace = false,
): ComputedDiff {
  if (
    new TextEncoder().encode(earlier).length > diffLimit ||
    new TextEncoder().encode(current).length > diffLimit
  )
    throw new Error(
      t("Visual comparison is limited to 8 MiB per source. Use the complete sources or patch below."),
    );
  const a = Text.of(earlier.split(/\r\n?|\n/)),
    b = Text.of(current.split(/\r\n?|\n/));
  const normalize = (raw: Text) => {
    const lines = raw.toJSON(),
      text = Text.of(lines.map((line) => line.trim()));
    return {
      text,
      map(position: number) {
        const line = text.lineAt(position),
          original = raw.line(line.number);
        return (
          original.from +
          (lines[line.number - 1].match(/^\s*/)?.[0].length || 0) +
          (position - line.from)
        );
      },
    };
  };
  const left = ignoreWhitespace ? normalize(a) : { text: a, map: (n: number) => n },
    right = ignoreWhitespace ? normalize(b) : { text: b, map: (n: number) => n };
  const chunks = Chunk.build(left.text, right.text, { timeout: 1800, scanLimit: 10000 });
  const changes = chunks.flatMap((chunk) =>
    chunk.changes.map(
      (change) =>
        new Change(
          left.map(chunk.fromA + change.fromA),
          left.map(chunk.fromA + change.toA),
          right.map(chunk.fromB + change.fromB),
          right.map(chunk.fromB + change.toB),
        ),
    ),
  );
  const visible = ignoreWhitespace ? Chunk.build(a, b, { override: () => changes }) : chunks;
  const range = (doc: Text, from: number, to: number) => ({
    start: doc.lineAt(Math.min(from, doc.length)).number - (from === to ? 1 : 0),
    end: from === to ? 0 : doc.lineAt(Math.min(to - 1, doc.length)).number,
  });
  return {
    changes,
    regions: visible.map((c) => {
      const left = range(a, c.fromA, c.toA),
        right = range(b, c.fromB, c.toB);
      return {
        originalStartLineNumber: left.start,
        originalEndLineNumber: left.end,
        modifiedStartLineNumber: right.start,
        modifiedEndLineNumber: right.end,
      };
    }),
    precise: chunks.every((c) => c.precise),
    lineEndings: a.toString() === b.toString() && earlier !== current,
    whitespaceOnly: ignoreWhitespace && !visible.length && a.toString() !== b.toString(),
  };
}
