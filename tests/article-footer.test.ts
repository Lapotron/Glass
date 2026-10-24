import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/engine/store.js';
import { siteSchema, entrySchema, routeFor } from '../src/shared/contracts.js';
import { resolveEntrySettings } from '../src/shared/entry-settings.js';
import { articleCitations } from '../src/shared/article-citation.js';
import { articleQrSvg } from '../src/engine/article-qr.js';
import { createRenderer } from '../src/site/pages.js';
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-footer-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  const model = await new Store(root).read();
  for (const entry of model.entries) entry.body = '## Reading\n\nA short article.';
  return { root, model };
}
it('defaults footer visibility and derives modified-date visibility without materializing entry overrides', async () => {
  const { root, model } = await fixture();
  try {
    const entry = model.entries[0];
    expect(entry.reading).toBeUndefined();
    expect(model.site.reading.articleFooter).toBe(true);
    expect(model.site.reading.modifiedDate).toBeUndefined();
    const site = siteSchema.parse({ ...model.site, reading: { publishedDate: false } });
    expect(resolveEntrySettings(site, entry).reading.modifiedDate).toBe(false);
    expect(
      resolveEntrySettings(site, { ...entry, reading: { publishedDate: true } }).reading
        .modifiedDate,
    ).toBe(true);
    expect(
      resolveEntrySettings(site, {
        ...entry,
        reading: { modifiedDate: false, articleFooter: false },
      }).reading,
    ).toMatchObject({ modifiedDate: false, articleFooter: false });
    expect(entrySchema.parse({ ...entry, reading: { articleFooter: false } }).reading).toEqual({
      articleFooter: false,
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
it('renders public canonical sharing, safe citations, static QR and compact sharing', async () => {
  const { root, model } = await fixture();
  try {
    const entry = model.entries.find((e) => e.kind === 'posts' && e.status === 'published')!;
    entry.updatedAt = '2026-10-21';
    model.site.profile.email = 'private@example.org';
    model.site.collections.posts.path = 'post';
    const renderer = await createRenderer(model),
      html = renderer.render(routeFor(entry, model.site.collections));
    expect(html).toContain('Article details and actions');
    expect(html).toContain('data-canonical="https://example.com/post/');
    expect(html).toContain('QR code for this article');
    expect(html).toContain('data-citation="bibtex"');
    expect(html).toContain('data-citation="ris"');
    expect(html).toContain('dateTime="2026-10-21"');
    expect(html).toContain('Written by');
    expect(html).not.toContain('mailto:' + model.site.profile.email);
    expect(html).toContain('data-article-action="print" disabled');
    expect(html).not.toContain('source-format');
    expect(html).not.toContain('qrcode-generator');
    const footer = html.match(/<footer class="article-bottom[\s\S]*?<\/footer>/)![0];
    expect(footer).not.toContain('article-adjacent');
    expect(footer).not.toContain('Follow along');
    expect(footer).not.toContain('Reading tools');
    expect(footer).toContain('data-article-fact="published"');
    expect(footer).toContain('data-article-fact="updated"');
    expect(footer).toContain('data-article-fact="reading"');
    expect(footer).toContain('words ·');
    expect(footer).toContain('article-share-more');
    expect(footer).not.toContain('href="/lab/');
    expect(footer).not.toContain('A draft');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
it('omits the whole footer when disabled and keeps private previews free of sharing payloads', async () => {
  const { root, model } = await fixture();
  try {
    const entry = model.entries.find((e) => e.status === 'published')!;
    model.site.reading.articleFooter = false;
    expect((await createRenderer(model)).render(routeFor(entry))).not.toContain(
      'data-article-footer',
    );
    model.site.reading.articleFooter = true;
    const preview = (await createRenderer(model, { preview: true })).render(routeFor(entry));
    const footer = preview.match(/<footer class="article-bottom[\s\S]*?<\/footer>/)![0];
    expect(footer).toContain('data-private="true"');
    expect(footer).not.toContain('data-canonical');
    expect(footer).not.toContain('data-citation');
    expect(footer).not.toContain('article-qr');
    entry.updatedAt = undefined;
    const html = (await createRenderer(model)).render(routeFor(entry));
    expect(html.match(/<footer class="article-bottom[\s\S]*?<\/footer>/)![0]).not.toContain(
      'Updated',
    );
    model.site.reading.author = false;
    model.site.reading.publishedDate = false;
    model.site.feeds = { ...model.site.feeds, rss: false, atom: false, json: false };
    const quiet = (await createRenderer(model))
      .render(routeFor(entry))
      .match(/<footer class="article-bottom[\s\S]*?<\/footer>/)![0];
    expect(quiet).not.toContain('Written by');
    expect(quiet).not.toContain('Published');
    expect(quiet).not.toContain('Follow along');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
it('escapes scholarly exports and creates deterministic complete QR SVGs at build time', () => {
  const article = {
    id: 'safe-id',
    title: 'A {title} & $math$\nnext',
    site: 'Notebook',
    url: 'https://example.com/post/a/',
    author: 'Author',
    publishedAt: '2026-10-21',
  };
  const result = articleCitations(article);
  expect(result.bibtex).toContain('A \\{title\\} \\& \\$math\\$ next');
  expect(result.ris).toContain('TY  - ELEC');
  expect(result.ris).toContain('DA  - 2026/10/21');
  expect(articleQrSvg(article.url)).toBe(articleQrSvg(article.url));
  expect(articleQrSvg(article.url)).toContain('<path');
  expect(articleQrSvg(article.url)).not.toContain('<script');
});
it('retains focus access without headings and paper metadata when the footer is disabled', async () => {
  const { root, model } = await fixture();
  try {
    const entry = model.entries.find((item) => item.status === 'published')!;
    entry.body = 'An article with no section headings.';
    entry.updatedAt = '2026-10-21';
    model.site.reading = {
      ...model.site.reading,
      articleFooter: false,
      author: false,
      modifiedDate: true,
      progress: false,
    };
    const html = (await createRenderer(model)).render(routeFor(entry));
    expect(html).toContain('data-article-focus-toggle');
    expect(html).not.toContain('class="post-outline"');
    const printMetadata = html.match(/class="article-print-meta">([\s\S]*?)<\/p>/)?.[1].replace(/<[^>]*>/g, '');
    expect(printMetadata).toMatch(/^Updated/);
    expect(printMetadata).not.toMatch(/^ ·/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
