/** Request-local filesystem view: canonical file operations are committed atomically by CloudWorkspace. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import type { CloudWorkspace } from './workspace.js';
const contexts = new AsyncLocalStorage<CloudWorkspace>();
export const withWorkspace = <T>(workspace: CloudWorkspace, work: () => T) =>
  contexts.run(workspace, work);
function workspace() {
  const value = contexts.getStore();
  if (!value) throw new Error('No cloud workspace is active.');
  return value;
}
function normalize(value: string | URL) {
  return path.posix.resolve(String(value).replace(/^file:\/\//, ''));
}
const relative = (value: string | URL) => normalize(value).replace(/^\/workspace\/?/, '');
const missing = (name: string) =>
  Object.assign(new Error('File not found: ' + name), { code: 'ENOENT' });
function stat(value: string | URL) {
  const name = relative(value),
    ws = workspace(),
    directory = ws.directories.has(name) || ws.paths().some((p) => p.startsWith(name + '/'));
  if (!ws.has(name) && !directory) throw missing(name);
  const file = ws.files.get(name),
    bytes = ws.changed.get(name);
  const timestamp =
    ws.modified.get(name) ?? Date.parse(file?.modified || new Date(0).toISOString());
  return {
    size: bytes?.byteLength ?? file?.bytes ?? 0,
    mtime: new Date(timestamp),
    mtimeMs: timestamp,
    ctimeMs: timestamp,
    dev: 0,
    ino: 0,
    isFile: () => !directory,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
  };
}
export const constants = { COPYFILE_EXCL: 1, R_OK: 4, W_OK: 2 };
export const promises: any = {
  readFile: async (value: string | URL, encoding?: string) => {
    const bytes = Buffer.from(await workspace().read(relative(value)));
    return encoding ? bytes.toString(encoding as BufferEncoding) : bytes;
  },
  writeFile: async (
    value: string | URL,
    data: string | Uint8Array,
    options?: { flag?: string },
  ) => {
    const name = relative(value);
    if (options?.flag === 'wx' && workspace().has(name))
      throw Object.assign(new Error('File exists'), { code: 'EEXIST' });
    workspace().write(
      name,
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data),
    );
  },
  mkdir: async (value: string | URL) => {
    let name = relative(value);
    while (name && name !== '.') {
      workspace().directories.add(name);
      name = path.posix.dirname(name);
    }
  },
  chmod: async () => {},
  access: async (value: string | URL) => {
    stat(value);
  },
  realpath: async (value: string | URL) => {
    stat(value);
    return normalize(value);
  },
  stat: async (value: string | URL) => stat(value),
  lstat: async (value: string | URL) => stat(value),
  readdir: async (value: string | URL, options?: { withFileTypes?: boolean }) => {
    const prefix = relative(value).replace(/\/$/, '') + '/',
      names = [
        ...new Set(
          workspace()
            .paths()
            .filter((p) => p.startsWith(prefix))
            .map((p) => p.slice(prefix.length).split('/')[0]),
        ),
      ].sort();
    if (!names.length) stat(value);
    return options?.withFileTypes
      ? names.map((name) => ({ name, ...stat(normalize(value) + '/' + name) }))
      : names;
  },
  rename: async (from: string | URL, to: string | URL) => {
    stat(from);
    const source = relative(from),
      target = relative(to);
    for (const file of workspace()
      .paths()
      .filter((p) => p === source || p.startsWith(source + '/'))) {
      workspace().write(target + file.slice(source.length), await workspace().read(file));
      workspace().write(file, null);
    }
  },
  unlink: async (value: string | URL) => {
    stat(value);
    workspace().write(relative(value), null);
  },
  rm: async (value: string | URL, options?: { recursive?: boolean; force?: boolean }) => {
    const name = relative(value),
      paths = workspace()
        .paths()
        .filter((p) => p === name || (options?.recursive && p.startsWith(name + '/')));
    if (!paths.length && !options?.force) throw missing(name);
    for (const file of paths) workspace().write(file, null);
  },
  rmdir: async (value: string | URL) => {
    if (
      workspace()
        .paths()
        .some((p) => p.startsWith(relative(value) + '/'))
    )
      throw Object.assign(new Error('Directory is not empty'), { code: 'ENOTEMPTY' });
  },
  copyFile: async (from: string | URL, to: string | URL) =>
    workspace().write(relative(to), await workspace().read(relative(from))),
};
export async function* createReadStream(value: string | URL) {
  yield Buffer.from(await workspace().read(relative(value)));
}
export const watch = () => ({ close() {} });
