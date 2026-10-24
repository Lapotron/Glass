export function encodeContact(href: string) {
  if (!/^mailto:/i.test(href) || href.length > 4096 || /[\r\n]/.test(href))
    throw new Error('Invalid email link.');
  return btoa(String.fromCharCode(...new TextEncoder().encode(href)));
}
export function decodeContact(token: string) {
  const href = new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(atob(token), (character) => character.charCodeAt(0)),
  );
  if (!/^mailto:/i.test(href) || href.length > 4096 || /[\r\n]/.test(href))
    throw new Error('This email link is unavailable.');
  return href;
}
export function contactLabel(label: string) {
  return /@|%40/i.test(label) ? 'Email' : label;
}
