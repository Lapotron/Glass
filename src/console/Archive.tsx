import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useState } from 'react';
import { chronologicalEntries, type PublicEntry } from '../shared/contracts.js';
import { ArchiveTimeline } from '../shared/ArchiveTimeline.js';
import { EmptyState, Icon } from '../shared/ui.js';
import { PageHeading } from './components.js';
import type { CollectionsConfig } from '../shared/collections.js';

export function Archive({
  entries,
  onOpen,
  collections,
}: {
  entries: PublicEntry[];
  onOpen: (entry: PublicEntry) => void;
  collections: CollectionsConfig;
}) {
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const published = chronologicalEntries(entries);
  const filtered = published.filter(
    (entry) =>
      (kind === 'all' || entry.kind === kind) &&
      `${entry.title} ${entry.summary} ${entry.tags.join(' ')}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="studio-page">
      <PageHeading
        eyebrow={t("The archive")}
        title={t("Every page, in its own time.")}
        description={t("A timeline of published {value0} and {value1}. Open an entry to edit its title, date, or content.", {value0: collections.posts.name, value1: collections.lab.name})}
      >
        <a className="button secondary small" href="/archive/" target="_blank" rel="noreferrer">
          <UiText message={"Visit archive"}/><Icon name="ArrowUpRight" size={14} />
        </a>
      </PageHeading>
      <div className="timeline-controls">
        <div className="timeline-filters" role="group" aria-label={t("Filter archive by kind")} data-ui-attrs={"{\"aria-label\":\"Filter archive by kind\"}"} >
          {(
            [
              ['all', 'All entries'],
              ['posts', collections.posts.name],
              ['lab', collections.lab.name],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={`chip${kind === value ? ' active' : ''}`}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="archive-search">
          <Icon name="Search" size={15} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Find a page…")}
            aria-label={t("Filter archive")}
           data-ui-attrs={"{\"placeholder\":\"Find a page…\",\"aria-label\":\"Filter archive\"}"} />
        </div>
      </div>
      <p className="timeline-count" aria-live="polite">
        {filtered.length} <UiText message={" published "}/>{filtered.length === 1 ? t("entry") : t("entries")}
      </p>
      <ArchiveTimeline entries={filtered} onOpen={onOpen} collections={collections} />
      {!filtered.length && (
        <EmptyState
          icon="BookOpen"
          title={published.length ? t("No pages match") : t("Your timeline starts here")}
        >
          {published.length
            ? t("Try another word or kind.")
            : t("Publish an entry in {value0} or {value1} to start the archive.", {value0: collections.posts.name, value1: collections.lab.name})}
        </EmptyState>
      )}
    </div>
  );
}
