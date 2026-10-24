import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { renderMarkdown } from '../src/engine/markdown.js';
import { inspectMarkdown, parseMarkdown } from '../src/shared/markdown-analysis.js';
import { imageLayout } from '../src/shared/image-layout.js';
import { inspectSource } from '../src/console/source-inspection.js';
import { imageFigure, imagePresentationChanges } from '../src/console/source-image-layout.js';

it('renders bounded responsive figure metadata without accepting arbitrary styles', async () => {
  const source =
    ':::figure[A small observation]{#observation width="480" max-height="640" align="right"}\n![The observation](/media/sample.webp)\n:::';
  const rendered = await renderMarkdown(source);
  expect(rendered.html).toContain('data-image-width="480"');
  expect(rendered.html).toContain('data-image-max-height="640"');
  expect(rendered.html).toContain('data-image-align="right"');
  expect(rendered.html).toContain('width:480px;max-width:100%;--figure-max-height:640px');
  expect(rendered.html).toContain('Figure 1');
  expect(rendered.media).toContain('/media/sample.webp');
  expect(inspectMarkdown(source).diagnostics).toEqual([]);
  for (const width of ['calc(100vw)', '2401', '9%', '101%', 'javascript:alert(1)'])
    expect(
      inspectMarkdown(
        `:::figure{width="${width}"}\n![Sample](/media/sample.webp)\n:::`,
      ).diagnostics.some((d) => d.code === 'image-layout'),
    ).toBe(true);
  expect(imageLayout({ width: '60%', 'max-height': '320px', align: 'center' })).toEqual({
    width: '60%',
    maxHeight: '320px',
    align: 'center',
  });
  expect(() => imageLayout({ align: 'fixed' })).toThrow('alignment');
});

it('adds image metadata in one source edit and preserves captions, labels and reference definitions on update/reset', () => {
  let source = 'Before.\n\n![A scene][scene]\n\n[scene]: /media/scene.webp\n';
  const first = inspectSource(parseMarkdown(source), source).images[0];
  const changes = imagePresentationChanges(source, first, source.slice(first.from, first.to), {
    width: '480',
    'max-height': '640',
    align: 'center',
  });
  expect(changes).toHaveLength(1);
  source = EditorState.create({ doc: source }).update({ changes }).state.doc.toString();
  expect(source).toContain(':::figure{width="480" max-height="640" align="center"}');
  expect(source).toContain('![A scene][scene]');
  expect(source).toContain('[scene]: /media/scene.webp');
  source = source.replace(':::figure{', ':::figure[The caption]{#fig-scene ');
  const image = inspectSource(parseMarkdown(source), source).images[0];
  expect(imageFigure(source, image)?.attributes.id).toBe('fig-scene');
  const reset = imagePresentationChanges(source, image, '![A better description][scene]', {
    width: '',
    'max-height': '',
    align: 'center',
  });
  const result = EditorState.create({ doc: source })
    .update({ changes: reset })
    .state.doc.toString();
  expect(result).toContain(':::figure[The caption]{id="fig-scene"}');
  expect(result).toContain('![A better description][scene]');
  expect(result).not.toContain('width=');
  expect(inspectMarkdown(result).diagnostics).toEqual([]);
});

it('keeps inline images in prose instead of converting their paragraphs into figures', () => {
  const source = 'An inline ![symbol](/media/symbol.svg) in a sentence.';
  const image = inspectSource(parseMarkdown(source), source).images[0];
  expect(image.block).toBe(false);
  expect(() =>
    imagePresentationChanges(source, image, source.slice(image.from, image.to), {
      width: '320',
      'max-height': '',
      align: 'center',
    }),
  ).toThrow('own Markdown line');
});
