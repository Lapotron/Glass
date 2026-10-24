import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EditorState } from '@codemirror/state';
import { tableCommand } from '../src/console/markdown-assistance.js';
import { sourceComponents, componentPreviewLimits } from '../src/shared/source-components.js';
import {
  parseSourceTable,
  writeSourceTable,
  changeSourceTable,
  tableDelimited,
} from '../src/shared/source-table.js';
import { readDelimited } from '../src/shared/tabular-data.js';
import { renderComponentPreviews } from '../src/engine/component-previews.js';
import { createApp } from '../src/server/app.js';
import { parseReaderPreferences } from '../src/shared/reader-preferences.js';

it('discovers bounded visual source ranges without turning code examples or prose into previews', () => {
  const source =
    'Paragraph | prose\n\n````text\n```mermaid\nflowchart LR\nA-->B\n```\n````\n\n| A | B |\n| --- | ---: |\n| C | 2 |\n\n:::mindmap[Map]\n- One\n  - Two\n:::\n\n```interactive\n{"type":"image-compare","title":"Pair"}\n```';
  const blocks = sourceComponents(source);
  expect(blocks.map((b) => b.kind)).toEqual(['table', 'mindmap', 'image-compare']);
  for (const block of blocks) expect(source.slice(block.from, block.to)).toBe(block.source);
});

it('round-trips raw Markdown cells, alignment, escaped pipes and code without absorbing adjacent text', () => {
  const source = '| Name | Value |\n| :--- | ---: |\n| A \\| B | `a\\|b` |\n| [Ref][r] | $x^2$ |';
  const table = parseSourceTable(source);
  expect(table.rows).toEqual([
    ['Name', 'Value'],
    ['A \\| B', '`a\\|b`'],
    ['[Ref][r]', '$x^2$'],
  ]);
  expect(parseSourceTable(writeSourceTable(table)).rows).toEqual(table.rows);
  expect(parseSourceTable(writeSourceTable(table)).align).toEqual(['left', 'right']);
  const added = changeSourceTable(table, 'column', 1, 0);
  expect(added.rows[0]).toHaveLength(3);
  expect(changeSourceTable(added, 'delete-column', 1, 1).rows).toEqual(table.rows);
  expect(() => changeSourceTable(table, 'delete-row', 0, 0)).toThrow('header');
  const csv = {
    rows: [
      ['Name', 'Value'],
      ['"quoted", value', 'line\nnext'],
    ],
  };
  expect(readDelimited(tableDelimited(csv, ','))).toEqual(csv.rows);
});

it('table commands target parsed source instead of neighboring pipe-containing prose', async () => {
  const source = 'Before | text\n\n| A | B |\n| --- | ---: |\n| C | 2 |\n\nAfter | text';
  let state = EditorState.create({ doc: source, selection: { anchor: source.indexOf('C |') } });
  const fakeView = {
    get state() {
      return state;
    },
    dispatch: (transaction: any) => {
      state = state.update(transaction).state;
    },
    focus: () => {},
    scrollSnapshot: () => [],
  };
  await tableCommand(fakeView as any, 'column');
  expect(state.doc.toString()).toMatch(/^Before \| text\n\n/);
  expect(state.doc.toString()).toMatch(/\n\nAfter \| text$/);
  expect(parseSourceTable(sourceComponents(state.doc.toString())[0].source).rows[0]).toHaveLength(
    3,
  );
});

it('renders isolated components with link and document-local math context, recovering per block', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-components-'));
  try {
    const source =
      '$\\newcommand{\\slope}{3}$\n\n| Link | Value |\n| --- | ---: |\n| [Local][ref] | $\\slope x$ |\n\n```interactive\n{"type":"chart","title":"Incomplete"}\n```\n\n[ref]: /about/';
    const blocks = sourceComponents(source);
    const results = await renderComponentPreviews(source, blocks, root);
    expect(results[0].html).toContain('href="/about/"');
    expect(results[0].html).toContain('class="math-inline"');
    expect(results[0].html).toContain('<svg');
    expect(results[1].error).toBeTruthy();
    expect((await renderComponentPreviews(source, [{ from: 0, to: 2 }], root))[0].error).toContain(
      'changed',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('keeps component previews authenticated, local, bounded and outside notebook persistence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-component-api-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  const context = await createApp(root, { watchFiles: false });
  try {
    const source = '| A | B |\n| --- | --- |\n| C | D |';
    const body = JSON.stringify({
      source,
      blocks: sourceComponents(source).map(({ from, to }) => ({ from, to })),
    });
    const url = 'http://127.0.0.1/api/authoring/component-preview';
    const headers = { 'Content-Type': 'application/json', 'X-Studio-Token': context.token };
    expect((await context.app.request(url, { method: 'POST', body })).status).toBe(403);
    expect(
      (
        await context.app.request(url, {
          method: 'POST',
          body,
          headers: { ...headers, Origin: 'https://elsewhere.example' },
        })
      ).status,
    ).toBe(403);
    const response = await context.app.request(url, { method: 'POST', body, headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).results[0].html).toContain('<table>');
    expect(
      (
        await context.app.request(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            source,
            blocks: Array.from({ length: componentPreviewLimits.count + 1 }, () => ({
              from: 0,
              to: 1,
            })),
          }),
        })
      ).status,
    ).toBe(400);
  } finally {
    context.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('validates optional browser-local article focus without changing old preference defaults', () => {
  expect(parseReaderPreferences({ version: 1, theme: {}, focusMode: true }).focusMode).toBe(true);
  expect(parseReaderPreferences({ version: 1, focusMode: 'true' }).focusMode).toBeUndefined();
  expect(parseReaderPreferences({ version: 1, theme: {} }).focusMode).toBeUndefined();
  expect(
    parseReaderPreferences({ version: 1, theme: { contentWidth: 1600 } }).theme.contentWidth,
  ).toBe(1600);
  expect(
    parseReaderPreferences({ version: 1, theme: { contentWidth: 1601 } }).theme.contentWidth,
  ).toBeUndefined();
});
