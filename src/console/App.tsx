import { collectionLabel } from '../shared/localization.js';
import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { LanguageControl, useUiLocale } from './LanguageControl.js';
import { StudioVersion } from './StudioVersion.js';
const Hosting = lazy(() => import('./Hosting.js').then((m) => ({ default: m.Hosting })));
const Analytics = lazy(() => import('./Analytics.js').then((m) => ({ default: m.Analytics })));
import { emptyProjects } from '../shared/projects.js';
const Projects = lazy(() => import('./Projects.js').then((m) => ({ default: m.Projects })));
import { GuidedSetup } from './GuidedSetup.js';
import { CommandPalette, MaintenanceCards } from './WorkspaceTools.js';
import { ShortLinks } from './ShortLinks.js';
import { TrashList as Trash } from './TrashList.js';
import { EntryList as ContentList } from './EntryList.js';
import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Brand, Button, EmptyState, Icon, themeVariables, type IconName } from '../shared/ui.js';
import {
  formatDate,
  routeFor,
  type PublicEntry,
  type SiteConfig,
  type Library,
  type Job,
} from '../shared/contracts.js';
import { Archive } from './Archive.js';
import { Builds } from './Builds.js';
import { headingSlug } from '../shared/utils.js';
import { collectionIndexRoute } from '../shared/collections.js';
import { api, send, type Bootstrap } from './api.js';
import { Modal, Field, PageHeading, ErrorBox, JobStatus } from './components.js';
const Editor = lazy(() => import('./Editor.js').then((module) => ({ default: module.Editor })));
const Settings = lazy(() =>
  import('./Settings.js').then((module) => ({ default: module.Settings })),
);
const About = lazy(() => import('./About.js').then((module) => ({ default: module.About })));
const HomeSettings = lazy(() =>
  import('./HomeSettings.js').then((module) => ({ default: module.HomeSettings })),
);
const Backups = lazy(() => import('./Backups.js').then((module) => ({ default: module.Backups })));
import { PhotoJournal, MediaLibrary } from './Collections.js';

type View =
  | 'hosting'
  | 'projects'
  | 'analytics'
  | 'overview'
  | 'homepage'
  | 'writing'
  | 'lab'
  | 'about'
  | 'photos'
  | 'archive'
  | 'media'
  | 'appearance'
  | 'settings'
  | 'builds'
  | 'backups'
  | 'shortlinks'
  | 'trash';
