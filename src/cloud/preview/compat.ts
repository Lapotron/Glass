/** Preview-only deterministic identifiers, never used for authentication, integrity or publication. */
export function digest(value: string | Uint8Array) {
  let hash = 2166136261;
  for (const c of typeof value === 'string' ? value : new TextDecoder().decode(value))
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(8);
}
export function createHash() {
  let source = '';
  return {
    update(value: any) {
      source += typeof value === 'string' ? value : new TextDecoder().decode(value);
      return this;
    },
    digest() {
      return digest(source);
    },
  };
}
export const randomUUID = () => crypto.randomUUID();
export const fileURLToPath = (value: any) => String(value);
const normalize = (value: string) => {
  const parts: string[] = [];
  for (const part of value.split('/'))
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  return (value.startsWith('/') ? '/' : '') + parts.join('/');
};
const path = {
  join: (...parts: string[]) => normalize(parts.join('/')),
  resolve: (...parts: string[]) => normalize('/' + parts.join('/')),
  dirname: (value: string) => value.slice(0, value.lastIndexOf('/')) || '/',
  basename: (value: string) => value.split('/').at(-1) || '',
  extname: (value: string) => value.match(/\.[^/.]+$/)?.[0] || '',
  relative: (base: string, value: string) =>
    value.startsWith(base) ? value.slice(base.length + 1) : value,
};
export default path;
export const promises = {
  readFile: async () => new TextEncoder().encode('browser-preview'),
  mkdir: async () => {},
  writeFile: async () => {},
  rename: async () => {},
  readdir: async () => [],
};
export const readFileSync = () => '';
