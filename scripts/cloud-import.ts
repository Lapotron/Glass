import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  sha,
  safePath,
  cloudFetch,
  responseToFile,
  cloudFileHash,
  uploadCloudMigration,
} from './cloud-client.js';
import { mapConcurrent } from '../src/engine/work-cache.js';
import { z } from 'zod';
import seed from '../tests/fixtures/notebook/site.json' with { type: 'json' };
import { siteSchema } from '../src/shared/contracts.js';
import { conflictingCloudChanges, validCloudExportPath } from '../src/shared/cloud-migration.js';
const arg = (name: string) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const source = arg('from');
if (!source) throw new Error('Pass --from with the reviewed private migration export folder.');
const directory = await fs.realpath(source),
  base = await fs.realpath(path.join(directory, 'data'));
const manifest = z
  .object({
    format: z.literal('glass-cloud-workspace'),
    version: z.literal(1),
    files: z
      .array(
        z.object({
          path: z.string(),
          storagePath: z.string().refine(validCloudExportPath).optional(),
          sha: z.string().regex(/^[a-f0-9]{64}$/),
          bytes: z.number().int().nonnegative(),
          modified: z.string().optional(),
        }),
      )
      .min(2)
      .max(30000),
  })
  .parse(JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')));
const setupFile = path.resolve('.studio/cloud/setup.json'),
  setup = JSON.parse(await fs.readFile(setupFile, 'utf8'));
process.env.GLASS_STUDIO_ORIGIN = 'https://' + setup.hostname;
process.env.GLASS_CI_TOKEN = setup.ciToken;
process.env.CF_ACCESS_CLIENT_ID = setup.serviceToken.clientId;
process.env.CF_ACCESS_CLIENT_SECRET = setup.serviceToken.clientSecret;
const current = await (await cloudFetch('workspace')).json();
const recovery = path.resolve(
  '.studio/cloud/before-import',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
const seedFiles = new Map([
  ['content/site.json', sha(JSON.stringify({ ...seed, url: 'https://example.com' }))],
  ['content/library.json', sha(JSON.stringify({ photos: [], albums: [], news: [] }))],
  [
    'content/about.md',
    sha('# Welcome\n\nImport your existing notebook in Hosting before publishing.\n'),
  ],
]);
const imported = new Map(manifest.files.map((file) => [file.path, file]));
let conflicts = current.files.filter(
  (file: any) =>
    file.path.startsWith('content/') &&
    file.sha !== imported.get(file.path)?.sha &&
    file.sha !== seedFiles.get(file.path),
);
// Preserve every byte of the cloud notebook first, including newly saved private settings.
await mapConcurrent(current.files, 8, async (file: any) => {
  const target = path.join(recovery, 'data', safePath(file.path));
  await responseToFile(
    await cloudFetch('workspace/file?' + new URLSearchParams({ path: file.path })),
    target,
    file.sha,
  );
});
await fs.writeFile(
  path.join(recovery, 'manifest.json'),
  JSON.stringify({
    format: 'glass-cloud-workspace',
    version: 1,
    workspaceVersion: current.version,
    files: current.files,
  }),
  { mode: 0o600 },
);
// Settings normalization and choices already present in the original notebook are safe.
if (conflicts.some((file: any) => file.path === 'content/site.json')) {
  const previous = siteSchema.parse({ ...seed, url: 'https://example.com' });
  const cloud = siteSchema.parse(
    JSON.parse(await fs.readFile(path.join(recovery, 'data/content/site.json'), 'utf8')),
  );
  const incoming = siteSchema.parse(
    JSON.parse(await fs.readFile(path.join(base, 'content/site.json'), 'utf8')),
  );
  // Legacy navigation is regenerated from collections on save; it is not an independent author choice.
  previous.navigation = [];
  cloud.navigation = [];
  incoming.navigation = [];
  if (!conflictingCloudChanges(previous, cloud, incoming).length)
    conflicts = conflicts.filter((file: any) => file.path !== 'content/site.json');
}
if (conflicts.length)
  throw new Error(
    'The hosted notebook has newer authored content. Its safety copy is at ' +
      recovery +
      '. Review these paths before importing: ' +
      conflicts.map((file: any) => file.path).join(', '),
  );
const afterCopy = await (await cloudFetch('workspace')).json();
if (current.version !== afterCopy.version)
  throw new Error('Cloud edits arrived during the safety copy. Retry after saving.');
const overrides = new Map<string, string>();
for (const file of current.files) {
  if (file.path.startsWith('content/')) continue;
  const existing = imported.get(file.path);
  if (existing && existing.sha === file.sha) continue;
  if (existing && Date.parse(existing.modified || '1970-01-01') > Date.parse(file.modified))
    continue;
  let sourceFile = path.join(recovery, 'data', safePath(file.path));
  if (file.path === '.studio/connections.json' && existing) {
    const old = JSON.parse(
      await fs.readFile(path.join(base, existing.storagePath || file.path), 'utf8'),
    );
    const bytes = Buffer.from(
      JSON.stringify({ ...old, ...JSON.parse(await fs.readFile(sourceFile, 'utf8')) }, null, 2),
    );
    sourceFile = path.join(recovery, 'merged-connections.json');
    await fs.writeFile(sourceFile, bytes, { mode: 0o600 });
  }
  const retained = {
    ...file,
    sha: await cloudFileHash(sourceFile),
    bytes: (await fs.stat(sourceFile)).size,
  };
  if (existing) Object.assign(existing, retained);
  else manifest.files.push(retained);
  overrides.set(file.path, sourceFile);
}
await mapConcurrent(manifest.files, 12, async (file) => {
  safePath(file.path);
  const target = path.join(base, file.storagePath || file.path),
    resolved = overrides.has(file.path) ? target : await fs.realpath(target);
  if (
    !overrides.has(file.path) &&
    (!resolved.startsWith(base + path.sep) || (await fs.lstat(target)).isSymbolicLink())
  )
    throw new Error('Migration files must remain inside the exported data directory.');
  const sourceFile = overrides.get(file.path) || target;
  if (
    (await fs.stat(sourceFile)).size !== file.bytes ||
    (await cloudFileHash(sourceFile)) !== file.sha
  )
    throw new Error('Migration checksum failed: ' + file.path);
});
const session = await (await cloudFetch('migration', { method: 'POST' })).json();
if (session.version !== current.version)
  throw new Error('The cloud notebook changed before import. No files were replaced.');
let done = 0;
await mapConcurrent(manifest.files, 2, async (file) => {
  await uploadCloudMigration(
    session.id,
    overrides.get(file.path) || path.join(base, file.storagePath || file.path),
    file.path,
    file.modified,
  );
  if (++done % 100 === 0 || done === manifest.files.length)
    console.log('Privately uploaded ' + done + ' / ' + manifest.files.length + ' files.');
});
await cloudFetch('migration/' + session.id + '/commit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    files: manifest.files.map(({ path, sha, bytes }) => ({ path, sha, bytes })),
  }),
});
const remote = await (await cloudFetch('workspace')).json();
const indexed = new Map(remote.files.map((file: any) => [file.path, file]));
for (const file of manifest.files) {
  const saved: any = indexed.get(file.path);
  if (saved?.sha !== file.sha || saved.bytes !== file.bytes)
    throw new Error('Post-import verification failed: ' + file.path);
}
setup.migratedAt = new Date().toISOString();
setup.migrationFiles = manifest.files.length;
await fs.writeFile(setupFile, JSON.stringify(setup, null, 2), { mode: 0o600 });
console.log(
  'Cloud notebook verified: ' +
    manifest.files.length +
    ' files. The original notebook and public site were kept.',
);
