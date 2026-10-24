import { promises as fs, createReadStream, constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

export type FileChange = { file: string; value: string | Buffer | null; expected?: string | null };
type Step = { file: string; before: string | null; after: string | null };
type Journal = { version: 1 | 2; state: 'prepared' | 'applying' | 'committed'; steps: Step[] };
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export async function fileDigest(file: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Operations require regular files.');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    return digest.digest('hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
async function destination(root: string, relative: string) {
  if (
    !/^(?:content\/|dist\/|\.studio\/(?:revisions|trash|history|project-history|pages|media-originals|backups|jobs|job-history|builds|render-cache|exports|imports|reports|search-console|health|analytics|reset-recovery)\/|\.studio\/scheduler\.json$)/.test(
      relative,
    ) ||
    relative.split('/').some((part) => !part || part === '..' || part === '.') ||
    relative.includes('\\')
  )
    throw new Error('Invalid operation path.');
  const target = path.resolve(root, relative);
  let cursor = path.dirname(target);
  while (cursor !== path.resolve(root)) {
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink())
        throw new Error('Operations cannot follow symbolic links.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    cursor = path.dirname(cursor);
  }
  return target;
}
async function install(file: string, source: string | null) {
  if (source === null) {
    await fs.rm(file, { force: true });
    // Empty source/history namespaces must not masquerade as retained originals.
    let parent = path.dirname(file);
    while (/\/(?:media-originals|revisions|history)\/.+/.test(parent)) {
      try {
        await fs.rmdir(parent);
      } catch {
        break;
      }
      parent = path.dirname(parent);
    }
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.copyFile(source, temporary, constants.COPYFILE_FICLONE);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function journalWrite(folder: string, journal: Journal) {
  const temporary = path.join(folder, 'plan.tmp');
  await fs.writeFile(temporary, JSON.stringify(journal));
  await fs.rename(temporary, path.join(folder, 'plan.json'));
}
async function rollback(root: string, folder: string, journal: Journal) {
  for (const [index, step] of journal.steps.entries()) {
    const actual = await fileDigest(await destination(root, step.file));
    if (actual !== step.before && actual !== step.after)
      throw new Error(
        'An interrupted operation needs review in ' + folder + '. External edits were preserved.',
      );
    if (
      step.before !== null &&
      (await fileDigest(path.join(folder, 'before-' + index))) !== step.before
    )
      throw new Error('Operation recovery checksum failed.');
  }
  for (let index = journal.steps.length - 1; index >= 0; index--) {
    const step = journal.steps[index];
    const source = step.before === null ? null : path.join(folder, 'before-' + index);
    await install(await destination(root, step.file), source);
  }
}
export async function recoverTransactions(root: string) {
  const base = path.join(root, '.studio/operations');
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(base)).isSymbolicLink())
    throw new Error('Operation storage cannot be a symbolic link.');
  for (const id of await fs.readdir(base)) {
    if (!/^[a-f0-9-]{36}$/.test(id)) continue;
    const folder = path.join(base, id);
    if ((await fs.lstat(folder)).isSymbolicLink()) throw new Error('Invalid operation journal.');
    let journal: Journal;
    try {
      journal = JSON.parse(await fs.readFile(path.join(folder, 'plan.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await fs.rm(folder, { recursive: true });
        continue;
      }
      throw error;
    }
    if (
      ![1, 2].includes(journal.version) ||
      !['prepared', 'applying', 'committed'].includes(journal.state) ||
      !Array.isArray(journal.steps) ||
      journal.steps.length > (journal.version === 2 ? 50000 : 10000) ||
      journal.steps.some(
        (step) =>
          !step ||
          typeof step.file !== 'string' ||
          ![step.before, step.after].every(
            (value) =>
              value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)),
          ),
      ) ||
      new Set(journal.steps.map((step) => step.file)).size !== journal.steps.length
    )
      throw new Error('Invalid operation recovery journal.');
    if (journal.state === 'applying') await rollback(root, folder, journal);
    await fs.rm(folder, { recursive: true });
  }
}
/** Called only while holding the notebook Store queue. */
export function commitFiles(
  root: string,
  changes: FileChange[],
  afterInstall?: (index: number) => void,
) {
  return commitChanges(root, changes, 1, afterInstall);
}
/** Reset-only expansion; ordinary batches retain their 10,000-file ceiling. */
export function commitNotebookResetFiles(root: string, changes: FileChange[]) {
  return commitChanges(root, changes, 2);
}
async function commitChanges(
  root: string,
  changes: FileChange[],
  version: 1 | 2,
  afterInstall?: (index: number) => void,
) {
  const limit = version === 2 ? 50000 : 10000;
  if (changes.length > limit)
    throw new Error(`This operation exceeds the ${limit.toLocaleString('en-US')}-file limit.`);
  if (new Set(changes.map((change) => path.resolve(change.file))).size !== changes.length)
    throw new Error('An operation cannot write the same file twice.');
  const folder = path.join(root, '.studio/operations', randomUUID());
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const journal: Journal = { version, state: 'prepared', steps: [] };
  try {
    for (const [index, change] of changes.entries()) {
      const relative = path.relative(root, change.file).split(path.sep).join('/');
      const target = await destination(root, relative);
      const before = await fileDigest(target);
      if (change.expected !== undefined && before !== change.expected)
        throw new Error('A selected file changed before the operation. Refresh the selection.');
      if (before !== null)
        await fs.copyFile(target, path.join(folder, 'before-' + index), constants.COPYFILE_FICLONE);
      if (change.value !== null)
        await fs.writeFile(path.join(folder, 'after-' + index), change.value);
      journal.steps.push({
        file: relative,
        before,
        after: change.value === null ? null : hash(change.value),
      });
    }
    await journalWrite(folder, journal);
    for (const step of journal.steps)
      if ((await fileDigest(await destination(root, step.file))) !== step.before)
        throw new Error('A selected file changed during review. No files were changed.');
    journal.state = 'applying';
    await journalWrite(folder, journal);
    for (const [index, step] of journal.steps.entries()) {
      const file = await destination(root, step.file);
      if ((await fileDigest(file)) !== step.before)
        throw new Error('A selected file changed during the operation.');
      await install(file, step.after === null ? null : path.join(folder, 'after-' + index));
      afterInstall?.(index);
    }
    journal.state = 'committed';
    await journalWrite(folder, journal);
  } catch (error) {
    if (journal.state === 'applying') await rollback(root, folder, journal);
    await fs.rm(folder, { recursive: true, force: true });
    throw error;
  }
  await fs.rm(folder, { recursive: true, force: true });
}
