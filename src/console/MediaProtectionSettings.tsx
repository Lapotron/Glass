import { useEffect, useState } from 'react';
import type { SiteConfig } from '../shared/contracts.js';
import type { MediaProtectionReview, MediaProtectionStatus } from '../shared/media-protection.js';
import { t, uiDate } from '../shared/i18n.js';
import { Button, Icon } from '../shared/ui.js';
import { api, send } from './api.js';
import { Field, ToggleField, ErrorBox } from './components.js';
export function MediaProtectionSettings({
  site,
  onChange,
  save,
}: {
  site: SiteConfig;
  onChange: (value: SiteConfig['mediaProtection']) => void;
  save: () => Promise<void>;
}) {
  const value = site.mediaProtection;
  const [hosts, setHosts] = useState(value.allowedHosts.join('\n')),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [review, setReview] = useState<MediaProtectionReview | null>(null),
    [status, setStatus] = useState<MediaProtectionStatus | null>(null);
  const target = JSON.stringify([site.url, site.cloudflare.accountId, site.mediaDelivery, value]);
  useEffect(() => {
    setReview(null);
  }, [target]);
  useEffect(() => {
    if (
      JSON.stringify(hosts.split(/[\s,]+/).filter(Boolean)) !== JSON.stringify(value.allowedHosts)
    )
      setHosts(value.allowedHosts.join('\n'));
  }, [JSON.stringify(value.allowedHosts)]);
  useEffect(() => {
    const c = new AbortController();
    void api<MediaProtectionStatus>('cloud-media/protection', { signal: c.signal })
      .then(setStatus)
      .catch(() => {});
    return () => c.abort();
  }, []);
  const update = (patch: Partial<typeof value>) => {
    onChange({ ...value, ...patch });
    setReview(null);
    setStatus(null);
  };
  return (
    <section className="media-protection-settings">
      <div className="settings-card-heading">
        <Icon name="LockKeyhole" />
        <h2>{t('Asset protection')}</h2>
      </div>
      <ToggleField
        label={t('Discourage asset indexing')}
        checked={value.discourageIndexing}
        onChange={(discourageIndexing) => update({ discourageIndexing })}
        help={t(
          'Ask search engines not to index media and asset files. Articles remain searchable.',
        )}
      />
      <ToggleField
        label={t('Block foreign media embeds')}
        checked={value.blockForeignEmbeds}
        onChange={(blockForeignEmbeds) => update({ blockForeignEmbeds })}
        help={t(
          'Optional: block embedding from other sites on media paths, including WebP and AVIF. Direct links remain public.',
        )}
      />
      {value.blockForeignEmbeds && (
        <Field
          label={t('Trusted embedding hosts')}
          help={t(
            'Your site and media domain are included. Add hostnames without a scheme or path, one per line.',
          )}
        >
          <textarea
            rows={3}
            value={hosts}
            onChange={(e) => {
              setHosts(e.target.value);
              update({ allowedHosts: e.target.value.split(/[\s,]+/).filter(Boolean) });
            }}
          />
        </Field>
      )}
      <p className="help">
        {t(
          'Public files remain downloadable by anyone who knows the URL. These controls reduce discovery and unwanted embedding.',
        )}
      </p>
      <p className="help">
        {t(
          'Build and publish for Pages headers. Apply Cloudflare rules separately for CDN headers and optional embed blocking.',
        )}
      </p>
      <div className="media-naming-actions">
        <Button
          icon={busy ? 'LoaderCircle' : 'CheckCircle2'}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await save();
              setReview(await send('cloud-media/protection/check', 'POST', {}));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('Check Cloudflare protection')}
        </Button>
        {review && (
          <Button
            variant="primary"
            icon="CloudUpload"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                setStatus(
                  await send('cloud-media/protection/apply', 'POST', {
                    id: review.id,
                    revision: review.revision,
                  }),
                );
                setReview(null);
              } catch (e) {
                setError((e as Error).message);
                setReview(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t(review.changes.length ? 'Apply scoped rules' : 'Verify saved rules')}
          </Button>
        )}
      </div>
      {review && (
        <div className="connection-card">
          <Icon name="Info" size={20} />
          <div>
            <strong>{t('Cloudflare protection review')}</strong>
            <p>
              {t('{count} scoped rule changes. Existing unrelated rules are preserved.', {
                count: review.changes.length,
              })}
            </p>
            <ul>
              {review.changes.map((change) => (
                <li key={change.zone + change.phase}>
                  {t(
                    change.phase === 'http_request_firewall_custom'
                      ? 'Foreign embeds'
                      : 'Asset indexing',
                  )}{' '}
                  · {t(change.enabled ? 'Enabled' : 'Disabled')} ·{' '}
                  <code>{change.zone.slice(0, 8)}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {status && (
        <p className="help" role="status">
          {status.current
            ? t('Cloudflare protection verified at {time}.', {
                time: uiDate(status.appliedAt, { dateStyle: 'medium', timeStyle: 'short' }),
              })
            : t('Cloudflare protection has not been verified for these saved settings.')}
        </p>
      )}
      <ErrorBox error={error} />
    </section>
  );
}
