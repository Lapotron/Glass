import { expect, it } from 'vitest';
import { runTool, csvToJson, jsonToCsv, parseColor } from '../src/site/tools/operations.js';
import {
  base64Decode,
  base64Encode,
  encryptContent,
  decryptContent,
} from '../src/shared/tools-crypto.js';
import { canSaveToolDraft, developerTools, toolLimits } from '../src/shared/tools-catalog.js';
import { navigationToolsSchema } from '../src/shared/site-settings.js';
import { renderMarkdown } from '../src/engine/markdown.js';
const encoder = new TextEncoder();
it('has distinct public tools and default-on visibility without adding a sixth main destination', () => {
  expect(new Set(developerTools.map((tool) => tool.id)).size).toBe(15);
  expect(navigationToolsSchema.parse({}).tools).toBe(true);
  expect(canSaveToolDraft('encrypt')).toBe(false);
  expect(canSaveToolDraft('jwt')).toBe(false);
  expect(canSaveToolDraft('equation')).toBe(true);
});
it('formats JSONC, rejects syntax errors, and bounds editable inputs', async () => {
  expect((await runTool('json', '{/* comment */"value": 3,}')).text).toContain('"value": 3');
  await expect(runTool('json', '{oops}')).rejects.toThrow();
  await expect(runTool('json', ' '.repeat(toolLimits.textBytes + 1))).rejects.toThrow('1 MiB');
});
it('converts YAML with core types while rejecting aliases, duplicate keys and custom tags', async () => {
  expect(JSON.parse((await runTool('yaml', 'name: Glass\ncount: 4')).text)).toEqual({
    name: 'Glass',
    count: 4,
  });
  await expect(runTool('yaml', 'name: one\nname: two')).rejects.toThrow();
  await expect(runTool('yaml', 'name: !fetch https://example.com')).rejects.toThrow();
});
it('round-trips quoted CSV, embedded newlines and explicit empty fields', () => {
  const records = [{ name: 'A, B', note: 'First\n"second"', empty: '' }];
  expect(csvToJson(jsonToCsv(JSON.stringify(records)))).toEqual(records);
  expect(csvToJson(jsonToCsv('[{"value":""}]'))).toEqual([{ value: '' }]);
  expect(csvToJson('a,b\n,')).toEqual([{ a: '', b: '' }]);
  expect(() => csvToJson('a,a\n1,2')).toThrow('unique');
  expect(() => csvToJson('a,b\n1')).toThrow('same number');
});
it('round-trips Unicode Base64 and rejects malformed or noncanonical encoded bytes', async () => {
  const source = '你好，Glass! 🧪';
  const encoded = (await runTool('base64', source)).text;
  expect((await runTool('base64', encoded, { action: 'decode' })).text).toBe(source);
  expect(
    (await runTool('base64', base64Encode(encoder.encode('\ufeffhello')), { action: 'decode' }))
      .text,
  ).toBe('\ufeffhello');
  expect(base64Decode(base64Encode(new Uint8Array([0, 255, 128]), true), true)).toEqual(
    new Uint8Array([0, 255, 128]),
  );
  for (const value of ['%%%%', 'Z', 'Zh==', 'Zg=']) expect(() => base64Decode(value)).toThrow();
});
it('retains repeated URL query parameters and marks JWT claims unverified', async () => {
  const inspected = JSON.parse(
    (await runTool('url', 'https://example.com/?tag=a&tag=b', { action: 'inspect' })).text,
  );
  expect(inspected.parameters).toEqual([
    { name: 'tag', value: 'a' },
    { name: 'tag', value: 'b' },
  ]);
  const token =
    base64Encode(encoder.encode('{"alg":"none"}'), true) +
    '.' +
    base64Encode(encoder.encode('{"sub":"reader"}'), true) +
    '.';
  expect(JSON.parse((await runTool('jwt', token)).text).signatureVerified).toBe(false);
});
it('uses SHA checksums and securely generated version-4 UUIDs', async () => {
  expect((await runTool('hash', 'abc')).text).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  const ids = (await runTool('uuid', '12')).text.split('\n');
  expect(new Set(ids).size).toBe(12);
  ids.forEach((id) =>
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/),
  );
});
it('converts integers without losing precision and timestamps with explicit units', async () => {
  const number = JSON.parse((await runTool('number', '900719925474099312345')).text);
  expect(number.decimal).toBe('900719925474099312345');
  expect(JSON.parse((await runTool('time', '1000', { action: 'milliseconds' })).text).ISO).toBe(
    '1970-01-01T00:00:01.000Z',
  );
  await expect(runTool('time', '2026-01-01')).rejects.toThrow('timezone');
  await expect(runTool('time', '2026-02-30T00:00:00Z')).rejects.toThrow('Invalid timestamp');
  await expect(runTool('number', '0x10', { base: '10' })).rejects.toThrow('valid integer');
});
it('provides deterministic color contrast, alpha composition and text/regex operations', async () => {
  expect(parseColor('hsl(0, 100%, 50%)')).toEqual([255, 0, 0, 1]);
  expect(
    JSON.parse((await runTool('color', '#000', { background: '#fff' })).text).contrastRatio,
  ).toBe(21);
  expect(
    JSON.parse((await runTool('color', 'rgba(0,0,0,0)', { background: '#fff' })).text)
      .contrastRatio,
  ).toBe(1);
  expect((await runTool('text', 'b\na\nb', { action: 'unique' })).text).toBe('b\na');
  expect(
    JSON.parse(
      (await runTool('regex', 'AB12 CD34', { pattern: '([A-Z]+)(?<digits>\\d+)', flags: 'g' }))
        .text,
    ).matches[1].groups.digits,
  ).toBe('34');
});
it('encrypts portable binary files with randomized, authenticated parameters and private metadata', async () => {
  const original = new Uint8Array([0, 1, 255, 0, 128]);
  const metadata = { kind: 'file' as const, name: 'private-secret.pdf', mime: 'application/pdf' };
  const first = await encryptContent(original, 'correct horse 🐎', metadata),
    second = await encryptContent(original, 'correct horse 🐎', metadata);
  expect(first).not.toEqual(second);
  expect(new TextDecoder().decode(first)).not.toContain(metadata.name);
  const restored = await decryptContent(first, 'correct horse 🐎');
  expect(restored.bytes).toEqual(original);
  expect(restored.metadata).toEqual(metadata);
  await expect(decryptContent(first, 'wrong')).rejects.toThrow('Incorrect password');
  const changed = first.slice();
  changed[changed.length - 1] ^= 1;
  await expect(decryptContent(changed, 'correct horse 🐎')).rejects.toThrow('damaged');
  const badHeader = first.slice();
  const text = new TextDecoder().decode(badHeader.slice(13, 200));
  expect(text).toContain('version');
  const index = new TextDecoder().decode(badHeader).indexOf('600000');
  badHeader[index] = 57;
  await expect(decryptContent(badHeader, 'correct horse 🐎')).rejects.toThrow('Unsupported');
});
it('isolates text encryption limits and rejects malformed envelopes before expensive work', async () => {
  const source = encoder.encode('A note with 中文 and ∇.');
  const envelope = await encryptContent(source, 'long passphrase', {
    kind: 'text',
    name: 'message.txt',
    mime: 'text/plain',
  });
  expect((await decryptContent(envelope, 'long passphrase')).bytes).toEqual(source);
  await expect(decryptContent(new Uint8Array([1, 2]), 'password')).rejects.toThrow('Invalid');
  await expect(
    encryptContent(new Uint8Array(toolLimits.textBytes + 1), 'password', {
      kind: 'text',
      name: '',
      mime: '',
    }),
  ).rejects.toThrow('limit');
});
it('keeps production chemistry arrows static and free from missing-font errors', async () => {
  const result = await renderMarkdown('$$\n\\ce{2H2 + O2 -> 2H2O}\n$$', {
    math: { packages: ['mhchem'] },
  });
  expect(result.html).toContain('<svg');
  expect(result.html).not.toMatch(/data-mjx-error|mjx-output-error|Invalid variant/);
  const rare = await renderMarkdown('$$\\mathfrak{ABCDEFGHIJKLMNOPQRSTUVWXYZ}$$');
  expect(rare.html).toContain('<svg');
  expect(rare.html).not.toMatch(/data-mjx-error|mjx-output-error/);
});
