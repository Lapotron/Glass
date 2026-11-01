import { attachmentTypes } from './attachments.js';

/** Public delivery is intentionally narrower than the private R2 bucket. */
export const publicMediaTypes: Record<string, string> = {
  ...attachmentTypes,
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
};

const privatePrefixes = new Set([
  'workspace',
  'jobs',
  'snapshots',
  'operations',
  'exports',
  'reviews',
  'migrations',
  'transfers',
]);
export function validPublicMediaPrefix(prefix: string) {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(prefix) && !privatePrefixes.has(prefix);
}

export function publicMediaKey(pathname: string, prefix: string) {
  if (!validPublicMediaPrefix(prefix)) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (
    !path.startsWith('/' + prefix + '/') ||
    /[\\%]/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return undefined;
  const parts = path.slice(1).split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return undefined;
  const modern =
    parts.length === 3 && parts[1] === 'v2' && /^([a-f0-9]{64})\.[a-z0-9]+$/.test(parts[2]);
  const legacy = parts.length === 3 && /^[a-f0-9]{64}$/.test(parts[1]) && parts[2].length <= 200;
  if (!modern && !legacy) return undefined;
  const extension = /\.[a-z0-9]+$/i.exec(parts[2])?.[0].toLowerCase();
  if (!extension || !publicMediaTypes[extension]) return undefined;
  return { key: parts.join('/'), extension, digest: modern ? parts[2].slice(0, 64) : undefined };
}

export function publicMediaMime(extension: string) {
  return publicMediaTypes[extension]?.split(';')[0];
}
