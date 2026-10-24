/** One-time migration export. Private service credentials require an explicit restricted export. */
import { promises as fs, createReadStream, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cloudExportFilePath } from '../src/shared/cloud-migration.js';
const arg = (name: string) => {
  const index = process.argv.indexOf('--' + name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  return value?.startsWith('--') ? undefined : value;
};
const usage = `Export a private Glass notebook for hosted Studio migration.

Usage:
  npm run cloud:export -- --root /absolute/notebook --out /new/export-folder
  npm run cloud:export -- --root "$PWD" --out "$HOME/Desktop/glass-cloud-export"

Options:
  --root PATH                  Required local notebook folder containing content/site.json.
  --out PATH                   New destination folder; existing destinations are never overwritten.
  --include-private-settings   Include connection/service credentials in this private export.
  --help                       Show this help without exporting anything.

Import the resulting folder through hosted Studio → Hosting. This exports local files;
it does not download the hosted notebook. Keep credential exports private.`;
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(usage);
  process.exit(0);
}
if (process.argv[2] !== 'export')
  throw new Error('Import the exported folder through hosted Studio → Hosting.');
const configured = arg('root');
if (!configured) {
  console.error('Choose the local notebook with --root. No files were exported.\n\n' + usage);
  process.exit(1);
}
const root = await fs.realpath(configured),
  output = path.resolve(arg('out') || path.join(root, '.studio/cloud/export'));
if (output === root || output.startsWith(path.join(root, 'content') + path.sep))
  throw new Error('Export outside the canonical content directory.');
try {
  await fs.access(output);
  throw new Error('Export destination already exists. Choose a new folder.');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const allowed = [
  'content',
  '.studio/revisions',
  '.studio/trash',
  '.studio/history',
  '.studio/project-history',
  '.studio/pages',
  '.studio/media-originals',
  '.studio/backups',
  '.studio/builds',
  '.studio/jobs',
  '.studio/job-history',
  '.studio/cloud-media',
  '.studio/search-console',
  '.studio/analytics',
  '.studio/backup-settings.json',
  '.studio/scheduler.json',
  '.studio/reset-recovery',
  '.studio/health',
];
const includePrivate = process.argv.includes('--include-private-settings');
if (includePrivate) allowed.push('.studio/connections.json', '.studio/services');
const files: {
  path: string;
  storagePath?: string;
  sha: string;
  bytes: number;
  modified: string;
}[] = [];
let verifying = false;
const seen = new Set<string>();
const indexed = new Map<string, (typeof files)[number]>();
async function copy(relative: string) {
  const source = path.join(root, relative),
    stat = await fs.lstat(source).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  if (!stat) return;
  if (stat.isSymbolicLink())
    throw new Error('Migration cannot include symbolic links: ' + relative);
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(source))
      if (!entry.startsWith('.') && !entry.startsWith('._') && !entry.endsWith('.lock'))
        await copy(relative + '/' + entry);
  } else if (stat.isFile()) {
    const storagePath = cloudExportFilePath(relative);
    const destination = path.join(output, 'data', storagePath);
    const hashFile = async (file: string) => {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      return hash.digest('hex');
    };
    const sha = await hashFile(source);
    if (verifying) {
      const previous = indexed.get(relative);
      if (!previous || previous.sha !== sha || previous.modified !== stat.mtime.toISOString())
        throw new Error(
          'The notebook changed during export. Wait for saves and jobs to finish, then export again.',
        );
      seen.add(relative);
      return;
    }
    if (files.length >= 30000)
      throw new Error('A cloud migration export supports up to 30,000 files.');
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.copyFile(source, destination, constants.COPYFILE_FICLONE);
    await fs.chmod(destination, 0o600);
    if ((await hashFile(destination)) !== sha)
      throw new Error('The notebook changed during export. Wait for saves and try again.');
    const record = {
      path: relative,
      ...(storagePath !== relative ? { storagePath } : {}),
      sha,
      bytes: stat.size,
      modified: stat.mtime.toISOString(),
    };
    files.push(record);
    indexed.set(relative, record);
  }
}
try {
  for (const name of allowed) await copy(name);
  verifying = true;
  for (const name of allowed) await copy(name);
  if (seen.size !== files.length)
    throw new Error(
      'Files were removed during export. Export again after all notebook operations finish.',
    );
  await fs.writeFile(
    path.join(output, 'manifest.json'),
    JSON.stringify(
      {
        format: 'glass-cloud-workspace',
        version: 1,
        privateSettings: includePrivate,
        createdAt: new Date().toISOString(),
        files,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    'Private migration export: ' +
      output +
      '\n' +
      files.length +
      ' files. Import this folder through hosted Studio → Hosting.',
  );
} catch (error) {
  await fs.rm(output, { recursive: true, force: true });
  throw error;
}
