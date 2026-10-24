import { t } from '../shared/i18n.js';
import { parseMarkdown } from '../shared/markdown-analysis.js';
import { imageLayout } from '../shared/image-layout.js';
import type { SourceImage } from './source-inspection.js';

export function imageFigure(source: string, image: Pick<SourceImage, 'from' | 'to'>) {
  let found:
    { from: number; to: number; stem: string; attributes: Record<string, string> } | undefined;
  const walk = (node: any) => {
    if (
      node.type === 'containerDirective' &&
      node.name === 'figure' &&
      node.position.start.offset < image.from &&
      node.position.end.offset > image.to
    ) {
      let count = 0;
      const countImages = (child: any) => {
        if (child.type === 'image' || child.type === 'imageReference') count++;
        child.children?.forEach(countImages);
      };
      countImages(node);
      if (count === 1) {
        const from = node.position.start.offset,
          newline = source.indexOf('\n', from),
          to = newline < 0 ? source.length : newline;
        const header = source.slice(from, to);
        let end = /^:{3,}figure/.exec(header)![0].length;
        if (header[end] === '[') {
          let depth = 1;
          while (++end < header.length && depth) {
            if (header[end] === '\\') end++;
            else if (header[end] === '[') depth++;
            else if (header[end] === ']') depth--;
          }
        }
        found = { from, to, stem: header.slice(0, end), attributes: node.attributes || {} };
      }
    }
    node.children?.forEach(walk);
  };
  walk(parseMarkdown(source));
  return found;
}
const quote = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('\n', ' ');
export function imagePresentationChanges(
  source: string,
  image: SourceImage,
  imageSource: string,
  attributes: { width: string; 'max-height': string; align: string },
) {
  const layout = imageLayout(attributes),
    figure = imageFigure(source, image);
  const properties = { ...figure?.attributes };
  for (const key of ['width', 'max-height', 'align']) delete properties[key];
  if (layout.width) properties.width = attributes.width.trim();
  if (layout.maxHeight) properties['max-height'] = attributes['max-height'].trim();
  if (layout.align && (layout.align !== 'center' || layout.width || layout.maxHeight))
    properties.align = layout.align;
  const metadata = Object.entries(properties)
    .map(([key, value]) => `${key}="${quote(value)}"`)
    .join(' ');
  const suffix = metadata ? `{${metadata}}` : '';
  if (figure)
    return [
      { from: figure.from, to: figure.to, insert: figure.stem + suffix },
      { from: image.from, to: image.to, insert: imageSource },
    ].filter((change) => source.slice(change.from, change.to) !== change.insert);
  const sized = !!(layout.width || layout.maxHeight || (layout.align && layout.align !== 'center'));
  if (sized && !image.block)
    throw new Error(
      t("Display sizing needs an image on its own Markdown line. Move this image to a separate paragraph first."),
    );
  return [
    {
      from: image.from,
      to: image.to,
      insert: sized ? `:::figure${suffix}\n${imageSource}\n:::` : imageSource,
    },
  ];
}
