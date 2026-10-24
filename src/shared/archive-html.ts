import {
  archiveHref,
  archivePageLinks,
  type ArchivePage,
  type ArchiveRecord,
  type ArchiveState,
} from './archive.js';
import { t, uiDate, type UiParams } from './i18n.js';
import { escapeHtml as e } from './utils.js';

const ui = (message: string, params?: UiParams) =>
  `data-ui="${e(message)}"${params ? ` data-ui-params="${e(JSON.stringify(params))}"` : ''}`;
const countLabel = (count: number) =>
  `<span ${ui(count === 1 ? '{value0} entry' : '{value0} entries', { value0: count })}>${e(count === 1 ? t('{value0} entry', { value0: count }) : t('{value0} entries', { value0: count }))}</span>`;
const arrow =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>';
function row(entry: ArchiveRecord, labels: { posts: string; lab: string }, edit: boolean) {
  const icon =
    entry.kind === 'posts'
      ? '<path d="M12 7v14m0-14C9 4 5 4 2 5v14c3-1 7-1 10 2 3-3 7-3 10-2V5c-3-1-7-1-10 2Z"/>'
      : '<path d="M9 3h6m-5 0v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 14h8"/>';
  const attrs = edit
    ? `type="button" data-archive-open="${e(entry.id)}" aria-label="${e(t('Edit {value0}', { value0: entry.title }))}"`
    : `href="${e(entry.url)}" data-aca-item="${e(entry.id)}" data-aca-surface="archive"`;
  return `<li class="post-timeline-item" data-timeline-entry data-kind="${entry.kind}"><time datetime="${e(entry.publishedAt)}">${e(entry.publishedAt.slice(8))}</time>
  <${edit ? 'button' : 'a'} class="timeline-entry${entry.cover ? ' has-cover' : ''}" ${attrs}>
    <div class="timeline-entry-content"><div class="timeline-entry-meta"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${icon}</svg><span data-ui-collection="${entry.kind}" data-ui-form="singular" data-ui-source="${e(labels[entry.kind])}">${e(labels[entry.kind])}</span>${entry.tags[0] ? `<span class="timeline-topic">${e(entry.tags[0])}</span>` : ''}</div>
    <h3 lang="${e(entry.lang)}"><span>${e(entry.title)}</span>${arrow}</h3>${entry.summary ? `<p lang="${e(entry.lang)}">${e(entry.summary)}</p>` : ''}</div>
    ${entry.cover ? `<img class="timeline-cover" src="${e(entry.cover)}" sizes="(max-width: 520px) 80px, 160px" alt="" loading="lazy" decoding="async" ${entry.coverWidth && entry.coverHeight ? `width="${entry.coverWidth}" height="${entry.coverHeight}"` : ''}/>` : ''}
  </${edit ? 'button' : 'a'}></li>`;
}
/** Trusted markup with every author-provided value escaped; no React in reader/worker graphs. */
export function archiveTimelineHtml(
  page: ArchivePage,
  labels: { posts: string; lab: string },
  state: ArchiveState,
  edit = false,
) {
  if (!page.total) return '';
  return `<div class="post-timeline editorial-timeline" data-timeline>
    <nav class="timeline-year-rail glass" aria-label="${e(t('Archive years'))}" data-ui-attrs="${e(JSON.stringify({ 'aria-label': 'Archive years' }))}"><span class="eyebrow" data-ui="Years">${e(t('Years'))}</span><span class="timeline-rail-progress" aria-hidden="true"></span><div class="year-rail-track">${page.years.map(({ year, count, page: destination }) => `<a href="${e(archiveHref(destination, state, year))}" data-year-link="${year}" ${page.groups[0]?.year === year ? 'aria-current="location"' : ''}><span>${year}</span><small data-year-count>${count}</small></a>`).join('')}</div></nav>
    <div class="timeline-years">${page.groups.map((group) => `<section class="post-timeline-year" id="archive-year-${group.year}" data-timeline-year data-year="${group.year}"><div class="timeline-year-label"><h2>${group.year}</h2>${countLabel(page.years.find((y) => y.year === group.year)!.count)}</div>${group.months.map((month) => `<section class="timeline-month" data-timeline-month><span class="timeline-month-marker liquid-lens" aria-hidden="true"></span><div class="timeline-month-panel glass-panel"><header class="timeline-month-header"><h3 class="timeline-month-heading" data-archive-month="${month.month}">${e(uiDate(`${month.month}-01T12:00:00Z`, { month: 'long' }))}</h3><span>${month.continued ? `<span class="timeline-continuation" data-ui="Continued">${e(t('Continued'))}</span> · ` : ''}${countLabel(month.count)}</span></header><ol class="post-timeline-list">${month.entries.map((entry) => row(entry, labels, edit)).join('')}</ol></div></section>`).join('')}</section>`).join('')}</div></div>`;
}
export function archivePaginationHtml(page: ArchivePage, state: ArchiveState) {
  if (page.pages <= 1) return '';
  const link = (n: number, label: string, rel?: string) =>
    `<a class="archive-page-link${n === page.page ? ' active' : ''}" href="${e(archiveHref(n, state))}" ${rel ? `rel="${rel}" aria-label="${e(label)}" data-ui-attrs="${e(JSON.stringify({ 'aria-label': rel === 'next' ? 'Next' : 'Previous' }))}" data-ui="${rel === 'next' ? 'Next' : 'Previous'}"` : ''} ${n === page.page ? 'aria-current="page"' : ''}>${e(label)}</a>`;
  return `<nav class="archive-pagination" aria-label="${e(t('Archive pages'))}" data-ui-attrs="${e(JSON.stringify({ 'aria-label': 'Archive pages' }))}"><span class="archive-page-range" ${ui('{value0}–{value1} of {value2}', { value0: page.start, value1: page.end, value2: page.total })}>${e(t('{value0}–{value1} of {value2}', { value0: page.start, value1: page.end, value2: page.total }))}</span><div class="archive-page-links glass-panel">${page.page > 1 ? link(page.page - 1, t('Previous'), 'prev') : ''}${archivePageLinks(
    page.page,
    page.pages,
  )
    .map((n) =>
      n === null
        ? '<span class="archive-page-gap" aria-hidden="true">…</span>'
        : link(n, String(n)),
    )
    .join('')}${page.page < page.pages ? link(page.page + 1, t('Next'), 'next') : ''}</div></nav>`;
}
