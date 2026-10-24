import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useState } from 'react';
import { api, send } from './api.js';
import { Button } from '../shared/ui.js';
import { cameraLabels, type StudioImageDetails } from '../shared/media-details.js';
import { ErrorBox } from './components.js';
export function MediaInformation({ url }: { url: string }) {
  const [details, setDetails] = useState<StudioImageDetails | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [desired, setDesired] = useState(false);
  const load = async (signal?: AbortSignal) => {
    setError('');
    try {
      const value = await api<StudioImageDetails>('media/details?url=' + encodeURIComponent(url), {
        signal,
      });
      setDetails(value);
      setDesired(value.publishCameraExif);
    } catch (error) {
      if (!signal?.aborted) setError((error as Error).message);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    setDetails(null);
    void load(controller.signal);
    return () => controller.abort();
  }, [url]);
  async function save(value: boolean) {
    if (!details) return;
    setDesired(value);
    setBusy(true);
    setError('');
    try {
      const result = await send<{ revision: string }>('media/details', 'PUT', {
        url,
        publishCameraExif: value,
        revision: details.libraryRevision,
      });
      setDetails({ ...details, publishCameraExif: value, libraryRevision: result.revision });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="media-information">
      <h4 data-ui={"Camera information"}>{t("Camera information")}</h4>
      {details ? (
        <>
          <dl className="media-camera-facts">
            {Object.entries(cameraLabels)
              .filter(([key]) => details.camera[key as keyof typeof cameraLabels])
              .map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{details.camera[key as keyof typeof cameraLabels]}</dd>
                </div>
              ))}
          </dl>
          {!Object.keys(details.camera).length && (
            <p className="help" data-ui={"This image has no available camera EXIF."}>{t("This image has no available camera EXIF.")}</p>
          )}
          <label className="toggle-row">
            <span>
              <strong data-ui={"Publish camera EXIF"}>{t("Publish camera EXIF")}</strong>
              <small className="help" data-ui={"Share camera and exposure details after the next build. Location, serial numbers and personal fields remain private."}>
                {t("Share camera and exposure details after the next build. Location, serial numbers and personal fields remain private.")}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={desired}
              disabled={busy || (!desired && !Object.keys(details.camera).length)}
              onChange={(event) => void save(event.target.checked)}
            />
          </label>
          <p className="help" role="status">
            {busy
              ? t("Saving publication choice…")
              : desired !== details.publishCameraExif
                ? t("Your choice is preserved. Reload the latest metadata before retrying.")
                : details.publishCameraExif
                  ? t("Camera details will be included in the next public build.")
                  : t("Camera details stay private.")}
          </p>
        </>
      ) : (
        !error && (
          <p className="help" role="status" data-ui={"Reading image information…"}>
            {t("Reading image information…")}</p>
        )
      )}
      <ErrorBox error={error} />
      {error && (
        <Button icon="RotateCcw" onClick={() => void load()}>
          <UiText message={"Reload metadata"}/></Button>
      )}
    </section>
  );
}
