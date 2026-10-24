import { expect, it } from 'vitest';
import { appearanceRanges, textScaleRange } from '../src/shared/appearance-ranges.js';
import { entrySchema, themeSchema } from '../src/shared/contracts.js';
import { parseReaderPreferences } from '../src/shared/reader-preferences.js';
import { contrastSchema } from '../src/shared/contracts.js';

it('accepts expanded appearance endpoints consistently in canonical and reader settings', () => {
  for (const [key, [min, max]] of Object.entries(appearanceRanges)) {
    for (const value of [min, max]) {
      expect(themeSchema.parse({ [key]: value })[key as keyof typeof appearanceRanges]).toBe(value);
      expect(parseReaderPreferences({ version: 1, theme: { [key]: value } }).theme).toEqual({
        [key]: value,
      });
    }
    for (const value of [min - 1, max + 1, NaN, Infinity]) {
      expect(themeSchema.safeParse({ [key]: value }).success).toBe(false);
      expect(parseReaderPreferences({ version: 1, theme: { [key]: value } }).theme).toEqual({});
    }
  }
  for (const value of [textScaleRange[0], textScaleRange[1]]) {
    expect(parseReaderPreferences({ version: 1, textScale: value }).textScale).toBe(value);
    expect(themeSchema.parse({ textScale: value }).textScale).toBe(value);
  }
  expect(themeSchema.safeParse({ textScale: 2.01 }).success).toBe(false);
  expect(themeSchema.parse({})).toMatchObject({ textScale: 1, focusMode: false });
  expect(themeSchema.safeParse({ focusMode: 'true' }).success).toBe(false);
  expect(
    parseReaderPreferences({
      version: 1,
      theme: { textScale: 2, focusMode: true },
      textScale: 0.8,
      focusMode: false,
    }),
  ).toEqual({ version: 1, theme: {}, textScale: 0.8, focusMode: false });
  expect(parseReaderPreferences({ version: 1, textScale: 2.01 }).textScale).toBeUndefined();
  expect(themeSchema.safeParse({ contentWidth: 1601 }).success).toBe(false);
});

it('preserves zero contrast floors and optional per-entry typography at the new limits', () => {
  for (const value of [0, 1]) {
    const floors = { glassFloor: value, readingFloor: value };
    expect(contrastSchema.parse(floors)).toMatchObject(floors);
    expect(
      parseReaderPreferences({ version: 1, theme: { contrast: floors } }).theme.contrast,
    ).toEqual(floors);
  }
  const entry = { id: 'test', slug: 'test', title: 'Test', publishedAt: '2026-10-01' };
  expect(
    entrySchema.parse({
      ...entry,
      typography: { articleWidth: 480, lineHeight: 1.3, paragraphSpace: 0 },
    }).typography,
  ).toEqual({ articleWidth: 480, lineHeight: 1.3, paragraphSpace: 0 });
  expect(entrySchema.parse({ ...entry, typography: {} }).typography).toEqual({});
  expect(entrySchema.safeParse({ ...entry, typography: { articleWidth: 1201 } }).success).toBe(
    false,
  );
});
