import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button, Icon } from '../shared/ui.js';
import { api, send, type MediaFile, type CloudJobProgress } from './api.js';
import { CloudUploadStatus } from './CloudUploadStatus.js';
import { Modal, Field, ErrorBox } from './components.js';
import type { ImageTransform } from '../engine/media.js';
type Inspection = { width: number; height: number; animated: boolean; preview: string };
type Crop = NonNullable<ImageTransform['crop']>;
export function ImagePreparation({
  files = [],
  source,
  onUploaded,
  onClose,
}: {
  files?: File[];
  source?: MediaFile;
  onUploaded: (file: MediaFile) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0),
    [inspection, setInspection] = useState<Inspection | null>(null),
    [crop, setCrop] = useState<Crop>({ x: 0, y: 0, width: 1, height: 1 }),
    [ratio, setRatio] = useState('free'),
    [size, setSize] = useState({ width: 1, height: 1 }),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [cloudProgress, setCloudProgress] = useState<CloudJobProgress>(),
    [retry, setRetry] = useState(0);
  const file = files[index],
    pdf = file?.type === 'application/pdf';
  const stage = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; crop: Crop; mode: string } | null>(null);
  useEffect(() => {
    setInspection(null);
    setError('');
    setCloudProgress(undefined);
    setRatio('free');
    if (pdf) return;
    const controller = new AbortController();
    setLoading(true);
    const form = new FormData();
    if (file) form.set('file', file);
    const request = source?.sourceId
      ? api<Inspection>(`media/${source.sourceId}/inspect`, { signal: controller.signal, onCloudProgress: setCloudProgress })
      : api<Inspection>('media/inspect', { method: 'POST', body: form, signal: controller.signal, onCloudProgress: setCloudProgress });
    void request
      .then((data) => {
        setInspection(data);
        setCrop({ x: 0, y: 0, width: data.width, height: data.height });
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [index, retry]);
  useEffect(() => {
    const scale = Math.min(1, 2400 / Math.max(crop.width, crop.height));
    setSize({
      width: Math.max(1, Math.round(crop.width * scale)),
      height: Math.max(1, Math.round(crop.height * scale)),
    });
  }, [crop.width, crop.height]);
  function preset(value: string) {
    setRatio(value);
    if (!inspection) return;
    const aspect = value === 'free' ? inspection.width / inspection.height : Number(value);
    const w = Math.min(inspection.width, inspection.height * aspect),
      h = w / aspect;
    setCrop({
      x: Math.round((inspection.width - w) / 2),
      y: Math.round((inspection.height - h) / 2),
      width: Math.max(1, Math.floor(w)),
      height: Math.max(1, Math.floor(h)),
    });
  }
  function bounds(value: Crop): Crop {
    if (!inspection) return value;
    const width = Math.max(1, Math.min(inspection.width, Math.round(value.width))),
      height = Math.max(1, Math.min(inspection.height, Math.round(value.height)));
    return {
      x: Math.max(0, Math.min(inspection.width - width, Math.round(value.x))),
      y: Math.max(0, Math.min(inspection.height - height, Math.round(value.y))),
      width,
      height,
    };
  }
  function pointer(event: PointerEvent<HTMLDivElement>) {
    if (!inspection || inspection.animated || !drag.current) return;
    const box = stage.current!.getBoundingClientRect(),
      d = drag.current;
    const dx = ((event.clientX - d.x) * inspection.width) / box.width,
      dy = ((event.clientY - d.y) * inspection.height) / box.height;
    const next = { ...d.crop };
    if (d.mode === 'move') {
      next.x += dx;
      next.y += dy;
    } else {
      if (d.mode.includes('e')) next.width += dx;
      if (d.mode.includes('s')) next.height += dy;
      if (d.mode.includes('w')) {
        next.x += dx;
        next.width -= dx;
      }
      if (d.mode.includes('n')) {
        next.y += dy;
        next.height -= dy;
      }
      if (ratio !== 'free') {
        const aspect = Number(ratio);
        if (d.mode === 'n' || d.mode === 's') next.width = next.height * aspect;
        else next.height = next.width / aspect;
        if (d.mode.includes('w')) next.x = d.crop.x + d.crop.width - next.width;
        if (d.mode.includes('n')) next.y = d.crop.y + d.crop.height - next.height;
        const scale = Math.min(
          1,
          inspection.width / Math.max(1, next.width),
          inspection.height / Math.max(1, next.height),
        );
        next.width *= scale;
        next.height *= scale;
      }
    }
    setCrop(bounds(next));
  }
  function begin(event: PointerEvent<HTMLDivElement>) {
    if (!inspection || inspection.animated) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      crop: { ...crop },
      mode: (event.target as HTMLElement).dataset.handle || 'move',
    };
  }
  async function upload(skip = false) {
    setBusy(true);
    setError('');
    setCloudProgress(undefined);
    try {
      const transform: ImageTransform =
        skip || pdf ? {} : { ...(inspection?.animated ? {} : { crop }), resize: size };
      let result: MediaFile;
      if (source?.sourceId)
        result = await send<MediaFile>(`media/${source.sourceId}/variants`, 'POST', { transform }, { onCloudProgress: setCloudProgress });
      else {
        const form = new FormData();
        form.set('file', file);
        form.set('transform', JSON.stringify(transform));
        result = await api<MediaFile>('media', { method: 'POST', body: form, onCloudProgress: setCloudProgress });
      }
      onUploaded(result);
      if (index + 1 < files.length) setIndex(index + 1);
      else onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function outputWidth(width: number) {
    const aspect = crop.width / crop.height;
    const scale = Math.min(
      1,
      2400 / Math.max(width, width / aspect),
      crop.width / Math.max(1, width),
    );
    setSize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round((width / aspect) * scale)),
    });
  }
  const ready = pdf || !!inspection;
  return (
    <Modal
      title={source ? t("Edit image") : t("Prepare image")}
      wide
      className="image-preparation"
      dismissible={!busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            <UiText message={"Cancel"}/></Button>
          {!pdf && (
            <Button disabled={busy || !ready} onClick={() => void upload(true)}>
              <UiText message={"Skip editing"}/></Button>
          )}
          <Button
            variant="primary"
            icon={busy ? 'LoaderCircle' : 'Check'}
            disabled={busy || loading || !ready}
            onClick={() => void upload()}
          >
            {busy
              ? t("Uploading…")
              : source
                ? t("Save edited copy")
                : pdf
                  ? t("Upload PDF")
                  : t("Apply & upload")}
          </Button>
        </>
      }
    >
      <div className="upload-review-heading">
        <span>{file?.name || source?.name}</span>
        <small>
          {files.length > 1
            ? t("{value0} of {value1}", {value0: index + 1, value1: files.length})
            : source
              ? t("New copy from the original")
              : t("Original kept privately")}
        </small>
      </div>
      <ErrorBox error={error} />
      <CloudUploadStatus progress={cloudProgress} pending={busy} />
      {error && !inspection && !pdf && (
        <Button icon="RotateCcw" onClick={() => setRetry((r) => r + 1)}>
          <UiText message={"Retry preview"}/></Button>
      )}
      {loading && (
        <p className="preview-loading" role="status">
          <Icon name="LoaderCircle" className="spin" />
          <UiText message={"Preparing image…"}/></p>
      )}
      {pdf && <p className="help" data-ui={"The PDF will be uploaded unchanged."}>{t("The PDF will be uploaded unchanged.")}</p>}
      {inspection && (
        <div className="image-edit-layout">
          <div className="crop-preview-wrap">
            <div
              className="crop-stage"
              ref={stage}
              style={{
                aspectRatio: `${inspection.width}/${inspection.height}`,
                maxWidth: `${(440 * inspection.width) / inspection.height}px`,
              }}
            >
              <img src={inspection.preview} alt={t("Image to crop")} draggable={false}  data-ui-attrs={"{\"alt\":\"Image to crop\"}"} />
              {!inspection.animated && (
                <div
                  className="crop-selection"
                  style={{
                    left: `${(crop.x / inspection.width) * 100}%`,
                    top: `${(crop.y / inspection.height) * 100}%`,
                    width: `${(crop.width / inspection.width) * 100}%`,
                    height: `${(crop.height / inspection.height) * 100}%`,
                  }}
                  onPointerDown={begin}
                  onPointerMove={pointer}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                >
                  <span className="crop-grid" />
                  {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => (
                    <span
                      key={handle}
                      className={`crop-handle handle-${handle}`}
                      data-handle={handle}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="crop-settings">
            <p className="help">
              {inspection.width} × {inspection.height} <UiText message={" pixels"}/>{inspection.animated ? t(" · Animated image, resize only") : ''}
            </p>
            {!inspection.animated && (
              <>
                <Field label={t("Crop ratio")}>
                  <select value={ratio} onChange={(e) => preset(e.target.value)}>
                    <option value="free" data-ui={"Free"}>{t("Free")}</option>
                    <option value="1" data-ui={"Square · 1:1"}>{t("Square · 1:1")}</option>
                    <option value={4 / 3} data-ui={"Landscape · 4:3"}>{t("Landscape · 4:3")}</option>
                    <option value={3 / 2} data-ui={"Photo · 3:2"}>{t("Photo · 3:2")}</option>
                    <option value={16 / 9} data-ui={"Wide · 16:9"}>{t("Wide · 16:9")}</option>
                    <option value={9 / 16} data-ui={"Portrait · 9:16"}>{t("Portrait · 9:16")}</option>
                  </select>
                </Field>
                <div className="crop-numbers">
                  {(['x', 'y', 'width', 'height'] as const).map((key) => (
                    <Field key={key} label={t("Crop {value0}", {value0: key})}>
                      <input
                        type="number"
                        min={key === 'x' || key === 'y' ? 0 : 1}
                        max={key === 'x' || key === 'width' ? inspection.width : inspection.height}
                        value={crop[key]}
                        onChange={(e) => {
                          setRatio('free');
                          setCrop(bounds({ ...crop, [key]: Number(e.target.value) }));
                        }}
                      />
                    </Field>
                  ))}
                </div>
              </>
            )}
            <div className="crop-numbers">
              <Field label={t("Output width")}>
                <input
                  type="number"
                  min="1"
                  max="2400"
                  value={size.width}
                  onChange={(e) => outputWidth(Number(e.target.value))}
                />
              </Field>
              <Field label={t("Output height")}>
                <input
                  type="number"
                  min="1"
                  max="2400"
                  value={size.height}
                  onChange={(e) => outputWidth((Number(e.target.value) * crop.width) / crop.height)}
                />
              </Field>
            </div>
            <p className="help" data-ui={"Output dimensions stay proportional. Edits create a new optimized image."}>
              {t("Output dimensions stay proportional. Edits create a new optimized image.")}</p>
            <Button
              className="small"
              icon="RotateCcw"
              disabled={busy}
              onClick={() => preset('free')}
            >
              <UiText message={"Reset image"}/></Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
