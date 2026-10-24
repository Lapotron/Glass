import { useEffect, useRef } from 'react';
import { Icon } from './ui.js';
import { t, uiAttrs } from './i18n.js';
import type { ArchiveState } from './archive.js';
import type { CollectionsConfig } from './collections.js';

export function ArchiveControls({
  state,
  collections,
  topics,
  onChange,
  onTopicQuery,
}: {
  state: ArchiveState;
  collections: CollectionsConfig;
  topics: { tag: string; count: number }[];
  onChange?: (state: ArchiveState) => void;
  onTopicQuery?: (query: string) => void;
}) {
  const picker = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!onChange) return;
    const outside = (event: MouseEvent) => {
      if (picker.current && !picker.current.contains(event.target as Node))
        picker.current.open = false;
    };
    document.addEventListener('click', outside);
    return () => document.removeEventListener('click', outside);
  }, [onChange]);
  return (
    <div className="timeline-controls glass">
      <div
        className="timeline-filters"
        role="group"
        {...uiAttrs({ 'aria-label': 'Filter archive by kind' })}
      >
        {(['all', 'posts', 'lab'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={`chip${state.kind === kind ? ' active' : ''}`}
            data-timeline-filter={kind}
            aria-pressed={state.kind === kind}
            onClick={() => onChange?.({ ...state, kind })}
          >
            <Icon
              name={kind === 'all' ? 'Archive' : kind === 'posts' ? 'BookOpen' : 'FlaskConical'}
              size={13}
            />
            <span
              {...(kind === 'all'
                ? { 'data-ui': 'All entries' }
                : { 'data-ui-collection': kind, 'data-ui-source': collections[kind].name })}
            >
              {kind === 'all' ? t('All entries') : collections[kind].name}
            </span>
          </button>
        ))}
      </div>
      <div className="archive-search">
        <Icon name="Search" size={15} />
        <input
          type="search"
          {...uiAttrs({ 'aria-label': 'Filter archive', placeholder: 'Find a page…' })}
          data-timeline-search
          value={state.q}
          onChange={(event) => onChange?.({ ...state, q: event.target.value })}
        />
      </div>
      <details
        ref={picker}
        className="archive-topic-picker"
        data-topic-picker
        onToggle={(event) => {
          if (onChange && event.currentTarget.open)
            event.currentTarget.querySelector<HTMLInputElement>('input')?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }
        }}
      >
        <summary>
          <Icon name="Tags" size={14} />
          <span data-topic-label>{state.tag || t('All topics')}</span>
          <Icon name="ChevronDown" size={13} />
        </summary>
        <div className="archive-topic-popover glass-panel" data-liquid-floating>
          <label className="archive-topic-search">
            <Icon name="Search" size={14} />
            <input
              type="search"
              {...uiAttrs({ 'aria-label': 'Search topics', placeholder: 'Search topics' })}
              data-topic-search
              onChange={(event) => onTopicQuery?.(event.target.value)}
            />
          </label>
          <div className="archive-topic-options" data-topic-options>
            <button
              type="button"
              data-timeline-tag=""
              aria-pressed={!state.tag}
              onClick={(event) => {
                onChange?.({ ...state, tag: '' });
                event.currentTarget.closest('details')!.open = false;
              }}
            >
              {t('All topics')}
            </button>
            {topics.map(({ tag, count }) => (
              <button
                type="button"
                key={tag}
                data-timeline-tag={tag}
                aria-pressed={state.tag === tag}
                onClick={(event) => {
                  onChange?.({ ...state, tag });
                  event.currentTarget.closest('details')!.open = false;
                }}
              >
                <span>{tag}</span>
                <small>{count}</small>
              </button>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
