import { useEffect, useState } from 'react';
import {
  segmentDimensions,
  type AcaSegment,
  type SegmentDimension,
  type SegmentOptions,
  type SavedSegments,
  hasSegment,
  savedSegmentsSchema,
} from '../shared/aca-segments.js';
import { languageOptionLabel } from '../shared/content-languages.js';
import { analyticsColumns } from '../shared/analytics-presentation.js';
import { t, getUiLocale } from '../shared/i18n.js';
import { Button, Icon } from '../shared/ui.js';
import { api, send } from './api.js';
import { Field, Modal, ErrorBox } from './components.js';
function validateSaved(value: { value: unknown; revision: string }) {
  const parsed = savedSegmentsSchema.safeParse(value.value);
  if (!parsed.success || typeof value.revision !== 'string')
    throw new Error(t('Saved segments could not load. Retry.'));
  return { value: parsed.data, revision: value.revision };
}
export function segmentValueLabel(key: SegmentDimension, value: string) {
  if (key === 'language' && value !== 'Unknown') return languageOptionLabel(value);
  if (key === 'country' && /^[A-Z]{2}$/.test(value))
    return new Intl.DisplayNames([getUiLocale()], { type: 'region' }).of(value) || value;
  return t(
    (
      {
        phone: 'Phone',
        tablet: 'Tablet',
        desktop: 'Desktop',
        Unknown: 'Unknown',
        direct: 'Direct',
        '(none)': 'None',
      } as Record<string, string>
    )[value] || value,
  );
}
export function SegmentControls({
  range,
  segment,
  onApply,
  siteId,
  enabled,
}: {
  range: { from: string; to: string; content: string; revision: string };
  segment: AcaSegment;
  onApply: (value: AcaSegment) => void;
  siteId: string;
  enabled: boolean;
}) {
  const [options, setOptions] = useState<SegmentOptions | null>(null),
    [saved, setSaved] = useState<{ value: SavedSegments; revision: string } | null>(null);
  const [error, setError] = useState(''),
    [open, setOpen] = useState(false),
    [draft, setDraft] = useState(segment),
    [dimension, setDimension] = useState<SegmentDimension>('country'),
    [query, setQuery] = useState('');
  const [selected, setSelected] = useState(''),
    [naming, setNaming] = useState<'new' | 'update' | null>(null),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify(range);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ value: SavedSegments; revision: string }>('analytics/segments', {
      signal: controller.signal,
    })
      .then((value) => setSaved(validateSaved(value)))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setOptions(null);
    void api<SegmentOptions>('analytics/segment-options?' + new URLSearchParams(range), {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setOptions(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [key, enabled, retry]);
  const list = saved?.value.segments.filter((item) => item.siteId === siteId) || [];
  const current = list.find((item) => item.id === selected);
  async function persist(value: SavedSegments) {
    if (!saved) return;
    setBusy(true);
    setError('');
    try {
      setSaved(
        validateSaved(await send('analytics/segments', 'PUT', { value, revision: saved.revision })),
      );
      setNaming(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const selectedValues = draft[dimension] || [];
  const candidates = [
    ...new Set([...(options?.options[dimension] || []), ...selectedValues]),
  ].filter((value) =>
    (segmentValueLabel(dimension, value) + ' ' + value).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="aca-segments">
      <div className="aca-segment-toolbar">
        <Button
          icon="SlidersHorizontal"
          className="small"
          disabled={!enabled || loading}
          onClick={() => {
            setDraft(segment);
            setQuery('');
            setOpen(true);
          }}
        >
          {t('Filter audience')}
        </Button>
        <select
          aria-label={t('Saved segments')}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            const item = list.find((s) => s.id === e.target.value);
            onApply(item?.filters || {});
          }}
        >
          <option value="">{t(hasSegment(segment) ? 'Custom segment' : 'Entire audience')}</option>
          {list.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <Button
          icon="Save"
          className="small"
          disabled={!saved || !hasSegment(segment)}
          onClick={() => {
            setName('');
            setNaming('new');
          }}
        >
          {t('Save segment')}
        </Button>
        {current && (
          <>
            <Button
              icon="PenLine"
              className="small"
              disabled={busy}
              onClick={() => {
                setName(current.name);
                setNaming('update');
              }}
            >
              {t('Update segment')}
            </Button>
            <Button
              icon="Trash2"
              className="small"
              disabled={busy}
              onClick={() => {
                void persist({
                  segments: saved!.value.segments.filter((item) => item.id !== current.id),
                }).then((ok) => {
                  if (ok) setSelected('');
                });
              }}
            >
              {t('Delete segment')}
            </Button>
          </>
        )}
        {hasSegment(segment) && (
          <Button
            className="small"
            onClick={() => {
              setSelected('');
              onApply({});
            }}
          >
            {t('Clear filters')}
          </Button>
        )}
      </div>
      {!enabled && (
        <p className="help">{t('Deploy the updated ACA Worker to enable audience segments.')}</p>
      )}
      {loading && (
        <p className="help" role="status">
          {t('Loading segment options…')}
        </p>
      )}
      <div className="aca-segment-chips">
        {segmentDimensions.flatMap((d) =>
          (segment[d] || []).map((value) => (
            <button
              className="aca-segment-chip"
              key={d + value}
              onClick={() => {
                const next = { ...segment };
                const keep = next[d]!.filter((v) => v !== value);
                if (keep.length) next[d] = keep;
                else delete next[d];
                onApply(next);
              }}
              aria-label={t('Remove {filter}', {
                filter: t(analyticsColumns[d]) + ': ' + segmentValueLabel(d, value),
              })}
            >
              {t(analyticsColumns[d])}: {segmentValueLabel(d, value)}
              <Icon name="X" size={12} />
            </button>
          )),
        )}
      </div>
      <ErrorBox error={t(error)} />
      {error && (
        <Button
          className="small"
          onClick={() => {
            setRetry((value) => value + 1);
            void api<{ value: SavedSegments; revision: string }>('analytics/segments')
              .then((value) => setSaved(validateSaved(value)))
              .catch((e) => setError(e.message));
          }}
        >
          {t('Reload saved segments')}
        </Button>
      )}
      {open && (
        <Modal
          title={t('Audience segment')}
          onClose={() => setOpen(false)}
          className="aca-segment-dialog"
          footer={
            <>
              <Button onClick={() => setOpen(false)}>{t('Cancel')}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  onApply(draft);
                  setOpen(false);
                }}
              >
                {t('Apply filters')}
              </Button>
            </>
          }
        >
          <p className="help">
            {t('Match any selected value within each filter, and every selected filter together.')}
          </p>
          <div className="aca-segment-builder">
            <nav aria-label={t('Audience filters')}>
              {segmentDimensions.map((d) => (
                <button
                  type="button"
                  key={d}
                  aria-pressed={dimension === d}
                  onClick={() => {
                    setDimension(d);
                    setQuery('');
                  }}
                >
                  {t(analyticsColumns[d])}
                  <span>{draft[d]?.length || ''}</span>
                </button>
              ))}
            </nav>
            <div className="aca-segment-values">
              <label className="search-field">
                <Icon name="Search" size={14} />
                <input
                  type="search"
                  aria-label={t('Find filter values')}
                  placeholder={t('Find filter values')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="aca-segment-value-list">
                {candidates.map((value) => (
                  <label className="check-row" key={value}>
                    <input
                      type="checkbox"
                      checked={selectedValues.includes(value)}
                      disabled={!selectedValues.includes(value) && selectedValues.length >= 10}
                      onChange={(e) =>
                        setDraft((previous) => {
                          const values = e.target.checked
                            ? [...(previous[dimension] || []), value]
                            : (previous[dimension] || []).filter((v) => v !== value);
                          const next = { ...previous };
                          if (values.length) next[dimension] = values;
                          else delete next[dimension];
                          return next;
                        })
                      }
                    />
                    {segmentValueLabel(dimension, value)}
                  </label>
                ))}
                {!candidates.length && (
                  <p className="help">{t('No observed values for this range.')}</p>
                )}
              </div>
              <p className="help">{t('Select up to 10 values per filter.')}</p>
            </div>
          </div>
        </Modal>
      )}
      {naming && (
        <Modal
          title={t(naming === 'new' ? 'Save segment' : 'Update segment')}
          dismissible={!busy}
          onClose={() => setNaming(null)}
          footer={
            <>
              <Button disabled={busy} onClick={() => setNaming(null)}>
                {t('Cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={busy || !name.trim()}
                onClick={() => {
                  const id = naming === 'update' ? current!.id : crypto.randomUUID();
                  void persist({
                    segments: [
                      ...saved!.value.segments.filter((item) => item.id !== id),
                      { id, name: name.trim(), siteId, filters: segment },
                    ],
                  }).then((ok) => {
                    if (ok) setSelected(id);
                  });
                }}
              >
                {t('Save')}
              </Button>
            </>
          }
        >
          <Field label={t('Segment name')}>
            <input
              autoFocus
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <ErrorBox error={t(error)} />
        </Modal>
      )}
    </div>
  );
}
