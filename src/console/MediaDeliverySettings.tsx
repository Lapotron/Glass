import { t } from '../shared/i18n.js';
import { useState } from 'react';
import type { SiteConfig } from '../shared/contracts.js';
import { Button, Icon } from '../shared/ui.js';
import { Field, ErrorBox } from './components.js';
import { api } from './api.js';
type Delivery = SiteConfig['mediaDelivery'];
export function MediaDeliverySettings({
  value,
  onChange,
  save,
}: {
  value: Delivery;
  onChange: (value: Delivery) => void;
  save: () => Promise<void>;
}) {
  const [status, setStatus] = useState<{ configured: boolean; missing: string[] } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const update = (patch: Partial<Delivery>) => {
    onChange({ ...value, ...patch });
    setStatus(null);
  };
  return (
    <section className="media-delivery-settings">
      <div className="settings-card-heading">
        <Icon name="Image" />
        <h2 data-ui={"Media delivery"}>{t("Media delivery")}</h2>
      </div>
      <p className="help" data-ui={"Keep standalone builds on Pages, or synchronize published raster images with R2 before deploying the site."}>
        {t("Keep standalone builds on Pages, or synchronize published raster images with R2 before deploying the site.")}</p>
      <Field label={t("Media delivery")}>
        <select
          value={value.mode}
          onChange={(event) => update({ mode: event.target.value as Delivery['mode'] })}
        >
          <option value="pages" data-ui={"Cloudflare Pages"}>{t("Cloudflare Pages")}</option>
          <option value="r2" data-ui={"R2 with a custom media domain"}>{t("R2 with a custom media domain")}</option>
        </select>
      </Field>
      {value.mode === 'r2' && (
        <>
          <div className="field-row">
            <Field label={t("R2 bucket")}>
              <input
                value={value.bucket}
                placeholder={t("notebook-media")}
                onChange={(event) => update({ bucket: event.target.value.trim() })}
               data-ui-attrs={"{\"placeholder\":\"notebook-media\"}"} />
            </Field>
            <Field label={t("Object prefix")}>
              <input
                value={value.prefix}
                onChange={(event) => update({ prefix: event.target.value.trim() })}
              />
            </Field>
          </div>
          <Field
            label={t("Public media origin")}
            help={t("An HTTPS custom domain connected to this bucket, such as https://media.example.com.")}
          >
            <input
              type="url"
              value={value.publicOrigin}
              placeholder="https://media.example.com"
              onChange={(event) => update({ publicOrigin: event.target.value.trim() })}
            />
          </Field>
          <div className="connection-card">
            <Icon name="CheckCircle2" size={24} />
            <div>
              <h3 data-ui={"Credentials stay on this computer"}>{t("Credentials stay on this computer")}</h3>
              <p data-ui={"Save the R2 access key and secret in Private connection credentials above. Use credentials scoped to this bucket. Uploads run during publication."}>
                {t("Save the R2 access key and secret in Private connection credentials above. Use credentials scoped to this bucket. Uploads run during publication.")}</p>
            </div>
          </div>
          <Button
            icon={busy ? 'LoaderCircle' : 'CheckCircle2'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await save();
                setStatus(await api('cloudflare/media'));
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t("Checking…") : t("Check R2 configuration")}
          </Button>
          {status && (
            <p className="help" role="status">
              {status.configured
                ? t("Configuration is available. Bucket access, CDN delivery, checksums and CORS will be verified during publication.")
                : 'Still needed: ' + status.missing.join(', ') + '.'}
            </p>
          )}
          <p className="help" data-ui={"Public images use immutable, versioned URLs. Configure GET/HEAD CORS for browser downloads. Originals remain private; SVGs and PDFs continue through Pages."}>
            {t("Public images use immutable, versioned URLs. Configure GET/HEAD CORS for browser downloads. Originals remain private; SVGs and PDFs continue through Pages.")}</p>
          <ErrorBox error={error} />
        </>
      )}
    </section>
  );
}
