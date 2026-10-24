import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState } from 'react';
import { Icon, Button } from '../shared/ui.js';
import type { MaintenanceSummary } from '../shared/operations.js';
import type { PublicEntry } from '../shared/contracts.js';
import { Modal, ErrorBox } from './components.js';
import { api } from './api.js';
export function MaintenanceCards({
  navigate,
}: {
  navigate: (view: 'backups' | 'media' | 'builds') => void;
}) {
  const [data, setData] = useState<MaintenanceSummary>(),
    [error, setError] = useState('');
  useEffect(() => {
    const load = () =>
      void api<MaintenanceSummary>('maintenance')
        .then((data) => {
          setData(data);
          setError('');
        })
        .catch((error) => setError(error.message));
    load();
    window.addEventListener('studio-filesystem', load);
    return () => window.removeEventListener('studio-filesystem', load);
  }, []);
  return (
    <>
      <ErrorBox error={error} />
      <section
        className="maintenance-grid"
        aria-label={t('Notebook maintenance')}
        data-ui-attrs={'{"aria-label":"Notebook maintenance"}'}
      >
        <article className="maintenance-card glass-panel">
          <h3>
            <Icon name="HardDrive" size={17} />
            <UiText message={'Backups'} />
          </h3>
          <p>
            {data
              ? data.latestBackup
                ? 'Last backup: ' + new Date(data.latestBackup).toLocaleString()
                : t('No backup saved yet.')
              : t('Checking backups…')}
          </p>
          <p>{data && (data.backupBytes / 1048576).toFixed(1) + ' MiB saved locally'}</p>
          <Button className="small" icon="ArrowRight" onClick={() => navigate('backups')}>
            <UiText message={'Manage backups'} />
          </Button>
        </article>
        <article className="maintenance-card glass-panel">
          <h3>
            <Icon name="Image" size={17} />
            <UiText message={'Media'} />
          </h3>
          <p>
            {data?.auditPending
              ? t('Open Media to run a complete reference audit.')
              : data
                ? t('{value0} missing · {value1} unused', {
                    value0: data.missing,
                    value1: data.unused,
                  })
                : t('Checking media references…')}
          </p>
          <p>{data && (data.mediaBytes / 1048576).toFixed(1) + ' MiB of public media'}</p>
          {data?.error && (
            <p className="help" data-ui={'Reference checks need attention.'}>
              {t('Reference checks need attention.')}
            </p>
          )}
          <Button className="small" icon="FolderOpen" onClick={() => navigate('media')}>
            <UiText message={'Review media'} />
          </Button>
        </article>
        <article className="maintenance-card glass-panel">
          <h3>
            <Icon name="Layers" size={17} />
            <UiText message={'Build status'} />
          </h3>
          <p>
            {data
              ? data.changedSinceBuild
                ? t('Notebook changed since the last successful build.')
                : t('The last build matches the saved notebook.')
              : t('Checking the last build…')}
          </p>
          <p>{data?.lastBuild && new Date(data.lastBuild).toLocaleString()}</p>
          <Button className="small" icon="ArrowRight" onClick={() => navigate('builds')}>
            <UiText message={'View builds'} />
          </Button>
        </article>
      </section>
    </>
  );
}
export type WorkspaceCommand = {
  id: string;
  label: string;
  detail?: string;
  run: () => void | Promise<void>;
};
export function CommandPalette({
  entries,
  collections,
  commands,
  onOpen,
  onClose,
}: {
  entries: PublicEntry[];
  collections: import('../shared/collections.js').CollectionsConfig;
  commands: WorkspaceCommand[];
  onOpen: (entry: PublicEntry) => void | Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [active, setActive] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const choices: WorkspaceCommand[] = [
    ...commands,
    ...entries.map((entry) => ({
      id: 'entry-' + entry.id,
      label: entry.title,
      detail: `${collections[entry.kind].singular} · ${entry.status}`,
      run: () => onOpen(entry),
    })),
  ]
    .filter((item) =>
      `${item.label} ${item.detail || ''}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 30);
  const current = Math.min(active, Math.max(0, choices.length - 1));
  const run = (item: WorkspaceCommand) => {
    if (busy) return;
    setBusy(true);
    setError('');
    void Promise.resolve()
      .then(item.run)
      .then(onClose)
      .catch((error) => setError(error.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <Modal
      title={t('Studio commands')}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="search-field">
        <Icon name="Search" size={17} />
        <input
          autoFocus
          data-modal-focus
          type="search"
          role="combobox"
          aria-label={t('Search commands and entries')}
          aria-expanded="true"
          aria-controls="studio-command-results"
          aria-activedescendant={choices[current] ? 'command-' + choices[current].id : undefined}
          placeholder={t('Find an entry or action…')}
          value={query}
          disabled={busy}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                ),
              );
            }
            if (event.key === 'Enter' && choices[current]) {
              event.preventDefault();
              run(choices[current]);
            }
          }}
          data-ui-attrs={
            '{"aria-label":"Search commands and entries","placeholder":"Find an entry or action…"}'
          }
        />
      </div>
      <ErrorBox error={error} />
      <div
        ref={list}
        className="command-results"
        role="listbox"
        id="studio-command-results"
        aria-label={t('Commands and entries')}
        data-ui-attrs={'{"aria-label":"Commands and entries"}'}
      >
        {choices.map((item, index) => (
          <button
            className="command-result"
            type="button"
            role="option"
            aria-selected={current === index}
            id={'command-' + item.id}
            key={item.id}
            disabled={busy}
            onClick={() => run(item)}
          >
            {item.label}
            {item.detail && <small>{item.detail}</small>}
          </button>
        ))}
        {!choices.length && (
          <p className="help" data-ui={'No matching entries or actions.'}>
            {t('No matching entries or actions.')}
          </p>
        )}
      </div>
      <p className="help" data-ui={'Arrow keys to select · Enter to open · Escape to close'}>
        {t('Arrow keys to select · Enter to open · Escape to close')}
      </p>
    </Modal>
  );
}
