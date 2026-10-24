import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EditorState } from '@codemirror/state';
import { analyzeSource } from '../src/console/source-analysis.js';
import { mathPreviewUpdate, sourceMathPreviews } from '../src/console/source-math.js';
import { renderMathPreviews } from '../src/engine/markdown.js';
import { createApp } from '../src/server/app.js';
import { mathPreviewLimits } from '../src/shared/math-preview.js';

it('collects inline macro context and display equations in source order, excluding code lookalikes', () => {
  const source =
    '$\\newcommand{\\slope}{3}$\n\n$$\ny=\\slope x\n$$\n\n```tex\n$$\nnot math\n$$\n```\n\n`$code$`';
  const maths = analyzeSource(source).maths!;
  expect(maths.map(({ source, display }) => ({ source, display }))).toEqual([
    { source: '\\newcommand{\\slope}{3}', display: false },
    { source: 'y=\\slope x', display: true },
  ]);
  expect(source.slice(maths[1].from, maths[1].to)).toBe('$$\ny=\\slope x\n$$');
});

it('renders with MathJax 4, shares macros only within a batch, and recovers after invalid TeX', async () => {
  const results = await renderMathPreviews([
    { source: '\\newcommand{\\fieldnotesslope}{3}', display: false },
    { source: 'y=\\fieldnotesslope x', display: true },
    { source: '\\unknownfieldnotescommand', display: true },
    { source: '\\frac{a}{b}', display: true },
    { source: 'x^2', display: false },
  ]);
  expect(results[0]).toEqual({ html: '' });
  expect(results[1].html).toContain('<svg');
  expect(results[1].html).toContain('role="math"');
  expect(results[2].error).toContain('Invalid equation');
  expect(results[3].html).toContain('<svg');
  expect(results[4].html).toContain('class="math-inline"');
  expect(results[4].html).toContain('<svg');
  expect(
    (await renderMathPreviews([{ source: '\\fieldnotesslope', display: true }]))[0].error,
  ).toBeTruthy();
  await expect(
    renderMathPreviews(
      Array.from({ length: mathPreviewLimits.count + 1 }, () => ({ source: 'x', display: true })),
    ),
  ).rejects.toThrow('200 expressions');
});

it('maps math widgets through prose edits and invalidates drawings when macro context changes', () => {
  const source = 'Before.\n\n$\\newcommand{\\slope}{3}$\n\n$$\ny=\\slope x\n$$',
    maths = analyzeSource(source).maths!;
  let state = EditorState.create({ doc: source, extensions: [sourceMathPreviews] });
  state = state.update({
    effects: mathPreviewUpdate.of(
      maths.map((math) => ({ ...math, result: { html: math.display ? '<svg></svg>' : '' } })),
    ),
  }).state;
  expect(state.field(sourceMathPreviews).decorations.size).toBe(1);
  state = state.update({ changes: { from: 0, insert: 'Intro.\n\n' } }).state;
  expect(state.field(sourceMathPreviews).previews[1].from).toBe(maths[1].from + 8);
  expect(state.field(sourceMathPreviews).previews[1].result?.html).toBe('<svg></svg>');
  state = state.update({
    changes: { from: 8 + source.indexOf('3'), to: 9 + source.indexOf('3'), insert: '4' },
  }).state;
  expect(state.field(sourceMathPreviews).previews).toHaveLength(1);
  expect(state.field(sourceMathPreviews).previews[0].result).toBeUndefined();
  expect(state.doc.toString()).toContain('{4}');
});

it('keeps the bounded math preview endpoint local, authenticated and uncacheable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldnotes-math-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  const context = await createApp(root, { watchFiles: false });
  try {
    const url = 'http://127.0.0.1/api/authoring/math-preview',
      body = JSON.stringify({ expressions: [{ source: 'x^2', display: true }] }),
      headers = { 'Content-Type': 'application/json', 'X-Studio-Token': context.token };
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
    expect((await response.json()).results[0].html).toContain('<svg');
    const excessive = Array.from({ length: 9 }, () => ({
      source: 'x'.repeat(mathPreviewLimits.expression),
      display: true,
    }));
    expect(
      (
        await context.app.request(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ expressions: excessive }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await context.app.request(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            expressions: [{ source: 'x', display: true, url: 'https://example.com' }],
          }),
        })
      ).status,
    ).toBe(400);
  } finally {
    context.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
