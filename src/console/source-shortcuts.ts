/** Stored as a single CodeMirror chord, never executable code or a key sequence. */
export const defaultCompletionShortcut = 'Ctrl-Space';
const keyPattern = /^(?:(?:Mod|Ctrl|Meta|Alt|Shift)-)+(?:[a-z0-9/.,;]|Space)$/;
const reserved = new Set([
  ...'abdfghiklnopqrstuvwxyz'.split('').map((key) => `Mod-${key}`),
  ...'acefgiklmnpqrstuvwxyzh'.split('').map((key) => `Mod-Shift-${key}`),
  'Mod-Alt-g',
  'Mod-Alt-i',
  'Mod-Alt-j',
  'Mod-Alt-c',
  'Mod-/',
  'Ctrl-m',
  'Alt-l',
  'Alt-u',
  'Alt-Shift-m',
]);
function onPlatform(chord: string, mac: boolean) {
  return chord.replace('Mod-', mac ? 'Meta-' : 'Ctrl-');
}
export function completionShortcutError(chord: string): string | undefined {
  if (chord === '') return;
  if (chord.length > 60 || !keyPattern.test(chord))
    return 'Use Ctrl, Cmd or Alt with a letter, number, Space or punctuation.';
  const parts = chord.split('-'),
    modifiers = parts.slice(0, -1);
  if (
    !modifiers.some((m) => ['Ctrl', 'Meta', 'Mod', 'Alt'].includes(m)) ||
    new Set(modifiers).size !== modifiers.length ||
    modifiers.filter((m) => ['Ctrl', 'Meta', 'Mod'].includes(m)).length > 1 ||
    ['Mod', 'Ctrl', 'Alt', 'Meta', 'Shift'].filter((m) => modifiers.includes(m)).join('-') !==
      modifiers.join('-')
  )
    return 'Use one Ctrl/Cmd modifier, optionally with Alt or Shift.';
  // Reserve primary shortcuts on either platform so a preference stays safe when moved.
  for (const mac of [false, true]) {
    const candidate = onPlatform(chord, mac);
    if ([...reserved].some((key) => onPlatform(key, mac) === candidate))
      return 'That shortcut is already used by the editor or browser. Choose another combination.';
  }
}
export function recordCompletionShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing'>,
  mac: boolean,
): string | undefined {
  if (
    event.isComposing ||
    ['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(event.key)
  )
    return;
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push(mac ? 'Ctrl' : 'Mod');
  if (event.altKey) modifiers.push('Alt');
  if (event.metaKey) modifiers.push(mac ? 'Mod' : 'Meta');
  if (event.shiftKey) modifiers.push('Shift');
  // Canonical order matches validation and CodeMirror's modifier normalization.
  modifiers.sort(
    (a, b) =>
      ['Mod', 'Ctrl', 'Alt', 'Meta', 'Shift'].indexOf(a) -
      ['Mod', 'Ctrl', 'Alt', 'Meta', 'Shift'].indexOf(b),
  );
  return [...modifiers, event.key === ' ' ? 'Space' : event.key.toLowerCase()].join('-');
}
export const completionShortcutLabel = (chord: string) =>
  chord
    ? chord
        .split('-')
        .map((key) => (key === 'Mod' ? 'Ctrl/Cmd' : key.length === 1 ? key.toUpperCase() : key))
        .join(' + ')
    : 'Unassigned';
