import { t } from '../shared/i18n.js';
import { useState } from 'react';
import { homePinLimit, type PublicEntry, type SiteConfig } from '../shared/contracts.js';
import { Icon } from '../shared/ui.js';
import { Field } from './components.js';

export function HomePins({
  site,
  entries,
  onChange,
}: {
  site: SiteConfig;
  entries: PublicEntry[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const pinned = site.home.pinned;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const available = entries
    .filter(
      (entry) =>
        !pinned.includes(entry.id) &&
        `${entry.title} ${entry.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const full = pinned.length >= homePinLimit;
  function move(index: number, direction: number) {
    const next = [...pinned];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  }
  return (
    <section className="settings-card glass-panel home-pins">
      <div className="settings-card-heading">
        <Icon name="Pin" />
        <h2 data-ui={"Pinned writing"}>{t("Pinned writing")}</h2>
        <span className="home-pin-count">
          {pinned.length} / {homePinLimit}
        </span>
      </div>
      <p className="help" data-ui={"Choose entries to keep above recent writing, in the order shown."}>{t("Choose entries to keep above recent writing, in the order shown.")}</p>
      <div className="search-field home-pin-search">
        <Icon name="Search" size={16} />
        <input
          type="search"
          aria-label={t("Search entries to pin")}
          placeholder={t("Search titles or topics…")}
          value={query}
          disabled={full}
          onChange={(event) => setQuery(event.target.value)}
         data-ui-attrs={"{\"aria-label\":\"Search entries to pin\",\"placeholder\":\"Search titles or topics…\"}"} />
      </div>
      <Field label={t("Choose an entry to pin")}>
        <select
          value=""
          disabled={full || !available.length}
          onChange={(event) => {
            if (event.target.value && !full) {
              onChange([...pinned, event.target.value]);
              setQuery('');
            }
          }}
        >
          <option value="">
            {full
              ? t("All pin slots are used")
              : available.length
                ? t("Choose an entry…")
                : t("No matching entries")}
          </option>
          {(['posts', 'lab'] as const).map((kind) => {
            const source = available.filter((entry) => entry.kind === kind);
            return source.length ? (
              <optgroup key={kind} label={site.collections[kind].name}>
                {source.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                    {entry.status !== 'published' ? t(" ({value0})", {value0: entry.status}) : ''}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </Field>
      {pinned.length ? (
        <ol className="home-pin-list" aria-label={t("Pinned homepage entries")} data-ui-attrs={"{\"aria-label\":\"Pinned homepage entries\"}"} >
          {pinned.map((id, index) => {
            const entry = byId.get(id);
            const title = entry?.title || 'Unavailable entry';
            return (
              <li key={id} className="home-pin-row" data-home-pin-id={id}>
                <span className="home-pin-order">{String(index + 1).padStart(2, '0')}</span>
                <div className="home-pin-copy">
                  <strong>{title}</strong>
                  {entry && (
                    <span>
                      <Icon name={entry.kind === 'posts' ? 'BookOpen' : 'FlaskConical'} size={12} />
                      {site.collections[entry.kind].singular} · {entry.status}
                    </span>
                  )}
                  {entry?.status !== 'published' && (
                    <small>
                      {entry
                        ? t("Appears after publication.")
                        : t("Restore the entry or remove this pin.")}
                    </small>
                  )}
                </div>
                <div className="home-pin-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("Move {value0} up", {value0: title})}
                    title={t("Move up")}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                   data-ui-attrs={"{\"title\":\"Move up\"}"} >
                    <Icon name="ArrowUp" size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("Move {value0} down", {value0: title})}
                    title={t("Move down")}
                    disabled={index === pinned.length - 1}
                    onClick={() => move(index, 1)}
                   data-ui-attrs={"{\"title\":\"Move down\"}"} >
                    <Icon name="ArrowDown" size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("Unpin {value0}", {value0: title})}
                    title={t("Unpin")}
                    onClick={() => onChange(pinned.filter((value) => value !== id))}
                   data-ui-attrs={"{\"title\":\"Unpin\"}"} >
                    <Icon name="X" size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="help home-pins-empty" data-ui={"No pinned entries yet."}>{t("No pinned entries yet.")}</p>
      )}
      <p className="help" data-ui={"Published pins can come from either collection. Your recent-entry limit applies to the remaining entries."}>
        {t("Published pins can come from either collection. Your recent-entry limit applies to the remaining entries.")}</p>
    </section>
  );
}
