import { useState } from 'react';
import { t, uiNumber } from '../shared/i18n.js';
import { Button, Icon } from '../shared/ui.js';
import { Modal, ErrorBox } from './components.js';
import { api, send, isCloudStudio } from './api.js';
import type { CloudMediaInventory, CloudMediaReview } from '../shared/cloud-media.js';
export function CloudMedia({ onClose }: { onClose: () => void }) {
  const [inventory, setInventory] = useState<CloudMediaInventory>(),
    [review, setReview] = useState<CloudMediaReview>(),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [filter, setFilter] = useState('all');
  const load = async () => {
    setBusy(true);
    setError('');
    setReview(undefined);
    try {
      setInventory(await api<CloudMediaInventory>('cloud-media'));
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rows =
    inventory?.objects.filter(
      (o) =>
        filter === 'all' ||
        (filter === 'duplicates' && o.duplicate) ||
        (filter === 'eligible' && o.eligible),
    ) || [];
  return (
    <Modal
      title={t('Cloud storage')}
      wide
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('Close')}
          </Button>
          <Button icon="RotateCcw" disabled={busy} onClick={load}>
            {t(busy ? 'Checking…' : 'Scan R2')}
          </Button>
        </>
      }
    >
      <p>
        {t(
          'Inspect content duplicates and storage use. Published URLs and every retained artifact stay protected. Cloud cleanup is separate from publication.',
        )}
      </p>
      {isCloudStudio() && (
        <p className="help">
          {t(
            'Public CDN scans and reviewed cleanup run as explicit pipeline maintenance. They do not build or deploy the site. Ordinary uploads use private storage directly.',
          )}
        </p>
      )}
      <ErrorBox error={error} />
      {notice && <p role="status">{notice}</p>}
      {!inventory && (
        <div className="empty-state">
          <Icon name="CloudUpload" size={32} />
          <p>
            {t(
              'Scan your configured R2 prefix to review objects, duplicates and deployment protection.',
            )}
          </p>
          <a href="#settings/media-delivery" onClick={onClose}>
            {t('Media delivery settings')}
          </a>
        </div>
      )}
      {inventory && (
        <>
          <div className="field-row">
            <div>
              <span className="eyebrow">{t('Objects')}</span>
              <h2>{uiNumber(inventory.objects.length)}</h2>
            </div>
            <div>
              <span className="eyebrow">{t('Storage')}</span>
              <h2>{uiNumber(inventory.totalBytes / 1048576, { maximumFractionDigits: 2 })} MiB</h2>
            </div>
            <div>
              <span className="eyebrow">{t('Potential duplicate bytes')}</span>
              <h2>{uiNumber(inventory.duplicateBytes / 1024, { maximumFractionDigits: 1 })} KiB</h2>
            </div>
          </div>
          {!!inventory.blockers.length && (
            <div className="notice">
              <strong>{t('Cleanup needs attention')}</strong>
              <ul>
                {inventory.blockers.map((message) => (
                  <li key={message}>{t(message)}</li>
                ))}
              </ul>
            </div>
          )}
          <Button
            className="small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await send('cloud-media/health', 'POST', {});
                setNotice(t('Sample CDN bytes, immutable caching and GET/HEAD CORS verified.'));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('Check CDN delivery')}
          </Button>
          <label>
            {t('Show objects')}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">{t('All objects')}</option>
              <option value="duplicates">{t('Duplicate content')}</option>
              <option value="eligible">{t('Eligible for cleanup')}</option>
            </select>
          </label>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Select')}</th>
                  <th>{t('Object')}</th>
                  <th>{t('Size')}</th>
                  <th>{t('Protection')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.key}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t('Select {name}', { name: o.key })}
                        disabled={busy || !o.eligible}
                        checked={selected.has(o.key)}
                        onChange={() =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (next.has(o.key)) next.delete(o.key);
                            else next.add(o.key);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>
                      <code style={{ overflowWrap: 'anywhere' }}>{o.key}</code>
                      {o.duplicate && (
                        <span className="status-pill">{t('Matching content hash')}</span>
                      )}
                    </td>
                    <td>{uiNumber(o.bytes / 1024, { maximumFractionDigits: 1 })} KiB</td>
                    <td>{t(o.reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!review ? (
            <Button
              disabled={busy || !selected.size}
              icon="Trash2"
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  setReview(
                    await send<CloudMediaReview>('cloud-media/review', 'POST', {
                      revision: inventory.revision,
                      keys: [...selected],
                    }),
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('Review cloud cleanup')}
            </Button>
          ) : (
            <div className="notice">
              <strong>{t('Remove {count} cloud objects?', { count: review.keys.length })}</strong>
              <p>
                {t(
                  'These objects passed ownership and deployment checks. Removal is permanent; CDN caches may continue serving previously cached bytes.',
                )}
              </p>
              <Button disabled={busy} onClick={() => setReview(undefined)}>
                {t('Cancel')}
              </Button>
              <Button
                disabled={busy}
                icon="Trash2"
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const result = await send<{ deleted: number }>('cloud-media/cleanup', 'POST', {
                      id: review.id,
                      revision: review.revision,
                    });
                    setNotice(t('Removed {count} cloud objects.', { count: result.deleted }));
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('Confirm cloud removal')}
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
