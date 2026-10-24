import { describe, expect, it } from 'vitest';
import { lineFragment, parseLineFragment, textBlockKey } from '../src/site/line-anchors.js';

describe('public line permalinks', () => {
  it('keeps an unchanged rendered block addressable after unrelated content is inserted', async () => {
    const quote = 'A careful observation. 一个精确的引用。';
    const original = await textBlockKey('p', quote, 1);
    await textBlockKey('p', 'An unrelated introduction inserted earlier.', 1);
    expect(await textBlockKey('p', quote, 1)).toBe(original);
    expect(await textBlockKey('p', `${quote} Edited.`, 1)).not.toBe(original);
    expect(await textBlockKey('p', quote, 2)).not.toBe(original);
    expect(await textBlockKey('code', quote, 1)).not.toBe(original);
    const reference = { key: original, start: 2, end: 25 };
    expect(parseLineFragment(`#${lineFragment(reference)}`)).toEqual(reference);
  });
  it('rejects malformed and excessive ranges rather than guessing a different quote', async () => {
    const key = await textBlockKey('p', 'A short passage.', 1);
    for (const suffix of ['-1-5', '9-2', '0-2001', '0-99999999', '2-2', 'x-8'])
      expect(parseLineFragment(`#line-${key}-${suffix}`)).toBeNull();
    expect(parseLineFragment('#line-invalid-0-10')).toBeNull();
    expect(parseLineFragment(`#line-${key}-0-10-extra`)).toBeNull();
  });
});
