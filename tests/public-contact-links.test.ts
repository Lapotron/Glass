import { beforeEach, afterEach, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseYaml } from 'yaml';
import { Store, digest } from '../src/engine/store.js';
import { shortLinkRedirects } from '../src/engine/shortlinks.js';
import { validateShortLinks } from '../src/shared/shortlinks.js';
import { encodeContact, decodeContact } from '../src/shared/contact.js';
import { renderMarkdown } from '../src/engine/markdown.js';
import { buildSite } from '../src/engine/build.js';
import { createRenderer } from '../src/site/pages.js';
import { createApp } from '../src/server/app.js';
let root: string, store: Store;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-contact-links-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  store = new Store(root);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('derives stable legacy codes without rewriting canonical Markdown and follows slug changes', async () => {
  const entry = (await store.snapshot()).entries[0],
    file = path.join(store.content, entry.kind, entry.file),
    original = await fs.readFile(file, 'utf8');
  expect(entry.shortCode).toBe(digest(entry.id).slice(0, 12));
  expect(await fs.readFile(file, 'utf8')).toBe(original);
  const changed = await store.saveEntry(entry.id, {
    metadata: { ...entry, slug: 'changed-url', shortAliases: ['reading-notes'] },
    body: entry.body,
    revision: entry.revision,
  });
  expect(changed.shortCode).toBe(entry.shortCode);
  const redirects = shortLinkRedirects([{ ...changed, status: 'published' }]);
  expect(redirects).toContain(
    '/s/' +
      entry.shortCode +
      ' /' +
      (entry.kind === 'posts' ? 'blog' : 'lab') +
      '/changed-url/ 302',
  );
  expect(redirects).toContain('/s/reading-notes ');
});
it('rejects duplicate aliases, primary-code collisions and unsupported aliases', () => {
  expect(() =>
    validateShortLinks([
      { id: 'a', shortCode: 'abcdef', shortAliases: ['notes'] },
      { id: 'b', shortCode: 'other1', shortAliases: ['notes'] },
    ]),
  ).toThrow('already in use');
  expect(() =>
    validateShortLinks([{ id: 'a', shortCode: 'abcdef', shortAliases: ['abcdef'] }]),
  ).toThrow('already in use');
  expect(() =>
    validateShortLinks([{ id: 'a', shortCode: 'abcdef', shortAliases: ['../private'] }]),
  ).toThrow('3–32');
});
it('persists automatic codes for new drafts and prevents alias conflicts on legacy Trash restoration', async () => {
  let entry = await store.create('posts', 'Stable new draft', 'stable-new-draft');
  const source = await fs.readFile(path.join(store.content, 'posts', entry.file), 'utf8');
  expect(parseYaml(source.match(/^---\n([\s\S]*?)\n---/)![1]).shortCode).toBe(entry.shortCode);
  entry = await store.saveEntry(entry.id, {
    metadata: { ...entry, shortAliases: ['reserved-alias'] },
    body: entry.body,
    revision: entry.revision,
  });
  await store.trash(entry.id, entry.revision);
  const other = await store.create('lab', 'Another draft', 'another-draft');
  await store.saveEntry(other.id, {
    metadata: { ...other, shortAliases: ['reserved-alias'] },
    body: other.body,
    revision: other.revision,
  });
  await expect(store.restore(entry.id)).rejects.toThrow('already in use');
  expect((await store.snapshot()).entries.some((item) => item.id === entry.id)).toBe(false);
  expect((await store.listTrash()).some((item) => item!.id === entry.id)).toBe(true);
});
it('does not generate public redirects for drafts, scheduled or trashed entries', async () => {
  const model = await store.snapshot();
  const entry = model.entries[0];
  expect(
    shortLinkRedirects([
      { ...entry, status: 'draft' },
      {
        ...entry,
        id: 'second',
        shortCode: 'another',
        status: 'scheduled',
        publishAt: new Date(Date.now() + 60000).toISOString(),
      },
    ]),
  ).toBe('');
  const context = await createApp(root, { watchFiles: false });
  try {
    const published = model.entries.find((entry) => entry.status === 'published')!;
    const response = await context.app.request('http://localhost/s/' + published.shortCode);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain(published.slug);
    await store.trash(published.id, published.revision);
    expect(
      (await context.app.request('http://localhost/s/' + published.shortCode)).status,
    ).not.toBe(302);
  } finally {
    context.close();
  }
});
it('round-trips Unicode mail links and rejects non-email navigation', () => {
  const href = 'mailto:writer@example.org?subject=你好';
  expect(decodeContact(encodeContact(href))).toBe(href);
  expect(() => encodeContact('javascript:alert(1)')).toThrow();
  expect(() => decodeContact(btoa('https://example.com'))).toThrow();
});
it('protects Markdown mail links while preserving plain prose and code examples', async () => {
  const result = await renderMarkdown(
    '[writer@example.org](mailto:writer@example.org)\n\nA plain example: code@example.org\n\n`inline@example.org`',
  );
  expect(result.html).toContain('data-email-token=');
  expect(result.html).not.toContain('writer@example.org');
  expect(result.html).toContain('code@example.org');
  expect(result.html).toContain('inline@example.org');
  expect(result.html).toContain('Enable JavaScript');
  expect(
    (await renderMarkdown('[Email](mailto:writer@example.org)', { protectEmailLinks: false })).html,
  ).toContain('href="mailto:writer@example.org"');
});
it('publishes protected About/footer controls, stable redirects, and no clear-text contact in artifacts', async () => {
  const model = await store.snapshot();
  model.entries = model.entries.slice(0, 1).map((entry) => ({
    ...entry,
    status: 'published',
    body: '[Contact](mailto:private-contact@example.org)\n\n[Short link](/s/hello-world)',
    shortAliases: ['hello-world'],
  }));
  model.site.profile.email = 'private-contact@example.org';
  model.site.profile.links = [{ label: 'Email', href: 'mailto:private-contact@example.org' }];
  model.about.body = '# About\n\nA short introduction.';
  const renderer = await createRenderer(model);
  expect(renderer.render('/about/')).toContain('data-email-token=');
  expect(renderer.render('/about/')).not.toContain('private-contact@example.org');
  const assets = path.join(root, 'test-assets');
  await fs.mkdir(assets);
  for (const file of ['site.js', 'site.css', 'appearance.js', 'annotations-worker.js'])
    await fs.writeFile(path.join(assets, file), '/* isolated test asset */');
  const built = await buildSite(store, { model, assets });
  expect(await fs.readFile(path.join(built.outputDir, '_redirects'), 'utf8')).toContain(
    '/s/hello-world ',
  );
  for (const file of built.manifest.filter((file) => /\.(html|json|xml|js)$/.test(file)))
    expect(await fs.readFile(path.join(built.outputDir, file), 'utf8'), file).not.toContain(
      'private-contact@example.org',
    );
  expect(
    await fs.readFile(path.join(root, '.studio/builds', built.id, 'source.json'), 'utf8'),
  ).toContain('private-contact@example.org');
}, 30000);
