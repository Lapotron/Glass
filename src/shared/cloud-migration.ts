/** Folder pickers omit hidden segments, including cache marker filenames inside visible folders. */
export const cloudExportFilePath = (name: string) =>
  (name.startsWith('.studio/') ? 'private/' + name.slice(8) : name)
    .split('/')
    // Escape existing underscores too, so `.complete` and `_.complete` remain distinct.
    .map((part) => (/^[._]/.test(part) ? '_' + part : part))
    .join('/');
export const validCloudExportPath = (name: unknown): name is string =>
  typeof name === 'string' &&
  name.length <= 2048 &&
  !/[\\\0]/.test(name) &&
  name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

/** Cloud changes may be replaced only when unchanged from the seed or already in the import. */
export function conflictingCloudChanges(
  seed: unknown,
  cloud: unknown,
  incoming: unknown,
  path = '',
): string[] {
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (equal(seed, cloud) || equal(cloud, incoming)) return [];
  const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
  if (object(seed) && object(cloud) && object(incoming))
    return [...new Set([...Object.keys(seed), ...Object.keys(cloud)])].flatMap((key) =>
      conflictingCloudChanges(seed[key], cloud[key], incoming[key], path ? path + '.' + key : key),
    );
  return [path || '(document)'];
}