const navigation: { group: string; items: { id: View; label: string; icon: IconName }[] }[] = [
  {
    group: 'Your notebook',
    items: [
      { id: 'overview', label: 'Overview', icon: 'Home' },
      { id: 'homepage', label: 'Homepage', icon: 'Layers' },
      { id: 'writing', label: 'Writing', icon: 'BookOpen' },
      { id: 'lab', label: 'Lab', icon: 'FlaskConical' },
      { id: 'about', label: 'About', icon: 'UserRound' },
      { id: 'photos', label: 'Photo journal', icon: 'Image' },
      { id: 'archive', label: 'Archive', icon: 'Archive' },
      { id: 'projects', label: 'Projects', icon: 'Code2' },
    ],
  },
  {
    group: 'Your workspace',
    items: [
      { id: 'analytics', label: 'Analytics', icon: 'ChartNoAxesCombined' },
      { id: 'media', label: 'Media library', icon: 'FolderOpen' },
      { id: 'shortlinks', label: 'Short links', icon: 'LinkIcon' },
      { id: 'appearance', label: 'Appearance', icon: 'Palette' },
      { id: 'settings', label: 'Site settings', icon: 'Settings2' },
      { id: 'builds', label: 'Builds & publish', icon: 'CloudUpload' },
      { id: 'backups', label: 'Backups', icon: 'HardDrive' },
      { id: 'hosting', label: 'Hosting', icon: 'CloudUpload' },
    ],
  },
];
function Overview({
  data,
  navigate,
  open,
  create,
}: {
  data: Bootstrap;
  navigate: (view: View, tab?: string) => void;
  open: (entry: PublicEntry) => void;
  create: (kind: 'posts' | 'lab') => void;
}) {
  const published = data.entries.filter((e) => e.status === 'published'),
    drafts = data.entries.filter((e) => e.status === 'draft');
  const stats: { label: string; value: number; icon: IconName; view: View; note: string }[] = [
    {
      label: `Published ${data.site.collections.posts.name}`,
      value: published.filter((e) => e.kind === 'posts').length,
      icon: 'BookOpen',
      view: 'writing',
      note: `${drafts.filter((e) => e.kind === 'posts').length} draft in progress`,
    },
    {
      label: `Published ${data.site.collections.lab.name}`,
      value: published.filter((e) => e.kind === 'lab').length,
      icon: 'FlaskConical',
      view: 'lab',
      note: `${drafts.filter((e) => e.kind === 'lab').length} draft in progress`,
    },
    {
      label: 'Collected moments',
      value: data.library.photos.length,
      icon: 'Image',
      view: 'photos',
      note: `${new Set(data.library.photos.map((p) => p.album)).size} albums in your journal`,
    },
    {
      label: 'Pages in the archive',
      value: published.length,
      icon: 'Layers',
      view: 'archive',
      note: `${data.site.collections.posts.name} & ${data.site.collections.lab.name}`,
    },
  ];
  const ready = data.runtime
    ? !!data.runtime.buildsConfigured && !data.runtime.preview
    : data.site.cloudflare.accountId &&
      data.site.cloudflare.projectName &&
      new URL(data.site.url).hostname !== 'example.com';
  const latest = data.jobs[0];
  return (
    <div className="studio-page overview-page">
      <PageHeading
        eyebrow={t('Your private workspace')}
        title={t('A little room to create.')}
        description={t('Welcome back. Your notebook is right where you left it.')}
      />
      <section className="welcome-card glass-panel">
        <div>
          <span className="eyebrow">
            <span className="status-dot" />
            <UiText message={'Your next good idea starts here'} />
          </span>
          <h2>
            <UiText message={'A thought today.'} />
            <br />
            <UiText message={'Something worth sharing tomorrow.'} />
          </h2>
          <p data-ui={'Write a little. Make something. Follow your curiosity.'}>
            {t('Write a little. Make something. Follow your curiosity.')}
          </p>
          <Button variant="primary" icon="Plus" onClick={() => create('posts')}>
            <UiText message={'Start a new entry'} />
          </Button>
          <a
            className="button ghost"
            href={data.runtime?.siteOrigin || '/'}
            target="_blank"
            rel="noreferrer"
          >
            <UiText message={'Visit your notebook'} />
            <Icon name="ArrowUpRight" size={15} />
          </a>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-orbit orbit-three" />
          <div className="art-book glass">
            <Icon name="BookOpen" size={58} />
            <span data-ui={'one idea at a time'}>{t('one idea at a time')}</span>
          </div>
          <span className="art-spark spark-one">✧</span>
          <span className="art-spark spark-two">✦</span>
          <span className="art-dot" />
        </div>
      </section>
      <GuidedSetup data={data} navigate={navigate} />
      <MaintenanceCards navigate={navigate} />
      <div className="stats-grid">
        {stats.map((item) => (
          <button
            key={t(item.label)}
            className="stat-card glass-panel"
            onClick={() => navigate(item.view)}
          >
            <span className="stat-heading">
              <Icon name={item.icon} size={17} />
              {t(item.label)}
              <Icon name="ArrowUpRight" size={12} />
            </span>
            <strong>{String(item.value).padStart(2, '0')}</strong>
            <span className="stat-note">{t(item.note)}</span>
          </button>
        ))}
      </div>
      <div className="dashboard-columns">
        <section className="dashboard-content glass-panel">
          <div className="panel-title">
            <h2 data-ui={'On your desk'}>{t('On your desk')}</h2>
            <Button
              variant="ghost"
              className="small"
              icon="ArrowRight"
              onClick={() => navigate('writing')}
            >
              <UiText message={'All entries'} />
            </Button>
          </div>
          {[...drafts, ...published].slice(0, 4).map((entry) => (
            <button className="desk-entry" key={entry.id} onClick={() => open(entry)}>
              <span className={`content-type-icon ${entry.kind === 'lab' ? 'lab' : ''}`}>
                <Icon name={entry.kind === 'lab' ? 'FlaskConical' : 'FileText'} size={17} />
              </span>
              <span>
                <strong>{entry.title}</strong>
                <small>
                  {entry.status === 'draft'
                    ? t('A thought in progress')
                    : formatDate(entry.publishedAt, true)}
                </small>
              </span>
              <span className={`badge ${entry.status === 'draft' ? 'draft' : ''}`}>
                {entry.status === 'draft' ? t('Draft') : t('Published')}
              </span>
              <Icon name="ChevronRight" size={14} />
            </button>
          ))}
        </section>
        <section className="publish-card glass-panel">
          <div className="publish-card-icon">
            <Icon name="CloudUpload" size={25} />
          </div>
          <h2>{ready ? t('Ready for the world.') : t('A home for your notebook.')}</h2>
          <p>
            {ready
              ? t('Your next build will publish to {value0}.', {
                  value0: data.runtime ? data.runtime.siteOrigin : data.site.cloudflare.projectName,
                })
              : data.runtime
                ? t('Connect GitHub and Workers Builds in Hosting when you’re ready to publish.')
                : t('Connect a Cloudflare Pages project when you’re ready to share your work.')}
          </p>
          <div className="publish-checklist">
            <span>
              <Icon name="CheckCircle2" size={14} />
              <span>
                {data.runtime ? t('Your source stays private') : t('Your source stays local')}
              </span>
            </span>
            <span>
              <Icon name="CheckCircle2" size={14} />
              <UiText message={'Complete static webpages'} />
            </span>
            <span>
              <Icon name="CheckCircle2" size={14} />
              <UiText message={'Drafts stay private'} />
            </span>
          </div>
          <Button
            className="small"
            icon={ready ? 'ArrowRight' : 'Settings2'}
            onClick={() =>
              navigate(ready ? 'builds' : data.runtime ? 'hosting' : 'settings', 'cloudflare')
            }
          >
            {ready ? t('View builds & publishing') : t('Connect Cloudflare')}
          </Button>
          {latest && (
            <div className="latest-job">
              <span>
                <UiText message={'Latest '} />
                {latest.action === 'publish' ? t('publication') : t('build')}
              </span>
              <JobStatus state={latest.state} />
            </div>
          )}
        </section>
      </div>
      <div className="dashboard-bottom">
        <span>
          <Icon name="FolderOpen" size={14} />
          <span>
            {data.runtime
              ? t('A private cloud notebook. Your writing, wherever you are.')
              : t('A local-first notebook. Your files, your space.')}
          </span>
        </span>
        <button onClick={() => navigate('appearance')}>
          <UiText message={'Make it feel like you'} />
          <Icon name="ArrowRight" size={13} />
        </button>
      </div>
    </div>
  );
}
export function App() {
  useUiLocale();
  const [data, setData] = useState<Bootstrap | null>(null),
    [view, setView] = useState<View>(() => {
      const requested = location.hash.slice(1).split('/')[0].split('?')[0];
      if (requested === 'news') return 'archive';
      return navigation.some((group) => group.items.some((item) => item.id === requested)) ||
        requested === 'trash'
        ? (requested as View)
        : 'overview';
    }),
    [selected, setSelected] = useState<string | null>(null),
    [settingsTab, setSettingsTab] = useState(
      () => location.hash.split('/')[1]?.split('?')[0] || 'general',
    ),
    [trashKind, setTrashKind] = useState('all');
  const [error, setError] = useState(''),
    [saveStatus, setSaveStatus] = useState('All changes saved'),
    [connected, setConnected] = useState(true),
    [sidebar, setSidebar] = useState(false),
    [createKind, setCreateKind] = useState<'posts' | 'lab' | null>(null),
    [title, setTitle] = useState(''),
    [slug, setSlug] = useState(''),
    [slugEdited, setSlugEdited] = useState(false),
    [creating, setCreating] = useState(false),
    [createError, setCreateError] = useState('');
  const [commandsOpen, setCommandsOpen] = useState(false);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        !event.shiftKey &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'k' &&
        !event.altKey &&
        (!document.querySelector('dialog[open]') || commandsOpen)
      ) {
        event.preventDefault();
        setCommandsOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [commandsOpen]);
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const jobUpdates = useRef(new Map<string, number>());
  const cloudPulse = useRef('');
  const removedJobs = useRef(new Set<string>());
  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.key.toLowerCase() !== 's'
      )
        return;
      event.preventDefault();
      void flushRef.current?.().catch((failure) => setError((failure as Error).message));
    };
    document.addEventListener('keydown', save);
    return () => document.removeEventListener('keydown', save);
  }, []);
  const refresh = useCallback(async () => {
    const previousUpdates = new Map(jobUpdates.current);
    try {
      const next = await api<Bootstrap>('bootstrap');
      cloudPulse.current = next.runtime?.pulse || '';
      setData((current) => {
        // A filesystem response can arrive after newer progress on the SSE connection.
        const newer =
          current?.jobs.filter(
            (job) => jobUpdates.current.get(job.id) !== previousUpdates.get(job.id),
          ) || [];
        return {
          ...next,
          jobs: [
            ...newer,
            ...next.jobs.filter(
              (job) => !removedJobs.current.has(job.id) && !newer.some((j) => j.id === job.id),
            ),
          ].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
        };
      });
      setConnected(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!data?.token) return;
    if (data.runtime?.mode === 'cloud') {
      let pending = false,
        disposed = false;
      const poll = async () => {
        if (pending || document.hidden) return;
        pending = true;
        try {
          const value = await api<{ pulse: string }>('cloud/pulse');
          if (!disposed && value.pulse !== cloudPulse.current) {
            await refresh();
            window.dispatchEvent(new Event('studio-filesystem'));
          }
          if (!disposed) setConnected(true);
        } catch {
          if (!disposed) setConnected(false);
        } finally {
          pending = false;
        }
      };
      const timer = setInterval(() => void poll(), 5000);
      document.addEventListener('visibilitychange', poll);
      return () => {
        disposed = true;
        clearInterval(timer);
        document.removeEventListener('visibilitychange', poll);
      };
    }
    const events = new EventSource('/api/events');
    let timeout: ReturnType<typeof setTimeout>;
    events.addEventListener('ready', () => setConnected(true));
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.addEventListener('filesystem', () => {
      window.dispatchEvent(new Event('studio-filesystem'));
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        void refresh();
      }, 350);
    });
    events.addEventListener('job', (event) => {
      const job = JSON.parse((event as MessageEvent).data) as Job;
      if (removedJobs.current.has(job.id)) return;
      jobUpdates.current.set(job.id, (jobUpdates.current.get(job.id) || 0) + 1);
      setData((current) =>
        current
          ? {
              ...current,
              jobs: [job, ...current.jobs.filter((j) => j.id !== job.id)].sort((a, b) =>
                b.startedAt.localeCompare(a.startedAt),
              ),
            }
          : current,
      );
    });
    events.addEventListener('job-history', (event) => {
      const update = JSON.parse((event as MessageEvent).data) as {
        removed: string[];
        restored: Job[];
      };
      update.removed.forEach((id) => removedJobs.current.add(id));
      update.restored.forEach((job) => {
        removedJobs.current.delete(job.id);
        jobUpdates.current.set(job.id, (jobUpdates.current.get(job.id) || 0) + 1);
      });
      setData((current) =>
        current
          ? {
              ...current,
              jobs: [
                ...update.restored,
                ...current.jobs.filter(
                  (job) =>
                    !update.removed.includes(job.id) &&
                    !update.restored.some((restored) => restored.id === job.id),
                ),
              ].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
            }
          : current,
      );
    });
    return () => {
      clearTimeout(timeout);
      events.close();
    };
  }, [data?.token]);
  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(themeVariables(data.site.theme)))
      root.style.setProperty(key, String(value));
    root.dataset.background = data.site.theme.background;
    root.dataset.wallpaper = String(Boolean(data.site.theme.backgroundImage));
    root.dataset.wallpaperWash = data.site.theme.wallpaperWash;
    root.dataset.reduceTransparency = String(data.site.theme.reduceTransparency);
    root.dataset.reduceMotion = String(data.site.theme.reduceMotion);
    const preference = localStorage.getItem('fieldnotes-appearance') || data.site.theme.appearance;
    root.dataset.theme =
      preference === 'system'
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : preference;
    document.title = `${data.site.name} Studio`;
  }, [data?.site]);
  useEffect(() => {
    const handler = () => {
      const target = location.hash.slice(1).split('/')[0].split('?')[0] as View;
      if (target === view) return;
      if ([...navigation.flatMap((g) => g.items.map((i) => i.id)), 'trash'].includes(target)) {
        void go(target, location.hash.split('/')[1]?.split('?')[0]);
      }
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  });
  async function go(target: View, tab?: string) {
    try {
      await flushRef.current?.();
      setSelected(null);
      if (target === 'trash') setTrashKind(tab || 'all');
      else if (tab) setSettingsTab(tab);
      setView(target);
      setSidebar(false);
      history.replaceState(
        null,
        '',
        `#${target}${tab && ['settings', 'appearance'].includes(target) ? '/' + tab : ''}`,
      );
      setSaveStatus('All changes saved');
    } catch (e) {
      setError((e as Error).message);
      history.replaceState(null, '', `#${view}`);
    }
  }
  async function openEntry(entry: PublicEntry) {
    try {
      await flushRef.current?.();
      setView(entry.kind === 'posts' ? 'writing' : 'lab');
      setSelected(entry.id);
      setSaveStatus('All changes saved');
      setSidebar(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function newEntry(kind: 'posts' | 'lab') {
    try {
      await flushRef.current?.();
      setCreateKind(kind);
      setTitle('');
      setSlug('');
      setSlugEdited(false);
      setCreateError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function create() {
    if (!createKind) return;
    setCreating(true);
    setCreateError('');
    try {
      const entry = await send<PublicEntry>('content', 'POST', {
        kind: createKind,
        title: title.trim(),
        slug,
      });
      setData((d) => (d ? { ...d, entries: [entry, ...d.entries] } : d));
      setCreateKind(null);
      await openEntry(entry);
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  async function build(action: 'build' | 'publish') {
    try {
      setError('');
      await flushRef.current?.();
      const job = await send<Job>('jobs', 'POST', { action });
      setData((d) =>
        d && !d.jobs.some((current) => current.id === job.id)
          ? { ...d, jobs: [job, ...d.jobs] }
          : d,
      );
      setSelected(null);
      setView('builds');
      history.replaceState(null, '', '#builds');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function onSaved(entry: PublicEntry) {
    setData((current) =>
      current
        ? { ...current, entries: current.entries.map((e) => (e.id === entry.id ? entry : e)) }
        : current,
    );
  }
  async function trash(entry: PublicEntry) {
    await send(`content/${entry.id}`, 'DELETE', { revision: entry.revision });
    setSelected(null);
    await refresh();
  }
  function saveSite(site: SiteConfig, revision: string) {
    setData((d) => (d ? { ...d, site, siteRevision: revision } : d));
  }
  function saveLibrary(library: Library, revision: string) {
    setData((d) => (d ? { ...d, library, libraryRevision: revision } : d));
  }
  if (!data)
    return (
      <div className="studio-boot">
        <Brand />
        <span className="boot-loader" />
        <p>{error || t('Opening your notebook…')}</p>
        {error && (
          <Button
            icon="RotateCcw"
            onClick={() => {
              void refresh();
            }}
          >
            <UiText message={'Try again'} />
          </Button>
        )}
      </div>
    );
  const entry = data.entries.find((e) => e.id === selected);
  const active =
    !!data.runtime?.busy || data.jobs.some((j) => !['succeeded', 'failed'].includes(j.state));
  const configured = data.runtime
    ? !!data.runtime.buildsConfigured && !data.runtime.preview
    : !!(
        data.site.cloudflare.accountId &&
        data.site.cloudflare.projectName &&
        new URL(data.site.url).hostname !== 'example.com'
      );
  const labelFor = (item: { id: View; label: string }) =>
    item.id === 'writing'
      ? collectionLabel(data.site, 'posts')
      : item.id === 'lab'
        ? collectionLabel(data.site, 'lab')
        : item.id === 'photos'
          ? collectionLabel(data.site, 'life')
          : t(item.label);
  const currentItem = navigation.flatMap((g) => g.items).find((i) => i.id === view);
  const currentLabel = currentItem ? labelFor(currentItem) : t('Trash');
  return (
    <div className={`studio-app ${sidebar ? 'sidebar-open' : ''}`}>
      <a className="skip-link" href="#studio-main" data-ui={'Skip to workspace'}>
        {t('Skip to workspace')}
      </a>
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label={t('Close sidebar')}
          onClick={() => setSidebar(false)}
          data-ui-attrs={'{"aria-label":"Close sidebar"}'}
        />
      )}
      <aside className="studio-sidebar">
        <a
          className="studio-brand"
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            void go('overview');
          }}
        >
          <Brand name={data.site.name} />
          <span className="studio-word" data-ui={'Studio'}>
            {t('Studio')}
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">{data.site.profile.name[0]}</span>
          <div>
            <strong data-ui={'Your personal space'}>{t('Your personal space')}</strong>
            <small>
              {data.runtime ? t('Private · Cloud workspace') : t('Private · Local workspace')}
            </small>
          </div>
          <Icon name="ChevronDown" size={13} />
        </div>
        <nav
          aria-label={t('Studio navigation')}
          data-ui-attrs={'{"aria-label":"Studio navigation"}'}
        >
          {navigation.map((group) => (
            <div className="sidebar-group" key={t(group.group)}>
              <p>{t(group.group)}</p>
              {group.items
                .filter((item) => item.id !== 'hosting' || data.runtime?.mode === 'cloud')
                .map((item) => (
                  <button
                    className={view === item.id ? 'active' : ''}
                    aria-current={view === item.id ? 'page' : undefined}
                    key={item.id}
                    title={
                      item.id === 'analytics' && !data.site.integrations.aca.enabled
                        ? t('Analytics is disabled. Enable ACA in Site settings.')
                        : labelFor(item)
                    }
                    disabled={item.id === 'analytics' && !data.site.integrations.aca.enabled}
                    onClick={() => {
                      void go(item.id);
                    }}
                  >
                    <Icon name={item.icon} size={17} />
                    <span>{labelFor(item)}</span>
                    {['writing', 'lab'].includes(item.id) && (
                      <small>
                        {
                          data.entries.filter(
                            (e) => e.kind === (item.id === 'writing' ? 'posts' : 'lab'),
                          ).length
                        }
                      </small>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            className={`sidebar-trash ${view === 'trash' ? 'active' : ''}`}
            aria-current={view === 'trash' ? 'page' : undefined}
            onClick={() => {
              void go('trash');
            }}
          >
            <Icon name="Trash2" size={17} />
            <UiText message={'Trash'} />
          </button>
          <div className="local-status" aria-live="polite" aria-atomic="true">
            <span className={`status-dot ${connected ? '' : 'disconnected'}`} />
            <span>
              {connected
                ? data.runtime
                  ? t('Saved privately in Cloudflare')
                  : t('Saved on this computer')
                : t('Reconnecting to Studio…')}
            </span>
          </div>
        </div>
      </aside>
      {commandsOpen && (
        <CommandPalette
          entries={data.entries}
          collections={data.site.collections}
          onClose={() => setCommandsOpen(false)}
          onOpen={openEntry}
          commands={[
            {
              id: 'command-new-writing',
              label: `New ${data.site.collections.posts.singular.toLocaleLowerCase()}`,
              detail: 'Create a Markdown draft',
              run: () => newEntry('posts'),
            },
            {
              id: 'command-new-lab',
              label: `New ${data.site.collections.lab.singular.toLocaleLowerCase()}`,
              detail: `Create a draft in ${data.site.collections.lab.name}`,
              run: () => newEntry('lab'),
            },
            { id: 'command-backups', label: 'Manage backups', run: () => go('backups') },
            { id: 'command-media', label: 'Media usage and cleanup', run: () => go('media') },
            { id: 'command-shortlinks', label: 'Manage short links', run: () => go('shortlinks') },
            { id: 'command-homepage', label: 'Set up homepage', run: () => go('homepage') },
            { id: 'command-build', label: 'Build published pages', run: () => build('build') },
          ]}
        />
      )}
      <div className="studio-main-column">
        <header className="studio-topbar glass">
          <div className="studio-breadcrumb">
            <button
              className="icon-button sidebar-toggle"
              aria-label={t('Open sidebar')}
              onClick={() => setSidebar(!sidebar)}
              data-ui-attrs={'{"aria-label":"Open sidebar"}'}
            >
              <Icon name="Menu" size={18} />
            </button>
            <Icon name="Home" size={14} />
            <span className="breadcrumb-slash">/</span>
            <span>{currentLabel}</span>
            <StudioVersion />
            {entry && (
              <>
                <span className="breadcrumb-slash">/</span>
                <span className="breadcrumb-entry">{entry.title}</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label={t('Open command palette')}
              title={t('Studio commands · ⌘/Ctrl K')}
              onClick={() => setCommandsOpen(true)}
              data-ui-attrs={
                '{"aria-label":"Open command palette","title":"Studio commands · ⌘/Ctrl K"}'
              }
            >
              <Icon name="Search" size={17} />
            </button>
            <span className={`save-status ${saveStatus === 'All changes saved' ? '' : 'pending'}`}>
              <Icon
                name={
                  saveStatus === 'Saving…'
                    ? 'LoaderCircle'
                    : saveStatus === 'All changes saved'
                      ? 'CheckCheck'
                      : 'Circle'
                }
                size={13}
                className={saveStatus === 'Saving…' ? 'spin' : ''}
              />
              {t(saveStatus)}
            </span>
            <button
              className="icon-button"
              aria-label={t('Toggle Studio appearance')}
              onClick={() => {
                const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
                document.documentElement.dataset.theme = next;
                localStorage.setItem('fieldnotes-appearance', next);
              }}
              data-ui-attrs={'{"aria-label":"Toggle Studio appearance"}'}
            >
              <Icon name="SunMoon" size={17} />
            </button>
            <LanguageControl />
            <a
              className="sidebar-site-link"
              href={data.runtime?.siteOrigin || '/'}
              target="_blank"
              rel="noreferrer"
              aria-label={t('View notebook')}
              title={t('View notebook')}
            >
              <Icon name="BookOpen" size={17} />
              <span data-ui={'View notebook'}>{t('View notebook')}</span>
              <Icon name="ExternalLink" size={12} />
            </a>
            <span className="topbar-separator" />
            <Button
              className="small build-header-button"
              aria-label={data.runtime ? t('Check source') : t('Build')}
              title={data.runtime ? t('Validate source without publishing') : t('Build site')}
              icon={active ? 'LoaderCircle' : 'Play'}
              disabled={active}
              onClick={() => {
                void build('build');
              }}
            >
              <span className="build-button-label">
                {data.runtime ? t('Check source') : t('Build')}
              </span>
            </Button>
            <Button
              className="small publish-header-button"
              variant="primary"
              aria-label={t('Build & Publish')}
              icon="CloudUpload"
              disabled={active || !configured}
              title={
                configured
                  ? data.runtime
                    ? t('Build and deploy with Workers Builds')
                    : t('Build and upload to Cloudflare Pages')
                  : data.runtime
                    ? t('Configure Workers Builds in Hosting first')
                    : t('Connect Cloudflare Pages in Site settings first')
              }
              onClick={() => {
                void build('publish');
              }}
            >
              <UiText message={'Build & Publish'} />
            </Button>
          </div>
        </header>
        <main id="studio-main" className={`studio-main ${entry ? 'editing' : ''}`}>
          {error && (
            <div className="global-error">
              <ErrorBox error={error} />
              <button
                className="icon-button"
                aria-label={t('Dismiss error')}
                onClick={() => setError('')}
                data-ui-attrs={'{"aria-label":"Dismiss error"}'}
              >
                <Icon name="X" size={15} />
              </button>
            </div>
          )}
          <Suspense
            fallback={
              <div className="preview-loading">
                <Icon name="LoaderCircle" className="spin" />
                <p data-ui={'Opening your workspace…'}>{t('Opening your workspace…')}</p>
              </div>
            }
          >
            {entry ? (
              <Editor
                key={entry.id}
                entry={entry}
                onSaved={onSaved}
                site={data.site}
                onDuplicated={async (copy) => {
                  await refresh();
                  await openEntry(copy);
                }}
                onConverted={openEntry}
                onBack={() => {
                  void go(view);
                }}
                onTrash={trash}
                flushRef={flushRef}
                onStatus={setSaveStatus}
              />
            ) : view === 'overview' ? (
              <Overview
                data={data}
                navigate={(v, t) => {
                  void go(v, t);
                }}
                open={(e) => {
                  void openEntry(e);
                }}
                create={(k) => {
                  void newEntry(k);
                }}
              />
            ) : view === 'writing' || view === 'lab' ? (
              <ContentList
                entries={data.entries}
                collections={data.site.collections}
                siteUrl={data.site.url}
                onChanged={refresh}
                kind={view === 'writing' ? 'posts' : 'lab'}
                onOpen={(e) => {
                  void openEntry(e);
                }}
                onCreate={() => {
                  void newEntry(view === 'writing' ? 'posts' : 'lab');
                }}
              />
            ) : view === 'shortlinks' ? (
              <ShortLinks
                entries={data.entries}
                collections={data.site.collections}
                siteUrl={data.site.url}
                onChanged={refresh}
                onOpen={(entry) => {
                  void openEntry(entry);
                }}
              />
            ) : view === 'archive' ? (
              <Archive
                entries={data.entries}
                site={data.site}
                onOpen={(entry) => {
                  void openEntry(entry);
                }}
              />
            ) : view === 'analytics' ? (
              data.site.integrations.aca.enabled ? (
                <Analytics
                  site={data.site}
                  library={data.library}
                  entries={data.entries}
                  onSettings={() => {
                    void go('settings', 'aca');
                  }}
                />
              ) : (
                <div className="studio-page analytics-disabled">
                  <PageHeading eyebrow={t('Advanced Customized Analytics')} title={t('Analytics')}>
                    <Button icon="Settings2" onClick={() => void go('settings', 'aca')}>
                      {t('Configure ACA')}
                    </Button>
                  </PageHeading>
                  <EmptyState icon="ChartNoAxesCombined" title={t('Analytics is disabled')}>
                    {t('Enable ACA in Site settings → Advanced analytics to view reports.')}
                  </EmptyState>
                </div>
              )
            ) : view === 'projects' ? (
              <Projects
                value={data.projects || emptyProjects()}
                revision={data.projectsRevision || ''}
                flushRef={flushRef}
                onStatus={setSaveStatus}
                onSaved={(projects, projectsRevision) =>
                  setData((current) => current && { ...current, projects, projectsRevision })
                }
              />
            ) : view === 'homepage' ? (
              <HomeSettings
                site={data.site}
                revision={data.siteRevision}
                entries={data.entries}
                library={data.library}
                flushRef={flushRef}
                onSaved={saveSite}
                onStatus={setSaveStatus}
                onProfile={() => {
                  void go('about', 'profile');
                }}
              />
            ) : view === 'about' ? (
              <About
                initialTab={settingsTab === 'profile' ? 'profile' : 'story'}
                document={data.about}
                site={data.site}
                siteRevision={data.siteRevision}
                onSiteSaved={saveSite}
                onIntegrations={() => {
                  void go('settings', 'discussions');
                }}
                flushRef={flushRef}
                onStatus={setSaveStatus}
                onSaved={(about) => setData((d) => (d ? { ...d, about } : d))}
              />
            ) : view === 'photos' ? (
              <PhotoJournal
                collections={data.site.collections}
                library={data.library}
                revision={data.libraryRevision}
                onSaved={saveLibrary}
                onOpenTrash={() => {
                  void go('trash', 'photos');
                }}
              />
            ) : view === 'media' ? (
              <MediaLibrary
                siteUrl={data.site.url}
                onOpenReference={(reference) => {
                  const entry =
                    reference.entryId &&
                    data.entries.find((entry) => entry.id === reference.entryId);
                  if (entry) void openEntry(entry);
                  else void go(reference.view, reference.tab);
                }}
              />
            ) : view === 'appearance' || view === 'settings' ? (
              <Settings
                key={view}
                site={data.site}
                revision={data.siteRevision}
                appearance={view === 'appearance'}
                initialTab={settingsTab}
                onReset={refresh}
                flushRef={flushRef}
                onSaved={saveSite}
                onStatus={setSaveStatus}
                articleRoute={
                  data.entries.find(
                    (entry) => entry.status === 'published' && entry.kind === 'posts',
                  )
                    ? routeFor(
                        data.entries.find(
                          (entry) => entry.status === 'published' && entry.kind === 'posts',
                        )!,
                        data.site.collections,
                      )
                    : undefined
                }
              />
            ) : view === 'builds' ? (
              <Builds
                cloud={data.runtime?.mode === 'cloud'}
                jobs={data.jobs}
                entries={data.entries}
                site={data.site}
                onBuild={build}
                onRefresh={refresh}
                onOpenEntry={(entry) => {
                  void openEntry(entry);
                }}
                onConnect={() => {
                  void go(
                    data.runtime ? 'hosting' : 'settings',
                    data.runtime ? undefined : 'cloudflare',
                  );
                }}
                configured={configured}
              />
            ) : view === 'hosting' ? (
              <Hosting />
            ) : view === 'backups' ? (
              <Backups onRestored={refresh} />
            ) : (
              <Trash
                key={trashKind}
                initialKind={trashKind}
                libraryRevision={data.libraryRevision}
                collections={data.site.collections}
                onRestored={refresh}
              />
            )}
          </Suspense>
        </main>
      </div>
      {createKind && (
        <Modal
          title={
            createKind === 'posts'
              ? t('The start of something.')
              : t('Follow an interesting question.')
          }
          onClose={() => setCreateKind(null)}
          footer={
            <>
              <Button onClick={() => setCreateKind(null)}>
                <UiText message={'Cancel'} />
              </Button>
              <Button
                variant="primary"
                icon="Plus"
                disabled={!title.trim() || !slug || creating}
                onClick={() => {
                  void create();
                }}
              >
                {creating ? t('Creating…') : t('Create draft')}
              </Button>
            </>
          }
        >
          <p
            className="modal-intro"
            data-ui={'It doesn’t have to be perfect. A title is a good place to begin.'}
          >
            {t('It doesn’t have to be perfect. A title is a good place to begin.')}
          </p>
          <Field label={t('Title')}>
            <input
              autoFocus
              data-modal-focus
              value={title}
              placeholder={
                createKind === 'posts'
                  ? t('Something I’ve been thinking about')
                  : t('What happens when…')
              }
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugEdited) setSlug(headingSlug(e.target.value));
              }}
            />
          </Field>
          <Field
            label={t('URL slug')}
            help={t('Your {value0} will live at {value1}{value2}/', {
              value0: data.site.collections[createKind].singular.toLocaleLowerCase(),
              value1: collectionIndexRoute(createKind, data.site.collections),
              value2: slug || 'your-title',
            })}
          >
            <input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugEdited(true);
              }}
            />
          </Field>
          <ErrorBox error={createError} />
        </Modal>
      )}
    </div>
  );
}
