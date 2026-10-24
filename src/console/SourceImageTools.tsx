import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useId, useState } from 'react';
import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Button } from '../shared/ui.js';
import { openImageViewer } from '../shared/image-viewer.js';
import { ErrorBox, Field, MediaPicker, Modal } from './components.js';
import { localSourceImage } from './source-images.js';
import { markdownLabel, safeLinkDestination } from './source-links.js';
import type { SourceImage } from './source-inspection.js';
import { api } from './api.js';
import { imageFigure, imagePresentationChanges } from './source-image-layout.js';
export function SourceImageTools({
  view,
  image,
  source,
  onClose,
}: {
  view: EditorView;
  image: SourceImage;
  source: string;
  onClose: () => void;
}) {
  const widthSuggestions = useId();
  const [figure] = useState(() => imageFigure(source, image));
  const [width, setWidth] = useState(figure?.attributes.width || ''),
    [maxHeight, setMaxHeight] = useState(figure?.attributes['max-height'] || ''),
    [align, setAlign] = useState(figure?.attributes.align || 'center');
  const [alt, setAlt] = useState(image.alt),
    [loaded, setLoaded] = useState(localSourceImage(image.url)),
    [replace, setReplace] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const apply = (url?: string) => {
    try {
      if (view.state.doc.toString() !== source)
        throw new Error('The source changed. Close and reopen image tools before editing.');
      const raw = source.slice(image.from, image.to);
      let close = -1,
        depth = 0;
      for (let i = 1; i < raw.length; i++) {
        if (raw[i] === '\\') {
          i++;
          continue;
        }
        if (raw[i] === '[') depth++;
        if (raw[i] === ']' && --depth === 0) {
          close = i;
          break;
        }
      }
      if (close < 0) throw new Error('The image syntax could not be edited safely.');
      const insert = url
        ? `![${markdownLabel(alt)}](${safeLinkDestination(url)})`
        : `![${markdownLabel(alt)}]${raw.slice(close + 1)}`;
      view.dispatch({
        changes: imagePresentationChanges(source, image, insert, {
          width,
          'max-height': maxHeight,
          align,
        }),
        effects: view.scrollSnapshot(),
        annotations: Transaction.userEvent.of('input.image'),
      });
      onClose();
      requestAnimationFrame(() => view.focus());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={t("Image tools")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}><UiText message={"Cancel"}/></Button>
          <Button variant="primary" icon="Check" onClick={() => apply()}>
            <UiText message={"Save changes"}/></Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="source-image-inspector">
        {loaded ? (
          <img
            src={image.url}
            alt={alt}
            onError={() =>
              setError(
                'The preview could not load. You can still replace the image or copy its path.',
              )
            }
          />
        ) : (
          <Button icon="Image" onClick={() => setLoaded(true)}>
            <UiText message={"Load external image"}/></Button>
        )}
      </div>
      {!localSourceImage(image.url) && (
        <p className="help" data-ui={"External previews load only when you choose to open them."}>{t("External previews load only when you choose to open them.")}</p>
      )}
      <Field
        label={t("Image description")}
        help={t("Describe what matters in the image; do not invent details.")}
      >
        <input value={alt} onChange={(e) => setAlt(e.target.value)} />
      </Field>
      <Field label={t("Image path")}>
        <input readOnly value={image.url} />
      </Field>
      <div className="field-row">
        <Field
          label={t("Display width")}
          help={t("Optional: 480 pixels or 60%. Always fits the reading column.")}
        >
          <input
            value={width}
            onChange={(event) => setWidth(event.target.value)}
            placeholder={t("Automatic")}
            list={widthSuggestions}
            disabled={!image.block}
           data-ui-attrs={"{\"placeholder\":\"Automatic\"}"} />
          <datalist id={widthSuggestions}>
            <option value="320" />
            <option value="480" />
            <option value="640" />
            <option value="80%" />
            <option value="100%" />
          </datalist>
        </Field>
        <Field
          label={t("Maximum height")}
          help={t("Optional pixel cap; keeps the complete image without cropping.")}
        >
          <input
            type="number"
            min="64"
            max="2400"
            step="1"
            value={maxHeight}
            onChange={(event) => setMaxHeight(event.target.value)}
            placeholder={t("Automatic")}
            disabled={!image.block}
           data-ui-attrs={"{\"placeholder\":\"Automatic\"}"} />
        </Field>
      </div>
      <Field label={t("Image alignment")}>
        <select
          value={align}
          onChange={(event) => setAlign(event.target.value)}
          disabled={!image.block}
        >
          <option value="left" data-ui={"Left"}>{t("Left")}</option>
          <option value="center" data-ui={"Center"}>{t("Center")}</option>
          <option value="right" data-ui={"Right"}>{t("Right")}</option>
        </select>
      </Field>
      <p className="help">
        <UiText message={"Display settings stay in Markdown figure metadata. The viewer and downloads keep the full image."}/>{!image.block && ' Move this inline image to its own paragraph to set its display size.'}
      </p>
      <div className="toolbar-group">
        <Button
          icon="Expand"
          onClick={(e) =>
            void openImageViewer(
              [
                {
                  src: image.url,
                  alt,
                  loadDetails: localSourceImage(image.url)
                    ? (signal) =>
                        api('media/details?url=' + encodeURIComponent(image.url), { signal })
                    : undefined,
                },
              ],
              0,
              e.currentTarget,
            )
          }
        >
          <UiText message={"View image"}/></Button>
        <Button icon="Image" onClick={() => setReplace(true)}>
          <UiText message={"Replace image"}/></Button>
        <Button
          icon="Copy"
          onClick={() =>
            void Promise.resolve()
              .then(() => navigator.clipboard.writeText(image.url))
              .then(() => setMessage('Image path copied.'))
              .catch(() => setMessage('Select and copy the image path above.'))
          }
        >
          <UiText message={"Copy path"}/></Button>
      </div>
      <p className="help" role="status">
        {message}
      </p>
      {image.reference && (
        <p className="help" data-ui={"Replacing this image changes only this occurrence; its shared reference definition stays intact."}>
          {t("Replacing this image changes only this occurrence; its shared reference definition stays intact.")}</p>
      )}
      {replace && (
        <MediaPicker
          onSelect={(url) => {
            setReplace(false);
            apply(url);
          }}
          onClose={() => setReplace(false)}
        />
      )}
    </Modal>
  );
}
