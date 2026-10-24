import path from 'node:path';

export const backupLocations = [
  { disk: 'content', archive: 'content' },
  { disk: '.studio/revisions', archive: 'history/revisions' },
  { disk: '.studio/trash', archive: 'history/trash' },
  { disk: '.studio/history', archive: 'history/collections' },
  { disk: '.studio/project-history', archive: 'history/projects' },
  { disk: '.studio/pages', archive: 'history/pages' },
  { disk: '.studio/media-originals', archive: 'private/media-originals' },
] as const;
export const backupPath = (name: string) =>
  !name.includes('\0') &&
  !name.split('/').some((part) => part === '.' || part === '..' || part.startsWith('.')) &&
  (/^content\/(?:site|library|projects)\.json$/.test(name) ||
    name === 'content/about.md' ||
    /^history\/pages\/about\/[a-f0-9]{64}\.json$/.test(name) ||
    /^private\/media-originals\/[a-f0-9-]{36}\/(?:original|record\.json)$/.test(name) ||
    /^content\/(?:posts|lab)\/[^/\\]+\.md$/.test(name) ||
    /^content\/media\/[^/\\]+$/.test(name) ||
    /^history\/revisions\/[\w-]{1,100}\/[a-f0-9]{64}\.json$/.test(name) ||
    /^history\/trash\/[\w-]{1,100}\.(?:json|md)$/.test(name) ||
    /^history\/trash\/photos\/photo-[a-f0-9-]{36}\.json$/.test(name) ||
    /^history\/collections\/[\w-]+\.json$/.test(name) ||
    /^history\/projects\/[a-f0-9]{64}\.json$/.test(name));
export function backupTarget(root: string, name: string) {
  if (!backupPath(name)) throw new Error('Invalid backup path.');
  const location = backupLocations.find((location) => name.startsWith(`${location.archive}/`));
  if (!location) throw new Error('Invalid backup location.');
  return path.join(root, location.disk, name.slice(location.archive.length + 1));
}
