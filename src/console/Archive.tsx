import { archiveEntry, archiveEntryMetadata } from '../shared/archive-entry.js';
import { watchArchivePosition } from '../shared/archive-position.js';
import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type PublicEntry, type SiteConfig } from '../shared/contracts.js';
import { ArchiveTimeline } from '../shared/ArchiveTimeline.js';
import { ArchiveControls } from '../shared/ArchiveControls.js';
import {
  archivePage,
  archivePageNumber,
  archiveTopics,
  createArchiveIndex,
  emptyArchiveState,
  filterArchive,
  type ArchiveState,
} from '../shared/archive.js';
import { archivePaginationHtml } from '../shared/archive-html.js';
import { EmptyState, Icon } from '../shared/ui.js';
import { PageHeading } from './components.js';

export function Archive({
  entries,
  onOpen,
  site,
}: {
  entries: PublicEntry[];
  onOpen: (entry: PublicEntry) => void;
  site: SiteConfig;
}) {
  const collections = site.collections;
  const surface = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(emptyArchiveState);
  const [number, setNumber] = useState(1);
  const [topicQuery, setTopicQuery] = useState('');
  const index = useMemo(
    () =>
      createArchiveIndex(
        entries
          .filter((entry) => entry.status === 'published')
          .map((entry) => archiveEntryMetadata(entry, collections)),
      ),
    [entries, collections],
  );
  const selection = useMemo(() => filterArchive(index, state), [index, state]);
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  // Count at most one visible page, rather than every private Markdown body.
  const page = useMemo(() => {
    const selected = archivePage(selection, number);
    return {
      ...selected,
      groups: selected.groups.map((group) => ({
        ...group,
        months: group.months.map((month) => ({
          ...month,
          entries: month.entries.map((record) => archiveEntry(byId.get(record.id)!, site)),
        })),
      })),
    };
  }, [selection, number, byId, site]);
  useEffect(() => {
    if (!surface.current) return;
    const tracker = watchArchivePosition(surface.current);
    return tracker.stop;
  }, [page]);
  const visible = page.groups.flatMap((group) =>
    group.months.flatMap((month) => month.entries.map((entry) => byId.get(entry.id)!)),
  );
  const change = (next: ArchiveState) => {
    setState(next);
    setNumber(1);
  };
  return (
    <div
      ref={surface}
      className="studio-page studio-archive"
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
          '.archive-pagination a,[data-year-link]',
        );
        if (!link) return;
        event.preventDefault();
        const url = new URL(link.href);
        setNumber(archivePageNumber(url.pathname));
        requestAnimationFrame(() => {
          const year = url.hash && document.getElementById(url.hash.slice(1));
          (year || document.querySelector('.studio-archive .timeline-count'))?.scrollIntoView({
            block: 'start',
          });
        });
      }}
    >
      <PageHeading
        eyebrow={t('The archive')}
        title={t('Every page, in its own time.')}
        description={t(
          'A timeline of published {value0} and {value1}. Open an entry to edit its title, date, or content.',
          { value0: collections.posts.name, value1: collections.lab.name },
        )}
      >
        <a className="button secondary small" href="/archive/" target="_blank" rel="noreferrer">
          <UiText message="Visit archive" />
          <Icon name="ArrowUpRight" size={14} />
        </a>
      </PageHeading>
      <ArchiveControls
        state={state}
        collections={collections}
        topics={archiveTopics(index, topicQuery)}
        onChange={change}
        onTopicQuery={setTopicQuery}
      />
      <p className="timeline-count" aria-live="polite">
        {t('{value0} published {value1}', {
          value0: page.total,
          value1: page.total === 1 ? t('entry') : t('entries'),
        })}
      </p>
      <ArchiveTimeline
        entries={visible}
        page={page}
        state={state}
        onOpen={onOpen}
        collections={collections}
      />
      <div dangerouslySetInnerHTML={{ __html: archivePaginationHtml(page, state) }} />
      {!page.total && (
        <EmptyState
          icon="BookOpen"
          title={index.records.length ? t('No pages match') : t('Your timeline starts here')}
        >
          {index.records.length
            ? t('Try another word or kind.')
            : t('Publish an entry in {value0} or {value1} to start the archive.', {
                value0: collections.posts.name,
                value1: collections.lab.name,
              })}
        </EmptyState>
      )}
    </div>
  );
}
