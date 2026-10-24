import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EditorState } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { parseEntry } from '../src/engine/store.js';
import { inspectMarkdown } from '../src/shared/markdown-analysis.js';
import { analyzeSource } from '../src/console/source-analysis.js';
import { formatMarkdown, markdownMeaning, type SourceEdit } from '../src/console/source-format.js';
import {
  composeLink,
  citationKey,
  existingLink,
  linkHeadings,
  safeLinkDestination,
  localLinkTargets,
} from '../src/console/source-links.js';
import { computeDiff, diffLimit } from '../src/console/diff-compute.js';
import { Store } from '../src/engine/store.js';

const apply = (source: string, edits: SourceEdit[]) =>
  EditorState.create({ doc: source }).update({ changes: edits }).state.doc.toString();
it('formats the complete custom showcase without changing math, nesting, tables or code payloads', async () => {
  const source = parseEntry(
    await fs.readFile('tests/fixtures/notebook/posts/component-showcase.md', 'utf8'),
    'posts',
    'component-showcase.md',
  ).body;
  const result = await formatMarkdown(source);
  expect(markdownMeaning(result.source)).toBe(markdownMeaning(source));
  expect(apply(source, result.edits)).toBe(result.source);
  expect(inspectMarkdown(result.source).diagnostics.filter((d) => d.severity === 'error')).toEqual(
    [],
  );
});
it('preserves Chinese prose, hard breaks, references, equations and embedded JSON while formatting tables', async () => {
  const source =
    '# 标题\n\n第一行  \n第二行 $\\alpha^2$。\n\n|值|公式|\n|---:|:---|\n|2|$x$|\n\n[Link][ref]\n\n[ref]: https://example.com/\n\n```interactive\n{"type":"function-plot","title":"A","expression":"x"}\n```\n';
  const result = await formatMarkdown(source);
  expect(markdownMeaning(result.source)).toBe(markdownMeaning(source));
  expect(result.source).toContain('第一行  \n第二行');
  expect(result.source).toContain('{"type":"function-plot","title":"A","expression":"x"}');
});
it('formats complete selected blocks and applies minimal edits as one undoable transaction', async () => {
  const source = 'Before.\n\n-   one\n-   two\n\nAfter.',
    from = source.indexOf('-'),
    to = source.indexOf('\n\nAfter');
  const result = await formatMarkdown(source, { from, to });
  expect(result.source).toBe('Before.\n\n- one\n- two\n\nAfter.');
  await expect(formatMarkdown(source, { from: from + 2, to })).rejects.toThrow(
    'complete Markdown blocks',
  );
  let state = EditorState.create({
    doc: source,
    selection: { anchor: source.indexOf('After') },
    extensions: [history()],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(t: any) {
      state = state.update(t).state;
    },
  } as unknown as EditorView;
  state = state.update({ changes: result.edits }).state;
  expect(state.doc.sliceString(state.selection.main.head)).toBe('After.');
  undo(view);
  expect(state.doc.toString()).toBe(source);
});
it('finds real images including references, while ignoring code and math lookalikes', () => {
  const source =
    '![A view](/media/one.webp)\n\nInline ![Two][photo] next.\n\n[photo]: /media/two.webp\n\n`![fake](/media/no.webp)`\n\n```md\n![fake](/media/no.webp)\n```\n\n$$\n![fake](/media/no.webp)\n$$';
  const result = analyzeSource(source);
  expect(result.images).toHaveLength(2);
  expect(result.images?.map((i) => [i.url, i.block])).toEqual([
    ['/media/one.webp', true],
    ['/media/two.webp', false],
  ]);
  expect(source.slice(result.images![1].from, result.images![1].to)).toBe('![Two][photo]');
});
it('categorizes nonblocking style, accessibility, structure and local-link diagnostics with safe fixes', () => {
  const source =
    '## Start\n\n#### Gap\n\nText \n\n![image](/media/missing.webp)\n\n[Draft](/post/draft/) [Lost](/gone/) [Missing][key]\n\n```md\ncode   \n```\n\nHard break  \nnext.\n';
  const result = analyzeSource(source, {
    links: [{ url: '/post/draft/', status: 'draft' }],
    media: [],
  });
  expect(result.diagnostics.map((d) => d.code)).toEqual(
    expect.arrayContaining([
      'heading-order',
      'trailing-whitespace',
      'image-alt',
      'missing-media',
      'unpublished-link',
      'broken-local-link',
      'missing-link-reference',
    ]),
  );
  expect(result.diagnostics.filter((d) => d.code === 'trailing-whitespace')).toHaveLength(1);
  const fixed = apply(
    source,
    result.diagnostics.flatMap((d) => d.fix?.changes || []),
  );
  expect(markdownMeaning(fixed)).toBe(markdownMeaning(source));
  expect(result.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
});
it('edits existing links, escapes labels and rejects executable or private destinations', () => {
  const source = 'Read [A note](/post/note/) now.',
    link = existingLink(source, 10)!;
  expect(link.label).toBe('A note');
  expect(
    apply(
      source,
      composeLink(source, link, {
        label: '[New] *note*',
        url: '/article/new/#part',
        style: 'inline',
      }),
    ),
  ).toContain('[\\[New\\] \\*note\\*](/article/new/#part)');
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,evil',
    '/studio/',
    '/%61pi/token',
    'http://127.0.0.1:4310/studio',
    '//evil.example',
    'https://user:secret@example.com',
    '/a\\b',
  ])
    expect(() => safeLinkDestination(url)).toThrow();
  expect(safeLinkDestination('https://example.com/path_(one)')).toBe(
    'https://example.com/path_%28one%29',
  );
  expect(linkHeadings('## A\n\n## A\n\n## 中文')).toEqual([
    { label: 'A', fragment: 'a' },
    { label: 'A', fragment: 'a-2' },
    { label: '中文', fragment: '中文' },
  ]);
});
it('reuses link definitions and stable local bibliography keys in a single undoable edit', () => {
  const target = {
    id: 'entry-stable-id',
    title: 'A *local* article',
    url: '/article/new-name/',
    status: 'published',
    group: 'Articles',
    author: 'An Author',
    date: '2026-10-21',
  };
  const source = 'Read here.\n';
  const first = apply(
    source,
    composeLink(
      source,
      { from: 5, to: 9 },
      {
        label: 'here',
        url: target.url,
        style: 'citation',
        target,
        siteUrl: 'https://example.com/',
      },
    ),
  );
  expect(first).toContain(':cite[entry-stable-id]');
  expect(first).toContain('https://example.com/article/new-name/');
  expect(inspectMarkdown(first).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const twice = apply(
    first,
    composeLink(
      first,
      { from: 0, to: 0 },
      {
        label: 'again',
        url: target.url,
        style: 'citation',
        target,
        siteUrl: 'https://example.com/',
      },
    ),
  );
  expect(twice.match(/:::reference\[/g)).toHaveLength(1);
  const reference = apply(
    '[one]: /article/new-name/\n\nHere',
    composeLink(
      '[one]: /article/new-name/\n\nHere',
      { from: 26, to: 30 },
      { label: 'Second', url: target.url, style: 'reference' },
    ),
  );
  expect(reference.match(/^\[one\]:/gm)).toHaveLength(1);
  expect(reference).toContain('[Second][one]');
  const atEnd = apply(
    '',
    composeLink(
      '',
      { from: 0, to: 0 },
      { label: '', url: target.url, style: 'citation', target, siteUrl: 'https://example.com' },
    ),
  );
  expect(atEnd).toMatch(/^:cite\[entry-stable-id\]\n\n::::references/);
});
it('appends citations inside existing references without overwriting manual bibliography text', () => {
  const source =
    'Text.\n\n::::references[Sources]\n:::reference[Manual]{#manual}\nKeep this exact text.\n:::\n::::\n';
  const target = {
    id: 'entry-target',
    title: 'Target',
    url: '/post/target/',
    status: 'published',
    group: 'Posts',
  };
  const next = apply(
    source,
    composeLink(
      source,
      { from: 0, to: 0 },
      { label: '', url: target.url, style: 'citation', target, siteUrl: 'https://example.com' },
    ),
  );
  expect(next).toContain('Keep this exact text.');
  expect(next.match(/::::references/g)).toHaveLength(1);
  expect(inspectMarkdown(next).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
});
it('uses configured local routes and includes fixed pages and real albums', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-tools-'));
  try {
    await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
    const model = await new Store(root).read();
    model.site.collections.posts.path = 'post';
    model.site.collections.lab.path = 'article';
    const targets = localLinkTargets({
      ...model,
      entries: model.entries,
      workspaceId: 'fixture',
      token: '',
      siteRevision: '',
      libraryRevision: '',
      jobs: [],
    });
    expect(targets.some((t) => t.url === '/about/')).toBe(true);
    for (const entry of model.entries)
      expect(targets.find((t) => t.id === `entry-${entry.id}`)?.url).toContain(
        '/' + model.site.collections[entry.kind].path + '/',
      );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
it('reports exact line regions, optional whitespace filtering, CRLF differences and bounded comparisons', () => {
  const result = computeDiff('One.\n\nSame.\n', 'Two.\n\nSame.\n');
  expect(result.precise).toBe(true);
  expect(result.regions).toHaveLength(1);
  expect(result.regions[0]).toMatchObject({
    originalStartLineNumber: 1,
    modifiedStartLineNumber: 1,
  });
  expect(computeDiff('x  \n', 'x\n', true).regions).toEqual([]);
  expect(computeDiff('x\r\n', 'x\n')).toMatchObject({ lineEndings: true, regions: [] });
  expect(() => computeDiff('x'.repeat(diffLimit + 1), '')).toThrow('8 MiB');
});

it('keeps long stable citation keys valid and distinct without dropping identity suffixes', () => {
  const a = citationKey('entry-' + 'x'.repeat(94) + '-first'),
    b = citationKey('entry-' + 'x'.repeat(94) + '-other');
  expect(a.length).toBeLessThanOrEqual(80);
  expect(b).not.toBe(a);
  expect(() => analyzeSource('![]() [empty]()')).not.toThrow();
});

it('ignores edge whitespace within mixed changes while retaining exact raw positions', () => {
  const result = computeDiff('  old  \n  same  \n', ' new\nsame\n', true);
  expect(result.regions).toHaveLength(1);
  expect(result.regions[0]).toMatchObject({
    originalStartLineNumber: 1,
    originalEndLineNumber: 1,
    modifiedStartLineNumber: 1,
    modifiedEndLineNumber: 1,
  });
  expect(result.changes[0]).toMatchObject({ fromA: 2, toA: 5, fromB: 1, toB: 4 });
  expect(computeDiff('  x\n', 'x\n', true).whitespaceOnly).toBe(true);
  expect(computeDiff('', 'Added\n').regions[0]).toMatchObject({
    originalStartLineNumber: 0,
    originalEndLineNumber: 0,
  });
});
