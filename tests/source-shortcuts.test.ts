import { afterEach, expect, it, vi } from 'vitest';
import {
  completionShortcutError,
  completionShortcutLabel,
  recordCompletionShortcut,
} from '../src/console/source-shortcuts.js';
import { readSourcePreferences } from '../src/console/source-analysis.js';
import { sourceAnalyzer } from '../src/console/source-worker.js';
afterEach(() => vi.unstubAllGlobals());
it('reuses math analysis for linting without parsing the same source and context again', async () => {
  const analyzer = sourceAnalyzer(),
    source = '$x^2$';
  const first = analyzer.analyze(source, { media: [] });
  expect(analyzer.analyze(source, { media: [] })).toBe(first);
  expect((await first).maths?.[0].source).toBe('x^2');
  expect(analyzer.analyze(source, { media: ['/media/new.webp'] })).not.toBe(first);
  analyzer.dispose();
});

it('records portable primary modifiers without accepting ordinary typing or duplicate modifiers', () => {
  const event = {
    key: ' ',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: true,
    isComposing: false,
  };
  expect(recordCompletionShortcut(event, false)).toBe('Mod-Shift-Space');
  expect(recordCompletionShortcut({ ...event, ctrlKey: false, metaKey: true }, true)).toBe(
    'Mod-Shift-Space',
  );
  expect(recordCompletionShortcut({ ...event, key: 'Control' }, false)).toBeUndefined();
  expect(completionShortcutError('Mod-Shift-Space')).toBeUndefined();
  expect(completionShortcutError('Alt-/')).toBeUndefined();
  expect(completionShortcutError('')).toBeUndefined();
  for (const bad of [
    'a',
    'Shift-a',
    'Mod-Ctrl-Space',
    'Ctrl-Ctrl-Space',
    'Mod-z',
    'Meta-s',
    'Ctrl-f',
    'Mod-Shift-p',
    'Mod-Alt-g',
    'Alt-ArrowUp',
  ])
    expect(completionShortcutError(bad), bad).toBeTruthy();
  expect(completionShortcutLabel('Mod-Shift-Space')).toBe('Ctrl/Cmd + Shift + Space');
});

it('validates saved shortcuts and math preferences without adding notebook content to browser storage', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) });
  const key = 'fieldnotes-editor:math-shortcuts';
  values.set(key, JSON.stringify({ version: 1, completionShortcut: 'Alt-/', mathPreviews: false }));
  expect(readSourcePreferences('math-shortcuts')).toMatchObject({
    completionShortcut: 'Alt-/',
    mathPreviews: false,
  });
  values.set(key, JSON.stringify({ version: 1, completionShortcut: 'Mod-s', mathPreviews: 'yes' }));
  expect(readSourcePreferences('math-shortcuts')).toMatchObject({
    completionShortcut: 'Ctrl-Space',
    mathPreviews: true,
  });
  values.set(key, JSON.stringify({ version: 1, completionShortcut: '' }));
  expect(readSourcePreferences('math-shortcuts').completionShortcut).toBe('');
});
