import { archiveTimelineHtml } from './archive-html.js';
import {
  archivePage,
  createArchiveIndex,
  emptyArchiveState,
  filterArchive,
  type ArchivePage,
  type ArchiveState,
} from './archive.js';
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
  page,
  state = emptyArchiveState(),
}: {
  entries: readonly T[];
  compact?: boolean;
  onOpen?: (entry: T) => void;
  collections?: CollectionsConfig;
  page?: ArchivePage;
  state?: ArchiveState;
}) {
  const published = chronologicalEntries(entries);
  if (!compact) {
    const model =
      page ||
      archivePage(
        filterArchive(
          createArchiveIndex(
            published.map((entry) => ({
              id: entry.id,
              title: entry.title,
              summary: entry.summary,
              publishedAt: entry.publishedAt,
              kind: entry.kind,
              lang: entry.lang,
              tags: entry.tags,
              cover: entry.cover,
              url: routeFor(entry, collections),
            })),
          ),
          state,
        ),
      );
    return (
      <div
        onClick={
          onOpen
            ? (event) => {
                const id = (event.target as HTMLElement).closest<HTMLElement>('[data-archive-open]')
                  ?.dataset.archiveOpen;
                const entry = entries.find((entry) => entry.id === id);
                if (entry) onOpen(entry);
              }
            : undefined
        }
        dangerouslySetInnerHTML={{
          __html: archiveTimelineHtml(
            model,
            { posts: collections.posts.singular, lab: collections.lab.singular },
            state,
            !!onOpen,
          ),
        }}
      />
    );
  }
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
                  aria-label={t('Edit {value0}', { value0: entry.title })}
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
    <div className="post-timeline timeline-compact" data-timeline>
      <div className="timeline-years">{list(published)}</div>
    </div>
  );
}
