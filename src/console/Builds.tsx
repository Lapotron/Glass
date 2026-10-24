import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useState } from 'react';
import { type Job, type SiteConfig, type PublicEntry } from '../shared/contracts.js';
import { routesForEntry } from '../shared/collections.js';
import type { SelectedItem } from '../shared/operations.js';
import { formatBytes } from '../shared/media-details.js';
import { Button, Icon, EmptyState } from '../shared/ui.js';
import { send } from './api.js';
import { PageHeading, ErrorBox, JobStatus } from './components.js';
import { BuildProgress } from './BuildProgress.js';
import { elapsedTime } from './build-progress.js';
import {
  BatchDialog,
  PageSelection,
  Pagination,
  SelectionCheck,
  SelectionToolbar,
  downloadUrl,
  useSelection,
} from './Selection.js';
import './build-history.css';

const terminal = (job: Job) => ['succeeded', 'failed'].includes(job.state);
const timestamp = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const title = (job: Job) => (job.action === 'publish' ? 'Build & publish' : 'Static site build');
function saveReport(value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  downloadUrl(url, 'glass-build-history.json');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Builds({
  jobs,
  entries,
  site,
  configured,
  cloud = false,
  onBuild,
  onConnect,
  onRefresh,
  onOpenEntry,
}: {
  jobs: Job[];
  entries: PublicEntry[];
  site: SiteConfig;
  configured: boolean;
  cloud?: boolean;
  onBuild: (action: Job['action']) => Promise<void>;
  onConnect: () => void;
  onRefresh: () => Promise<void>;
  onOpenEntry: (entry: PublicEntry) => void;
}) {
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [action, setAction] = useState('all'),
    [sort, setSort] = useState('newest'),
    [page, setPage] = useState(1),
    [expanded, setExpanded] = useState<Record<string, boolean>>({}),
    [review, setReview] = useState<SelectedItem[] | null>(null),
    [undoId, setUndoId] = useState(''),
    [busy, setBusy] = useState(''),
    [starting, setStarting] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const active = jobs.some((job) => !terminal(job)),
    resetKey = query + '|' + status + '|' + action;
  const selectable = jobs
    .filter((job) => terminal(job) && job.revision)
    .map((job) => ({ ...job, revision: job.revision! }));
  const selection = useSelection(selectable, resetKey);
  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  const matching = jobs
    .filter(
      (job) =>
        (status === 'all' || (status === 'active' ? !terminal(job) : job.state === status)) &&
        (action === 'all' || job.action === action) &&
        [
          job.id,
          title(job),
          job.target?.canonicalUrl,
          job.deployment?.url,
          job.target?.project,
          job.target?.branch,
          job.build?.sourceRevision,
          job.error,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'oldest'
        ? a.startedAt.localeCompare(b.startedAt)
        : b.startedAt.localeCompare(a.startedAt),
    );
  const current = Math.min(page, Math.max(1, Math.ceil(matching.length / 10))),
    shown = matching.slice((current - 1) * 10, current * 10);
  const matchingSelection = selectable.filter((job) => matching.some((item) => item.id === job.id)),
    visibleSelection = matchingSelection.filter((job) => shown.some((item) => item.id === job.id));
  const isOpen = (job: Job) => expanded[job.id] ?? !terminal(job);
  const allOpen = shown.length > 0 && shown.every(isOpen);
  async function task(name: string, operation: () => Promise<void>) {
    setBusy(name);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function copy(value: string, label: string) {
    await task('copy', async () => {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    });
  }
  async function run(kind: Job['action']) {
    setStarting(true);
    try {
      await onBuild(kind);
    } finally {
      setStarting(false);
    }
  }
  async function report(items: SelectedItem[]) {
    await task('report', async () => {
      saveReport(await send('jobs/history/export', 'POST', { items }));
    });
  }
  return (
    <div className="studio-page builds-page">
      <PageHeading
        eyebrow={t('From your desk to the world')}
        title={t('Ready when you are.')}
        description={t(
          'Build, inspect and publish. Every run keeps its own source and destination.',
        )}
      >
        <Button icon="Play" disabled={active || starting} onClick={() => void run('build')}>
          <UiText message={'Build site'} />
        </Button>
        <Button
          variant="primary"
          icon="CloudUpload"
          disabled={active || starting || !configured}
          onClick={() => void run('publish')}
        >
          <UiText message={'Build & Publish'} />
        </Button>
      </PageHeading>
      <section
        className="build-destination glass-panel"
        aria-label={t('Publishing destination')}
        data-ui-attrs={'{"aria-label":"Publishing destination"}'}
      >
        <span className="build-destination-icon">
          <Icon name="LinkIcon" size={22} />
        </span>
        <div className="build-destination-copy">
          <span className="eyebrow" data-ui={'Canonical site · next build'}>
            {t('Canonical site · next build')}
          </span>
          <a href={site.url} target="_blank" rel="noreferrer">
            {site.url}
            <Icon name="ArrowUpRight" size={15} />
          </a>
          <p>
            {cloud
              ? t('Workers Builds')
              : site.cloudflare.projectName || t('Pages project not set')}{' '}
            <span>·</span> {site.cloudflare.productionBranch} <span>·</span>{' '}
            {site.mediaDelivery.mode === 'r2'
              ? t('R2 image delivery')
              : t(cloud ? 'Media included in the reader Worker' : 'Media included in Pages')}
          </p>
        </div>
        <div className="build-destination-actions">
          <Button
            className="small"
            icon="Copy"
            onClick={() => void copy(site.url, 'Canonical URL')}
          >
            <UiText message={'Copy link'} />
          </Button>
          <Button className="small" variant="ghost" icon="Settings2" onClick={onConnect}>
            {configured
              ? t('Publishing settings')
              : t(cloud ? 'Set up Workers Builds' : 'Set up Pages')}
          </Button>
        </div>
      </section>
      {!configured && (
        <p className="build-setup-note">
          <Icon name="Info" size={15} />
          <UiText
            message={
              cloud
                ? 'Connect GitHub and a private reader Deploy Hook in Hosting to enable cloud builds.'
                : 'Add your real site URL, Cloudflare account and Pages project to enable publishing. Local builds are available now.'
            }
          />
        </p>
      )}
      <ErrorBox error={error} />
      {(message || undoId) && (
        <div className="operation-message" role="status">
          <span>{message}</span>
          {undoId && (
            <Button
              className="small"
              icon="Undo2"
              disabled={!!busy}
              onClick={() =>
                void task('undo', async () => {
                  await send(`jobs/history/${undoId}/restore`, 'POST', {});
                  setUndoId('');
                  await onRefresh();
                  setMessage('Build history restored.');
                })
              }
            >
              <UiText message={'Undo removal'} />
            </Button>
          )}
        </div>
      )}
      <section
        className="build-catalog glass-panel"
        aria-label={t('Build history')}
        data-ui-attrs={'{"aria-label":"Build history"}'}
      >
        <div className="build-history-heading">
          <div>
            <h2 data-ui={'Build history'}>{t('Build history')}</h2>
            <p>
              {jobs.length} <UiText message={' recorded '} />
              {jobs.length === 1 ? t('run') : t('runs')}
              <UiText message={'. Artifacts stay private; publication is explicit.'} />
            </p>
          </div>
          <Button
            className="small"
            icon="RotateCcw"
            disabled={!!busy}
            onClick={() => void task('refresh', onRefresh)}
          >
            <UiText message={'Refresh'} />
          </Button>
        </div>
        <div
          className="build-history-counts"
          aria-label={t('History totals')}
          data-ui-attrs={'{"aria-label":"History totals"}'}
        >
          <span>
            <Icon name="CheckCircle2" size={14} />
            {jobs.filter((job) => job.state === 'succeeded').length}{' '}
            <UiText message={' successful'} />
          </span>
          <span>
            <Icon name="AlertCircle" size={14} />
            {jobs.filter((job) => job.state === 'failed').length} <UiText message={' failed'} />
          </span>
          <span>
            <Icon name="Clock3" size={14} />
            {jobs.filter((job) => !terminal(job)).length} <UiText message={' running'} />
          </span>
        </div>
        <div className="build-history-filters">
          <label className="search-field">
            <Icon name="Search" size={16} />
            <input
              type="search"
              aria-label={t('Search build history')}
              placeholder={t('Search runs, URLs or errors…')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              data-ui-attrs={
                '{"aria-label":"Search build history","placeholder":"Search runs, URLs or errors…"}'
              }
            />
          </label>
          <select
            aria-label={t('Filter build status')}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            data-ui-attrs={'{"aria-label":"Filter build status"}'}
          >
            <option value="all" data-ui={'All statuses'}>
              {t('All statuses')}
            </option>
            <option value="succeeded" data-ui={'Successful'}>
              {t('Successful')}
            </option>
            <option value="failed" data-ui={'Failed'}>
              {t('Failed')}
            </option>
            <option value="active" data-ui={'Running'}>
              {t('Running')}
            </option>
          </select>
          <select
            aria-label={t('Filter build action')}
            value={action}
            onChange={(event) => setAction(event.target.value)}
            data-ui-attrs={'{"aria-label":"Filter build action"}'}
          >
            <option value="all" data-ui={'All runs'}>
              {t('All runs')}
            </option>
            <option value="build" data-ui={'Build only'}>
              {t('Build only')}
            </option>
            <option value="publish" data-ui={'Build & publish'}>
              {t('Build & publish')}
            </option>
          </select>
          <select
            aria-label={t('Sort build history')}
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            data-ui-attrs={'{"aria-label":"Sort build history"}'}
          >
            <option value="newest" data-ui={'Newest first'}>
              {t('Newest first')}
            </option>
            <option value="oldest" data-ui={'Oldest first'}>
              {t('Oldest first')}
            </option>
          </select>
        </div>
        <SelectionToolbar selection={selection} matching={matchingSelection}>
          <Button
            className="small"
            icon="Download"
            disabled={!!busy}
            onClick={() => void report(selection.items)}
          >
            <UiText message={'Export reports'} />
          </Button>
          <Button
            className="small"
            icon="Trash2"
            variant="danger"
            disabled={!!busy}
            onClick={() => setReview(selection.items)}
          >
            <UiText message={'Remove from history'} />
          </Button>
        </SelectionToolbar>
        {!!matching.length && (
          <div className="build-history-list-heading">
            <PageSelection selection={selection} items={visibleSelection} />
            <Button
              variant="ghost"
              className="small"
              icon="ChevronDown"
              onClick={() =>
                setExpanded((previous) => ({
                  ...previous,
                  ...Object.fromEntries(shown.map((job) => [job.id, !allOpen])),
                }))
              }
            >
              {allOpen ? t('Collapse page') : t('Expand page')}
            </Button>
          </div>
        )}
        <div className="build-history">
          {shown.map((job) => {
            const sourceRoute = job.error?.match(/^Broken local link on (\S+): /)?.[1];
            const sourceEntry = entries.find((entry) =>
              routesForEntry(entry, site.collections).includes(sourceRoute || ''),
            );
            const open = isOpen(job),
              running = !terminal(job),
              selected = selectable.find((item) => item.id === job.id);
            return (
              <article className="build-job" data-job-id={job.id} key={job.id}>
                <div className="build-job-header">
                  <SelectionCheck
                    label={t('Select job {value0}', { value0: job.id })}
                    checked={selection.has(job.id)}
                    disabled={!selected}
                    onChange={() => selected && selection.toggle(selected)}
                  />
                  <button
                    className="build-job-summary"
                    aria-expanded={open}
                    aria-controls={`job-details-${job.id}`}
                    onClick={() => setExpanded((previous) => ({ ...previous, [job.id]: !open }))}
                  >
                    <span className={`build-icon ${job.state === 'failed' ? 'failed' : ''}`}>
                      <Icon name={job.action === 'publish' ? 'CloudUpload' : 'Layers'} size={19} />
                    </span>
                    <span className="build-job-title">
                      <strong>{title(job)}</strong>
                      <small>
                        <time dateTime={job.startedAt}>{timestamp(job.startedAt)}</time>
                        {job.completedAt && (
                          <> · {elapsedTime(job.startedAt, Date.parse(job.completedAt))}</>
                        )}
                      </small>
                    </span>
                    <JobStatus state={job.state} />
                    <Icon name="ChevronDown" className={open ? 'rotate' : ''} size={15} />
                  </button>
                </div>
                <div className="build-job-facts">
                  <span>
                    <Icon name="Layers" size={13} />
                    {job.build
                      ? t('{value0} pages · {value1} files · {value2}', {
                          value0: job.build.pages,
                          value1: job.build.manifest.length,
                          value2:
                            job.build.totalBytes === undefined
                              ? 'size not recorded'
                              : formatBytes(job.build.totalBytes),
                        })
                      : running
                        ? t('Preparing artifact')
                        : t('No accepted artifact')}
                  </span>
                  <span>
                    {job.action === 'build'
                      ? t('Media in artifact')
                      : job.mediaDelivery === 'r2'
                        ? t(job.target?.project === 'Workers' ? 'R2 + Workers' : 'R2 + Pages')
                        : job.mediaDelivery === 'pages'
                          ? t('Pages media')
                          : t('Media mode not recorded')}
                  </span>
                  {job.target?.project && (
                    <span>
                      {job.target.project} · {job.target.branch}
                    </span>
                  )}
                </div>
                <div className="build-job-links">
                  {job.target?.canonicalUrl ? (
                    <div>
                      <span data-ui={'Canonical'}>{t('Canonical')}</span>
                      <a href={job.target.canonicalUrl} target="_blank" rel="noreferrer">
                        {job.target.canonicalUrl}
                        <Icon name="ArrowUpRight" size={12} />
                      </a>
                      <button
                        className="icon-button"
                        aria-label={t('Copy canonical URL for {value0}', { value0: job.id })}
                        title={t('Copy canonical URL')}
                        onClick={() => void copy(job.target!.canonicalUrl, 'Canonical URL')}
                        data-ui-attrs={'{"title":"Copy canonical URL"}'}
                      >
                        <Icon name="Copy" size={14} />
                      </button>
                    </div>
                  ) : (
                    <p data-ui={'Canonical URL not recorded for this run.'}>
                      {t('Canonical URL not recorded for this run.')}
                    </p>
                  )}
                  <div className="build-job-deployment">
                    <span data-ui={'Deployment'}>{t('Deployment')}</span>
                    {job.deployment ? (
                      <>
                        <a
                          className="deployment-link"
                          href={job.deployment.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {job.deployment.url}
                          <Icon name="ExternalLink" size={12} />
                        </a>
                        <button
                          className="icon-button"
                          aria-label={t('Copy deployment URL for {value0}', { value0: job.id })}
                          title={t('Copy deployment URL')}
                          onClick={() => void copy(job.deployment!.url, 'Deployment URL')}
                          data-ui-attrs={'{"title":"Copy deployment URL"}'}
                        >
                          <Icon name="Copy" size={14} />
                        </button>
                        {job.state !== 'succeeded' && (
                          <small
                            className="build-deployment-unverified"
                            data-ui={'Unverified upload'}
                          >
                            {t('Unverified upload')}
                          </small>
                        )}
                      </>
                    ) : (
                      <small className="build-link-state">
                        {job.action === 'build'
                          ? t('Not published')
                          : running
                            ? t('Pending upload')
                            : t('URL not recorded')}
                      </small>
                    )}
                  </div>
                </div>
                {job.error && (
                  <div className="build-job-error">
                    <Icon name="AlertCircle" size={15} />
                    <div>
                      <p className="job-inline-error">{job.error}</p>
                      {job.deployment && (
                        <p
                          data-ui={
                            'Upload returned a URL. Inspect that deployment before publishing again.'
                          }
                        >
                          {t(
                            'Upload returned a URL. Inspect that deployment before publishing again.',
                          )}
                        </p>
                      )}
                      {job.deployment &&
                        job.failedAt === 'verifying-deployment' &&
                        job.revision && (
                          <Button
                            className="small"
                            variant="ghost"
                            icon="RotateCcw"
                            disabled={active || Boolean(busy)}
                            onClick={() =>
                              void task('recheck', async () => {
                                await send(`jobs/${job.id}/recheck`, 'POST', {
                                  revision: job.revision,
                                });
                                await onRefresh();
                                setMessage(t('Deployment verified. No files were uploaded.'));
                              })
                            }
                          >
                            {t(busy === 'recheck' ? 'Verifying…' : 'Recheck deployment')}
                          </Button>
                        )}
                      {sourceEntry && (
                        <Button
                          className="small"
                          variant="ghost"
                          icon="FileText"
                          onClick={() => onOpenEntry(sourceEntry)}
                        >
                          <UiText message={'Open source article'} />
                        </Button>
                      )}
                      {!sourceRoute && job.action === 'publish' && !job.deployment && (
                        <Button
                          className="small"
                          variant="ghost"
                          icon="ArrowRight"
                          onClick={onConnect}
                        >
                          <UiText message={'Open Pages settings'} />
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {(job.id === jobs[0]?.id || running || open) && <BuildProgress job={job} />}
                <div id={`job-details-${job.id}`} hidden={!open} className="job-details">
                  {open && (
                    <>
                      <dl className="build-detail-grid">
                        <div>
                          <dt data-ui={'Run ID'}>{t('Run ID')}</dt>
                          <dd>
                            <code>{job.id}</code>
                          </dd>
                        </div>
                        <div>
                          <dt data-ui={'Completed'}>{t('Completed')}</dt>
                          <dd>
                            {job.completedAt ? (
                              <time dateTime={job.completedAt}>
                                {new Date(job.completedAt).toLocaleString()}
                              </time>
                            ) : running ? (
                              'In progress'
                            ) : (
                              'Not recorded'
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt data-ui={'Source revision'}>{t('Source revision')}</dt>
                          <dd>
                            {job.build ? (
                              <button
                                className="build-revision"
                                title={t('Copy complete source revision')}
                                onClick={() =>
                                  void copy(job.build!.sourceRevision, 'Source revision')
                                }
                                data-ui-attrs={'{"title":"Copy complete source revision"}'}
                              >
                                <code>{job.build.sourceRevision.slice(0, 16)}</code>
                                <Icon name="Copy" size={12} />
                              </button>
                            ) : (
                              'Not recorded'
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt data-ui={'Published content'}>{t('Published content')}</dt>
                          <dd>
                            {job.build?.contentCounts
                              ? t(
                                  '{value0} {value1} · {value2} {value3} · {value4} media references',
                                  {
                                    value0: job.build.contentCounts.posts,
                                    value1: job.build.collectionNames?.posts || 'writings',
                                    value2: job.build.contentCounts.lab,
                                    value3: job.build.collectionNames?.lab || 'labs',
                                    value4: job.build.contentCounts.media,
                                  },
                                )
                              : t('Counts not recorded')}
                          </dd>
                        </div>
                      </dl>
                      <div className="build-detail-actions">
                        <Button
                          className="small"
                          icon="RotateCcw"
                          disabled={active || starting || (job.action === 'publish' && !configured)}
                          onClick={() => void run(job.action)}
                        >
                          {job.action === 'publish' ? t('Build & publish again') : t('Build again')}
                        </Button>
                        {job.build && (
                          <Button
                            className="small"
                            icon="FolderOpen"
                            disabled={!!busy || !selected}
                            onClick={() =>
                              void task('artifact', async () => {
                                const result = await send<{ url: string }>(
                                  `jobs/${job.id}/artifact`,
                                  'POST',
                                  { revision: job.revision },
                                );
                                downloadUrl(result.url);
                              })
                            }
                          >
                            <UiText message={'Download artifact'} />
                          </Button>
                        )}
                        <a
                          className="button secondary small"
                          href={`/api/jobs/${job.id}/log`}
                          download
                        >
                          <Icon name="Download" size={14} />
                          <UiText message={'Download log'} />
                        </a>
                        <Button
                          className="small"
                          icon="FileText"
                          disabled={!!busy || !selected}
                          onClick={() =>
                            selected &&
                            void report([{ id: selected.id, revision: selected.revision }])
                          }
                        >
                          <UiText message={'Export report'} />
                        </Button>
                        <Button
                          className="small"
                          variant="ghost"
                          icon="Trash2"
                          disabled={!!busy || !selected}
                          onClick={() =>
                            selected &&
                            setReview([{ id: selected.id, revision: selected.revision }])
                          }
                        >
                          <UiText message={'Remove record'} />
                        </Button>
                      </div>
                      <p
                        className="build-repeat-note"
                        data-ui={
                          'Run again uses saved content and current settings. Downloads contain this run’s accepted files.'
                        }
                      >
                        {t(
                          'Run again uses saved content and current settings. Downloads contain this run’s accepted files.',
                        )}
                      </p>
                      {!!job.build?.diagnostics.length && (
                        <ul className="build-diagnostics">
                          {job.build.diagnostics.map((diagnostic, index) => (
                            <li key={index}>
                              <Icon name="Info" size={14} />
                              {diagnostic}
                            </li>
                          ))}
                        </ul>
                      )}
                      {job.build && (
                        <details className="build-manifest">
                          <summary>
                            <Icon name="FolderOpen" size={14} />
                            <UiText message={'Generated files '} />
                            <span>{job.build.manifest.length}</span>
                          </summary>
                          <ul>
                            {job.build.manifest.map((file) => (
                              <li key={file}>
                                <code>{file}</code>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <div className="job-log-heading">
                        <span>
                          <UiText message={'Build log · '} />
                          {job.logs.length} {job.logs.length === 1 ? t('line') : t('lines')}
                        </span>
                        {job.build && (
                          <a href="/" target="_blank" rel="noreferrer">
                            <UiText message={'Current local site'} />
                            <Icon name="ArrowUpRight" size={12} />
                          </a>
                        )}
                      </div>
                      <pre
                        className="job-log"
                        tabIndex={0}
                        aria-label={`Build log for ${job.id}`}
                        aria-live={running ? 'polite' : 'off'}
                      >
                        {job.logs.join('\n') ||
                          (running ? 'Preparing your notebook…' : 'No log lines were recorded.')}
                      </pre>
                    </>
                  )}
                </div>
              </article>
            );
          })}
          {!matching.length && (
            <EmptyState
              icon={jobs.length ? 'Search' : 'Layers'}
              title={jobs.length ? t('No matching runs') : t('The first build is a fresh start')}
            >
              {jobs.length
                ? t('Try another search or reset the filters.')
                : t('Generate the complete website to start your build history.')}
              {jobs.length > 0 && (
                <Button
                  className="small"
                  onClick={() => {
                    setQuery('');
                    setStatus('all');
                    setAction('all');
                  }}
                >
                  <UiText message={'Reset filters'} />
                </Button>
              )}
            </EmptyState>
          )}
        </div>
        <Pagination page={current} total={matching.length} size={10} onPage={setPage} />
      </section>
      {review && (
        <BatchDialog
          title={t('Remove runs from history?')}
          names={review.map((item) => {
            const job = jobs.find((job) => job.id === item.id);
            return job ? `${title(job)} · ${timestamp(job.startedAt)} · ${job.id}` : item.id;
          })}
          destructive
          confirmLabel="Remove from history"
          onClose={() => setReview(null)}
          onConfirm={async () => {
            const result = await send<{ undoId: string; removed: string[] }>(
              'jobs/history/remove',
              'POST',
              { items: review },
            );
            setUndoId(result.undoId);
            selection.clear();
            await onRefresh();
            setMessage(
              `${result.removed.length} ${result.removed.length === 1 ? 'run removed' : 'runs removed'} from history.`,
            );
          }}
        >
          <p
            data-ui={
              'Only local job records are removed. Retained artifacts, source snapshots, notebook files and live deployments are kept. You can undo this removal.'
            }
          >
            {t(
              'Only local job records are removed. Retained artifacts, source snapshots, notebook files and live deployments are kept. You can undo this removal.',
            )}
          </p>
        </BatchDialog>
      )}
    </div>
  );
}
