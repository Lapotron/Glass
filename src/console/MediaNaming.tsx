import { useEffect, useState } from 'react';
import { t } from '../shared/i18n.js';
import type { MediaMetadataResponse } from '../shared/media-metadata.js';
import { Button, Icon } from '../shared/ui.js';
import { Field, ErrorBox, CopyButton, ToggleField } from './components.js';
import { api, send } from './api.js';
export function MediaNaming({
  url,
  siteUrl,
  onSaved,
}: {
  url: string;
  siteUrl: string;
  onSaved: (value: MediaMetadataResponse) => void;
}) {
  const [saved, setSaved] = useState<MediaMetadataResponse | null>(null),
    [name, setName] = useState(''),
    [code, setCode] = useState(''),
    [aliases, setAliases] = useState(''),
    [share, setShare] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const install = (value: MediaMetadataResponse) => {
    setSaved(value);
    setName(value.metadata.displayName);
    setCode(value.metadata.shortCode);
    setAliases(value.metadata.shortAliases.join('\n'));
    setShare(value.metadata.publishForSharing);
  };
  const load = async (signal?: AbortSignal) => {
    try {
      const value = await api<MediaMetadataResponse>(
        'media/metadata?url=' + encodeURIComponent(url),
        { signal },
      );
      if (!signal?.aborted) {
        install(value);
        setError('');
      }
    } catch (e) {
      if (!signal?.aborted) setError((e as Error).message);
    }
  };
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [url]);
  const dirty =
    !!saved &&
    (name !== saved.metadata.displayName ||
      code !== saved.metadata.shortCode ||
      aliases !== saved.metadata.shortAliases.join('\n') ||
      share !== saved.metadata.publishForSharing);
  return (
    <section className="media-naming">
      <h4>
        <Icon name="LinkIcon" size={16} />
        {t('Name and sharing')}
      </h4>
      {saved ? (
        <>
          <Field
            label={t('Display name')}
            help={t(
              'A readable name for the library and downloads. Existing file URLs stay the same.',
            )}
          >
            <input value={name} maxLength={180} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            label={t('Media short code')}
            help={t(
              'Use 3–32 lowercase letters, numbers, hyphens or underscores. Previous codes remain aliases.',
            )}
          >
            <input
              value={code}
              maxLength={32}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <details>
            <summary>{t('Previous short links')}</summary>
            <Field
              label={t('Short link aliases')}
              help={t('Up to 10 aliases, one per line or separated by commas.')}
            >
              <textarea rows={2} value={aliases} onChange={(e) => setAliases(e.target.value)} />
            </Field>
          </details>
          <ToggleField
            label={t('Publish for sharing')}
            help={t('Include this file in public builds even when no published page uses it.')}
            checked={share}
            onChange={setShare}
          />
          <p className="help">
            {t(
              'Build and publish to activate changes. Turning sharing off does not remove copies in older deployments.',
            )}
          </p>
          <div className="media-naming-actions">
            <Button
              icon="Save"
              variant="primary"
              disabled={busy || !dirty}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const result = await send<MediaMetadataResponse>('media/metadata', 'PUT', {
                    url,
                    revision: saved.libraryRevision,
                    metadata: {
                      ...saved.metadata,
                      displayName: name,
                      shortCode: code,
                      shortAliases: aliases.split(/[\s,]+/).filter(Boolean),
                      publishForSharing: share,
                    },
                  });
                  install(result);
                  onSaved(result);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t(busy ? 'Saving…' : 'Save media settings')}
            </Button>
            <CopyButton
              value={new URL(saved.shortPath, siteUrl).href}
              label={t('Copy media short link')}
            />
          </div>
          <code className="media-short-url">{new URL(saved.shortPath, siteUrl).href}</code>
          <p className="help">
            {t(
              'Short links are public after a build when this file is referenced publicly or published for sharing.',
            )}
          </p>
        </>
      ) : (
        !error && (
          <p className="help" role="status">
            {t('Loading media settings…')}
          </p>
        )
      )}
      <ErrorBox error={error} />
      {error && (
        <Button className="small" icon="RotateCcw" disabled={busy} onClick={() => void load()}>
          {t('Reload metadata')}
        </Button>
      )}
    </section>
  );
}
