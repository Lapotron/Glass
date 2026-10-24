export const shortLinkPattern = /^[a-z0-9][a-z0-9_-]{2,31}$/;
export type ShortLinkedEntry = { id: string; shortCode: string; shortAliases: string[] };
export function shortLinkPath(entry: Pick<ShortLinkedEntry, 'shortCode'>) {
  return '/s/' + entry.shortCode;
}
export function validateShortLinks(entries: ShortLinkedEntry[]) {
  const codes = new Map<string, string>();
  for (const entry of entries) {
    for (const code of [entry.shortCode, ...entry.shortAliases].filter(Boolean)) {
      if (!shortLinkPattern.test(code))
        throw new Error('Short links use 3–32 lowercase letters, digits, hyphens or underscores.');
      if (codes.has(code)) throw new Error('Short link “' + code + '” is already in use.');
      codes.set(code, entry.id);
    }
  }
}
