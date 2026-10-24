import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { cloudExportFilePath, validCloudExportPath } from '../src/shared/cloud-migration.js';
const run = promisify(execFile);
const script = path.resolve('scripts/cloud-migrate.ts');
it('keeps folder export paths visible and distinct without changing canonical names', () => {
  const source = [
    '.studio/assets/cache/.complete',
    '.studio/assets/cache/_.complete',
    '.studio/assets/cache/__.complete',
    '.studio/history/.hidden/_receipt.json',
    'content/media/_image.png',
    'content/media/__image.png',
    'content/media/normal.png',
  ];
  const stored = source.map(cloudExportFilePath);
  expect(new Set(stored).size).toBe(source.length);
  expect(stored.every((name) => validCloudExportPath(name))).toBe(true);
  expect(stored.every((name) => name.split('/').every((part) => !part.startsWith('.')))).toBe(true);
  expect(stored[0]).toBe('private/assets/cache/_.complete');
  // Existing manifests remain valid; importers use their explicit path rather than remapping it.
  expect(validCloudExportPath('private/assets/cache/.complete')).toBe(true);
  expect(validCloudExportPath('.studio/history/receipt.json')).toBe(true);
});
it('explains an omitted root without starting an export', async () => {
  await expect(run(process.execPath, ['--import', 'tsx', script, 'export'])).rejects.toMatchObject({
    stderr: expect.stringContaining(
      'Choose the local notebook with --root. No files were exported.',
    ),
  });
  const result = await run(process.execPath, ['--import', 'tsx', script, 'export', '--help']);
  expect(result.stdout).toContain('npm run cloud:export -- --root');
  expect(result.stderr).toBe('');
});
it('exports exact media with explicit private-setting scope and refuses an existing destination', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-export-test-')),
    notebook = path.join(folder, 'notebook'),
    destination = path.join(folder, 'ordinary'),
    restricted = path.join(folder, 'restricted');
  try {
    await fs.cp('tests/fixtures/notebook', path.join(notebook, 'content'), { recursive: true });
    await fs.mkdir(path.join(notebook, '.studio/cloud'), { recursive: true });
    await fs.writeFile(
      path.join(notebook, '.studio/connections.json'),
      JSON.stringify({ cloudflareApiToken: 'fixture-export-token' }),
    );
    await fs.writeFile(
      path.join(notebook, '.studio/cloud/setup.json'),
      'Never export machine setup',
    );
    const media = randomBytes(9 * 1024 ** 2),
      name = 'content/media/large-file.bin';
    await fs.writeFile(path.join(notebook, name), media);
    await fs.writeFile(path.join(notebook, 'content/media/_retained.bin'), 'Exact retained bytes');
    await run(process.execPath, [
      '--import',
      'tsx',
      script,
      'export',
      '--root',
      notebook,
      '--out',
      destination,
    ]);
    const manifest = JSON.parse(await fs.readFile(path.join(destination, 'manifest.json'), 'utf8'));
    expect(manifest.files.find((file: any) => file.path === name)).toMatchObject({
      bytes: media.length,
      sha: createHash('sha256').update(media).digest('hex'),
    });
    expect((await fs.readFile(path.join(destination, 'data', name))).equals(media)).toBe(true);
    expect(
      manifest.files.find((file: any) => file.path === 'content/media/_retained.bin'),
    ).toMatchObject({
      storagePath: 'content/media/__retained.bin',
      sha: createHash('sha256').update('Exact retained bytes').digest('hex'),
    });
    expect(
      await fs.readFile(path.join(destination, 'data/content/media/__retained.bin'), 'utf8'),
    ).toBe('Exact retained bytes');
    expect(
      manifest.files.some(
        (file: any) =>
          file.path === '.studio/connections.json' || file.path.startsWith('.studio/cloud/'),
      ),
    ).toBe(false);
    await expect(
      run(process.execPath, [
        '--import',
        'tsx',
        script,
        'export',
        '--root',
        notebook,
        '--out',
        destination,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Export destination already exists.'),
    });
    await run(process.execPath, [
      '--import',
      'tsx',
      script,
      'export',
      '--root',
      notebook,
      '--out',
      restricted,
      '--include-private-settings',
    ]);
    expect(
      await fs.readFile(path.join(restricted, 'data/private/connections.json'), 'utf8'),
    ).toContain('fixture-export-token');
    await expect(fs.stat(path.join(restricted, 'data/private/cloud/setup.json'))).rejects.toThrow();
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
