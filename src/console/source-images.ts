import { t } from '../shared/i18n.js';
import { StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  hoverTooltip,
  type DecorationSet,
} from '@codemirror/view';
import type { SourceImage } from './source-inspection.js';
export const imagePreviewUpdate = StateEffect.define<{
  images: SourceImage[];
  mode: 'both' | 'thumbnails' | 'hover' | 'off';
}>();
export const safeSourceImage = (url: string) =>
  /^\/media\/[^\s\\]+$/.test(url) || /^https?:\/\/[^\s\\]+$/i.test(url);
export const localSourceImage = (url: string) => /^\/media\//.test(url);
type OpenImage = (image: SourceImage) => void;
class ImageWidget extends WidgetType {
  private current: SourceImage;
  get image() {
    return this.current;
  }
  constructor(
    image: SourceImage,
    readonly thumbnail: boolean,
    readonly open: OpenImage,
  ) {
    super();
    this.current = image;
  }
  eq(other: ImageWidget) {
    const same =
      this.image.url === other.image.url &&
      this.image.alt === other.image.alt &&
      this.thumbnail === other.thumbnail;
    if (same) this.current = other.image;
    return same;
  }
  get estimatedHeight() {
    return this.thumbnail ? 160 : -1;
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement(this.thumbnail ? 'div' : 'span');
    wrapper.className = this.thumbnail ? 'source-image-widget' : 'source-image-inline';
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(
      'aria-label',
      t('Image tools: {value0}', { value0: this.image.alt || 'Untitled image' }),
    );
    button.title = t('Preview, replace, or edit this image');
    button.onclick = () => this.open(this.image);
    if (this.thumbnail && localSourceImage(this.image.url)) {
      const img = document.createElement('img');
      img.src = this.image.url;
      img.alt = this.image.alt;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onload = () => view.requestMeasure();
      img.onerror = () => {
        img.remove();
        button.textContent = t('Image unavailable · Open image tools');
        view.requestMeasure();
      };
      button.append(img);
      const caption = document.createElement('span');
      caption.textContent = this.image.alt || 'Add an image description';
      button.append(caption);
    } else button.textContent = this.thumbnail ? t('External image · Click to preview') : '▧';
    wrapper.append(button);
    return wrapper;
  }
  ignoreEvent() {
    return true;
  }
}
export function sourceImageExtensions(open: OpenImage) {
  const field = StateField.define<{
    images: SourceImage[];
    mode: 'both' | 'thumbnails' | 'hover' | 'off';
    decorations: DecorationSet;
  }>({
    create: () => ({ images: [], mode: 'both', decorations: Decoration.none }),
    update(value, transaction) {
      if (
        !transaction.docChanged &&
        !transaction.effects.some((effect) => effect.is(imagePreviewUpdate))
      )
        return value;
      if (transaction.docChanged)
        value = {
          ...value,
          images: value.images
            .filter((image) => !transaction.changes.touchesRange(image.from, image.to))
            .map((image) => ({
              ...image,
              from: transaction.changes.mapPos(image.from),
              to: transaction.changes.mapPos(image.to),
            })),
          decorations: Decoration.none,
        };
      for (const effect of transaction.effects)
        if (effect.is(imagePreviewUpdate)) value = { ...value, ...effect.value };
      const decorations =
        value.mode === 'off'
          ? []
          : value.images
              .filter(
                (image) =>
                  safeSourceImage(image.url) &&
                  image.to <= transaction.newDoc.length &&
                  (value.mode !== 'thumbnails' || image.block),
              )
              .map((image) =>
                Decoration.widget({
                  widget: new ImageWidget(
                    image,
                    (value.mode === 'both' || value.mode === 'thumbnails') && image.block,
                    open,
                  ),
                  side: 1,
                  block: (value.mode === 'both' || value.mode === 'thumbnails') && image.block,
                }).range(image.to),
              );
      return { ...value, decorations: Decoration.set(decorations, true) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
  });
  return [
    field,
    hoverTooltip(
      (view, position) => {
        const state = view.state.field(field);
        if (state.mode === 'off' || state.mode === 'thumbnails') return null;
        const image = state.images.find(
          (image) => position >= image.from && position <= image.to && safeSourceImage(image.url),
        );
        if (!image) return null;
        return {
          pos: image.from,
          end: image.to,
          above: true,
          create: () => {
            const dom = document.createElement('div');
            dom.className = 'source-image-tooltip';
            if (localSourceImage(image.url)) {
              const img = document.createElement('img');
              img.src = image.url;
              img.alt = image.alt;
              img.onload = () => view.requestMeasure();
              dom.append(img);
            }
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = localSourceImage(image.url)
              ? t('Image tools · {value0}', { value0: image.alt || 'Add description' })
              : t('Load external image preview');
            button.onclick = () => open(image);
            dom.append(button);
            return { dom };
          },
        };
      },
      { hoverTime: 350 },
    ),
  ];
}
