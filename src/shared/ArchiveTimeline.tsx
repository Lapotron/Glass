import { t } from './i18n.js';
import { chronologicalEntries, formatDate, routeFor, type PublicEntry } from './contracts.js';
import { Icon } from './ui.js';
import { defaultCollections, type CollectionsConfig } from './collections.js';

export type TimelineEntry = Pick<
  PublicEntry,
  'id' | 'title' | 'summary' | 'publishedAt' | 'status' | 'kind' | 'slug' | 'tags' | 'lang'
> & { cover?: string };
export function ArchiveTimeline<T extends TimelineEntry>({
  entries,
  compact = false,
  onOpen,
  collections = defaultCollections,
}: {
  entries: readonly T[];
  compact?: boolean;
  onOpen?: (entry: T) => void;
  collections?: CollectionsConfig;
}) {
  const published = chronologicalEntries(entries);
  const years = [...new Set(published.map((e) => e.publishedAt.slice(0, 4)))];
  function list(source: T[]) {
    return (
      <ol className="post-timeline-list">
        {source.map((entry) => {
          const hasCover = !compact && !!entry.cover;
          const className = `timeline-entry${hasCover ? ' has-cover' : ''}`;
          const content = (
            <>
              <div className="timeline-entry-content">
                <div className="timeline-entry-meta">
                  <Icon name={entry.kind === 'posts' ? 'BookOpen' : 'FlaskConical'} size={13} />
                  <span>{collections[entry.kind].singular}</span>
                  {entry.lang === 'zh' && <span>中文</span>}
                  {!compact && entry.tags[0] && (
                    <span className="timeline-topic">{entry.tags[0]}</span>
                  )}
                </div>
                <h3 lang={entry.lang}>
                  {entry.title}
                  <Icon name="ArrowUpRight" size={16} />
                </h3>
                {!compact && entry.summary && <p lang={entry.lang}>{entry.summary}</p>}
              </div>
              {hasCover && (
                <img
                  className="timeline-cover"
                  src={entry.cover}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              )}
            </>
          );
          return (
            <li
              className="post-timeline-item"
              key={entry.id}
              data-timeline-entry
              data-kind={entry.kind}
              data-tags={JSON.stringify(entry.tags)}
              data-search={`${entry.title} ${entry.summary} ${entry.tags.join(' ')}`.toLowerCase()}
            >
              <time dateTime={entry.publishedAt}>
                {compact ? formatDate(entry.publishedAt, true) : entry.publishedAt.slice(8)}
              </time>
              {onOpen ? (
                <button
                  className={className}
                  onClick={() => onOpen(entry)}
                  aria-label={t("Edit {value0}", {value0: entry.title})}
                >
                  {content}
                </button>
              ) : (
                <a
                  className={className}
                  href={routeFor(entry, collections)}
                  data-aca-item={entry.id}
                  data-aca-surface="archive"
                >
                  {content}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    );
  }
  return (
    <div
      className={`post-timeline${compact ? ' timeline-compact' : ' editorial-timeline'}`}
      data-timeline
    >
      {!compact && (
        <nav className="timeline-year-rail" aria-label={t("Archive years")} data-ui-attrs={"{\"aria-label\":\"Archive years\"}"} >
          <span className="eyebrow" data-ui={"Years"}>{t("Years")}</span>
          <div className="year-rail-track">
            {years.map((year) => (
              <a key={year} href={`#archive-year-${year}`} data-year-link={year}>
                <span>{year}</span>
                <small data-year-count>
                  {published.filter((e) => e.publishedAt.startsWith(year)).length}
                </small>
              </a>
            ))}
          </div>
        </nav>
      )}
      <div className="timeline-years">
        {compact
          ? list(published)
          : years.map((year) => {
              const source = published.filter((e) => e.publishedAt.startsWith(year));
              const months = [...new Set(source.map((e) => e.publishedAt.slice(0, 7)))];
              return (
                <section
                  className="post-timeline-year"
                  id={`archive-year-${year}`}
                  data-timeline-year
                  key={year}
                  data-year={year}
                >
                  <div className="timeline-year-label">
                    <h2>{year}</h2>
                    <span>
                      {source.length} {source.length === 1 ? t("entry") : t("entries")}
                    </span>
                  </div>
                  {months.map((month) => (
                    <section className="timeline-month" data-timeline-month key={month}>
                      <h3 className="timeline-month-heading">
                        {new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', {
                          month: 'long',
                          timeZone: 'UTC',
                        })}
                      </h3>
                      {list(source.filter((e) => e.publishedAt.startsWith(month)))}
                    </section>
                  ))}
                </section>
              );
            })}
      </div>
    </div>
  );
}
