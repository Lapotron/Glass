import { useEffect, useState } from 'react';
import { t, uiNumber } from '../shared/i18n.js';
import { Button } from '../shared/ui.js';
import { Field, ErrorBox, ToggleField } from './components.js';
import { api, send, isCloudStudio } from './api.js';
import type { SearchDataset, SearchImportReview } from '../shared/search-console.js';
type Summary = Omit<SearchDataset, 'rows'> & { rowCount: number };
type GoogleStatus = {
  revision: string;
  configured: boolean;
  connected: boolean;
  property: string;
  autoSync: boolean;
  lastSync: string | null;
};

function GoogleSearchConnection({ onSync }: { onSync: () => Promise<unknown> }) {
  const [status, setStatus] = useState<GoogleStatus>();
  const [clientId, setClientId] = useState(''),
    [clientSecret, setClientSecret] = useState('');
  const [properties, setProperties] = useState<string[]>([]),
    [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [removing, setRemoving] = useState(false);
  const refresh = async () => {
    const next = await api<GoogleStatus>('search-console/oauth/status');
    setStatus(next);
    setChoice(next.property);
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (change: Record<string, unknown>) => {
    if (!status) return;
    const next = await send<GoogleStatus>('search-console/oauth/settings', 'PUT', {
      revision: status.revision,
      ...change,
    });
    setStatus(next);
    setChoice(next.property);
  };
  return (
    <div className="settings-card">
      <h3>{t('Connect Google Search Console')}</h3>
      <p className="help">
        {t(
          'Optional read-only access imports finalized daily search reports. Existing CSV reports remain separate.',
        )}
      </p>
      <p className="help">
        {t('Create a Google OAuth web client and add this authorized redirect URI:')}{' '}
        <code>{location.origin}/api/search-console/oauth/callback</code>.{' '}
        <a
          href="https://developers.google.com/identity/protocols/oauth2/web-server"
          target="_blank"
          rel="noreferrer"
        >
          {t('Google setup guide')}
        </a>
      </p>
      <ErrorBox error={error} />
      {message && <p role="status">{message}</p>}
      {status && (
        <>
          <p className="help">
            {t(
              status.connected
                ? 'Google is connected.'
                : status.configured
                  ? 'Client saved; connect Google to continue.'
                  : 'No Google client configured.',
            )}
          </p>
          <div className="field-row">
            <Field label={t('Google OAuth client ID')}>
              <input
                value={clientId}
                autoComplete="off"
                onChange={(e) => setClientId(e.target.value)}
              />
            </Field>
            <Field label={t('Google OAuth client secret')}>
              <input
                type="password"
                value={clientSecret}
                autoComplete="new-password"
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </Field>
          </div>
          <div className="page-actions">
            <Button
              disabled={busy || !clientId || !clientSecret}
              onClick={() =>
                void perform(async () => {
                  await save({ clientId, clientSecret });
                  setClientId('');
                  setClientSecret('');
                  setProperties([]);
                })
              }
            >
              {t('Save Google client')}
            </Button>
            <Button
              disabled={busy || !status.configured}
              onClick={() =>
                void perform(async () => {
                  const result = await send<{ url: string }>(
                    'search-console/oauth/start',
                    'POST',
                    {},
                  );
                  const url = new URL(result.url);
                  if (
                    url.origin !== 'https://accounts.google.com' ||
                    url.pathname !== '/o/oauth2/v2/auth'
                  )
                    throw new Error('Unexpected Google authorization URL.');
                  location.assign(url.href);
                })
              }
            >
              {t(status.connected ? 'Reconnect Google' : 'Connect Google')}
            </Button>
            {status.connected && (
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await save({ disconnect: true });
                    setProperties([]);
                  })
                }
              >
                {t('Disconnect Google')}
              </Button>
            )}
            {status.configured && (
              <Button
                disabled={busy}
                onClick={() => {
                  if (!removing) {
                    setRemoving(true);
                    return;
                  }
                  void perform(async () => {
                    await save({ clearClient: true });
                    setProperties([]);
                    setRemoving(false);
                  });
                }}
              >
                {t(removing ? 'Confirm removal' : 'Remove Google client')}
              </Button>
            )}
          </div>
          {status.connected && (
            <>
              <div className="page-actions">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      setProperties(
                        (await api<{ properties: string[] }>('search-console/oauth/properties'))
                          .properties,
                      );
                    })
                  }
                >
                  {t('Load verified properties')}
                </Button>
              </div>
              <Field label={t('Google property')}>
                <select value={choice} onChange={(e) => setChoice(e.target.value)}>
                  <option value="">{t('Choose a property')}</option>
                  {[...new Set([status.property, ...properties].filter(Boolean))].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="page-actions">
                <Button
                  disabled={busy || !choice || choice === status.property}
                  onClick={() => void perform(() => save({ property: choice }))}
                >
                  {t('Save property')}
                </Button>
                <Button
                  disabled={busy || !status.property}
                  onClick={() =>
                    void perform(async () => {
                      const result = await send<{ rows: number; noData: boolean }>(
                        'search-console/oauth/sync',
                        'POST',
                        {},
                      );
                      await refresh();
                      await onSync();
                      setMessage(
                        t(
                          result.noData
                            ? 'Google returned no finalized data for this period.'
                            : 'Search report refreshed.',
                        ),
                      );
                    })
                  }
                >
                  {t('Sync now')}
                </Button>
              </div>
              <ToggleField
                label={t('Refresh Google data daily')}
                help={t(
                  isCloudStudio()
                    ? 'Runs privately in hosted Studio when enabled.'
                    : 'Runs while local Studio is open.',
                )}
                checked={status.autoSync}
                onChange={(value) => void perform(() => save({ autoSync: value }))}
              />
              {status.lastSync && (
                <p className="help">
                  {t('Last successful sync')}: {new Date(status.lastSync).toLocaleString()}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
export function SearchConsole({ property }: { property: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [datasets, setDatasets] = useState<Summary[]>([]),
    [selected, setSelected] = useState<SearchDataset>(),
    [review, setReview] = useState<SearchImportReview>(),
    [from, setFrom] = useState(new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10)),
    [to, setTo] = useState(today),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState(false),
    [page, setPage] = useState(0);
  const load = () => api<Summary[]>('search-console').then(setDatasets);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const rows = selected?.rows || review?.dataset.rows || [];
  const clicks = rows.reduce((n, r) => n + (r.clicks || 0), 0),
    impressions = rows.reduce((n, r) => n + (r.impressions || 0), 0);
  return (
    <section className="settings-card glass-panel">
      <div className="aca-section-head">
        <div>
          <span className="eyebrow">{t('Imported Google data')}</span>
          <h2>{t('Search performance')}</h2>
        </div>
        <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer">
          {t('Open Search Console')}
        </a>
      </div>
      <p className="help">
        {t(
          'Import one exported performance CSV at a time. Google report dates use Pacific time. Exported dimension tables may be truncated; they are not ACA event totals.',
        )}
      </p>
      <ErrorBox error={error} />
      <GoogleSearchConnection onSync={load} />
      <div className="field-row">
        <Field label={t('Report from')}>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setReview(undefined);
            }}
          />
        </Field>
        <Field label={t('Report to')}>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setReview(undefined);
            }}
          />
        </Field>
        <Field label={t('Performance CSV')}>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (!file) return;
              setBusy(true);
              setError('');
              setReview(undefined);
              try {
                if (file.size > 2000000)
                  throw new Error(t('CSV is too large. Export a smaller report.'));
                setReview(
                  await send<SearchImportReview>('search-console/review', 'POST', {
                    source: await file.text(),
                    name: file.name,
                    property,
                    from,
                    to,
                  }),
                );
                setSelected(undefined);
                setPage(0);
              } catch (failure) {
                setError((failure as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </Field>
      </div>
      {review && (
        <div className="notice">
          <strong>
            {t(review.replaces ? 'Replace the matching imported report?' : 'Review this import')}
          </strong>
          <p>
            {review.dataset.name} · {review.dataset.dimension} · {review.dataset.rows.length}{' '}
            {t('rows')} · {review.dataset.from} — {review.dataset.to}
          </p>
          <Button disabled={busy} onClick={() => setReview(undefined)}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={busy}
            icon="Check"
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const result = await send<SearchDataset>('search-console/import', 'POST', {
                  id: review.id,
                });
                setSelected(result);
                setReview(undefined);
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('Confirm import')}
          </Button>
        </div>
      )}
      {!!datasets.length && (
        <Field label={t('Imported reports')}>
          <select
            value={selected?.id || ''}
            onChange={async (e) => {
              if (!e.target.value) {
                setSelected(undefined);
                return;
              }
              setError('');
              try {
                setSelected(await api<SearchDataset>('search-console/' + e.target.value));
                setReview(undefined);
                setRemove(false);
                setPage(0);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <option value="">{t('Choose a report')}</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.from} — {d.to}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!!rows.length && (
        <>
          <p>
            <strong>{uiNumber(clicks)}</strong> {t('Search clicks')} ·{' '}
            <strong>{uiNumber(impressions)}</strong> {t('Search impressions')} ·{' '}
            {impressions
              ? uiNumber((clicks / impressions) * 100, { maximumFractionDigits: 2 }) + '%'
              : '—'}{' '}
            {t('Search CTR')}
          </p>
          {(selected || review?.dataset)?.partial && (
            <p className="help">
              {t('Totals describe imported rows only; this is a partial dimension export.')}
            </p>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    t('Dimension'),
                    t('Clicks'),
                    t('Impressions'),
                    t('Search CTR'),
                    t('Average position'),
                  ].map((h) => (
                    <th key={h}>{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(page * 25, page * 25 + 25).map((r, i) => (
                  <tr key={i}>
                    <td style={{ overflowWrap: 'anywhere', maxWidth: 400 }}>{r.label}</td>
                    <td>{r.clicks ?? '—'}</td>
                    <td>{r.impressions ?? '—'}</td>
                    <td>
                      {r.ctr === null ? '—' : uiNumber(r.ctr, { maximumFractionDigits: 2 }) + '%'}
                    </td>
                    <td>
                      {r.position === null
                        ? '—'
                        : uiNumber(r.position, { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="page-actions">
            <Button className="small" disabled={!page} onClick={() => setPage((p) => p - 1)}>
              {t('Previous')}
            </Button>
            <span>
              {page + 1} / {Math.ceil(rows.length / 25)}
            </span>
            <Button
              className="small"
              disabled={(page + 1) * 25 >= rows.length}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('Next')}
            </Button>
            {selected && (
              <Button
                className="small"
                icon="Trash2"
                disabled={busy}
                onClick={async () => {
                  if (!remove) {
                    setRemove(true);
                    return;
                  }
                  setBusy(true);
                  try {
                    await send('search-console/' + selected.id, 'DELETE', {
                      revision: selected.revision,
                    });
                    setSelected(undefined);
                    setRemove(false);
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t(remove ? 'Confirm removal' : 'Remove imported report')}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
