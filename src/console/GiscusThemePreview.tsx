import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useState } from 'react';
import type { SiteConfig } from '../shared/contracts.js';
import { api } from './api.js';
import { Modal, ErrorBox } from './components.js';
import { Button } from '../shared/ui.js';
import './giscus-preview.css';

export function GiscusThemePreview({
  theme,
  onClose,
}: {
  theme: SiteConfig['theme'];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'light' | 'dark'>(
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  const [html, setHtml] = useState(''),
    [frameVersion, setFrameVersion] = useState(0),
    [frameLoading, setFrameLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    void api<{ html: string }>('integrations/giscus/theme-preview', {
      method: 'POST',
      body: JSON.stringify({ theme, mode }),
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setFrameLoading(true);
          setFrameVersion((value) => value + 1);
          setHtml(result.html);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError((failure as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [mode, theme, retry]);
  return (
    <Modal
      title={t('Discussion styles')}
      wide
      onClose={onClose}
      className="giscus-style-preview"
      footer={
        <Button onClick={onClose}>
          <UiText message={'Done'} />
        </Button>
      }
    >
      <p
        className="help"
        data-ui={
          'Preview Glass’s comment editor, threads, and reactions in both themes. Sample content stays on this computer; this preview never connects to GitHub.'
        }
      >
        {t(
          'Preview Glass’s comment editor, threads, and reactions in both themes. Sample content stays on this computer; this preview never connects to GitHub.',
        )}
      </p>
      <div className="giscus-preview-actions">
        <div
          role="group"
          aria-label={t('Discussion preview appearance')}
          data-ui-attrs={'{"aria-label":"Discussion preview appearance"}'}
        >
          <Button
            icon="Sun"
            aria-pressed={mode === 'light'}
            onClick={() => {
              if (mode !== 'light') {
                setBusy(true);
                setMode('light');
              }
            }}
          >
            <UiText message={'Light'} />
          </Button>
          <Button
            icon="Moon"
            aria-pressed={mode === 'dark'}
            onClick={() => {
              if (mode !== 'dark') {
                setBusy(true);
                setMode('dark');
              }
            }}
          >
            <UiText message={'Dark'} />
          </Button>
        </div>
        <span className="help" role="status">
          {busy || frameLoading
            ? t('Updating preview…')
            : t('Uses your current appearance settings')}
        </span>
      </div>
      <ErrorBox error={error} />
      {error && (
        <Button onClick={() => setRetry((value) => value + 1)}>
          <UiText message={'Retry preview'} />
        </Button>
      )}
      {html && (
        <iframe
          key={frameVersion}
          className="giscus-style-frame"
          title={t('Discussion style specimen')}
          srcDoc={html}
          sandbox="allow-scripts"
          aria-busy={busy || frameLoading}
          onLoad={() => setFrameLoading(false)}
          data-ui-attrs={'{"title":"Discussion style specimen"}'}
        />
      )}
    </Modal>
  );
}
