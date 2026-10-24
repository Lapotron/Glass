/** Author-owned data is portable; generated output and operational caches are not. */
export function portableNotebookPath(path: string) {
  if (/[\\\0]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..'))
    return false;
  return (
    /^content\/(?:site\.json|library\.json|projects\.json|about\.md|(?:posts|lab)\/[^/]+\.md|media\/[^/]+)$/.test(
      path,
    ) ||
    /^\.studio\/(?:revisions\/[\w-]{1,100}\/[a-f0-9]{64}\.json|trash\/(?:[\w-]{1,100}\.(?:md|json)|photos\/photo-[a-f0-9-]{36}\.json)|history\/[\w-]+\.json|project-history\/[a-f0-9]{64}\.json|pages\/about\/[a-f0-9]{64}\.json|media-originals\/[a-f0-9-]{36}\/(?:original|record\.json))$/.test(
      path,
    )
  );
}
const locations = [
  ['.studio/revisions', 'history/revisions'],
  ['.studio/trash', 'history/trash'],
  ['.studio/history', 'history/collections'],
  ['.studio/project-history', 'history/projects'],
  ['.studio/pages', 'history/pages'],
  ['.studio/media-originals', 'private/media-originals'],
] as const;
export function archiveNotebookPath(path: string) {
  if (!portableNotebookPath(path)) throw new Error('File is outside portable notebook data.');
  const match = locations.find(([disk]) => path.startsWith(disk + '/'));
  return match ? match[1] + path.slice(match[0].length) : path;
}
export function notebookArchivePath(path: string) {
  const match = locations.find(([, archive]) => path.startsWith(archive + '/'));
  const result = match ? match[0] + path.slice(match[1].length) : path;
  if (!portableNotebookPath(result)) throw new Error('File is outside portable notebook data.');
  return result;
}
export function notebookCategory(path: string) {
  if (path.startsWith('content/media/')) return 'media';
  if (path.startsWith('content/')) return 'content';
  if (path.startsWith('.studio/media-originals/')) return 'originals';
  if (portableNotebookPath(path)) return 'history';
  if (/^\.studio\/(?:backups|reset-recovery)\//.test(path)) return 'backups';
  if (path.startsWith('.studio/builds/')) return 'artifacts';
  if (/^\.studio\/(?:render-cache|assets)\//.test(path)) return 'cache';
  return 'operations';
}
