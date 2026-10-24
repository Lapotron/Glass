import { useState } from 'react';
import { t, uiDate } from '../shared/i18n.js';
import { Button } from '../shared/ui.js';
import { ErrorBox, Field } from './components.js';
import { api, send } from './api.js';
export function AcaRecovery() {
  const [versions, setVersions] = useState<{ id: string; createdAt: string }[]>([]),
    [version, setVersion] = useState(''),
    [review, setReview] = useState<{ id: string; worker: string; version: string }>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  return (
    <details className="aca-setup-advanced">
      <summary>{t('Service recovery')}</summary>
      <p className="help">
        {t(
          'Worker rollback leaves D1 data unchanged. Only versions verified compatible with this reader protocol, identity policy and database can be restored here. Older versions require the matched-build recovery procedure.',
        )}
      </p>
      <ErrorBox error={error} />
      {notice && <p role="status">{notice}</p>}
      <Button
        className="small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const result = await api<{ versions: typeof versions }>('aca/versions');
            setVersions(result.versions);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('Load Worker versions')}
      </Button>
      {!!versions.length && (
        <Field label={t('Recovery version')}>
          <select
            value={version}
            onChange={(e) => {
              setVersion(e.target.value);
              setReview(undefined);
            }}
          >
            <option value="">{t('Choose a version')}</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.createdAt
                  ? uiDate(v.createdAt, { dateStyle: 'medium', timeStyle: 'short' })
                  : v.id}{' '}
                · {v.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {version && !review && (
        <Button
          className="small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              setReview(await send('aca/rollback/review', 'POST', { version }));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('Review rollback')}
        </Button>
      )}
      {review && (
        <div className="notice">
          <strong>{t('Restore this Worker version?')}</strong>
          <p>
            {review.worker} · {review.version}
          </p>
          <Button className="small" onClick={() => setReview(undefined)} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button
            className="small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await send('aca/rollback', 'POST', { id: review.id });
                setNotice(t('Worker rollback verified. Database contents were unchanged.'));
                setReview(undefined);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('Confirm Worker rollback')}
          </Button>
        </div>
      )}
    </details>
  );
}
