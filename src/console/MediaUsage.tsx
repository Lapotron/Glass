import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useState } from 'react';
import { Button, Icon } from '../shared/ui.js';
import type { MediaReference, MediaUsage } from '../shared/operations.js';
import { ErrorBox } from './components.js';

export function mediaUsageSummary(item?: MediaUsage) {
  if (!item) return 'Checking references…';
  const current =
    item.references?.filter((reference) => reference.scope === 'current').length ||
    item.active.length;
  const history =
    item.references?.filter((reference) => reference.scope === 'history').length ||
    item.history.length;
  return current || history
    ? [
        current ? `${current} current ${current === 1 ? 'use' : 'uses'}` : '',
        history ? `${history} retained` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Unused';
}
export function mediaUsageLocations(item?: MediaUsage) {
  const references = item?.references || [];
  const current = references.filter((reference) => reference.scope === 'current');
  const names = [
    ...new Set((current.length ? current : references).map((reference) => reference.title)),
  ];
  return names.slice(0, 2).join(' · ') + (names.length > 2 ? ` +${names.length - 2} more` : '');
}
export function MediaUsageDetails({
  item,
  loading,
  error,
  incomplete,
  onOpen,
  onRetry,
}: {
  item?: MediaUsage;
  loading: boolean;
  error: string;
  incomplete: boolean;
  onOpen: (reference: MediaReference) => void;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const current = item?.references?.filter((reference) => reference.scope === 'current') || [],
    history = item?.references?.filter((reference) => reference.scope === 'history') || [];
  const rows = (references: MediaReference[]) => (
    <ul className="media-reference-list">
      {references.map((reference) => (
        <li key={reference.id}>
          <Icon
            size={17}
            name={
              ['photo', 'photo-trash', 'album'].includes(reference.kind)
                ? 'Image'
                : reference.kind === 'setting'
                  ? 'Settings2'
                  : 'FileText'
            }
          />
          <div>
            <div className="media-reference-title">
              <button className="text-link" onClick={() => onOpen(reference)}>
                {reference.title}
              </button>
              {reference.status && (
                <span className={'badge ' + (reference.status === 'draft' ? 'draft' : '')}>
                  {reference.status}
                </span>
              )}
              {reference.href && (
                <a
                  className="icon-button"
                  href={reference.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={'Open published page ' + reference.title}
                  title={t("Open published page")}
                 data-ui-attrs={"{\"title\":\"Open published page\"}"} >
                  <Icon name="ArrowUpRight" size={14} />
                </a>
              )}
            </div>
            <p>
              {reference.context}
              {reference.field ? ' · ' + reference.field : ''}
              {reference.line ? ' · Markdown line ' + reference.line : ''}
            </p>
            <code>{reference.source}</code>
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <section
      className="media-reference-details"
      aria-label={t("Media usage details")}
      aria-busy={loading}
     data-ui-attrs={"{\"aria-label\":\"Media usage details\"}"} >
      <div className="media-reference-heading">
        <h4 data-ui={"Where this file is used"}>{t("Where this file is used")}</h4>
        <Button className="small" icon="RotateCcw" disabled={loading} onClick={onRetry}>
          {loading ? t("Checking…") : t("Refresh usage")}
        </Button>
      </div>
      <ErrorBox error={error} />
      {incomplete && (
        <p className="help" data-ui={"Some references could not be verified. Cleanup stays blocked until the usage check succeeds."}>
          {t("Some references could not be verified. Cleanup stays blocked until the usage check succeeds.")}</p>
      )}
      {!item ? (
        <p className="help" role="status">
          {loading
            ? t("Checking current pages and recovery history…")
            : t("Usage information is unavailable. Refresh usage to retry.")}
        </p>
      ) : (
        <>
          <p className="help">
            {mediaUsageSummary(item)}<UiText message={". Current pages and retained recovery data protect this file from deletion."}/></p>
          {current.length > 0 && (
            <>
              <h5><UiText message={"Current uses · "}/>{current.length}</h5>
              {rows(expanded ? current : current.slice(0, 8))}
              {current.length > 8 && (
                <Button className="small" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? t("Show fewer uses") : t("Show all {value0} current uses", {value0: current.length})}
                </Button>
              )}
            </>
          )}
          {history.length > 0 && (
            <details className="media-retained-references">
              <summary><UiText message={"Retained for recovery · "}/>{history.length}</summary>
              <p className="help" data-ui={"Trash, revisions and collection Undo can still restore these references. They are kept locally, even when no current page uses this file."}>
                {t("Trash, revisions and collection Undo can still restore these references. They are kept locally, even when no current page uses this file.")}</p>
              {rows(history)}
            </details>
          )}
          {!current.length &&
            !history.length &&
            (item.active.length || item.history.length ? (
              <ul className="media-usage-list">
                {[...item.active, ...item.history].map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            ) : (
              <p className="help">
                <UiText message={"No current or retained references were found."}/>{!error && !incomplete ? t(" This file can be reviewed for deletion.") : ''}
              </p>
            ))}
          {item.referencesTruncated && (
            <p className="help" data-ui={"Showing up to 300 locations. Additional references remain protected from cleanup."}>
              {t("Showing up to 300 locations. Additional references remain protected from cleanup.")}</p>
          )}
        </>
      )}
    </section>
  );
}
